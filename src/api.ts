import * as core from "@actions/core";
import type { OAuthClient } from "./auth.js";
import { SpiceApiError } from "./errors.js";
import type {
  ApiErrorBody,
  App,
  AppListResponse,
  CreateAppBody,
  CreateDeploymentBody,
  Deployment,
  DeploymentListResponse,
  UpdateAppBody,
} from "./types.js";

export interface SpiceApiClientOptions {
  baseUrl: string;
  oauth: OAuthClient;
  fetchImpl?: typeof fetch;
  retry?: {
    maxAttempts?: number;
    initialDelayMs?: number;
  };
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class SpiceApiClient {
  private readonly baseUrl: string;
  private readonly oauth: OAuthClient;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly initialDelayMs: number;

  constructor(opts: SpiceApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.oauth = opts.oauth;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.maxAttempts = opts.retry?.maxAttempts ?? 4;
    this.initialDelayMs = opts.retry?.initialDelayMs ?? 500;
  }

  async listApps(): Promise<App[]> {
    const json = await this.request<AppListResponse>("GET", "/v1/apps");
    return json.apps ?? [];
  }

  async getApp(appId: number): Promise<App> {
    return this.request<App>("GET", `/v1/apps/${appId}`);
  }

  async createApp(body: CreateAppBody): Promise<App> {
    return this.request<App>("POST", "/v1/apps", body);
  }

  async updateApp(appId: number, body: UpdateAppBody): Promise<App> {
    return this.request<App>("PUT", `/v1/apps/${appId}`, body);
  }

  async upsertSecret(appId: number, name: string, value: string): Promise<void> {
    await this.request<unknown>("POST", `/v1/apps/${appId}/secrets`, { name, value });
  }

  async createDeployment(appId: number, body: CreateDeploymentBody): Promise<Deployment> {
    return this.request<Deployment>("POST", `/v1/apps/${appId}/deployments`, body);
  }

  async getApiKeys(appId: number): Promise<{ api_key: string | null; api_key_2: string | null }> {
    return this.request<{ api_key: string | null; api_key_2: string | null }>(
      "GET",
      `/v1/apps/${appId}/api-keys`,
    );
  }

  async listDeployments(
    appId: number,
    params?: { limit?: number; status?: string },
  ): Promise<Deployment[]> {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.status) search.set("status", params.status);
    const qs = search.toString();
    const path = `/v1/apps/${appId}/deployments${qs ? `?${qs}` : ""}`;
    const json = await this.request<DeploymentListResponse>("GET", path);
    return json.deployments ?? [];
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const token = await this.oauth.getAccessToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "spice-cloud-deploy-action",
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";

      const startMs = Date.now();
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch (err) {
        const durationMs = Date.now() - startMs;
        lastError = err as Error;
        core.info(`${method} ${path} → network error in ${durationMs}ms: ${lastError.message}`);
        if (attempt < this.maxAttempts) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw new SpiceApiError(
          `Network error calling ${method} ${path}: ${lastError.message}`,
          0,
          url,
        );
      }

      // Read the body before logging so the timing covers true end-to-end
      // request latency (request send → response headers → full body received),
      // not just time-to-first-byte. 204 No Content has no body to read.
      let bodyText = "";
      let bodyError: Error | undefined;
      if (res.status !== 204) {
        try {
          bodyText = await res.text();
        } catch (err) {
          bodyError = err as Error;
        }
      }
      const durationMs = Date.now() - startMs;
      core.info(`${method} ${path} → ${res.status} ${res.statusText} (${durationMs}ms)`);

      if (res.status === 204) {
        return undefined as T;
      }

      if (bodyError) {
        if (attempt < this.maxAttempts) {
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw new SpiceApiError(
          `Failed to read response body for ${method} ${path}: ${bodyError.message}`,
          res.status,
          url,
        );
      }

      if (res.ok) {
        if (!bodyText) return undefined as T;
        try {
          return JSON.parse(bodyText) as T;
        } catch {
          return bodyText as unknown as T;
        }
      }

      if (RETRYABLE_STATUSES.has(res.status) && attempt < this.maxAttempts) {
        const delay = retryAfterMs(res) ?? this.backoff(attempt);
        core.debug(
          `Retrying ${method} ${path} after ${res.status} ${res.statusText} (attempt ${attempt}/${this.maxAttempts}, sleep ${delay}ms)`,
        );
        await this.sleep(delay);
        continue;
      }

      const errorBody = parseErrorBody(bodyText);
      throw new SpiceApiError(
        formatApiError(method, path, res, errorBody),
        res.status,
        url,
        errorBody,
      );
    }

    throw new SpiceApiError(
      `Exhausted retries calling ${method} ${path}: ${lastError?.message ?? "unknown error"}`,
      0,
      url,
    );
  }

  private backoff(attempt: number): number {
    const exp = this.initialDelayMs * 2 ** (attempt - 1);
    const jitter = Math.floor(Math.random() * this.initialDelayMs);
    return exp + jitter;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function parseErrorBody(text: string): ApiErrorBody | string | undefined {
  if (!text) return undefined;
  try {
    return JSON.parse(text) as ApiErrorBody;
  } catch {
    return text;
  }
}

function formatApiError(
  method: string,
  path: string,
  res: Response,
  body: ApiErrorBody | string | undefined,
): string {
  const prefix = `${method} ${path} failed: ${res.status} ${res.statusText}`;
  if (!body) return prefix;
  if (typeof body === "string") return `${prefix} — ${body.slice(0, 500)}`;
  const parts: string[] = [];
  if (body.error) parts.push(body.error);
  else if (body.message) parts.push(body.message);
  if (body.details?.fieldErrors) {
    for (const [field, messages] of Object.entries(body.details.fieldErrors)) {
      parts.push(`${field}: ${messages.join("; ")}`);
    }
  }
  const joined = parts.join(" — ");
  return joined ? `${prefix} — ${joined}` : prefix;
}

function retryAfterMs(res: Response): number | undefined {
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}
