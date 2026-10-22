import type { CatalogPart, JobResultPayload, QueueMessage } from "@partspilot/shared";
import type { Deps, Limiter } from "../../src/deps.js";
import type { JobPartRow, JobRow, PhotoStore, Repo } from "../../src/db/types.js";
import type { AiEngine } from "../../src/pipeline/engine.js";

export const USER_A = "11111111-1111-4111-8111-111111111111";
export const USER_B = "22222222-2222-4222-8222-222222222222";

export const CATALOG: CatalogPart[] = [
  ["arduino-uno-r3", "Arduino Uno R3", "microcontroller"],
  ["l298n-motor-driver", "L298N Dual H-Bridge Motor Driver Module", "motor_driver"],
  ["tt-dc-gear-motor", "TT DC Gear Motor 3-6V", "motor"],
  ["hc-sr04", "HC-SR04 Ultrasonic Distance Sensor", "sensor"],
].map(([id, name, category]) => ({
  id: id!,
  name: name!,
  category: category as CatalogPart["category"],
  manufacturer: null,
  aliases: [],
  source: "curated" as const,
  source_ref: null,
  license: null,
  buy_query: name!,
  profile: null,
}));

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const ts = () => new Date(Date.now() + seq).toISOString();

export class FakeRepo implements Repo {
  jobs = new Map<string, JobRow>();
  parts = new Map<string, JobPartRow>();
  results = new Map<string, JobResultPayload>();
  usage = new Map<string, number>();
  tickets = new Map<string, { user: string; used: boolean; expires: number }>();
  inventory = new Map<string, number>(); // `${user}|${part}`
  cache = new Map<string, unknown>();
  appliedInventory: string[] = [];

