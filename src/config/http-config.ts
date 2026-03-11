const DEFAULT_ALLOWED_ORIGINS = ["https://localhost:3000"];

export type HttpMiddlewareConfig = {
  allowedOrigins: string[];
  jsonBodyLimit: string;
  requestTimeout: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
};

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value?.trim()) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function getHttpMiddlewareConfig(): HttpMiddlewareConfig {
  return {
    allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
    jsonBodyLimit: "10mb",
    requestTimeout: "30s",
    rateLimitWindowMs: 15 * 60 * 1000,
    rateLimitMaxRequests: 100,
  };
}