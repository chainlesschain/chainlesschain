"use strict";

import { afterEach, describe, expect, it } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { WpsDocAdapter } = require("../lib/adapters/doc-wps");
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

describe("WPS runtime-OAuth registry integration", () => {
  it("isolates accounts and folders without persisting OAuth or KSO secrets", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-wps-runtime-"));
    vault = new LocalVault({
      path: path.join(tmpDir, "vault.db"),
      key: generateKeyHex(),
    });
    vault.open();

    const sourceRequests = [];
    const adapter = new WpsDocAdapter({
      now: () => Date.parse("2026-07-24T00:00:00Z"),
      fetchFn: async (request) => {
        sourceRequests.push(request);
        const suffix = request.headers.authorization.includes("alpha")
          ? "a"
          : "b";
        return {
          code: 0,
          data: {
            items: [
              {
                id: `file-${suffix}`,
                name: `File ${suffix}.docx`,
                type: "file",
                drive_id: "drive-1",
                parent_id: request.url.includes("/files/0/") ? "0" : "folder",
                mtime: 1_784_505_600,
              },
            ],
          },
        };
      },
    });
    const registry = new AdapterRegistry({ vault, sleep: async () => {} });
    registry.register(adapter);

    const first = await registry.syncAdapter("doc-wps", {
      accessToken: "oauth-alpha-secret",
      accountId: "WPS-Account-A",
      driveId: "drive-1",
      parentId: "0",
      appId: "wps-app-id",
      appKey: "wps-app-key-secret",
    });
    const second = await registry.syncAdapter("doc-wps", {
      accessToken: "oauth-beta-secret",
      accountId: "WPS-Account-B",
      driveId: "drive-1",
      appId: "wps-app-id",
      appKey: "wps-app-key-secret",
    });

    for (const report of [first, second]) {
      expect(report.status).toBe("ok");
      expect(report.rawCount).toBe(1);
      expect(report.checkpointCommitted).toBe(true);
      expect(report.sourceRequestCount).toBe(1);
      expect(report.scope).toMatch(/^account:doc-wps:[a-f0-9]{32}$/u);
      expect(
        vault.queryRawEvents({
          adapter: "doc-wps",
          scope: report.scope,
        }),
      ).toHaveLength(1);
      expect(vault.getWatermark("doc-wps", report.scope)).toBeTruthy();
    }
    expect(first.scope).not.toBe(second.scope);

    const rootScope = registry._resolveScope(adapter, {
      accessToken: "oauth-alpha-secret",
      accountId: "WPS-Account-A",
      driveId: "drive-1",
    });
    const explicitRootScope = registry._resolveScope(adapter, {
      accessToken: "rotated-secret",
      accountId: "WPS-Account-A",
      driveId: "drive-1",
      parentId: "0",
    });
    const folderScope = registry._resolveScope(adapter, {
      accessToken: "rotated-secret",
      accountId: "WPS-Account-A",
      driveId: "drive-1",
      parentId: "folder-1",
    });
    const shallowScope = registry._resolveScope(adapter, {
      accessToken: "rotated-secret",
      accountId: "WPS-Account-A",
      driveId: "drive-1",
      recursive: false,
    });
    expect(rootScope).toBe(explicitRootScope);
    expect(rootScope).not.toBe(folderScope);
    expect(rootScope).not.toBe(shallowScope);

    expect(sourceRequests).toHaveLength(2);
    expect(
      sourceRequests.every(
        (request) =>
          request.url.startsWith("https://openapi.wps.cn/v7/drives/") &&
          request.query.order_by === "mtime" &&
          request.query.order === "desc" &&
          request.query.page_size === 500 &&
          request.headers.authorization.startsWith("Bearer ") &&
          request.headers["x-kso-authorization"].startsWith("KSO-1 "),
      ),
    ).toBe(true);
    expect(adapter.account).toBe(null);
    expect(adapter).not.toHaveProperty("accessToken");
    expect(adapter).not.toHaveProperty("appKey");

    const persisted = JSON.stringify({
      first,
      second,
      raw: vault.queryRawEvents({ adapter: "doc-wps" }),
      audit: vault.queryAudit({ limit: 100 }),
    }).toLowerCase();
    for (const secret of [
      "oauth-alpha-secret",
      "oauth-beta-secret",
      "wps-app-key-secret",
      "wps-account-a",
      "wps-account-b",
    ]) {
      expect(persisted).not.toContain(secret);
    }
  });
});
