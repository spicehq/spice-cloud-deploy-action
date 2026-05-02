export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  scope?: string;
}

export interface App {
  id: number;
  name: string;
  description?: string | null;
  visibility?: "public" | "private";
  cname?: string;
  region?: string;
  cluster_id?: string | null;
  created_at?: string;
  tags?: Record<string, string> | null;
}

export interface AppListResponse {
  apps: App[];
}

export type DeploymentStatus = "queued" | "in_progress" | "succeeded" | "failed" | "created";

export interface Deployment {
  id: number | string;
  app_id?: number;
  status: DeploymentStatus;
  branch?: string;
  commit_sha?: string;
  commit_message?: string;
  image_tag?: string;
  channel?: string;
  replicas?: number;
  debug?: boolean;
  created_at?: string;
  updated_at?: string;
  finished_at?: string | null;
  error?: string | null;
}

export interface DeploymentListResponse {
  deployments: Deployment[];
}

export interface CreateDeploymentBody {
  image_tag?: string;
  channel?: string;
  replicas?: number;
  branch?: string;
  commit_sha?: string;
  commit_message?: string;
  debug?: boolean;
}

export interface CreateAppBody {
  name: string;
  region?: string;
  cname?: string;
  description?: string;
  visibility?: "public" | "private";
  tags?: Record<string, string>;
}

export interface UpdateAppBody {
  description?: string;
  visibility?: "public" | "private";
  spicepod?: string;
  image_tag?: string;
  replicas?: number;
  tags?: Record<string, string>;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
  details?: {
    fieldErrors?: Record<string, string[]>;
  };
}
