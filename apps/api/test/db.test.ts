import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { addUser, asRole, asUser, createTestDb } from "./support/pglite.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const req = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let db: PGlite;

async function createJob(user: string, clientReq: string, limit = 10) {
  const r = await db.query<{ job_id: string | null; duplicate: boolean; allowed: boolean; used: number }>(
    "select * from public.create_job($1, $2, 'photo', 'RC car', 1, $3)",
    [user, clientReq, limit],
  );
  return r.rows[0]!;
}

beforeAll(async () => {
  db = await createTestDb();
  await addUser(db, A);
  await addUser(db, B);
  await db.exec(`
    insert into public.catalog_parts (id, name, category, source, buy_query, profile) values
      ('arduino-uno-r3', 'Arduino Uno R3', 'microcontroller', 'curated', 'Arduino Uno R3', '{"role":"mcu","pins":[]}'),
      ('l298n-motor-driver', 'L298N Dual H-Bridge Motor Driver Module', 'motor_driver', 'curated', 'L298N module', null),
      ('hc-sr04', 'HC-SR04 Ultrasonic Distance Sensor', 'sensor', 'curated', 'HC-SR04', null);
    insert into public.catalog_aliases (part_id, alias) values
      ('arduino-uno-r3', 'Arduino Uno R3'), ('arduino-uno-r3', 'UNO'),
      ('l298n-motor-driver', 'L298N'), ('l298n-motor-driver', 'L298N motor driver board'),
      ('hc-sr04', 'HC-SR04'), ('hc-sr04', 'ultrasonic sensor');
  `);
}, 60_000);

