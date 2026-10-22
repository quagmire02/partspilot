import { Hono } from "hono";
import { InventoryPlanRequest, LIMITS, PartId, PutInventoryRequest } from "@partspilot/shared";
import type { AppEnv } from "../app.js";
import { HttpError } from "../lib/errors.js";
import { log } from "../lib/log.js";
import { quotaFor, secondsUntil } from "../lib/quota.js";

export const inventoryRoutes = new Hono<AppEnv>();

inventoryRoutes.get("/inventory", async (c) => {
  return c.json({ items: await c.get("deps").repo.listInventory(c.get("user").id) });
});

inventoryRoutes.put("/inventory/:part_id", async (c) => {
  const { repo } = c.get("deps");
  const user = c.get("user");
  const partId = PartId.safeParse(c.req.param("part_id"));
  if (!partId.success) throw new HttpError("not_found");
  const body = PutInventoryRequest.parse(await c.req.json().catch(() => null));
  if (body.quantity > 0 && (await repo.getCatalogParts([partId.data])).length === 0) throw new HttpError("unknown_part");
  await repo.setInventory(user.id, partId.data, body.quantity);
  return c.json({ items: await repo.listInventory(user.id) });
});

/** "What can I build with my inventory?" — a job without photos that goes straight to planning. */
inventoryRoutes.post("/inventory/plan", async (c) => {
  const { repo, enqueue, now } = c.get("deps");
  const user = c.get("user");
  const body = InventoryPlanRequest.parse(await c.req.json().catch(() => null));
  const items = (await repo.listInventory(user.id)).filter((i) => i.quantity > 0);
  if (items.length === 0) throw new HttpError("bad_request");

  const created = await repo.createJob({
    userId: user.id,
    clientRequestId: body.client_request_id,
    source: "inventory",
    goal: body.goal,
    photoCount: 0,
    limit: LIMITS.DAILY_JOBS,
  });
  if (!created.allowed || !created.jobId) {
    const q = quotaFor(LIMITS.DAILY_JOBS, now());
    throw new HttpError("quota_exceeded", secondsUntil(q.resets_at, now()));
  }
  if (!created.duplicate) {
    try {
      await repo.insertJobParts(
        items.slice(0, LIMITS.MAX_PARTS_PER_JOB).map((i) => ({
          job_id: created.jobId!,
          user_id: user.id,
          image_index: null,
          bbox: null,
          label: i.name,
          visible_text: [],
          detection_confidence: 1,
          candidates: [],
          part_id: i.part_id,
          confidence: 1,
          quantity: Math.min(i.quantity, 50),
          status: "confirmed",
          duplicate: false,
        })),
      );
      await repo.updateJob(created.jobId, { stage: "planning" });
      await enqueue({ type: "plan", job_id: created.jobId, plan_version: 0 });
    } catch {
      await repo.refundJob(created.jobId).catch(() => undefined);
      throw new HttpError("internal");
    }
    log("job_created", { job_id: created.jobId, user_id: user.id, n: 0 });
  }
  return c.json({ job_id: created.jobId, quota: quotaFor(created.used, now()) }, 202);
});
