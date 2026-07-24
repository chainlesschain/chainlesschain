"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { BaiduNetdiskAdapter } = require("../lib/adapters/doc-baidu-netdisk");
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

describe("Baidu Netdisk runtime-OAuth registry integration", () => {
  it("isolates transient accounts and never persists access tokens or account ids", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-baidu-runtime-"));
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
    });
    vault.open();

    const sourceRequests = [];
    const adapter = new BaiduNetdiskAdapter({
      fetchFn: async (request) => {
        sourceRequests.push(request);
        const suffix = request.credentialQuery.access_token.includes("alpha")
          ? "a"
          : "b";
        return {
          errno: 0,
          has_more: 0,
          list: [
            {
              fs_id: `file-${suffix}`,
              server_filename: `File ${suffix}.pdf`,
              category: 4,
              path: `/apps/chainlesschain/File ${suffix}.pdf`,
              server_mtime: 1_784_505_600,
            },
          ],
        };
      },
    });
    const registry = new AdapterRegistry({ vault, sleep: async () => {} });
    registry.register(adapter);

    const first = await registry.syncAdapter("doc-baidu-netdisk", {
      accessToken: "oauth-alpha-secret",
      accountId: "Baidu-Account-A",
      dir: "/apps/chainlesschain",
    });
    const second = await registry.syncAdapter("doc-baidu-netdisk", {
      accessToken: "oauth-beta-secret",
      accountId: "Baidu-Account-B",
      dir: "/apps/chainlesschain",
    });

    for (const report of [first, second]) {
      expect(report.status).toBe("ok");
      expect(report.rawCount).toBe(1);
      expect(report.checkpointCommitted).toBe(true);
      expect(report.sourceRequestCount).toBe(1);
      expect(report.scope).toMatch(/^account:doc-baidu-netdisk:[a-f0-9]{32}$/u);
      expect(
        vault.queryRawEvents({
          adapter: "doc-baidu-netdisk",
          scope: report.scope,
        }),
      ).toHaveLength(1);
      expect(
        vault.getWatermark("doc-baidu-netdisk", report.scope),
      ).toBeTruthy();
    }
    expect(first.scope).not.toBe(second.scope);
    expect(sourceRequests).toHaveLength(2);
    expect(
      sourceRequests.every(
        (request) =>
          request.url === "https://pan.baidu.com/rest/2.0/xpan/multimedia" &&
          request.query.method === "listall" &&
          request.query.path === "/apps/chainlesschain" &&
          request.query.recursion === 1 &&
          request.query.start === 0 &&
          request.query.limit === 1000 &&
          typeof request.credentialQuery.access_token === "string",
      ),
    ).toBe(true);
    expect(adapter.account).toBe(null);
    expect(adapter).not.toHaveProperty("accessToken");

    const persisted = JSON.stringify({
      first,
      second,
      raw: vault.queryRawEvents({ adapter: "doc-baidu-netdisk" }),
      audit: vault.queryAudit({ limit: 100 }),
    }).toLowerCase();
    for (const secret of [
      "oauth-alpha-secret",
      "oauth-beta-secret",
      "baidu-account-a",
      "baidu-account-b",
    ]) {
      expect(persisted).not.toContain(secret);
    }
  });
});
