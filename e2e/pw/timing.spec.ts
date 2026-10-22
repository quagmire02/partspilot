import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { localStack, photo } from "../support/local";

test.skip(process.env.LOCAL_STACK !== "1" || process.env.PW_TIMING !== "1", "diagnostic: PW_TIMING=1");

test("where does send time go", async ({ page }) => {
  const s = localStack();
  const admin = createClient(s.url, s.serviceKey, { auth: { persistSession: false } });
  const email = `t-${Date.now()}@partspilot.test`;
  const password = `pw-${crypto.randomUUID()}`;
  await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const { data } = await createClient(s.url, s.anonKey, { auth: { persistSession: false } }).auth.signInWithPassword({ email, password });
  await page.goto("/");
  await page.evaluate(async (v) => {
    await new Promise<void>((res) => {
      const r = indexedDB.open("partspilot");
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => {
        const tx = r.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put(v, "pp-auth");
        tx.oncomplete = () => res();
      };
    });
  }, JSON.stringify(data.session));
  await page.reload();
  await expect(page.getByText(/of 10 left/)).toBeVisible();
  await page.waitForTimeout(4000);
  await page.locator("input[type=file][multiple]").setInputFiles({ name: "p.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photo(2)) });
  await expect(page.locator(".strip img")).toHaveCount(1);
  const t0 = Date.now();
  const events: string[] = [];
  page.on("request", (r) => events.push(`${Date.now() - t0}ms → ${r.method()} ${new URL(r.url()).pathname}`));
  page.on("requestfinished", async (r) => {
    const t = r.timing();
    events.push(`${Date.now() - t0}ms ✓ ${r.method()} ${new URL(r.url()).pathname} (dns ${t.domainLookupEnd - t.domainLookupStart | 0} connect ${t.connectEnd - t.connectStart | 0} wait ${t.responseStart - t.requestStart | 0} total ${t.responseEnd | 0})`);
  });
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent – check your PC")).toBeVisible({ timeout: 5000 });
  events.push(`${Date.now() - t0}ms "Sent" visible`);
  console.log(events.join("\n"));
});
