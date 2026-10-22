import { Hono } from "hono";
import { CreateJobFields, LIMITS, UploadTicketsRequest } from "@partspilot/shared";
import type { AppEnv } from "../app.js";
import type { PhotoMeta } from "../db/types.js";
import { HttpError } from "../lib/errors.js";
import { cleanImage, sha256Hex, type CleanImage } from "../lib/images.js";
import { log } from "../lib/log.js";
import { quotaFor, secondsUntil } from "../lib/quota.js";

export const uploadRoutes = new Hono<AppEnv>();

/** Multipart overhead allowance on top of the photo bytes. */
const MAX_BODY = LIMITS.MAX_PHOTOS * LIMITS.MAX_PHOTO_BYTES + 256 * 1024;

uploadRoutes.post("/upload-tickets", async (c) => {
  const { repo, limiters, verifyTurnstile } = c.get("deps");
  const user = c.get("user");
  if (!(await limiters.upload.allow(`upload:${user.id}`))) throw new HttpError("rate_limited", 60);
  const body = UploadTicketsRequest.parse(await c.req.json().catch(() => ({})));
  if (!(await verifyTurnstile(body.turnstile_token, c.get("ip")))) throw new HttpError("turnstile_failed");
  const tickets = await repo.issueTickets(user.id, LIMITS.MAX_UPLOAD_TICKETS, LIMITS.UPLOAD_TICKET_TTL_S);
  return c.json({ tickets: tickets.map((t) => ({ id: t.id, expires_at: new Date(t.expires_at).toISOString() })) });
});

uploadRoutes.post("/jobs", async (c) => {
  const { repo, photos, enqueue, limiters, verifyTurnstile, now } = c.get("deps");
  const user = c.get("user");
  if (!(await limiters.upload.allow(`upload:${user.id}`))) throw new HttpError("rate_limited", 60);

  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > MAX_BODY) throw new HttpError("payload_too_large");
  if (!(c.req.header("content-type") ?? "").startsWith("multipart/form-data")) throw new HttpError("bad_request");

  const form = await c.req.formData().catch(() => {
    throw new HttpError("bad_request");
  });
  const goalRaw = form.get("goal");
  if (typeof goalRaw === "string" && goalRaw.length > LIMITS.MAX_GOAL_CHARS) throw new HttpError("goal_too_long");
  const fields = CreateJobFields.safeParse({
    client_request_id: form.get("client_request_id"),
    goal: typeof goalRaw === "string" ? goalRaw : "",
    turnstile_token: form.get("turnstile_token") || undefined,
    upload_ticket: form.get("upload_ticket") || undefined,
  });
  if (!fields.success) throw new HttpError("bad_request");
  const f = fields.data;

  const files = form.getAll("photos").filter((p): p is File => typeof p !== "string");
  if (files.length === 0) throw new HttpError("no_photos");
  if (files.length > LIMITS.MAX_PHOTOS) throw new HttpError("too_many_photos");
  if (files.some((file) => file.size > LIMITS.MAX_PHOTO_BYTES)) throw new HttpError("payload_too_large");

  // Idempotent replay (offline queue): answer before spending a ticket or Turnstile token.
  const existing = await repo.findJobByRequest(user.id, f.client_request_id);
  if (existing) {
    const used = await repo.quotaUsed(user.id);
    return c.json({ job_id: existing, status: "processing", duplicate: true, quota: quotaFor(used, now()) }, 202);
  }

  // Sanitize before spending abuse budget: rejects non-images, strips metadata.
  const cleaned: CleanImage[] = [];
  for (const file of files) cleaned.push(await cleanImage(new Uint8Array(await file.arrayBuffer())));

  if (f.upload_ticket) {
    if (!(await repo.consumeTicket(user.id, f.upload_ticket))) throw new HttpError("ticket_invalid");
  } else if (!(await verifyTurnstile(f.turnstile_token!, c.get("ip")))) {
    throw new HttpError("turnstile_failed");
  }

  const created = await repo.createJob({
    userId: user.id,
    clientRequestId: f.client_request_id,
    source: "photo",
    goal: f.goal,
    photoCount: cleaned.length,
    limit: LIMITS.DAILY_JOBS,
  });
  if (!created.allowed || !created.jobId) {
    if (f.upload_ticket) await repo.releaseTicket(user.id, f.upload_ticket);
    const q = quotaFor(LIMITS.DAILY_JOBS, now());
    throw new HttpError("quota_exceeded", secondsUntil(q.resets_at, now()));
  }
  const jobId = created.jobId;
  if (created.duplicate) {
    return c.json({ job_id: jobId, status: "processing", duplicate: true, quota: quotaFor(created.used, now()) }, 202);
  }

  try {
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
    const paths = cleaned.map((img, i) => `${user.id}/${jobId}/${i}.${ext[img.mime]}`);
    await Promise.all(cleaned.map((img, i) => photos.put(paths[i]!, img.bytes, img.mime)));
    const meta: PhotoMeta[] = cleaned.map((img, i) => ({
      index: i,
      width: img.width,
      height: img.height,
      bytes: img.bytes.length,
      sha256: img.sha256,
      mime: img.mime,
    }));
    const imageSetHash = await sha256Hex(cleaned.map((x) => x.sha256).sort().join(","));
    await repo.updateJob(jobId, { photo_paths: paths, photo_meta: meta, image_set_hash: imageSetHash });
    await enqueue({ type: "detect", job_id: jobId });
  } catch (err) {
    log("job_create_failed", { job_id: jobId, user_id: user.id, code: "internal" });
    await repo.refundJob(jobId).catch(() => undefined);
    throw err instanceof HttpError ? err : new HttpError("internal");
  }

  log("job_created", { job_id: jobId, user_id: user.id, n: cleaned.length });
  return c.json({ job_id: jobId, status: "processing", duplicate: false, quota: quotaFor(created.used, now()) }, 202);
});
