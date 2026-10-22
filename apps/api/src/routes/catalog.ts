import { Hono } from "hono";
import { CatalogSearchQuery } from "@partspilot/shared";
import type { AppEnv } from "../app.js";

export const catalogRoutes = new Hono<AppEnv>();

catalogRoutes.get("/catalog/search", async (c) => {
  const q = CatalogSearchQuery.parse(c.req.query());
  return c.json({ items: await c.get("deps").repo.searchCatalog(q.q, q.limit) });
});
