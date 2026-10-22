import { Hono } from "hono";
import type { AppEnv } from "../app.js";
import { quotaFor } from "../lib/quota.js";

export const meRoutes = new Hono<AppEnv>();

meRoutes.get("/me", async (c) => {
  const { repo, now } = c.get("deps");
  const user = c.get("user");
  const used = await repo.quotaUsed(user.id);
  return c.json({ user_id: user.id, email: user.email, quota: quotaFor(used, now()) });
});

meRoutes.get("/quota", async (c) => {
  const { repo, now } = c.get("deps");
  return c.json(quotaFor(await repo.quotaUsed(c.get("user").id), now()));
});
