import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { api, enabled, localStack, photo, testUser, TURNSTILE_TEST_TOKEN, waitFor } from "../support/local";

/** Real Postgres RLS + Storage policies + Worker checks, attacked from a second account. */
describe.runIf(enabled)("cross-user isolation on the local stack", () => {
  it("user B cannot read, change, list or download user A's data by any route", async () => {
    const a = await testUser("iso-a");
    const b = await testUser("iso-b");
    const form = new FormData();
    form.set("client_request_id", crypto.randomUUID());
    form.set("goal", "A's private goal");
    form.set("turnstile_token", TURNSTILE_TEST_TOKEN);
    form.append("photos", new Blob([photo() as BlobPart], { type: "image/jpeg" }), "p.jpg");
    const { job_id } = (await (await api("/v1/jobs", a.token, { method: "POST", body: form })).json()) as { job_id: string };
    await waitFor(async () => {
      const r = (await (await api(`/v1/jobs/${job_id}`, a.token)).json()) as { job: { status: string } };
      return r.job.status === "processing" ? null : r;
    }, 30_000);

    // Worker API
    expect((await api(`/v1/jobs/${job_id}`, b.token)).status).toBe(404);
    expect((await api(`/v1/jobs/${job_id}`, b.token, { method: "DELETE" })).status).toBe(404);
    expect((await api(`/v1/jobs/${job_id}/parts`, b.token, { method: "PUT", body: JSON.stringify({ plan_version: 0, parts: [] }) })).status).toBe(404);
    expect(((await (await api("/v1/jobs", b.token)).json()) as { items: unknown[] }).items).toEqual([]);
    expect(((await (await api("/v1/inventory", b.token)).json()) as { items: unknown[] }).items).toEqual([]);

    // Direct PostgREST + Storage with B's own JWT and the public anon key
    const s = localStack();
    const asB = createClient(s.url, s.anonKey, { auth: { persistSession: false }, global: { headers: { authorization: `Bearer ${b.token}` } } });
    for (const table of ["jobs", "job_parts", "job_results", "inventory_items", "usage_daily", "upload_tickets", "result_cache"]) {
      const { data, error } = await asB.from(table).select("*");
      expect(error, table).toBeNull();
      expect(data, table).toEqual([]);
    }
    const ins = await asB.from("jobs").insert({ user_id: b.id, client_request_id: crypto.randomUUID(), source: "photo" });
    expect(ins.error?.code).toBe("42501"); // permission denied: clients never write
    const rpc = await asB.rpc("create_job", { p_user: b.id, p_client_request_id: crypto.randomUUID(), p_source: "photo", p_goal: "", p_photo_count: 1, p_limit: 1000 });
    expect(rpc.error).not.toBeNull(); // server functions are not exposed to clients
    const list = await asB.storage.from("photos").list(a.id);
    expect(list.data ?? []).toEqual([]);
    const dl = await asB.storage.from("photos").download(`${a.id}/${job_id}/0.jpg`);
    expect(dl.data).toBeNull();

    // Even A's own client cannot fetch the private object without a Worker-signed URL.
    const asA = createClient(s.url, s.anonKey, { auth: { persistSession: false }, global: { headers: { authorization: `Bearer ${a.token}` } } });
    expect((await asA.storage.from("photos").download(`${a.id}/${job_id}/0.jpg`)).data).toBeNull();
    // Anonymous (no JWT) sees nothing at all
    const anon = createClient(s.url, s.anonKey, { auth: { persistSession: false } });
    const anonJobs = await anon.from("jobs").select("*");
    expect(anonJobs.data ?? []).toEqual([]);
  }, 60_000);
});
