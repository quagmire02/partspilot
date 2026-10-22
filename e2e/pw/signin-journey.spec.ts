import { devices, expect, test } from "@playwright/test";

test.skip(process.env.LOCAL_STACK !== "1", "needs the local stack (LOCAL_STACK=1)");

/**
 * Without a Google OAuth client the local stack offers email + password sign-in:
 * create the account on the phone, then sign in with it on the PC through the UI.
 */
test("local email sign-in: create on phone, sign in on PC, survives reload", async ({ browser }) => {
  const email = `local-${Date.now()}@partspilot.test`;
  const password = `pw-${crypto.randomUUID().slice(0, 12)}`;

  const phone = await browser.newContext({ ...devices["Pixel 7"], baseURL: "http://localhost:3000" });
  const mob = await phone.newPage();
  await mob.goto("/");
  await expect(mob.getByLabel("Email")).toBeVisible();
  await mob.getByLabel("Email").fill(email);
  await mob.getByLabel("Password").fill(password);
  await mob.getByRole("button", { name: "Create account" }).click();
  await expect(mob.getByText(/of 10 left/)).toBeVisible();
  await mob.reload();
  await expect(mob.getByText(/of 10 left/)).toBeVisible();

  const pc = await browser.newContext({ baseURL: "http://localhost:1420", viewport: { width: 1360, height: 900 } });
  const desk = await pc.newPage();
  await desk.goto("/");
  await desk.getByLabel("Password").fill("wrong-password");
  await desk.getByLabel("Email").fill(email);
  await desk.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(desk.locator(".notice.error")).toBeVisible();
  await desk.getByLabel("Password").fill(password);
  await desk.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(desk.getByText("No scans yet.")).toBeVisible();
  await desk.reload();
  await expect(desk.getByText("No scans yet.")).toBeVisible();

  await phone.close();
  await pc.close();
});
