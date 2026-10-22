import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import jpeg from "jpeg-js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const API_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:8787";
/** Cloudflare's published Turnstile test response; the local secret 1x…AA accepts it. */
export const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

export const enabled = process.env.LOCAL_STACK === "1";

export function localStack(): { url: string; anonKey: string; serviceKey: string } {
  const cli = `${ROOT}apps/api/node_modules/.bin/supabase${process.platform === "win32" ? ".CMD" : ""}`;
  const out = execFileSync(cli, ["status", "--workdir", ROOT, "-o", "env"], { encoding: "utf8", shell: process.platform === "win32" });
  const env = Object.fromEntries(
    out
      .split(/\r?\n/)
      .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l))
      .filter((m): m is RegExpExecArray => Boolean(m))
      .map((m) => [m[1]!, m[2]!]),
  );
  return { url: env.API_URL!, anonKey: env.ANON_KEY!, serviceKey: env.SERVICE_ROLE_KEY! };
}

/** Creates a throwaway confirmed user on the LOCAL stack and returns an access token. */
export async function testUser(tag: string): Promise<{ id: string; token: string; email: string }> {
  const s = localStack();
  const admin = createClient(s.url, s.serviceKey, { auth: { persistSession: false } });
  const email = `e2e-${tag}-${Date.now()}@partspilot.test`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const client = createClient(s.url, s.anonKey, { auth: { persistSession: false } });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.session) throw new Error(`signIn: ${signIn.error?.message}`);
  return { id: data.user.id, token: signIn.data.session.access_token, email };
}

/** A real, decodable 960×720 JPEG (colour bands) with a fake EXIF block appended after SOI. */
export function photo(seed = 1): Uint8Array {
  const width = 960;
  const height = 720;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * seed) % 256;
      data[i + 1] = (y * 3) % 256;
      data[i + 2] = ((x + y) * 7) % 256;
      data[i + 3] = 255;
    }
  }
  const encoded = jpeg.encode({ data, width, height }, 80).data;
  const payload = Buffer.from("Exif\0\0GPS 51.5007N 0.1246W phone");
  const exif = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  return new Uint8Array(Buffer.concat([encoded.subarray(0, 2), exif, encoded.subarray(2)]));
}

export async function api(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

export async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs: number, everyMs = 500): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, everyMs));
  }
}
