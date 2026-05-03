import * as core from "@actions/core";
import { SpiceClient } from "@spiceai/spice";

export interface RuntimeOptions {
  baseUrl: string;
  flightUrl?: string;
  apiKey: string;
  warmupSeconds: number;
  timeoutSeconds: number;
  fetchImpl?: typeof fetch;
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> };
  sdkFactory?: (config: { apiKey: string; httpUrl: string; flightUrl?: string }) => SdkLike;
}

export interface ProbeResult {
  name: string;
  ok: boolean;
  durationMs: number;
  detail?: string;
  error?: string;
}

export interface DatasetState {
  name: string;
  from?: string;
  status: string;
  error?: { category?: string; type?: string; code?: string } | null;
  error_message?: string | null;
  acceleration_enabled?: boolean;
  replication_enabled?: boolean;
}

export class DatasetReadinessError extends Error {
  readonly datasets: DatasetState[];
  constructor(message: string, datasets: DatasetState[]) {
    super(message);
    this.name = "DatasetReadinessError";
    this.datasets = datasets;
  }
}

export interface SdkLike {
  isSpiceReady(): Promise<boolean>;
  sqlJson(
    query: string,
  ): Promise<{ row_count?: number; data?: unknown[]; execution_time_ms?: number }>;
  nsql(
    query: string,
    options?: { datasets?: string[] | null; model?: string; sample_data_enabled?: boolean },
  ): Promise<{
    row_count?: number;
    data?: unknown[];
    sql?: string;
  }>;
}

