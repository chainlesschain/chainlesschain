/**
 * webdav-client 单元测试 — Phase 3c.2 task #3
 *
 * 用 _setWebdavLoaderForTest 注入 fake `webdav` 模块，验证：
 *   - testConnection 走 stat()，404/401/403 各分支
 *   - putFile：If-Match 头、412 → conflict、5xx 重试 3 次后放弃、stat 取 etag
 *   - deleteFile：404 幂等 ok=true、412 conflict
 *   - getEtag：404 → null
 *   - listRemote 过滤非 .md
 *   - 重试：429 / 503 重试，4xx 立即抛
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const {
  WebDAVClient,
  _setWebdavLoaderForTest,
  _resetWebdavLoaderForTest,
} = require("../webdav-client");

// ── fake webdav module ────────────────────────────────────────────

function makeFakeClient(overrides = {}) {
  return {
    stat: vi.fn(overrides.stat ?? (async () => ({ etag: '"deadbeef"' }))),
    putFileContents: vi.fn(overrides.putFileContents ?? (async () => true)),
    deleteFile: vi.fn(overrides.deleteFile ?? (async () => true)),
    getDirectoryContents: vi.fn(
      overrides.getDirectoryContents ?? (async () => []),
    ),
  };
}

function injectClient(fakeClient) {
  _setWebdavLoaderForTest(async () => ({
    createClient: () => fakeClient,
  }));
}

class HttpError extends Error {
  constructor(status, msg) {
    super(msg ?? `HTTP ${status}`);
    this.status = status;
  }
}

beforeEach(() => {
  _resetWebdavLoaderForTest();
});

// ── constructor + path resolve ────────────────────────────────────

describe("WebDAVClient · constructor", () => {
  it("requires url", () => {
    expect(() => new WebDAVClient({})).toThrow(/url 必填/);
  });

  it("normalizes remotePath (strips trailing slashes)", () => {
    const c = new WebDAVClient({ url: "https://x", remotePath: "/foo/bar///" });
    expect(c.remotePath).toBe("/foo/bar");
  });

  it("defaults remotePath to /", () => {
    const c = new WebDAVClient({ url: "https://x" });
    expect(c.remotePath).toBe("/");
  });
});

describe("WebDAVClient · _resolveRemote", () => {
  it("joins remotePath + filename without double slashes", () => {
    const c = new WebDAVClient({ url: "https://x", remotePath: "/cc" });
    expect(c._resolveRemote("a.md")).toBe("/cc/a.md");
    expect(c._resolveRemote("/a.md")).toBe("/cc/a.md");
  });
});

// ── testConnection ────────────────────────────────────────────────

describe("WebDAVClient · testConnection", () => {
  it("returns ok:true on successful stat", async () => {
    const fake = makeFakeClient();
    injectClient(fake);
    const c = new WebDAVClient({ url: "https://x", remotePath: "/cc" });
    expect(await c.testConnection()).toEqual({ ok: true });
    expect(fake.stat).toHaveBeenCalledWith("/cc");
  });

  it("maps 404 to 远端路径不存在", async () => {
    injectClient(
      makeFakeClient({
        stat: async () => {
          throw new HttpError(404);
        },
      }),
    );
    const c = new WebDAVClient({ url: "https://x", remotePath: "/cc" });
    const res = await c.testConnection();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.error).toMatch(/不存在/);
  });

  it("maps 401 to 认证失败", async () => {
    injectClient(
      makeFakeClient({
        stat: async () => {
          throw new HttpError(401);
        },
      }),
    );
    const c = new WebDAVClient({ url: "https://x" });
    const res = await c.testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/认证失败/);
  });
});

// ── putFile ───────────────────────────────────────────────────────

describe("WebDAVClient · putFile", () => {
  it("calls putFileContents and returns new etag from subsequent stat", async () => {
    const fake = makeFakeClient({
      stat: async () => ({ etag: '"new-etag"' }),
    });
    injectClient(fake);
    const c = new WebDAVClient({ url: "https://x", remotePath: "/cc" });
    const res = await c.putFile("a.md", "content");
    expect(res).toMatchObject({ ok: true, etag: '"new-etag"' });
    expect(fake.putFileContents).toHaveBeenCalledWith(
      "/cc/a.md",
      "content",
      expect.objectContaining({ overwrite: true, headers: {} }),
    );
  });

  it("sends If-Match header when etag provided", async () => {
    const fake = makeFakeClient();
    injectClient(fake);
    const c = new WebDAVClient({ url: "https://x", remotePath: "/cc" });
    await c.putFile("a.md", "x", '"old-etag"');
    expect(fake.putFileContents).toHaveBeenCalledWith(
      "/cc/a.md",
      "x",
      expect.objectContaining({ headers: { "If-Match": '"old-etag"' } }),
    );
  });

  it("412 → conflict result, no throw", async () => {
    injectClient(
      makeFakeClient({
        putFileContents: async () => {
          throw new HttpError(412);
        },
      }),
    );
    const c = new WebDAVClient({ url: "https://x" });
    const res = await c.putFile("a.md", "x", '"old"');
    expect(res).toEqual({ ok: false, conflict: true, status: 412 });
  });

  it("4xx other than 412 → ok:false with status", async () => {
    injectClient(
      makeFakeClient({
        putFileContents: async () => {
          throw new HttpError(403, "forbidden");
        },
      }),
    );
    const c = new WebDAVClient({ url: "https://x" });
    const res = await c.putFile("a.md", "x");
    expect(res.ok).toBe(false);
    expect(res.conflict).toBeUndefined();
    expect(res.status).toBe(403);
  });

  it("does not fail when post-put stat throws (non-fatal)", async () => {
    let statCalls = 0;
    const fake = makeFakeClient({
      stat: async () => {
        statCalls++;
        throw new Error("stat boom");
      },
    });
    injectClient(fake);
    const c = new WebDAVClient({ url: "https://x" });
    const res = await c.putFile("a.md", "x");
    expect(res.ok).toBe(true);
    expect(res.etag).toBeNull();
    expect(statCalls).toBe(1);
  });
});

// ── deleteFile ────────────────────────────────────────────────────

describe("WebDAVClient · deleteFile", () => {
  it("404 → ok:true with alreadyAbsent flag (idempotent)", async () => {
    injectClient(
      makeFakeClient({
        deleteFile: async () => {
          throw new HttpError(404);
        },
      }),
    );
    const c = new WebDAVClient({ url: "https://x" });
    const res = await c.deleteFile("a.md");
    expect(res).toEqual({ ok: true, alreadyAbsent: true });
  });

  it("412 → conflict", async () => {
    injectClient(
      makeFakeClient({
        deleteFile: async () => {
          throw new HttpError(412);
        },
      }),
    );
    const c = new WebDAVClient({ url: "https://x" });
    const res = await c.deleteFile("a.md", '"etag"');
    expect(res).toEqual({ ok: false, conflict: true, status: 412 });
  });

  it("sends If-Match when etag provided", async () => {
    const fake = makeFakeClient();
    injectClient(fake);
    const c = new WebDAVClient({ url: "https://x" });
    await c.deleteFile("a.md", '"x"');
    expect(fake.deleteFile).toHaveBeenCalledWith(
      "/a.md",
      expect.objectContaining({ headers: { "If-Match": '"x"' } }),
    );
  });
});

// ── getEtag ───────────────────────────────────────────────────────

describe("WebDAVClient · getEtag", () => {
  it("returns etag from stat", async () => {
    injectClient(makeFakeClient({ stat: async () => ({ etag: '"abc"' }) }));
    const c = new WebDAVClient({ url: "https://x" });
    expect(await c.getEtag("a.md")).toBe('"abc"');
  });

  it("returns null on 404", async () => {
    injectClient(
      makeFakeClient({
        stat: async () => {
          throw new HttpError(404);
        },
      }),
    );
    const c = new WebDAVClient({ url: "https://x" });
    expect(await c.getEtag("a.md")).toBeNull();
  });

  it("rethrows non-404 errors", async () => {
    injectClient(
      makeFakeClient({
        stat: async () => {
          throw new HttpError(403);
        },
      }),
    );
    const c = new WebDAVClient({ url: "https://x" });
    await expect(c.getEtag("a.md")).rejects.toThrow();
  });
});

// ── listRemote ────────────────────────────────────────────────────

describe("WebDAVClient · listRemote", () => {
  it("filters to .md files only", async () => {
    injectClient(
      makeFakeClient({
        getDirectoryContents: async () => [
          {
            type: "file",
            basename: "a.md",
            etag: '"a"',
            size: 1,
            lastmod: "x",
          },
          { type: "file", basename: "b.txt", etag: '"b"', size: 2 },
          { type: "directory", basename: "subdir" },
          { type: "file", basename: "c.md", etag: '"c"', size: 3 },
        ],
      }),
    );
    const c = new WebDAVClient({ url: "https://x", remotePath: "/cc" });
    const out = await c.listRemote();
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.filename)).toEqual(["a.md", "c.md"]);
    expect(out[0]).toEqual({
      filename: "a.md",
      etag: '"a"',
      size: 1,
      lastmod: "x",
    });
  });

  it("returns empty when remote is empty", async () => {
    injectClient(makeFakeClient({ getDirectoryContents: async () => [] }));
    const c = new WebDAVClient({ url: "https://x" });
    expect(await c.listRemote()).toEqual([]);
  });
});

// ── 重试 ──────────────────────────────────────────────────────────

describe("WebDAVClient · retry policy", () => {
  it("retries on 503 up to 3 times", async () => {
    let calls = 0;
    injectClient(
      makeFakeClient({
        putFileContents: async () => {
          calls++;
          throw new HttpError(503);
        },
      }),
    );
    const c = new WebDAVClient({ url: "https://x" });
    const res = await c.putFile("a.md", "x");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    expect(calls).toBe(3);
  }, 30_000);

  it("retries on 429 then succeeds", async () => {
    let calls = 0;
    const fake = makeFakeClient({
      putFileContents: async () => {
        calls++;
        if (calls < 2) {
          throw new HttpError(429);
        }
        return true;
      },
    });
    injectClient(fake);
    const c = new WebDAVClient({ url: "https://x" });
    const res = await c.putFile("a.md", "x");
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  }, 30_000);

  it("does NOT retry on 401 (4xx non-retriable)", async () => {
    let calls = 0;
    injectClient(
      makeFakeClient({
        putFileContents: async () => {
          calls++;
          throw new HttpError(401);
        },
      }),
    );
    const c = new WebDAVClient({ url: "https://x" });
    const res = await c.putFile("a.md", "x");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    expect(calls).toBe(1);
  });
});
