import test from "node:test";
import assert from "node:assert/strict";

import { getHttpMiddlewareConfig } from "../src/config/http-config.ts";

type EnvSnapshot = Partial<Record<string, string | undefined>>;

function snapshotEnv(): EnvSnapshot {
  return {
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  };
}

function restoreEnv(snapshot: EnvSnapshot) {
  if (snapshot.ALLOWED_ORIGINS === undefined) {
    delete process.env.ALLOWED_ORIGINS;
    return;
  }

  process.env.ALLOWED_ORIGINS = snapshot.ALLOWED_ORIGINS;
}

test("getHttpMiddlewareConfig uses default allowed origin when env is missing", () => {
  const snapshot = snapshotEnv();

  try {
    delete process.env.ALLOWED_ORIGINS;

    assert.deepEqual(getHttpMiddlewareConfig().allowedOrigins, [
      "https://localhost:3000",
    ]);
  } finally {
    restoreEnv(snapshot);
  }
});

test("getHttpMiddlewareConfig parses comma-separated allowed origins", () => {
  const snapshot = snapshotEnv();

  try {
    process.env.ALLOWED_ORIGINS = " https://a.example , https://b.example ,, ";

    assert.deepEqual(getHttpMiddlewareConfig().allowedOrigins, [
      "https://a.example",
      "https://b.example",
    ]);
  } finally {
    restoreEnv(snapshot);
  }
});