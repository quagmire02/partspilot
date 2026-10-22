import type { z } from "zod";
import { ApiError, type ErrorCode } from "./errors";
import {
  CatalogSearchResponse,
  CreateJobResponse,
  DeleteJobResponse,
  InventoryPlanResponse,
  InventoryResponse,
  JobDetailResponse,
  JobListResponse,
  MeResponse,
  Quota,
  UpdatePartsResponse,
  UploadTicketsResponse,
  type InventoryPlanRequest,
  type JobListQuery,
  type UpdatePartsRequestInput,
} from "./api";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "network" | "invalid_response",
    readonly retryAfterS?: number,
  ) {
    super(`api_error:${code}`);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns a fresh access token (refreshing if needed), or null when signed out. */
  getAccessToken: () => Promise<string | null>;
  fetch?: typeof fetch;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Typed client for the PartsPilot Worker API. Every response is parsed with Zod. */
export function createApiClient(opts: ApiClientOptions) {
  const doFetch: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init));
  const base = opts.baseUrl.replace(/\/+$/, "");

  async function request<T extends z.ZodType>(
    schema: T,
    path: string,
    init: RequestInit & { json?: unknown } = {},
  ): Promise<z.infer<T>> {
    const token = await opts.getAccessToken();
    if (!token) throw new ApiRequestError(401, "unauthorized");
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { ...init, headers, body });
    } catch {
      throw new ApiRequestError(0, "network");
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiRequestError(res.status, "invalid_response");
    }
    if (!res.ok) {
      const err = ApiError.safeParse(data);
      throw new ApiRequestError(
        res.status,
        err.success ? err.data.error.code : "invalid_response",
        err.success ? err.data.error.retry_after_s : undefined,
      );
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new ApiRequestError(res.status, "invalid_response");
    return parsed.data;
  }

  return {
    me: () => request(MeResponse, "/v1/me"),
    quota: () => request(Quota, "/v1/quota"),
    uploadTickets: (turnstile_token: string) =>
      request(UploadTicketsResponse, "/v1/upload-tickets", { method: "POST", json: { turnstile_token } }),
    /** `form` is built by the caller (see buildCreateJobForm) so the SW can replay it. */
    createJob: (form: FormData) => request(CreateJobResponse, "/v1/jobs", { method: "POST", body: form }),
    listJobs: (q: Partial<JobListQuery> = {}) => {
      const p = new URLSearchParams();
      if (q.limit) p.set("limit", String(q.limit));
      if (q.updated_after) p.set("updated_after", q.updated_after);
      if (q.before) p.set("before", q.before);
      const qs = p.toString();
      return request(JobListResponse, `/v1/jobs${qs ? `?${qs}` : ""}`);
    },
    getJob: (id: string) => request(JobDetailResponse, `/v1/jobs/${encodeURIComponent(id)}`),
    updateParts: (id: string, body: UpdatePartsRequestInput) =>
      request(UpdatePartsResponse, `/v1/jobs/${encodeURIComponent(id)}/parts`, { method: "PUT", json: body }),
    deleteJob: (id: string) =>
      request(DeleteJobResponse, `/v1/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }),
    searchCatalog: (q: string, limit = 10) =>
      request(CatalogSearchResponse, `/v1/catalog/search?q=${encodeURIComponent(q)}&limit=${limit}`),
    inventory: () => request(InventoryResponse, "/v1/inventory"),
    putInventory: (partId: string, quantity: number) =>
      request(InventoryResponse, `/v1/inventory/${encodeURIComponent(partId)}`, {
        method: "PUT",
        json: { quantity },
      }),
    planFromInventory: (body: InventoryPlanRequest) =>
      request(InventoryPlanResponse, "/v1/inventory/plan", { method: "POST", json: body }),
  };
}

export interface CreateJobFormInput {
  clientRequestId: string;
  goal: string;
  photos: Blob[];
  turnstileToken?: string;
  uploadTicket?: string;
}

export function buildCreateJobForm(input: CreateJobFormInput): FormData {
  const form = new FormData();
  form.set("client_request_id", input.clientRequestId);
  form.set("goal", input.goal);
  if (input.turnstileToken) form.set("turnstile_token", input.turnstileToken);
  if (input.uploadTicket) form.set("upload_ticket", input.uploadTicket);
  input.photos.forEach((p, i) => form.append("photos", p, `photo-${i}.jpg`));
  return form;
}
