/**
 * Generates packages/shared/openapi.json from the Zod contracts.
 * Run: pnpm --filter @partspilot/shared openapi
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import * as S from "../src/index";

export function buildOpenApiDocument() {
  const r = new OpenAPIRegistry();
  // Zod-native metadata: the generator emits a component for every schema with an id.
  const named = <T extends z.ZodType>(id: string, schema: T): T => schema.meta({ id }) as T;
  const bearer = r.registerComponent("securitySchemes", "supabaseJwt", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "Supabase Auth access token. Required on every request.",
  });
  const security = [{ [bearer.name]: [] }];

  const ApiError = named("ApiError", S.ApiError);
  const errors = {
    400: { description: "Invalid request", content: { "application/json": { schema: ApiError } } },
    401: { description: "Missing or invalid JWT", content: { "application/json": { schema: ApiError } } },
    429: { description: "Rate or quota limit", content: { "application/json": { schema: ApiError } } },
  };
  const json = <T extends z.ZodType>(schema: T, description = "OK") => ({
    description,
    content: { "application/json": { schema } },
  });

  const Quota = named("Quota", S.Quota);

  r.registerPath({
    method: "get",
    path: "/v1/me",
    security,
    responses: { 200: json(named("MeResponse", S.MeResponse)), ...errors },
  });
  r.registerPath({ method: "get", path: "/v1/quota", security, responses: { 200: json(Quota), ...errors } });
  r.registerPath({
    method: "post",
    path: "/v1/upload-tickets",
    summary: "Exchange a Turnstile token for single-use upload tickets (offline queue)",
    security,
    request: { body: { content: { "application/json": { schema: S.UploadTicketsRequest } } } },
    responses: { 200: json(named("UploadTicketsResponse", S.UploadTicketsResponse)), 403: json(ApiError, "Turnstile failed"), ...errors },
  });
  r.registerPath({
    method: "post",
    path: "/v1/jobs",
    summary: "Upload 1-4 photos and a goal; processing starts immediately",
    security,
    request: {
      body: {
        content: {
          "multipart/form-data": {
            schema: z.object({
              client_request_id: z.uuid(),
              goal: z.string().max(S.LIMITS.MAX_GOAL_CHARS).optional(),
              turnstile_token: z.string().optional(),
              upload_ticket: z.uuid().optional(),
              photos: z.array(z.string().meta({ format: "binary" })).min(1).max(S.LIMITS.MAX_PHOTOS),
            }),
          },
        },
      },
    },
    responses: {
      202: json(named("CreateJobResponse", S.CreateJobResponse), "Accepted"),
      413: json(ApiError, "Photo larger than 10 MB"),
      415: json(ApiError, "Not JPEG/PNG/WebP"),
      ...errors,
    },
  });
  r.registerPath({
    method: "get",
    path: "/v1/jobs",
    security,
    request: { query: S.JobListQuery },
    responses: { 200: json(named("JobListResponse", S.JobListResponse)), ...errors },
  });
  const idParam = z.object({ id: z.uuid() });
  r.registerPath({
    method: "get",
    path: "/v1/jobs/{id}",
    security,
    request: { params: idParam },
    responses: { 200: json(named("JobDetailResponse", S.JobDetailResponse)), 404: json(ApiError, "Not found"), ...errors },
  });
  r.registerPath({
    method: "put",
    path: "/v1/jobs/{id}/parts",
    summary: "Confirm/correct parts; re-runs the plan",
    security,
    request: { params: idParam, body: { content: { "application/json": { schema: S.UpdatePartsRequest } } } },
    responses: { 202: json(named("UpdatePartsResponse", S.UpdatePartsResponse), "Accepted"), 409: json(ApiError, "Stale plan_version"), ...errors },
  });
  r.registerPath({
    method: "delete",
    path: "/v1/jobs/{id}",
    security,
    request: { params: idParam },
    responses: { 200: json(named("DeleteJobResponse", S.DeleteJobResponse)), ...errors },
  });
  r.registerPath({
    method: "get",
    path: "/v1/catalog/search",
    security,
    request: { query: S.CatalogSearchQuery },
    responses: { 200: json(named("CatalogSearchResponse", S.CatalogSearchResponse)), ...errors },
  });
  r.registerPath({
    method: "get",
    path: "/v1/inventory",
    security,
    responses: { 200: json(named("InventoryResponse", S.InventoryResponse)), ...errors },
  });
  r.registerPath({
    method: "put",
    path: "/v1/inventory/{part_id}",
    security,
    request: {
      params: z.object({ part_id: S.PartId }),
      body: { content: { "application/json": { schema: S.PutInventoryRequest } } },
    },
    responses: { 200: json(named("InventoryResponse", S.InventoryResponse)), ...errors },
  });
  r.registerPath({
    method: "post",
    path: "/v1/inventory/plan",
    summary: "What can I build with my inventory? Creates a job without photos",
    security,
    request: { body: { content: { "application/json": { schema: S.InventoryPlanRequest } } } },
    responses: { 202: json(named("InventoryPlanResponse", S.InventoryPlanResponse), "Accepted"), ...errors },
  });

  return new OpenApiGeneratorV31(r.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "PartsPilot API", version: "0.1.0" },
    servers: [{ url: "https://api.partspilot.app" }],
    security,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = fileURLToPath(new URL("../openapi.json", import.meta.url));
  writeFileSync(out, JSON.stringify(buildOpenApiDocument(), null, 2) + "\n");
  console.log(`wrote ${out}`);
}
