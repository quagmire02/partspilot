import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CatalogPart, JobResultPayload, PlannerOutput, type InventoryItem } from "@partspilot/shared";
import type { CatalogMatchRow, JobPartRow, JobRow, PhotoStore, ReferenceProjectRow, Repo } from "./types.js";

const JOB_COLUMNS =
  "id,user_id,client_request_id,source,goal,intent,status,stage,plan_version,error_code,photo_count,photo_paths,photo_meta,image_set_hash,photos_deleted_at,summary,created_at,updated_at";
const PART_COLUMNS =
  "id,job_id,user_id,image_index,bbox,label,visible_text,detection_confidence,candidates,part_id,confidence,quantity,status,duplicate";

/** Thrown on any PostgREST/Storage failure; the message is a code, never row data. */
class DbError extends Error {
  constructor(op: string, readonly pgCode?: string) {
    super(`db_error:${op}${pgCode ? `:${pgCode}` : ""}`);
  }
}

function check<T>(op: string, r: { data: T; error: { code?: string } | null }): T {
  if (r.error) throw new DbError(op, r.error.code);
  return r.data;
}

/** Service-role client. Lives only in the Worker; never shipped to a client bundle. */
export function createServiceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createSupabaseRepo(sb: SupabaseClient): Repo {
  return {
    async createJob(a) {
      const rows = check(
        "create_job",
        await sb.rpc("create_job", {
          p_user: a.userId,
          p_client_request_id: a.clientRequestId,
          p_source: a.source,
          p_goal: a.goal,
          p_photo_count: a.photoCount,
          p_limit: a.limit,
        }),
      ) as { job_id: string | null; duplicate: boolean; allowed: boolean; used: number }[];
      const r = rows[0];
      if (!r) throw new DbError("create_job_empty");
      return { jobId: r.job_id, duplicate: r.duplicate, allowed: r.allowed, used: r.used };
    },

    async refundJob(jobId) {
      check("refund_job", await sb.rpc("refund_job", { p_job: jobId }));
    },

    async quotaUsed(userId) {
      return Number(check("quota_used", await sb.rpc("quota_used", { p_user: userId })) ?? 0);
    },

    async findJobByRequest(userId, clientRequestId) {
      const row = check(
        "find_job",
        await sb.from("jobs").select("id").eq("user_id", userId).eq("client_request_id", clientRequestId).maybeSingle(),
      ) as { id: string } | null;
      return row?.id ?? null;
    },

    async getJob(jobId, userId) {
      let q = sb.from("jobs").select(JOB_COLUMNS).eq("id", jobId);
      if (userId) q = q.eq("user_id", userId);
      return check("get_job", await q.maybeSingle()) as JobRow | null;
    },

    async listJobs(userId, q) {
      let query = sb
        .from("jobs")
        .select(JOB_COLUMNS)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(q.limit);
      if (q.updatedAfter) query = query.gt("updated_at", q.updatedAfter);
      if (q.before) query = query.lt("created_at", q.before);
      return check("list_jobs", await query) as JobRow[];
    },

    async updateJob(jobId, patch, opts) {
      let q = sb.from("jobs").update(patch).eq("id", jobId);
      if (opts?.expectPlanVersion !== undefined) q = q.eq("plan_version", opts.expectPlanVersion);
      return check("update_job", await q.select(JOB_COLUMNS).maybeSingle()) as JobRow | null;
    },

    async deleteJob(jobId, userId) {
      const rows = check("delete_job", await sb.from("jobs").delete().eq("id", jobId).eq("user_id", userId).select("id"));
      return (rows as unknown[]).length > 0;
    },

    async listJobParts(jobId) {
      return check(
        "list_parts",
        await sb.from("job_parts").select(PART_COLUMNS).eq("job_id", jobId).order("created_at").order("id"),
      ) as JobPartRow[];
    },

    async replaceDetectedParts(jobId, rows) {
      check("delete_parts", await sb.from("job_parts").delete().eq("job_id", jobId));
      if (rows.length) check("insert_parts", await sb.from("job_parts").insert(rows));
    },

    async insertJobParts(rows) {
      if (rows.length) check("insert_parts", await sb.from("job_parts").insert(rows));
    },

    async updateJobPart(id, patch) {
      check("update_part", await sb.from("job_parts").update(patch).eq("id", id));
    },

    async applyInventory(jobId) {
      check("apply_inventory", await sb.rpc("apply_job_inventory", { p_job: jobId }));
    },

    async saveResult(jobId, userId, planVersion, payload) {
      check(
        "save_result",
        await sb
          .from("job_results")
          .upsert({ job_id: jobId, user_id: userId, plan_version: planVersion, payload }, { onConflict: "job_id,plan_version" }),
      );
    },

    async latestResult(jobId) {
      const row = check(
        "latest_result",
        await sb
          .from("job_results")
          .select("payload")
          .eq("job_id", jobId)
          .order("plan_version", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ) as { payload: unknown } | null;
      if (!row) return null;
      const parsed = JobResultPayload.safeParse(row.payload);
      return parsed.success ? parsed.data : null;
    },

    async issueTickets(userId, max, ttlS) {
      return check(
        "issue_tickets",
        await sb.rpc("issue_upload_tickets", { p_user: userId, p_max: max, p_ttl_s: ttlS }),
      ) as { id: string; expires_at: string }[];
    },

    async consumeTicket(userId, ticketId) {
      return check(
        "consume_ticket",
        await sb.rpc("consume_upload_ticket", { p_user: userId, p_ticket: ticketId }),
      ) as boolean;
    },

    async releaseTicket(userId, ticketId) {
      check("release_ticket", await sb.rpc("release_upload_ticket", { p_user: userId, p_ticket: ticketId }));
    },

    async searchCatalog(q, limit) {
      const rows = check("search_catalog", await sb.rpc("search_catalog", { p_query: q, p_limit: limit })) as {
        part_id: string;
        name: string;
        category: string;
        has_profile: boolean;
      }[];
      return rows.map((r) => ({ part_id: r.part_id, name: r.name, category: r.category as never, has_profile: r.has_profile }));
    },

    async getCatalogParts(ids) {
      if (!ids.length) return [];
      const rows = check(
        "catalog_parts",
        await sb
          .from("catalog_parts")
          .select("id,name,category,manufacturer,source,source_ref,license,buy_query,profile")
          .in("id", [...new Set(ids)]),
      ) as unknown[];
      return rows.flatMap((r) => {
        const p = CatalogPart.safeParse(r);
        return p.success ? [p.data] : [];
      });
    },

    async listProfiledParts() {
      const rows = check(
        "profiled_parts",
        await sb
          .from("catalog_parts")
          .select("id,name,category,manufacturer,source,source_ref,license,buy_query,profile")
          .not("profile", "is", null)
          .order("id"),
      ) as unknown[];
      return rows.flatMap((r) => {
        const p = CatalogPart.safeParse(r);
        return p.success ? [p.data] : [];
      });
    },

    async matchCatalog(embedding, query, k) {
      return check(
        "match_catalog",
        await sb.rpc("match_catalog", {
          p_embedding: embedding ? JSON.stringify(embedding) : null,
          p_query: query,
          p_k: k,
        }),
      ) as CatalogMatchRow[];
    },

    async matchReferenceProjects(embedding, k) {
      const rows = check(
        "match_reference",
        await sb.rpc("match_reference_projects", { p_embedding: JSON.stringify(embedding), p_k: k }),
      ) as { id: string; title: string; plan: unknown; similarity: number }[];
      return rows.flatMap((r) => {
        const plan = PlannerOutput.safeParse(r.plan);
        return plan.success ? [{ ...r, plan: plan.data }] : [];
      });
    },

    async listReferenceProjects() {
      const rows = check(
        "list_reference",
        await sb.from("reference_projects").select("id,title,goal_examples,plan").order("id"),
      ) as { id: string; title: string; goal_examples: string[]; plan: unknown }[];
      return rows.flatMap((r) => {
        const plan = PlannerOutput.safeParse(r.plan);
        return plan.success ? [{ id: r.id, title: r.title, goal_examples: r.goal_examples, plan: plan.data, similarity: 0 }] : [];
      });
    },

    async listInventory(userId) {
      const rows = check(
        "inventory",
        await sb
          .from("inventory_items")
          .select("part_id,quantity,updated_at,catalog_parts(name,category)")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false }),
      ) as unknown as {
        part_id: string;
        quantity: number;
        updated_at: string;
        catalog_parts: { name: string; category: string } | null;
      }[];
      return rows.map(
        (r): InventoryItem => ({
          part_id: r.part_id,
          name: r.catalog_parts?.name ?? r.part_id,
          category: (r.catalog_parts?.category ?? "other") as InventoryItem["category"],
          quantity: r.quantity,
          updated_at: r.updated_at,
        }),
      );
    },

    async setInventory(userId, partId, quantity) {
      if (quantity <= 0) {
        check("inventory_delete", await sb.from("inventory_items").delete().eq("user_id", userId).eq("part_id", partId));
        return;
      }
      check(
        "inventory_upsert",
        await sb.from("inventory_items").upsert({ user_id: userId, part_id: partId, quantity }, { onConflict: "user_id,part_id" }),
      );
    },

    async getCache<T>(userId: string, key: string) {
      const row = check(
        "cache_get",
        await sb.from("result_cache").select("payload").eq("user_id", userId).eq("key", key).maybeSingle(),
      ) as { payload: T } | null;
      return row?.payload ?? null;
    },

    async setCache(userId, key, kind, payload) {
      check(
        "cache_set",
        await sb.from("result_cache").upsert({ user_id: userId, key, kind, payload, created_at: new Date().toISOString() }),
      );
    },

    async expiredPhotos(days, limit) {
      return check("expired_photos", await sb.rpc("jobs_with_expired_photos", { p_days: days, p_limit: limit })) as {
        id: string;
        photo_paths: string[];
      }[];
    },

    async markPhotosDeleted(ids) {
      return Number(check("mark_deleted", await sb.rpc("mark_photos_deleted", { p_ids: ids })) ?? 0);
    },

    async purgeCache(days) {
      return Number(check("purge_cache", await sb.rpc("purge_result_cache", { p_days: days })) ?? 0);
    },
  };
}

export function createSupabasePhotoStore(sb: SupabaseClient, bucket: string): PhotoStore {
  const b = () => sb.storage.from(bucket);
  return {
    async put(path, bytes, mime) {
      const { error } = await b().upload(path, bytes, { contentType: mime, upsert: true, cacheControl: "private, max-age=0" });
      if (error) throw new DbError("storage_put");
    },
    async get(path) {
      const { data, error } = await b().download(path);
      if (error || !data) throw new DbError("storage_get");
      return new Uint8Array(await data.arrayBuffer());
    },
    async signedUrls(paths, ttlS) {
      if (!paths.length) return [];
      const { data, error } = await b().createSignedUrls(paths, ttlS);
      if (error || !data) throw new DbError("storage_sign");
      const byPath = new Map(data.map((d) => [d.path, d.error ? null : d.signedUrl]));
      return paths.map((p) => byPath.get(p) ?? null);
    },
    async remove(paths) {
      if (!paths.length) return;
      const { error } = await b().remove(paths);
      if (error) throw new DbError("storage_remove");
    },
  };
}

export type { ReferenceProjectRow };
