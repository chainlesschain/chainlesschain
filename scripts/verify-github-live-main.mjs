#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MAIN_REF = "refs/heads/main";
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function fail(message) {
  const error = new Error(message);
  error.code = "CC_GITHUB_LIVE_MAIN_INVALID";
  throw error;
}

function required(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${name} is required`);
  }
  return value;
}

async function cancelResponseBody(response, reason) {
  try {
    await response?.body?.cancel?.(reason);
  } catch {
    // The validation failure remains authoritative if cancellation fails.
  }
}

function strictHttpsOrigin(value, name) {
  const raw = required(value, name);
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`${name} must be a canonical HTTPS origin`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    raw !== url.origin
  ) {
    fail(`${name} must be a canonical HTTPS origin`);
  }
  return url.origin;
}

export function canonicalGithubApiUrl(serverUrl) {
  const origin = strictHttpsOrigin(serverUrl, "server URL");
  return origin === "https://github.com"
    ? "https://api.github.com"
    : `${origin}/api/v3`;
}

export function assertGithubLiveMain({
  expectedSha,
  eventSha,
  eventRef,
  refProtected,
  repository,
  liveRef,
}) {
  if (!COMMIT_SHA.test(expectedSha || "")) {
    fail("expected SHA must be an exact lowercase commit SHA");
  }
  if (!COMMIT_SHA.test(eventSha || "") || eventSha !== expectedSha) {
    fail("event SHA does not match the exact candidate SHA");
  }
  if (eventRef !== MAIN_REF) {
    fail("workflow ref must be refs/heads/main");
  }
  if (refProtected !== true && refProtected !== "true") {
    fail("refs/heads/main is not reported as protected");
  }
  if (!REPOSITORY.test(repository || "")) {
    fail("repository must be owner/repository");
  }
  if (
    liveRef?.ref !== MAIN_REF ||
    liveRef?.object?.type !== "commit" ||
    !COMMIT_SHA.test(liveRef?.object?.sha || "") ||
    liveRef.object.sha !== expectedSha
  ) {
    fail("live refs/heads/main does not resolve to the exact candidate SHA");
  }
  return Object.freeze({
    repository,
    ref: MAIN_REF,
    sha: expectedSha,
    protected: true,
  });
}

async function boundedJson(response) {
  if (!response || response.status !== 200 || response.ok !== true) {
    await cancelResponseBody(response, "GitHub refs API rejected response");
    fail(`GitHub refs API returned HTTP ${response?.status ?? "unknown"}`);
  }
  const contentType = response.headers?.get?.("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    await cancelResponseBody(response, "GitHub refs API returned non-JSON");
    fail("GitHub refs API did not return JSON");
  }
  const contentLength = response.headers?.get?.("content-length");
  let declaredLength = null;
  if (contentLength !== null && contentLength !== undefined) {
    if (
      !/^[1-9][0-9]*$/u.test(contentLength) ||
      Number(contentLength) > MAX_RESPONSE_BYTES
    ) {
      await cancelResponseBody(
        response,
        "GitHub refs API declared an invalid response size",
      );
      fail("GitHub refs API response size is invalid");
    }
    declaredLength = Number(contentLength);
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    fail("GitHub refs API response body stream is unavailable");
  }
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch {
        fail("GitHub refs API response body could not be read");
      }
      if (chunk?.done === true) break;
      if (!(chunk?.value instanceof Uint8Array)) {
        try {
          await reader.cancel("GitHub refs API returned an invalid body chunk");
        } catch {
          // The body-shape failure remains authoritative.
        }
        fail("GitHub refs API response body is invalid");
      }
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel("GitHub refs API response exceeded byte limit");
        } catch {
          // The size failure remains authoritative even if cancellation fails.
        }
        fail("GitHub refs API response size is invalid");
      }
      chunks.push(chunk.value);
    }
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      // Nothing else should replace the original validation failure.
    }
  }
  if (
    total < 1 ||
    total > MAX_RESPONSE_BYTES ||
    (declaredLength !== null && declaredLength !== total)
  ) {
    fail("GitHub refs API response size is invalid");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("GitHub refs API returned invalid JSON");
  }
}

export async function fetchGithubLiveMain({
  serverUrl,
  apiUrl,
  repository,
  token,
  fetchImpl = globalThis.fetch,
}) {
  const expectedApiUrl = canonicalGithubApiUrl(serverUrl);
  if (apiUrl !== expectedApiUrl) {
    fail("GitHub API URL does not match the canonical server API origin");
  }
  if (!REPOSITORY.test(repository || "")) {
    fail("repository must be owner/repository");
  }
  required(token, "GitHub token");
  if (typeof fetchImpl !== "function") {
    fail("fetch implementation is unavailable");
  }
  const [owner, name] = repository.split("/");
  const endpoint = `${apiUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/ref/heads/main`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "chainlesschain-live-main-verifier",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (error) {
    fail(`GitHub refs API request failed: ${error?.message || error}`);
  }
  return boundedJson(response);
}

export async function verifyGithubLiveMain(options) {
  const liveRef = await fetchGithubLiveMain(options);
  return assertGithubLiveMain({ ...options, liveRef });
}

function argument(name) {
  const indexes = process.argv
    .map((value, index) => (value === name ? index : -1))
    .filter((index) => index >= 0);
  if (indexes.length !== 1 || indexes[0] === process.argv.length - 1) {
    fail(`${name} must be supplied exactly once`);
  }
  return process.argv[indexes[0] + 1];
}

async function main() {
  const result = await verifyGithubLiveMain({
    expectedSha: argument("--expected-sha"),
    eventSha: argument("--event-sha"),
    eventRef: argument("--event-ref"),
    refProtected: argument("--ref-protected"),
    repository: argument("--repository"),
    serverUrl: argument("--server-url"),
    apiUrl: argument("--api-url"),
    token: process.env.GITHUB_TOKEN,
  });
  process.stdout.write(
    `Verified protected live main: ${result.repository}@${result.sha}\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(
      `${error?.code ? `${error.code}: ` : ""}${error?.message || error}\n`,
    );
    process.exitCode = 1;
  });
}