  async createJob(a: Parameters<Repo["createJob"]>[0]) {
    const existing = [...this.jobs.values()].find((j) => j.user_id === a.userId && j.client_request_id === a.clientRequestId);
    const used = this.usage.get(a.userId) ?? 0;
    if (existing) return { jobId: existing.id, duplicate: true, allowed: true, used };
    if (a.limit <= 0 || used >= a.limit) return { jobId: null, duplicate: false, allowed: false, used: a.limit };
    this.usage.set(a.userId, used + 1);
    const id = uuid();
    this.jobs.set(id, {
      id,
      user_id: a.userId,
      client_request_id: a.clientRequestId,
      source: a.source,
      goal: a.goal || null,
      intent: null,
      status: "processing",
      stage: "queued",
      plan_version: 0,
      error_code: null,
      photo_count: a.photoCount,
      photo_paths: [],
      photo_meta: [],
      image_set_hash: null,
      photos_deleted_at: null,
      summary: null,
      created_at: ts(),
      updated_at: ts(),
    });
    return { jobId: id, duplicate: false, allowed: true, used: used + 1 };
  }
  async refundJob(jobId: string) {
    const j = this.jobs.get(jobId);
    if (!j) return;
    Object.assign(j, { status: "needs_review", stage: "failed", error_code: "internal" });
    this.usage.set(j.user_id, Math.max(0, (this.usage.get(j.user_id) ?? 0) - 1));
  }
  async quotaUsed(userId: string) {
    return this.usage.get(userId) ?? 0;
  }
  async findJobByRequest(userId: string, clientRequestId: string) {
    return [...this.jobs.values()].find((j) => j.user_id === userId && j.client_request_id === clientRequestId)?.id ?? null;
  }
  async getJob(jobId: string, userId?: string) {
    const j = this.jobs.get(jobId);
    return j && (!userId || j.user_id === userId) ? structuredClone(j) : null;
  }
  async listJobs(userId: string, q: { limit: number; updatedAfter?: string }) {
    return [...this.jobs.values()]
      .filter((j) => j.user_id === userId && (!q.updatedAfter || j.updated_at > q.updatedAfter))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, q.limit)
      .map((j) => structuredClone(j));
  }
  async updateJob(jobId: string, patch: Partial<JobRow>, opts?: { expectPlanVersion?: number }) {
    const j = this.jobs.get(jobId);
    if (!j || (opts?.expectPlanVersion !== undefined && j.plan_version !== opts.expectPlanVersion)) return null;
    Object.assign(j, patch, { updated_at: ts() });
    return structuredClone(j);
  }
  async deleteJob(jobId: string, userId: string) {
    const j = this.jobs.get(jobId);
    if (!j || j.user_id !== userId) return false;
    this.jobs.delete(jobId);
    return true;
  }
  async listJobParts(jobId: string) {
    return [...this.parts.values()].filter((p) => p.job_id === jobId).map((p) => structuredClone(p));
  }
  async replaceDetectedParts(jobId: string, rows: Omit<JobPartRow, "id">[]) {
    for (const [id, p] of this.parts) if (p.job_id === jobId) this.parts.delete(id);
    await this.insertJobParts(rows);
  }
  async insertJobParts(rows: Omit<JobPartRow, "id">[]) {
    for (const r of rows) {
      const id = uuid();
      this.parts.set(id, { ...structuredClone(r), id });
    }
  }
  async updateJobPart(id: string, patch: Partial<JobPartRow>) {
    Object.assign(this.parts.get(id)!, patch);
  }
  async applyInventory(jobId: string) {
    this.appliedInventory.push(jobId);
  }
  async saveResult(jobId: string, _u: string, v: number, payload: JobResultPayload) {
    this.results.set(`${jobId}|${v}`, payload);
  }
  async latestResult(jobId: string) {
    const keys = [...this.results.keys()].filter((k) => k.startsWith(`${jobId}|`)).sort();
    return keys.length ? this.results.get(keys.at(-1)!)! : null;
  }
  async issueTickets(userId: string, max: number, ttlS: number) {
    for (const [id, t] of this.tickets) if (t.user === userId && (t.used || t.expires < Date.now())) this.tickets.delete(id);
    const active = [...this.tickets.values()].filter((t) => t.user === userId).length;
    for (let i = active; i < max; i++) this.tickets.set(uuid(), { user: userId, used: false, expires: Date.now() + ttlS * 1000 });
    return [...this.tickets.entries()]
      .filter(([, t]) => t.user === userId)
      .map(([id, t]) => ({ id, expires_at: new Date(t.expires).toISOString() }));
  }
  async consumeTicket(userId: string, id: string) {
    const t = this.tickets.get(id);
    if (!t || t.user !== userId || t.used || t.expires < Date.now()) return false;
    t.used = true;
    return true;
  }
  async releaseTicket(userId: string, id: string) {
    const t = this.tickets.get(id);
    if (t && t.user === userId) t.used = false;
  }
  async searchCatalog(q: string, limit: number) {
    return CATALOG.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
      .slice(0, limit)
      .map((p) => ({ part_id: p.id, name: p.name, category: p.category, has_profile: p.profile !== null }));
  }
  async getCatalogParts(ids: string[]) {
    return CATALOG.filter((p) => ids.includes(p.id));
  }
  async listProfiledParts() {
    return CATALOG.filter((p) => p.profile);
  }
  async matchCatalog() {
    return [];
  }
  async matchReferenceProjects() {
    return [];
  }
  async listReferenceProjects() {
    return [];
  }
  async listInventory(userId: string) {
    return [...this.inventory.entries()]
      .filter(([k, q]) => k.startsWith(`${userId}|`) && q > 0)
      .map(([k, quantity]) => {
        const part = CATALOG.find((p) => p.id === k.split("|")[1])!;
        return { part_id: part.id, name: part.name, category: part.category, quantity, updated_at: ts() };
      });
  }
  async setInventory(userId: string, partId: string, qty: number) {
    if (qty <= 0) this.inventory.delete(`${userId}|${partId}`);
    else this.inventory.set(`${userId}|${partId}`, qty);
  }
  async getCache<T>(userId: string, key: string) {
    return (this.cache.get(`${userId}|${key}`) as T) ?? null;
  }
  async setCache(userId: string, key: string, _kind: string, payload: unknown) {
    this.cache.set(`${userId}|${key}`, structuredClone(payload));
  }
  async expiredPhotos() {
    return [...this.jobs.values()]
      .filter((j) => !j.photos_deleted_at && j.photo_paths.length && Date.parse(j.created_at) < Date.now() - 30 * 864e5)
      .map((j) => ({ id: j.id, photo_paths: j.photo_paths }));
  }
  async markPhotosDeleted(ids: string[]) {
    for (const id of ids) Object.assign(this.jobs.get(id)!, { photos_deleted_at: ts(), photo_paths: [] });
    return ids.length;
  }
  async purgeCache() {
    return 0;
  }
}

