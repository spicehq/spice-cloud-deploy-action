import type { ApiErrorBody } from "./types.js";

export class SpiceApiError extends Error {
  readonly status: number;
  readonly url: string;
  readonly body: ApiErrorBody | string | undefined;

  constructor(message: string, status: number, url: string, body?: ApiErrorBody | string) {
    super(message);
    this.name = "SpiceApiError";
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

export class OAuthError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = "OAuthError";
    this.status = status;
    this.url = url;
  }
}

export class DeploymentTimeoutError extends Error {
  readonly deploymentId: number | string;
  readonly lastStatus: string;

  constructor(deploymentId: number | string, lastStatus: string, timeoutSeconds: number) {
    super(
      `Deployment ${deploymentId} did not complete within ${timeoutSeconds}s (last status: ${lastStatus}).`,
    );
    this.name = "DeploymentTimeoutError";
    this.deploymentId = deploymentId;
    this.lastStatus = lastStatus;
  }
}

export class DeploymentFailedError extends Error {
  readonly deploymentId: number | string;

  constructor(deploymentId: number | string, detail?: string) {
    const suffix = detail ? `: ${detail}` : "";
    super(`Deployment ${deploymentId} failed${suffix}.`);
    this.name = "DeploymentFailedError";
    this.deploymentId = deploymentId;
  }
}

export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}
