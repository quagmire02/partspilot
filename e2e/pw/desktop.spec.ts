import { expect, test, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { JobDetailResponse } from "@partspilot/shared";
import { api, localStack, photo, TURNSTILE_TEST_TOKEN } from "../support/local";

test.skip(process.env.LOCAL_STACK !== "1", "needs the local stack (LOCAL_STACK=1)");

async function newSession(): Promise<Session> {
  const s = localStack();
  const admin = createClient(s.url, s.serviceKey, { auth: { persistSession: false } });
  const email = `desk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@partspilot.test`;
  const password = `pw-${crypto.randomUUID()}`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const { data } = await createClient(s.url, s.anonKey, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  return data.session!;
}

/** Same as the phone: upload a pile photo + goal and wait for the pipeline. */
async function scan(token: string, goal: string): Promise<string> {
  const form = new FormData();
  form.set("client_request_id", crypto.randomUUID());
  form.set("goal", goal);
  form.set("turnstile_token", TURNSTILE_TEST_TOKEN);
  form.append("photos", new Blob([photo(4) as BlobPart], { type: "image/jpeg" }), "pile.jpg");
  const res = await api("/v1/jobs", token, { method: "POST", body: form });
  expect(res.status).toBe(202);
  const { job_id } = (await res.json()) as { job_id: string };
  await expect
    .poll(async () => JobDetailResponse.parse(await (await api(`/v1/jobs/${job_id}`, token)).json()).job.status, { timeout: 30_000 })
    .toBe("ready");
  return job_id;
}

async function openApp(page: Page, session: Session) {
  await page.goto("/");
  await page.evaluate((v) => localStorage.setItem("pp-desktop-auth", v), JSON.stringify(session));
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

test("signed out (self-hosted, no Google client): email sign-in only", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
});

test("New scan: upload photos from this computer → result in the Inbox", async ({ page }) => {
  const session = await newSession();
  await openApp(page, session);
  await page.getByRole("button", { name: "+ New scan" }).click();
  await page.getByTestId("scan-files").setInputFiles({ name: "pile.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo(7)) });
  await expect(page.locator(".scan-thumb img")).toHaveCount(1);
  await page.getByPlaceholder(/Can I build an RC car/).fill("Can I build a line follower?");
  await page.getByRole("button", { name: "Find what I can build" }).click();
  const row = page.getByRole("button", { name: /Can I build a line follower?/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Ready")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".bbox").first()).toBeVisible();
});

test("inbox → result: photo boxes, exact names, verdict, missing parts, wiring, steps, code", async ({ page }) => {
  const session = await newSession();
  await scan(session.access_token, "Can I build an RC car?");
  await openApp(page, session);

  const row = page.getByRole("button", { name: /Can I build an RC car\?/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("Ready")).toBeVisible();
  await row.click();

  await expect(page.locator(".bbox")).toHaveCount(5);
  await expect(page.locator(".bbox-label").first()).toHaveText(/Arduino Uno R3|L298N|HC-05|TT DC|18650/);
  await expect(page.getByRole("status").filter({ hasText: "Yes — 3 parts missing" })).toBeVisible();
  await expect(page.getByText("2WD Robot Car Chassis (frame, wheels, caster)")).toBeVisible();
  await expect(page.locator(".missing li").first().getByRole("button", { name: "Amazon" })).toBeVisible();
  await expect(page.locator("wokwi-arduino-uno")).toHaveCount(1);
  await expect.poll(() => page.locator(".diagram-wires path").count()).toBeGreaterThan(15);
  await expect(page.locator(".steps li")).toHaveCount(9);
  await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
  await expect(page.locator("pre.code")).toContainText("SoftwareSerial");
  await page.screenshot({ path: "test-results/desktop-result.png", fullPage: true });
  await page.locator(".diagram").screenshot({ path: "test-results/desktop-diagram.png" });
});

test("changing a part re-runs the plan automatically", async ({ page }) => {
  const session = await newSession();
  const jobId = await scan(session.access_token, "Can I build an RC car?");
  await openApp(page, session);
  await page.getByRole("button", { name: /Can I build an RC car\?/ }).click();
  await expect(page.locator(".verdict")).toBeVisible();

  await page.getByLabel("Quantity of TT DC Gear Motor 3-6V (1:48)").fill("1");
  await expect
    .poll(async () => JobDetailResponse.parse(await (await api(`/v1/jobs/${jobId}`, session.access_token)).json()).job.plan_version, { timeout: 15_000 })
    .toBe(1);
  // one motor short now: the verdict follows the corrected parts
  await expect(page.getByRole("status").filter({ hasText: "Yes — 4 parts missing" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("TT DC Gear Motor 3-6V (1:48)", { exact: true }).last()).toBeVisible();
});

test("confirmed parts land in My Inventory; inventory discovery shows 3 project cards", async ({ page }) => {
  const session = await newSession();
  await scan(session.access_token, "Can I build an RC car?");
  await openApp(page, session);
  await page.getByRole("button", { name: "My Inventory" }).click();
  await expect(page.getByRole("cell", { name: "L298N Dual H-Bridge Motor Driver Module", exact: true })).toBeVisible();
  await expect(page.getByLabel("Quantity of TT DC Gear Motor 3-6V (1:48)")).toHaveValue("2");

  await page.getByRole("button", { name: "What can I build with my inventory?" }).click();
  await expect(page.getByRole("heading", { name: "What can I build with my inventory?" })).toBeVisible();
  await expect(page.locator(".project-card")).toHaveCount(3, { timeout: 30_000 });
  await page.screenshot({ path: "test-results/desktop-discovery.png" });
  await page.locator(".project-card").first().click();
  await expect(page.locator(".verdict")).toBeVisible();
  await expect(page.getByRole("button", { name: "← All ideas" })).toBeVisible();
});