export class FakePhotos implements PhotoStore {
  objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  failPut = false;
  async put(path: string, bytes: Uint8Array, mime: string) {
    if (this.failPut) throw new Error("storage down");
    this.objects.set(path, { bytes, mime });
  }
  async get(path: string) {
    const o = this.objects.get(path);
    if (!o) throw new Error("missing");
    return o.bytes;
  }
  async signedUrls(paths: string[], ttl: number) {
    return paths.map((p) => (this.objects.has(p) ? `https://storage.test/sign/${p}?ttl=${ttl}` : null));
  }
  async remove(paths: string[]) {
    for (const p of paths) this.objects.delete(p);
  }
}

export class FakeLimiter implements Limiter {
  deny = new Set<string>();
  async allow(key: string) {
    return !this.deny.has(key);
  }
}

export function makeDeps(over: Partial<Deps> = {}) {
  const repo = new FakeRepo();
  const photos = new FakePhotos();
  const queue: QueueMessage[] = [];
  const limiters = { ip: new FakeLimiter(), user: new FakeLimiter(), upload: new FakeLimiter() };
  const turnstileTokens = new Set(["good-turnstile"]);
  const deps: Deps = {
    repo,
    photos,
    enqueue: async (m) => {
      queue.push(m);
    },
    verifyToken: async (token) => {
      const user = { "token-a": USER_A, "token-b": USER_B }[token];
      if (!user) throw new Error("bad token");
      return { id: user, email: null };
    },
    verifyTurnstile: async (t) => turnstileTokens.has(t),
    limiters,
    allowedOrigins: ["http://localhost:3000", "http://tauri.localhost"],
    now: () => new Date("2026-10-21T12:00:00Z"),
    ...over,
  };
  return { deps, repo, photos, queue, limiters };
}

export function fakeEngine(over: Partial<AiEngine> = {}): AiEngine {
  return {
    name: "fake",
    detect: async (images) =>
      images.map((img) => ({
        image_index: img.index,
        quality: "ok" as const,
        items: [{ label: "Arduino Uno", bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.3 }, confidence: 0.95, visible_text: ["UNO"], quantity: 1 }],
      })),
    match: async (items) => items.map(() => [{ part_id: "arduino-uno-r3", name: "Arduino Uno R3", score: 0.93 }]),
    plan: async ({ planVersion }) => ({
      intent: "specific" as const,
      payload: {
        kind: "single" as const,
        plan_version: planVersion,
        refusal: null,
        plans: [
          {
            id: "p1",
            title: "Blink",
            summary: "Blink an LED",
            verdict: "yes" as const,
            closest_reason: null,
            language: "arduino_cpp" as const,
            power_mode: "usb" as const,
            bom: [],
            missing: [],
            connections: [],
            steps: ["Plug in"],
            code: { language: "arduino_cpp" as const, filename: "blink.ino", source: "void setup(){}" },
            libraries: [],
            safety_notes: [],
            validation: { passed: true, attempts: 1, issues: [] },
            diagram: null,
            reference_project_id: null,
          },
        ],
      },
    }),
    ...over,
  };
}
