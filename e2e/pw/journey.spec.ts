import { devices, expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { localStack, photo } from "../support/local";

test.skip(process.env.LOCAL_STACK !== "1", "needs the local stack (LOCAL_STACK=1)");

/**
 * The product promise, end to end on the local stack: photograph on the phone, ask a
 * goal, and the PC — already open on the Inbox — gets the result pushed (Realtime),
 * with no reload, then shows a validated plan.
 */
test("phone → cloud → PC: Inbox updates live and shows the validated result", async ({ browser }) => {
  const s = localStack();
  const admin = createClient(s.url, s.serviceKey, { auth: { persistSession: false } });
  const email = `journey-${Date.now()}@partspilot.test`;
  const password = `pw-${crypto.randomUUID()}`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const signIn = () => createClient(s.url, s.anonKey, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });

  // PC: signed in, idle on the Inbox.
  const pc = await browser.newContext({ baseURL: "http://localhost:1420", viewport: { width: 1360, height: 900 } });
  const desk = await pc.newPage();
  await desk.goto("/");
  const pcSession = (await signIn()).data.session!;
  await desk.evaluate((v) => localStorage.setItem("pp-desktop-auth", v), JSON.stringify(pcSession));
  await desk.reload();
  await expect(desk.getByText("No scans yet.")).toBeVisible();

  // Phone: signed in, takes a photo, asks the goal.
  const phone = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://localhost:3000" });
  const mob = await phone.newPage();
  await mob.goto("/");
  const phoneSession = (await signIn()).data.session!;
  await mob.evaluate(async (value) => {
    await new Promise<void>((resolve) => {
      const r = indexedDB.open("partspilot");
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => {
        const tx = r.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put(value, "pp-auth");
        tx.oncomplete = () => resolve();
      };
    });
  }, JSON.stringify(phoneSession));
  await mob.reload();
  await expect(mob.getByText("10 of 10 left")).toBeVisible();
  await mob.locator("input[type=file][multiple]").setInputFiles({ name: "pile.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo(9)) });
  await expect(mob.locator(".strip img")).toHaveCount(1); // photo normalised on the phone
  await mob.getByPlaceholder("What do you want to build?").fill("Can I build an RC car?");
  await expect(mob.getByRole("button", { name: "Send" })).toBeEnabled();
  await mob.getByRole("button", { name: "Send" }).click();
  await expect(mob.getByText("Sent – check your PC")).toBeVisible({ timeout: 4000 });
  const sentAt = Date.now();

  // PC: the job appears and turns Ready by itself (Realtime push, no reload).
  const row = desk.getByRole("button", { name: /Can I build an RC car\?/ });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText("Ready")).toBeVisible({ timeout: 60_000 });
  console.log(`PC showed Ready ${Date.now() - sentAt} ms after "Sent"`);
  await row.click();
  await expect(desk.getByRole("status").filter({ hasText: /^Yes/ })).toBeVisible();
  await expect(desk.locator("wokwi-arduino-uno")).toHaveCount(1);
  await expect(desk.getByRole("button", { name: "Copy" })).toBeVisible();

  await phone.close();
  await pc.close();
});