const defaultClock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export class RuntimeClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly warmupSeconds: number;
  private readonly timeoutSeconds: number;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: { now: () => number; sleep: (ms: number) => Promise<void> };
  private readonly sdk: SdkLike;

  private warmedUp = false;

  constructor(opts: RuntimeOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.warmupSeconds = opts.warmupSeconds;
    this.timeoutSeconds = opts.timeoutSeconds;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.clock = opts.clock ?? defaultClock;

    const factory = opts.sdkFactory ?? defaultSdkFactory;
    this.sdk = factory({
      apiKey: opts.apiKey,
      httpUrl: this.baseUrl,
      flightUrl: opts.flightUrl,
    });
  }

  async waitForReady(): Promise<void> {
    if (this.warmedUp || this.warmupSeconds <= 0) {
      this.warmedUp = true;
      return;
    }

    core.info(
      `Waiting up to ${this.warmupSeconds}s for runtime at ${this.baseUrl} to become ready.`,
    );
    const deadline = this.clock.now() + this.warmupSeconds * 1000;
    let attempt = 0;
    let lastError = "no response";
    while (this.clock.now() < deadline) {
      attempt++;
      try {
        if (await this.sdk.isSpiceReady()) {
          core.info(`Runtime ready after ${attempt} attempt(s).`);
          this.warmedUp = true;
          return;
        }
        lastError = "isSpiceReady returned false";
      } catch (err) {
        lastError = (err as Error).message;
      }
      await this.clock.sleep(2_000);
    }
    throw new Error(`Runtime not ready within ${this.warmupSeconds}s (last error: ${lastError}).`);
  }

  async probeSql(query: string): Promise<ProbeResult> {
    return this.timed("sql", async () => {
      const result = await this.sdk.sqlJson(query);
      const rows = result.row_count ?? result.data?.length ?? 0;
      const ms = result.execution_time_ms;
      return ms === undefined ? `${rows} row(s)` : `${rows} row(s) in ${ms}ms`;
    });
  }

  async probeNsql(query: string, model?: string): Promise<ProbeResult> {
    return this.timed("nsql", async () => {
      const result = await this.sdk.nsql(query, { model });
      const rows = result.row_count ?? result.data?.length ?? 0;
      const sql = result.sql ?? "";
      return `${rows} row(s); generated SQL: ${truncate(sql, 80)}`;
    });
  }

  async probeChat(body: unknown, scheme: "bearer" | "x-api-key" = "bearer"): Promise<ProbeResult> {
    return this.timedFetch("chat", "/v1/chat/completions", body, scheme, summarizeChat);
  }

  async probeSearch(body: unknown): Promise<ProbeResult> {
    return this.timedFetch("search", "/v1/search", body, "x-api-key", summarizeMatches);
  }

  async probeMcp(body: unknown): Promise<ProbeResult> {
    return this.timedFetch("mcp", "/v1/mcp", body, "bearer", summarizeMcp);
  }

  /**
   * Fetch the runtime's dataset list with status. Hits `GET /v1/datasets?status=true`
   * (see https://spiceai.org/docs/api/HTTP/get-datasets).
   */
  async getDatasets(): Promise<DatasetState[]> {
    const url = `${this.baseUrl}/v1/datasets?status=true`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000);
    try {
      const res = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "x-api-key": this.apiKey,
          "User-Agent": "spice-cloud-deploy-action",
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `GET /v1/datasets failed: ${res.status} ${res.statusText}: ${truncate(text, 300)}`,
        );
      }
      const json = (await res.json()) as DatasetState[];
      return Array.isArray(json) ? json : [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Poll `/v1/datasets?status=true` until every dataset is in a terminal-ready state
   * (`ready`, `disabled`, or `refreshing`). Throws `DatasetReadinessError` immediately
   * if any dataset reports `error`, or if the timeout expires while datasets are still
   * `initializing`.
   */
  async waitForDatasetsReady(timeoutSeconds: number): Promise<DatasetState[]> {
    if (timeoutSeconds <= 0) return [];
    core.info(`Waiting up to ${timeoutSeconds}s for datasets to load.`);
    const deadline = this.clock.now() + timeoutSeconds * 1000;
    let last: DatasetState[] = [];

    while (this.clock.now() < deadline) {
      try {
        last = await this.getDatasets();
      } catch (err) {
        core.debug(`getDatasets failed (will retry): ${(err as Error).message}`);
        await this.clock.sleep(2_000);
        continue;
      }

      const errored = last.filter((d) => normalizeStatus(d.status) === "error");
      if (errored.length > 0) {
        const detail = errored
          .map((d) => `${d.name}: ${d.error_message ?? d.error?.code ?? "<no message>"}`)
          .join("; ");
        throw new DatasetReadinessError(
          `${errored.length} dataset(s) failed to load: ${detail}`,
          last,
        );
      }

      const pending = last.filter((d) => normalizeStatus(d.status) === "initializing");
      if (pending.length === 0) {
        core.info(`All ${last.length} dataset(s) loaded.`);
        return last;
      }

      core.info(
        `${last.length - pending.length}/${last.length} dataset(s) loaded (still initializing: ${pending.map((d) => d.name).join(", ")})`,
      );
      await this.clock.sleep(3_000);
    }

    const stillPending = last
      .filter((d) => normalizeStatus(d.status) === "initializing")
      .map((d) => d.name);
    throw new DatasetReadinessError(
      `Datasets did not finish loading within ${timeoutSeconds}s (still initializing: ${stillPending.join(", ") || "<unknown>"}).`,
      last,
    );
  }

  private async timed(name: string, fn: () => Promise<string | undefined>): Promise<ProbeResult> {
    const start = this.clock.now();
    try {
      const detail = await fn();
      return { name, ok: true, durationMs: this.clock.now() - start, detail };
    } catch (err) {
      return {
        name,
        ok: false,
        durationMs: this.clock.now() - start,
        error: (err as Error).message,
      };
    }
  }

  private async timedFetch(
    name: string,
    path: string,
    body: unknown,
    scheme: "bearer" | "x-api-key",
    summarize: (text: string) => string | undefined,
  ): Promise<ProbeResult> {
    const start = this.clock.now();
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "spice-cloud-deploy-action",
      };
      if (scheme === "bearer") headers.Authorization = `Bearer ${this.apiKey}`;
      else headers["x-api-key"] = this.apiKey;

      const res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const durationMs = this.clock.now() - start;
      const text = await res.text().catch(() => "");
      if (!res.ok) {
        return {
          name,
          ok: false,
          durationMs,
          error: `${res.status} ${res.statusText}: ${truncate(text, 300)}`,
        };
      }
      return { name, ok: true, durationMs, detail: summarize(text) };
    } catch (err) {
      return {
        name,
        ok: false,
        durationMs: this.clock.now() - start,
        error: (err as Error).message,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function defaultSdkFactory(config: {
  apiKey: string;
  httpUrl: string;
  flightUrl?: string;
}): SdkLike {
  const client = new SpiceClient({
    apiKey: config.apiKey,
    httpUrl: config.httpUrl,
    flightUrl: config.flightUrl,
    logging: false,
  });
  return client as unknown as SdkLike;
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function normalizeStatus(status: string): string {
  return (status ?? "").trim().toLowerCase();
}

function summarizeChat(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
    };
    const content = parsed.choices?.[0]?.message?.content;
    const tokens = parsed.usage?.total_tokens;
    const parts: string[] = [];
    if (typeof tokens === "number") parts.push(`${tokens} tokens`);
    if (typeof content === "string") parts.push(`reply: ${truncate(content, 80)}`);
    return parts.join(", ") || undefined;
  } catch {
    return undefined;
  }
}

function summarizeMatches(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { matches?: unknown[] };
    if (Array.isArray(parsed.matches)) return `${parsed.matches.length} match(es)`;
  } catch {
    /* noop */
  }
  return undefined;
}

function summarizeMcp(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as {
      result?: { content?: unknown[] };
      error?: { message?: string };
    };
    if (parsed.error?.message) return `error: ${parsed.error.message}`;
    if (Array.isArray(parsed.result?.content)) {
      return `${parsed.result.content.length} content block(s)`;
    }
  } catch {
    /* noop */
  }
  return undefined;
}
