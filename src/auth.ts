import * as core from "@actions/core";
import { OAuthError } from "./errors.js";
import type { OAuthTokenResponse } from "./types.js";

export interface OAuthClientOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  fetchImpl?: typeof fetch;
}

export class OAuthClient {
  private readonly tokenUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scope?: string;
  private readonly fetchImpl: typeof fetch;

  private cachedToken?: { value: string; expiresAt: number };

  constructor(opts: OAuthClientOptions) {
    this.tokenUrl = opts.tokenUrl;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.scope = opts.scope;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt - 30_000 > now) {
      return this.cachedToken.value;
    }

    const body: Record<string, string> = {
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    };
    if (this.scope) body.scope = this.scope;

    let res: Response;
    try {
      res = await this.fetchImpl(this.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "spice-cloud-deploy-action",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new OAuthError(
        `Network error contacting OAuth token endpoint: ${(err as Error).message}`,
        0,
        this.tokenUrl,
      );
    }

    if (!res.ok) {
      const text = await safeText(res);
      throw new OAuthError(
        `OAuth token exchange failed (${res.status} ${res.statusText}): ${text}`,
        res.status,
        this.tokenUrl,
      );
    }

    const json = (await res.json()) as OAuthTokenResponse;
    if (!json.access_token) {
      throw new OAuthError("OAuth token response missing access_token.", res.status, this.tokenUrl);
    }

    core.setSecret(json.access_token);

    const expiresInMs = (json.expires_in ?? 3600) * 1000;
    this.cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + expiresInMs,
    };
    return json.access_token;
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable response body>";
  }
}
