import { describe, expect, it } from "vitest";
import {
  ApiRequestError,
  buyLinks,
  CatalogPart,
  createApiClient,
  CreateJobFields,
  ImageDetection,
  isLocalStack,
  JobDetailResponse,
  PlannerOutput,
  QueueMessage,
  statusForStage,
  type PlannerOutputInput,
} from "../src/index";
import { buildOpenApiDocument } from "../scripts/openapi";

const uuid = "3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";

const validPlan: PlannerOutputInput = {
  title: "Blink",
  summary: "Blink the onboard LED.",
  feasibility: "achievable",
  language: "arduino_cpp",
  power_mode: "usb",
  parts: [{ ref: "U1", part_id: "arduino-uno-r3" }],
  connections: [],
  steps: ["Plug the Uno into USB."],
  code: { filename: "blink.ino", source: "void setup(){} void loop(){}" },
};

describe("model output contracts", () => {
  it("accepts a valid planner output and fills defaults", () => {
    const p = PlannerOutput.parse(validPlan);
    expect(p.parts[0]?.qty).toBe(1);
    expect(p.safety_notes).toEqual([]);
    expect(p.closest_reason).toBeNull();
  });

  it.each([
    ["lowercase ref", { parts: [{ ref: "u1", part_id: "arduino-uno-r3" }] }],
    ["path traversal filename", { code: { filename: "../x.ino", source: "void setup(){}" } }],
    ["unknown language", { language: "rust" }],
    ["no steps", { steps: [] }],
    ["bad pin ref", { connections: [{ from: { ref: "U1", pin: "" }, to: { ref: "M1", pin: "A" } }] }],
  ])("rejects %s", (_, patch) => {
    expect(PlannerOutput.safeParse({ ...validPlan, ...patch }).success).toBe(false);
  });

  it("rejects detections with out-of-image boxes and caps text length", () => {
    const base = {
      image_index: 0,
      quality: "ok",
      items: [{ label: "L298N", bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, confidence: 0.9 }],
    };
    expect(ImageDetection.parse(base).items[0]?.quantity).toBe(1);
    const outside = structuredClone(base);
    outside.items[0]!.bbox = { x: 0.9, y: 0.1, w: 0.5, h: 0.2 };
    expect(ImageDetection.safeParse(outside).success).toBe(false);
    const longText = structuredClone(base) as Record<string, unknown> & typeof base;
    (longText.items[0] as Record<string, unknown>).visible_text = ["x".repeat(61)];
    expect(ImageDetection.safeParse(longText).success).toBe(false);
  });
});

describe("api contracts", () => {
  it("requires exactly one of turnstile token or ticket", () => {
    expect(CreateJobFields.safeParse({ client_request_id: uuid }).success).toBe(false);
    expect(
      CreateJobFields.safeParse({ client_request_id: uuid, turnstile_token: "t", upload_ticket: uuid }).success,
    ).toBe(false);
    expect(CreateJobFields.safeParse({ client_request_id: uuid, upload_ticket: uuid }).success).toBe(true);
  });

  it("strips control characters from goals", () => {
    const f = CreateJobFields.parse({ client_request_id: uuid, turnstile_token: "t", goal: " RC\u0000 car\u0007 " });
    expect(f.goal).toBe("RC car");
  });

  it("rejects non-kebab part ids in the catalog", () => {
    expect(
      CatalogPart.safeParse({ id: "Arduino Uno", name: "Arduino Uno R3", category: "microcontroller", source: "curated", buy_query: "x" })
        .success,
    ).toBe(false);
  });

  it("parses queue messages strictly", () => {
    expect(QueueMessage.safeParse({ type: "plan", job_id: uuid }).success).toBe(false);
    expect(QueueMessage.parse({ type: "plan", job_id: uuid, plan_version: 2 }).type).toBe("plan");
  });

  it("maps stages to user statuses", () => {
    expect(statusForStage("awaiting_confirmation")).toBe("needs_check");
    expect(statusForStage("planning")).toBe("processing");
    expect(statusForStage("failed")).toBe("needs_review");
  });

  it("builds https buy links with the exact name encoded", () => {
    const links = buyLinks("L298N Dual H-Bridge & Motor Driver");
    expect(links.length).toBeGreaterThan(1);
    for (const l of links) {
      expect(l.url.startsWith("https://")).toBe(true);
      expect(l.url).toContain("L298N%20Dual%20H-Bridge%20%26%20Motor%20Driver");
    }
  });
});

describe("typed api client", () => {
  const job = {
    id: uuid,
    created_at: "2026-10-21T05:32:00.123456+00:00",
    updated_at: "2026-10-21T05:32:00+00:00",
    source: "photo",
    goal: "RC car",
    intent: null,
    status: "processing",
    stage: "detecting",
    plan_version: 0,
    error_code: null,
    photo_count: 1,
    summary: null,
  };

  it("sends the bearer token and parses the response", async () => {
    let auth = "";
    const client = createApiClient({
      baseUrl: "https://api.test/",
      getAccessToken: async () => "tok",
      fetch: async (input, init) => {
        auth = new Headers(init?.headers).get("authorization") ?? "";
        expect(String(input)).toBe(`https://api.test/v1/jobs/${uuid}`);
        return new Response(JSON.stringify({ job, photos: [], parts: [], result: null }));
      },
    });
    const res = await client.getJob(uuid);
    expect(auth).toBe("Bearer tok");
    expect(JobDetailResponse.parse(res).job.id).toBe(uuid);
  });

  it("maps API errors to codes and rejects malformed bodies", async () => {
    const mk = (body: string, status: number) =>
      createApiClient({
        baseUrl: "https://api.test",
        getAccessToken: async () => "tok",
        fetch: async () => new Response(body, { status }),
      });
    await expect(
      mk(JSON.stringify({ error: { code: "quota_exceeded", message: "x", retry_after_s: 60 } }), 429).quota(),
    ).rejects.toMatchObject({ code: "quota_exceeded", status: 429, retryAfterS: 60 });
    await expect(mk(JSON.stringify({ limit: "ten" }), 200).quota()).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      createApiClient({ baseUrl: "https://api.test", getAccessToken: async () => null }).quota(),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
});

describe("openapi", () => {
  it("documents every route with bearer security", () => {
    const doc = buildOpenApiDocument();
    const paths = Object.keys(doc.paths ?? {});
    expect(paths).toEqual(
      expect.arrayContaining([
        "/v1/me",
        "/v1/quota",
        "/v1/upload-tickets",
        "/v1/jobs",
        "/v1/jobs/{id}",
        "/v1/jobs/{id}/parts",
        "/v1/catalog/search",
        "/v1/inventory",
        "/v1/inventory/{part_id}",
        "/v1/inventory/plan",
      ]),
    );
    expect(doc.components?.securitySchemes).toHaveProperty("supabaseJwt");
    expect(doc.components?.schemas).toHaveProperty("JobDetailResponse");
    expect(doc.components?.schemas).toHaveProperty("ApiError");
    expect(doc.security).toEqual([{ supabaseJwt: [] }]);
  });
});

describe("local-stack detection (email sign-in gate)", () => {
  it("is true only for loopback Supabase URLs", () => {
    for (const u of ["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321", "http://api.partspilot.localhost"]) expect(isLocalStack(u)).toBe(true);
    for (const u of ["https://abc.supabase.co", "https://127.0.0.1.evil.example", "", "not a url"]) expect(isLocalStack(u)).toBe(false);
  });
});
