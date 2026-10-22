import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { ZodError } from "zod";
import type { Deps } from "./deps.js";
import type { AuthUser } from "./lib/jwt.js";
import { HttpError } from "./lib/errors.js";
import { log, timer } from "./lib/log.js";
import { meRoutes } from "./routes/me.js";
import { jobRoutes } from "./routes/jobs.js";
import { uploadRoutes } from "./routes/uploads.js";
import { catalogRoutes } from "./routes/catalog.js";
import { inventoryRoutes } from "./routes/inventory.js";

export type AppEnv = { Variables: { deps: Deps; user: AuthUser; ip: string | null } };

export function createApp(getDeps: (env: unknown) => Deps) {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("deps", getDeps(c.env));
    c.set("ip", c.req.header("cf-connecting-ip") ?? null);
    await next();
  });

  app.use(
    "*",
    secureHeaders({
      crossOriginResourcePolicy: "same-site",
      referrerPolicy: "no-referrer",
      xFrameOptions: "DENY",
    }),
  );

  app.use("*", async (c, next) => {
    const origins = c.get("deps").allowedOrigins;
    return cors({
      origin: (origin) => (origins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["authorization", "content-type"],
      maxAge: 600,
    })(c, next);
  });

  // Order matters: cheap per-IP limit, then JWT (every route), then per-user limit.
  app.use("/v1/*", async (c, next) => {
    const { limiters, verifyToken } = c.get("deps");
    const ip = c.get("ip");
    if (ip && !(await limiters.ip.allow(`ip:${ip}`))) throw new HttpError("rate_limited", 60);

    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer ([A-Za-z0-9\-_.]+)$/.exec(header)?.[1];
    if (!token) throw new HttpError("unauthorized");
    const user = await verifyToken(token).catch(() => null);
    if (!user) throw new HttpError("unauthorized");
    c.set("user", user);

    if (!(await limiters.user.allow(`user:${user.id}`))) throw new HttpError("rate_limited", 60);
    c.header("cache-control", "no-store");
    const elapsed = timer();
    await next();
    log("http", { route: c.req.routePath, status: c.res.status, ms: elapsed(), user_id: user.id });
  });

  app.route("/v1", meRoutes);
  app.route("/v1", uploadRoutes);
  app.route("/v1", jobRoutes);
  app.route("/v1", catalogRoutes);
  app.route("/v1", inventoryRoutes);

  app.notFound(() => {
    throw new HttpError("not_found");
  });

  app.onError((err, c) => {
    const e =
      err instanceof HttpError ? err : err instanceof ZodError ? new HttpError("bad_request") : new HttpError("internal");
    if (e.code === "internal") log("http_error", { code: "internal", route: c.req.routePath });
    if (e.retryAfterS) c.header("retry-after", String(e.retryAfterS));
    c.header("cache-control", "no-store");
    return c.json(e.toBody(), e.status as 400);
  });

  return app;
}
