import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGithubLiveMain,
  canonicalGithubApiUrl,
  fetchGithubLiveMain,
  verifyGithubLiveMain,
} from "../verify-github-live-main.mjs";

const SHA = "a".repeat(40);
const CONTEXT = Object.freeze({
  expectedSha: SHA,
  eventSha: SHA,
  eventRef: "refs/heads/main",
  refProtected: "true",
  repository: "chainlesschain/chainlesschain",
});

function liveRef(sha = SHA) {
  return {
    ref: "refs/heads/main",
    object: { type: "commit", sha },
  };
}

function response(value = liveRef(), overrides = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      "content-type": "application/json; charset=utf-8",
      "content-length": String(bytes.byteLength),
    }),
    async arrayBuffer() {
      return bytes.buffer;
    },
    ...overrides,
  };
}

test("accepts only the protected event SHA at the live main ref", async () => {
  let request;
  const result = await verifyGithubLiveMain({
    ...CONTEXT,
    serverUrl: "https://github.com",
    apiUrl: "https://api.github.com",
    token: "test-token",
    fetchImpl: async (...args) => {
      request = args;
      return response();
    },
  });
  assert.equal(result.sha, SHA);
  assert.equal(
    request[0],
    "https://api.github.com/repos/chainlesschain/chainlesschain/git/ref/heads/main",
  );
  assert.equal(request[1].redirect, "error");
  assert.equal(request[1].signal.aborted, false);
  assert.equal(request[1].headers.Authorization, "Bearer test-token");
});

test("rejects stale, rerun, branch, tag, and unprotected workflow identities", () => {
  for (const [override, pattern] of [
    [{ expectedSha: "b".repeat(40) }, /event SHA/u],
    [{ eventSha: "b".repeat(40) }, /event SHA/u],
    [{ eventRef: "refs/heads/release" }, /refs\/heads\/main/u],
    [{ eventRef: "refs/tags/v1.0.0" }, /refs\/heads\/main/u],
    [{ refProtected: "false" }, /not reported as protected/u],
  ]) {
    assert.throws(
      () =>
        assertGithubLiveMain({ ...CONTEXT, ...override, liveRef: liveRef() }),
      pattern,
    );
  }
  assert.throws(
    () =>
      assertGithubLiveMain({
        ...CONTEXT,
        liveRef: liveRef("c".repeat(40)),
      }),
    /live refs\/heads\/main/u,
  );
});

test("requires the canonical GitHub API origin and rejects redirects", async () => {
  assert.equal(
    canonicalGithubApiUrl("https://github.com"),
    "https://api.github.com",
  );
  assert.equal(
    canonicalGithubApiUrl("https://github.enterprise.test"),
    "https://github.enterprise.test/api/v3",
  );
  for (const [serverUrl, apiUrl] of [
    ["https://github.com/", "https://api.github.com"],
    ["http://github.com", "https://api.github.com"],
    ["https://github.com", "https://github.com/api/v3"],
    ["https://github.enterprise.test", "https://api.github.enterprise.test"],
  ]) {
    await assert.rejects(
      fetchGithubLiveMain({
        serverUrl,
        apiUrl,
        repository: CONTEXT.repository,
        token: "test-token",
        fetchImpl: async () => response(),
      }),
      /canonical HTTPS origin|canonical server API origin/u,
    );
  }
  await assert.rejects(
    fetchGithubLiveMain({
      serverUrl: "https://github.com",
      apiUrl: "https://api.github.com",
      repository: CONTEXT.repository,
      token: "test-token",
      fetchImpl: async () => response({}, { ok: false, status: 302 }),
    }),
    /HTTP 302/u,
  );
});

test("fails closed on malformed or oversized refs API responses", async () => {
  for (const result of [
    response({}, { headers: new Headers({ "content-type": "text/html" }) }),
    response(
      {},
      {
        headers: new Headers({
          "content-type": "application/json",
          "content-length": String(300 * 1024),
        }),
      },
    ),
    response(
      {},
      {
        headers: new Headers({
          "content-type": "application/json",
          "content-length": "invalid",
        }),
      },
    ),
  ]) {
    await assert.rejects(
      fetchGithubLiveMain({
        serverUrl: "https://github.com",
        apiUrl: "https://api.github.com",
        repository: CONTEXT.repository,
        token: "test-token",
        fetchImpl: async () => result,
      }),
      /did not return JSON|response size is invalid/u,
    );
  }
});

test("accepts bounded chunked JSON without a content-length header", async () => {
  const result = await fetchGithubLiveMain({
    serverUrl: "https://github.com",
    apiUrl: "https://api.github.com",
    repository: CONTEXT.repository,
    token: "test-token",
    fetchImpl: async () =>
      response(liveRef(), {
        headers: new Headers({ "content-type": "application/json" }),
      }),
  });
  assert.equal(result.object.sha, SHA);
});
