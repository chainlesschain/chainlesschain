"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ZhihuAdapter } = require("../lib/adapters/social-zhihu");
const { generateKeyHex } = require("../lib/key-providers");
const { AdapterRegistry } = require("../lib/registry");
const { LocalVault } = require("../lib/vault");

let tmpDir;
let vault;

afterEach(() => {
  if (vault) {
    try {
      vault.close();
    } catch (_error) {
      // Best-effort test cleanup.
    }
    vault = null;
  }
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

function responseFor(request) {
  const account = request.cookies.includes("account-a") ? "a" : "b";
  if (request.url.includes("/answers")) {
    return {
      data: [
        {
          id: `answer-${account}`,
          question: { title: `Question ${account}` },
          excerpt: `Answer ${account}`,
          created_time: 1_784_505_600,
        },
      ],
      paging: { is_end: true },
    };
  }
  if (request.url.includes("/followees")) {
    return {
      data: [
        {
          url_token: `follow-${account}`,
          name: `Follow ${account}`,
        },
      ],
      paging: { is_end: true },
    };
  }
  return {
    data: [
      {
        id: `collection-${account}`,
        title: `Collection ${account}`,
        created: 1_784_505_600,
      },
    ],
    paging: { is_end: true },
  };
}

describe("Zhihu runtime-cookie registry integration", () => {
  it("isolates two transient accounts without persisting cookies or url_tokens", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-zhihu-runtime-"));
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
    });
    vault.open();

    const sourceRequests = [];
    const adapter = new ZhihuAdapter({
      fetchFn: async (request) => {
        sourceRequests.push(request);
        return responseFor(request);
      },
    });
    const registry = new AdapterRegistry({
      vault,
      sleep: async () => {},
    });
    registry.register(adapter);

    const first = await registry.syncAdapter("social-zhihu", {
      cookie: "z_c0=account-a-secret",
      accountId: "Alice-Token-A",
    });
    const second = await registry.syncAdapter("social-zhihu", {
      cookie: "z_c0=account-b-secret",
      accountId: "Alice-Token-B",
    });

    for (const report of [first, second]) {
      expect(report.status).toBe("ok");
      expect(report.rawCount).toBe(3);
      expect(report.checkpointCommitted).toBe(true);
      expect(report.sourceRequestCount).toBe(3);
      expect(report.scope).toMatch(/^account:social-zhihu:[a-f0-9]{32}$/u);
      expect(
        vault.queryRawEvents({
          adapter: "social-zhihu",
          scope: report.scope,
        }),
      ).toHaveLength(3);
      expect(vault.getWatermark("social-zhihu", report.scope)).toBeTruthy();
    }
    expect(first.scope).not.toBe(second.scope);
    expect(sourceRequests).toHaveLength(6);
    expect(
      sourceRequests.every(
        (request) =>
          request.headers["x-requested-with"] === "XMLHttpRequest" &&
          request.headers.referer.startsWith("https://www.zhihu.com/people/"),
      ),
    ).toBe(true);
    expect(
      sourceRequests.every(
        (request) =>
          request.query.limit === 20 &&
          request.query.offset === 0 &&
          !Object.hasOwn(request.query, "sign"),
      ),
    ).toBe(true);
    expect(adapter.account).toBe(null);
    expect(adapter._cookieAuth).toBe(null);

    const persisted = JSON.stringify({
      first,
      second,
      raw: vault.queryRawEvents({ adapter: "social-zhihu" }),
      audit: vault.queryAudit({ limit: 100 }),
    }).toLowerCase();
    for (const secret of [
      "account-a-secret",
      "account-b-secret",
      "alice-token-a",
      "alice-token-b",
    ]) {
      expect(persisted).not.toContain(secret);
    }
  });
});
