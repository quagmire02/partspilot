import { expect, test, type Page } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";
import { API_URL, localStack, photo } from "../support/local";

test.skip(process.env.LOCAL_STACK !== "1", "needs the local stack (LOCAL_STACK=1)");

async function newSession(): Promise<Session> {
  const s = localStack();
  const admin = createClient(s.url, s.serviceKey, { auth: { persistSession: false } });
  const email = `pwa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@partspilot.test`;
  const password = `pw-${crypto.randomUUID()}`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const { data } = await createClient(s.url, s.anonKey, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  return data.session!;
}

/** Puts the session where the OAuth callback would (IndexedDB "partspilot"/"kv", key pp-auth). */
async function signIn(page: Page, session: Session) {
  await page.goto("/");
  await page.evaluate(async (value) => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("partspilot");
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => {
        const tx = r.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put(value, "pp-auth");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, JSON.stringify(session));
  await page.reload();
  await expect(page.getByText(/of 10 left/)).toBeVisible();
}

async function addPhoto(page: Page, seed: number) {
  await page.locator("input[type=file][multiple]").setInputFiles({ name: `pile-${seed}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(photo(seed)) });
  await expect(page.locator(".strip img")).toHaveCount(1);
}

/** Upload tickets are fetched (after Turnstile) while the user is still taking photos. */
async function ticketPoolWarm(page: Page) {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const r = indexedDB.open("partspilot");
        r.onsuccess = () => {
          const q = r.result.transaction("kv").objectStore("kv").get("tickets");
          q.onsuccess = () => resolve((q.result ?? []).length >= 2);
          q.onerror = () => resolve(false);
        };
        r.onerror = () => resolve(false);
      }),
    null,
    { timeout: 15_000 },
  );
}

async function jobCount(token: string): Promise<number> {
  const res = await fetch(`${API_URL}/v1/jobs`, { headers: { authorization: `Bearer ${token}` } });
  return ((await res.json()) as { items: unknown[] }).items.length;
}

test.describe("camera", () => {
  test.use({ permissions: ["camera"] });

  test("main screen is a live camera; the shutter adds a photo; max 4 photos", async ({ page }) => {
    await signIn(page, await newSession());
    const video = page.getByLabel("Camera preview");
    await expect(video).toBeVisible();
    await page.waitForFunction(() => (document.querySelector("video.viewfinder") as HTMLVideoElement | null)?.videoWidth! > 0);
    await page.getByRole("button", { name: "Take photo" }).click();
    await expect(page.locator(".strip img")).toHaveCount(1);
    const files = [2, 3, 4, 6, 7].map((n) => ({ name: `p${n}.jpg`, mimeType: "image/jpeg", buffer: Buffer.from(photo(n)) }));
    await page.locator("input[type=file][multiple]").setInputFiles(files);
    await expect(page.locator(".strip img")).toHaveCount(4);
    await expect(page.getByText("Up to 4 photos per scan.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Take photo" })).toBeDisabled();
  });
});

test("first open asks to sign in (email on a self-hosted install without Google)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("photo + goal → 'Sent – check your PC' within 2 s, quota shown", async ({ page }) => {
  const session = await newSession();
  await signIn(page, session);
  await expect(page.getByText("10 of 10 left")).toBeVisible();
  await addPhoto(page, 3);
  await page.getByPlaceholder("What do you want to build?").fill("Can I build an RC car?");
  await ticketPoolWarm(page);
  const t0 = Date.now();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent – check your PC")).toBeVisible({ timeout: 2000 });
  console.log(`sent in ${Date.now() - t0} ms`);
  await expect(page.getByText("9 of 10 left")).toBeVisible();
  expect(await jobCount(session.access_token)).toBe(1);
});

test("offline: queued, then sent automatically by the service worker", async ({ page, context }) => {
  const session = await newSession();
  await signIn(page, session);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 30_000 });
  await ticketPoolWarm(page);

  await context.setOffline(true);
  await addPhoto(page, 5);
  await page.getByPlaceholder("What do you want to build?").fill("line follower");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Queued, will send automatically")).toBeVisible({ timeout: 2000 });
  expect(await jobCount(session.access_token)).toBe(0);

  await context.setOffline(false);
  await expect.poll(() => jobCount(session.access_token), { timeout: 30_000 }).toBe(1);
  await expect(page.getByText(/queued/i)).toHaveCount(0, { timeout: 10_000 });
});
