import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DiagramSpec } from "@partspilot/shared";
import { chunkedStore, CHUNK_BYTES, type ByteVault } from "../src/platform/chunked";
import { catchUp, transitions } from "../src/notices";
import { layoutNodes, routeWire } from "../src/diagram/layout";

// Minimal localStorage for node.
beforeAll(() => {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
});

function memVault() {
  const m = new Map<string, Uint8Array>();
  const writes: string[] = [];
  const v: ByteVault = {
    get: async (n) => m.get(n) ?? null,
    set: async (n, b) => {
      if (b.length > 2560) throw new Error("credential too large");
      writes.push(n);
      m.set(n, new Uint8Array(b));
    },
    remove: async (n) => void m.delete(n),
  };
  return { v, m, writes };
}

describe("chunked keyring store", () => {
  it("round-trips a session larger than one Windows credential", async () => {
    const { v, m, writes } = memVault();
    const s = chunkedStore(v);
    const value = JSON.stringify({ access_token: "x".repeat(4500), refresh_token: "r", user: { email: "ü@test" } });
    await s.setItem("k", value);
    expect(await s.getItem("k")).toBe(value);
    expect([...m.keys()].filter((k) => k.startsWith("k#")).length).toBe(Math.ceil(new TextEncoder().encode(value).length / CHUNK_BYTES));
    expect(writes.at(-1)).toBe("k"); // header written last
  });

  it("drops stale chunks when the value shrinks, and clears fully", async () => {
    const { v, m } = memVault();
    const s = chunkedStore(v);
    await s.setItem("k", "a".repeat(5000));
    await s.setItem("k", "short");
    expect([...m.keys()].sort()).toEqual(["k", "k#0"]);
    await s.removeItem("k");
    expect(m.size).toBe(0);
    expect(await s.getItem("k")).toBeNull();
  });

  it("returns null if a chunk is missing instead of a corrupt session", async () => {
    const { v, m } = memVault();
    const s = chunkedStore(v);
    await s.setItem("k", "b".repeat(4100));
    m.delete("k#1");
    expect(await s.getItem("k")).toBeNull();
  });
});

describe("deep-link sign-in callback", () => {
  it("only accepts partspilot://auth/callback while a sign-in is pending", async () => {
    const { initAuth, handleDeepLink, supabase } = await import("../src/auth");
    initAuth({ secureStore: chunkedStore(memVault().v) } as never);
    const exchange = vi.spyOn(supabase().auth, "exchangeCodeForSession").mockResolvedValue({ data: {}, error: null } as never);

    expect(await handleDeepLink("partspilot://auth/callback?code=evil")).toBe("ignored");
    localStorage.setItem("pp-signin-pending-until", String(Date.now() + 60_000));
    expect(await handleDeepLink("https://evil.example/auth/callback?code=x")).toBe("ignored");
    expect(await handleDeepLink("partspilot://other/path?code=x")).toBe("ignored");
    expect(await handleDeepLink("partspilot://auth/callback?code=abc")).toBe("signed_in");
    expect(exchange).toHaveBeenCalledWith("abc");
    // single use: the same link again is ignored
    expect(await handleDeepLink("partspilot://auth/callback?code=abc")).toBe("ignored");
    localStorage.setItem("pp-signin-pending-until", String(Date.now() - 1));
    expect(await handleDeepLink("partspilot://auth/callback?code=late")).toBe("ignored");
  });
});

describe("notifications", () => {
  const job = (id: string, status: "processing" | "ready" | "needs_check" | "needs_review", summary: object | null = null) => ({ id, status, summary: summary as never, goal: "RC car" });

  it("toasts only on transitions into ready / needs check / needs review", () => {
    const prev = new Map([
      ["a", "processing" as const],
      ["b", "ready" as const],
      ["c", "processing" as const],
    ]);
    const n = transitions(prev, [
      job("a", "ready", { title: "Bluetooth RC Car", verdict: "yes_missing", missing_count: 3, needs_check_count: 0, idea_titles: [] }),
      job("b", "ready"),
      job("c", "needs_check", { title: null, verdict: null, missing_count: null, needs_check_count: 2, idea_titles: [] }),
      job("new", "ready"),
    ]);
    expect(n).toEqual([
      { jobId: "a", title: "Bluetooth RC Car", body: "You can build it — 3 parts missing." },
      { jobId: "c", title: "Check your parts", body: "2 parts need a quick look." },
    ]);
  });

  it("collapses a big catch-up after the PC was off into one toast", () => {
    expect(catchUp([job("a", "ready"), job("b", "processing")])).toHaveLength(1);
    const many = catchUp([job("a", "ready"), job("b", "ready"), job("c", "needs_check")]);
    expect(many).toEqual([{ jobId: "a", title: "3 results are waiting", body: "Open PartsPilot to see them." }]);
  });
});

describe("diagram layout", () => {
  const spec: DiagramSpec = {
    version: 1,
    nodes: ["U1", "U2", "M1", "B1", "U3"].map((ref) => ({ ref, part_id: ref, label: ref, element: "pp-generic", attrs: {}, pins: [] })),
    wires: [
      ["U1", "U2", "signal"],
      ["U1", "U2", "signal"],
      ["U1", "U3", "signal"],
      ["U2", "M1", "load"],
      ["B1", "U2", "power"],
      ["B1", "U1", "ground"],
    ].map(([a, b, kind], i) => ({ id: `w${i}`, from: { ref: a!, pin: "x" }, to: { ref: b!, pin: "y" }, net: `n${i}`, kind: kind as never, color: "#000000" })),
  };

  it("centres the controller, keeps power sources at the bottom, never overlaps", () => {
    const sizes = new Map(spec.nodes.map((n) => [n.ref, { w: 150, h: 120 }]));
    const boxes = layoutNodes(spec, sizes);
    const u1 = boxes.get("U1")!;
    const b1 = boxes.get("B1")!;
    expect(b1.y).toBeGreaterThan(Math.max(...[...boxes.values()].filter((b) => b !== b1).map((b) => b.y)));
    expect(boxes.get("U2")!.x).toBeGreaterThan(u1.x); // most-linked peer on the right
    const all = [...boxes.values()];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!;
        const b = all[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    expect(layoutNodes(spec, sizes)).toEqual(boxes); // deterministic
  });

  it("routes orthogonally between pins", () => {
    const d = routeWire({ x: 150, y: 50 }, { x: 400, y: 90 }, 0, { x: 0, y: 0, w: 150, h: 100 }, { x: 400, y: 40, w: 150, h: 100 });
    expect(d).toMatch(/^M150,50 H\d+ H[\d.]+ V90 H\d+ H400$/);
  });
});
