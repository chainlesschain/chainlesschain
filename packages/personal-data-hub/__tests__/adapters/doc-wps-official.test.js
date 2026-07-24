"use strict";

import { describe, expect, it } from "vitest";

const wps = require("../../lib/adapters/doc-wps");

async function collect(gen) {
  const out = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe("doc-wps official OpenAPI contract", () => {
  it("maps v7 file metadata and validates response envelopes", () => {
    expect(
      wps.mapDoc({
        id: "file-1",
        name: "预算.xlsx",
        type: "file",
        link_url: "https://www.kdocs.cn/l/file-1",
        drive_id: "drive-1",
        parent_id: "0",
        ctime: 1_716_300_000,
        mtime: 1_716_383_000,
        size: 42,
        shared: true,
        version: 3,
      }),
    ).toMatchObject({
      docId: "file-1",
      title: "预算.xlsx",
      docType: "sheet",
      url: "https://www.kdocs.cn/l/file-1",
      createdMs: 1_716_300_000_000,
      updatedMs: 1_716_383_000_000,
      extra: {
        driveId: "drive-1",
        parentId: "0",
        size: 42,
        shared: true,
        version: 3,
      },
    });
    expect(
      wps.mapDoc({ id: "folder-1", name: "资料", type: "folder" }).docType,
    ).toBe("folder");

    expect(
      wps.parseOfficialListResponse({
        code: 0,
        data: { items: [], next_page_token: "next" },
      }),
    ).toEqual({ items: [], nextPageToken: "next" });
    expect(() => wps.parseOfficialListResponse({ code: 401 })).toThrow(
      /code 401/u,
    );
    expect(() =>
      wps.parseOfficialListResponse({ data: { items: [] } }),
    ).toThrow(/missing code/u);
    expect(() => wps.parseOfficialListResponse({ code: 0, data: {} })).toThrow(
      /missing data\.items/u,
    );
    expect(() =>
      wps.parseOfficialListResponse({
        code: 0,
        data: { items: [], next_page_token: 123 },
      }),
    ).toThrow(/invalid next_page_token/u);
  });

  it("reproduces the official KSO-1 GET signature example", () => {
    expect(
      wps.createKso1Authorization({
        appId: "AK123456",
        appKey: "sk098765",
        method: "GET",
        requestUri: "/v7/test?key=value",
        contentType: "application/json",
        ksoDate: "Mon, 02 Jan 2006 15:04:05 GMT",
      }),
    ).toBe(
      "KSO-1 AK123456:ce8df66877175e5198c8ea1362ffddf82e4941c6f25a4ca205a1ad09d0faaf03",
    );
  });

  it("uses Bearer + optional KSO-1 headers and page-token pagination", async () => {
    const calls = [];
    const permits = [];
    let complete = false;
    const adapter = new wps.WpsDocAdapter({
      listUrl: "https://untrusted.example.test/collect",
      now: () => Date.parse("2026-07-24T00:00:00Z"),
      fetchFn: async (request) => {
        calls.push(request);
        return request.query.page_token
          ? { code: 0, data: { items: [], next_page_token: "" } }
          : {
              code: 0,
              data: {
                items: [
                  {
                    id: "file-1",
                    name: "计划.docx",
                    type: "file",
                    mtime: 1_784_505_600,
                  },
                ],
                next_page_token: "page-2",
              },
            };
      },
    });

    expect(
      await adapter.authenticate({
        accessToken: "oauth-secret",
        accountId: "wps-user",
        driveId: "drive / 1",
        appId: "app-id",
        appKey: "app-key-secret",
      }),
    ).toEqual({ ok: true, mode: "oauth-kso1" });

    const items = await collect(
      adapter.sync({
        accessToken: "oauth-secret",
        accountId: "wps-user",
        driveId: "drive / 1",
        parentId: "parent / 1",
        appId: "app-id",
        appKey: "app-key-secret",
        pageSize: 1,
        beforeSourceRequest: async (detail) => permits.push(detail),
        markWatermarkComplete: () => {
          complete = true;
        },
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].originalId).toBe("wps:document:file-1");
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(
      "https://openapi.wps.cn/v7/drives/drive%20%2F%201/files/parent%20%2F%201/children",
    );
    expect(calls[0].query).toEqual({
      order_by: "mtime",
      order: "desc",
      page_size: 1,
    });
    expect(calls[1].query.page_token).toBe("page-2");
    expect(calls[0].headers).toMatchObject({
      authorization: "Bearer oauth-secret",
      "content-type": "application/json",
      "x-kso-date": "Fri, 24 Jul 2026 00:00:00 GMT",
    });
    expect(calls[0].headers["x-kso-authorization"]).toBe(
      "KSO-1 app-id:31cc523d0745804245e5272f94edcd8478dca6a9812ac75c9381f238374454ff",
    );
    expect(permits).toEqual([
      { operation: "document", page: 0 },
      { operation: "document", page: 1 },
    ]);
    expect(complete).toBe(true);
    expect(adapter).not.toHaveProperty("accessToken");
    expect(adapter).not.toHaveProperty("appKey");
  });

  it("supports unsigned applications and rejects incomplete runtime setup", async () => {
    const calls = [];
    const adapter = new wps.WpsDocAdapter({
      fetchFn: async (request) => {
        calls.push(request);
        return { code: 0, data: { items: [] } };
      },
    });
    await collect(
      adapter.sync({
        accessToken: "oauth-secret",
        accountId: "wps-user",
        driveId: "drive-1",
      }),
    );
    expect(calls[0].headers).toEqual({
      authorization: "Bearer oauth-secret",
      "content-type": "application/json",
    });
    expect(
      await adapter.healthCheck({
        accessToken: "oauth-secret",
        accountId: "wps-user",
      }),
    ).toMatchObject({ ok: false, reason: "NO_DRIVE_ID" });
    expect(
      await adapter.healthCheck({
        accessToken: "oauth-secret",
        accountId: "wps-user",
        driveId: "drive-1",
        appId: "app-id",
      }),
    ).toMatchObject({
      ok: false,
      reason: "INCOMPLETE_KSO1_CREDENTIALS",
    });
  });

  it("recursively traverses folders and still finds new children under old folders", async () => {
    const calls = [];
    const adapter = new wps.WpsDocAdapter({
      fetchFn: async (request) => {
        calls.push(request);
        return request.url.includes("/files/0/")
          ? {
              code: 0,
              data: {
                items: [
                  {
                    id: "folder-1",
                    name: "Archive",
                    type: "folder",
                    mtime: 1_000_000_000,
                  },
                ],
              },
            }
          : {
              code: 0,
              data: {
                items: [
                  {
                    id: "new-file",
                    name: "New.docx",
                    type: "file",
                    mtime: 2_000_000_000,
                  },
                ],
              },
            };
      },
    });

    const items = await collect(
      adapter.sync({
        accessToken: "oauth-secret",
        accountId: "wps-user",
        driveId: "drive-1",
        sinceWatermark: 1_500_000_000_000,
      }),
    );
    expect(items.map((item) => item.originalId)).toEqual([
      "wps:document:new-file",
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      "https://openapi.wps.cn/v7/drives/drive-1/files/0/children",
      "https://openapi.wps.cn/v7/drives/drive-1/files/folder-1/children",
    ]);

    calls.length = 0;
    await collect(
      adapter.sync({
        accessToken: "oauth-secret",
        accountId: "wps-user",
        driveId: "drive-1",
        recursive: false,
      }),
    );
    expect(calls).toHaveLength(1);
  });

  it("keeps the watermark incomplete on budget, API error, or cursor loop", async () => {
    let complete = 0;
    const budgeted = new wps.WpsDocAdapter({
      fetchFn: async () => ({
        code: 0,
        data: {
          items: [{ id: "file-1", name: "one.txt", mtime: 1_716_383_000 }],
          next_page_token: "page-2",
        },
      }),
    });
    await collect(
      budgeted.sync({
        accessToken: "oauth-secret",
        accountId: "wps-user",
        driveId: "drive-1",
        maxPages: 1,
        markWatermarkComplete: () => {
          complete += 1;
        },
      }),
    );
    expect(complete).toBe(0);

    const failed = new wps.WpsDocAdapter({
      fetchFn: async () => ({ code: 400_000_003, msg: "denied" }),
    });
    await expect(
      collect(
        failed.sync({
          accessToken: "oauth-secret",
          accountId: "wps-user",
          driveId: "drive-1",
          markWatermarkComplete: () => {
            complete += 1;
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: "WPS_API_ERROR",
      wpsCode: 400_000_003,
    });
    expect(complete).toBe(0);

    const looped = new wps.WpsDocAdapter({
      fetchFn: async () => ({
        code: 0,
        data: { items: [], next_page_token: "same-token" },
      }),
    });
    await expect(
      collect(
        looped.sync({
          accessToken: "oauth-secret",
          accountId: "wps-user",
          driveId: "drive-1",
        }),
      ),
    ).rejects.toMatchObject({ code: "WPS_PAGINATION_LOOP" });
    expect(complete).toBe(0);
  });
});