describe("row level security", () => {
  it("is enabled on every public table", async () => {
    const r = await db.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(r.rows).toEqual([]);
  });

  it("isolates users and blocks client writes", async () => {
    const a = await createJob(A, req(1));
    await createJob(B, req(2));
    const seenByA = await asUser(db, A, () => db.query<{ id: string }>("select id from public.jobs"));
    expect(seenByA.rows.map((r) => r.id)).toEqual([a.job_id]);

    await expect(
      asUser(db, A, () =>
        db.query("insert into public.jobs (user_id, client_request_id, source) values ($1, $2, 'photo')", [A, req(3)]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, A, () => db.query("update public.jobs set status = 'ready' where user_id = $1", [A])),
    ).rejects.toThrow(/permission denied/);
  });

  it("gives anon nothing and authenticated read-only catalog", async () => {
    await expect(asRole(db, "anon", () => db.query("select * from public.catalog_parts"))).rejects.toThrow(
      /permission denied/,
    );
    const parts = await asUser(db, A, () => db.query("select id from public.catalog_parts"));
    expect(parts.rows.length).toBe(3);
  });

  it("does not let clients call server functions", async () => {
    await expect(
      asUser(db, A, () => db.query("select * from public.create_job($1, $2, 'photo', '', 1, 10)", [A, req(4)])),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, () => db.query("select public.quota_used($1)", [A]))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("create_job", () => {
  it("is idempotent per client_request_id and enforces the daily limit", async () => {
    const user = "33333333-3333-4333-8333-333333333333";
    await addUser(db, user);
    const first = await createJob(user, req(100), 3);
    const replay = await createJob(user, req(100), 3);
    expect(replay).toMatchObject({ job_id: first.job_id, duplicate: true, used: 1 });
    await createJob(user, req(101), 3);
    const third = await createJob(user, req(102), 3);
    expect(third).toMatchObject({ allowed: true, used: 3 });
    const over = await createJob(user, req(103), 3);
    expect(over).toMatchObject({ allowed: false, job_id: null });
    // replays of accepted requests still succeed once the limit is reached
    expect((await createJob(user, req(102), 3)).duplicate).toBe(true);
  });

  it("refunds quota for jobs that never reached the queue", async () => {
    const user = "44444444-4444-4444-8444-444444444444";
    await addUser(db, user);
    const j = await createJob(user, req(200));
    await db.query("select public.refund_job($1)", [j.job_id]);
    const used = await db.query<{ q: number }>("select public.quota_used($1) as q", [user]);
    expect(used.rows[0]!.q).toBe(0);
    const job = await db.query<{ status: string }>("select status from public.jobs where id = $1", [j.job_id]);
    expect(job.rows[0]!.status).toBe("needs_review");
  });
});

describe("upload tickets", () => {
  it("issues at most N, consumes once, and can be released", async () => {
    const issued = await db.query<{ id: string }>("select * from public.issue_upload_tickets($1, 3, 3600)", [A]);
    expect(issued.rows.length).toBe(3);
    const again = await db.query<{ id: string }>("select * from public.issue_upload_tickets($1, 3, 3600)", [A]);
    expect(again.rows.map((r) => r.id)).toEqual(issued.rows.map((r) => r.id));

    const t = issued.rows[0]!.id;
    const use = (u: string) =>
      db.query<{ ok: boolean }>("select public.consume_upload_ticket($1, $2) as ok", [u, t]).then((r) => r.rows[0]!.ok);
    expect(await use(B)).toBe(false); // bound to its owner
    expect(await use(A)).toBe(true);
    expect(await use(A)).toBe(false); // single use
    await db.query("select public.release_upload_ticket($1, $2)", [A, t]);
    expect(await use(A)).toBe(true);
  });

  it("rejects expired tickets", async () => {
    const r = await db.query<{ id: string }>("select * from public.issue_upload_tickets($1, 1, 1)", [B]);
    await db.query("update public.upload_tickets set expires_at = now() - interval '1 second' where id = $1", [
      r.rows[0]!.id,
    ]);
    const ok = await db.query<{ ok: boolean }>("select public.consume_upload_ticket($1, $2) as ok", [B, r.rows[0]!.id]);
    expect(ok.rows[0]!.ok).toBe(false);
  });
});

describe("inventory bookkeeping", () => {
  it("applies confirmed parts once and follows corrections", async () => {
    const user = "55555555-5555-4555-8555-555555555555";
    await addUser(db, user);
    const j = await createJob(user, req(300));
    const job = j.job_id!;
    await db.query(
      `insert into public.job_parts (job_id, user_id, label, part_id, quantity, status) values
        ($1, $2, 'uno', 'arduino-uno-r3', 1, 'auto'),
        ($1, $2, 'driver', 'l298n-motor-driver', 2, 'confirmed'),
        ($1, $2, 'unsure', 'hc-sr04', 1, 'needs_check')`,
      [job, user],
    );
    const inv = async () =>
      Object.fromEntries(
        (
          await db.query<{ part_id: string; quantity: number }>(
            "select part_id, quantity from public.inventory_items where user_id = $1 order by part_id",
            [user],
          )
        ).rows.map((r) => [r.part_id, r.quantity]),
      );

    await db.query("select public.apply_job_inventory($1)", [job]);
    expect(await inv()).toEqual({ "arduino-uno-r3": 1, "l298n-motor-driver": 2 });

    await db.query("select public.apply_job_inventory($1)", [job]); // idempotent
    expect(await inv()).toEqual({ "arduino-uno-r3": 1, "l298n-motor-driver": 2 });

    // user corrects the driver to a sensor, confirms the unsure part, removes the uno
    await db.exec(
      `update public.job_parts set part_id = 'hc-sr04', quantity = 1 where job_id = '${job}' and label = 'driver';
       update public.job_parts set status = 'confirmed' where job_id = '${job}' and label = 'unsure';
       update public.job_parts set status = 'removed' where job_id = '${job}' and label = 'uno';`,
    );
    await db.query("select public.apply_job_inventory($1)", [job]);
    expect(await inv()).toEqual({ "hc-sr04": 2 });
  });
});

describe("catalog matching", () => {
  it("finds parts by printed text and fuzzy labels", async () => {
    const r = await db.query<{ part_id: string; trgm_sim: number }>(
      "select * from public.match_catalog(null, $1, 5)",
      ["blue l298n board"],
    );
    expect(r.rows[0]?.part_id).toBe("l298n-motor-driver");
    expect(r.rows[0]!.trgm_sim).toBeGreaterThan(0.5);
  });

  it("ranks by vector similarity when embeddings exist", async () => {
    const vec = (hot: number) => `[${Array.from({ length: 768 }, (_, i) => (i === hot ? 1 : 0)).join(",")}]`;
    await db.query("update public.catalog_aliases set embedding = $1 where alias = 'HC-SR04'", [vec(5)]);
    await db.query("update public.catalog_aliases set embedding = $1 where alias = 'UNO'", [vec(9)]);
    const r = await db.query<{ part_id: string; vec_sim: number }>(
      "select * from public.match_catalog($1::extensions.vector, '', 5)",
      [vec(5)],
    );
    expect(r.rows[0]).toMatchObject({ part_id: "hc-sr04" });
    expect(r.rows[0]!.vec_sim).toBeCloseTo(1, 5);
  });

  it("supports typeahead search with profiled parts first", async () => {
    const r = await db.query<{ part_id: string }>("select * from public.search_catalog('ultra', 5)");
    expect(r.rows.map((x) => x.part_id)).toContain("hc-sr04");
    const uno = await db.query<{ part_id: string }>("select * from public.search_catalog('uno', 5)");
    expect(uno.rows[0]?.part_id).toBe("arduino-uno-r3");
  });
});

describe("photo retention", () => {
  it("lists and marks jobs whose photos are older than 30 days", async () => {
    const j = await createJob(A, req(400));
    await db.query(
      "update public.jobs set created_at = now() - interval '31 days', photo_paths = '{a/b/0.jpg}' where id = $1",
      [j.job_id],
    );
    const due = await db.query<{ id: string }>("select * from public.jobs_with_expired_photos(30, 100)");
    expect(due.rows.map((r) => r.id)).toContain(j.job_id);
    await db.query("select public.mark_photos_deleted($1::uuid[])", [[j.job_id]]);
    const after = await db.query<{ id: string }>("select * from public.jobs_with_expired_photos(30, 100)");
    expect(after.rows.map((r) => r.id)).not.toContain(j.job_id);
  });
});
