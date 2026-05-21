/**
 * oss-client 单元测试 — Phase 3c.3 task #1
 *
 * 用 _setS3LoaderForTest 注入 fake `@aws-sdk/client-s3` 模块，验证：
 *   - testConnection 走 HeadBucket，404/403/301 各分支
 *   - putFile：IfMatch 头、412 → conflict、501 → conflict、5xx 重试 3 次后放弃
 *   - deleteFile：404 幂等 ok=true（S3 实际不返但兼容）
 *   - getEtag：404 → null；ETag quoted → unquoted
 *   - listRemote：分页 + 过滤非 .md
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
  OSSClient,
  _setS3LoaderForTest,
  _resetS3LoaderForTest,
} = require("../oss-client");

// ── fake @aws-sdk/client-s3 module ──────────────────────────────────

/** Helper: AWS SDK errors carry $metadata.httpStatusCode */
class S3Error extends Error {
  constructor(status, msg) {
    super(msg ?? `S3 status ${status}`);
    this.$metadata = { httpStatusCode: status };
  }
}

/**
 * Build a fake S3 module with a scripted send() that dispatches by command
 * constructor name. Each handler returns the result OR throws an error.
 */
function makeFakeS3({
  HeadBucket = async () => ({}),
  PutObject = async () => ({ ETag: '"deadbeef"' }),
  DeleteObject = async () => ({}),
  HeadObject = async () => ({ ETag: '"abc123"' }),
  ListObjectsV2 = async () => ({ Contents: [], IsTruncated: false }),
} = {}) {
  // Each "Command" stores its input + a tag so the fake client knows which
  // handler to invoke.
  function makeCmdClass(tag) {
    return class {
      constructor(input) {
        this._tag = tag;
        this.input = input;
      }
    };
  }
  const HeadBucketCommand = makeCmdClass("HeadBucket");
  const PutObjectCommand = makeCmdClass("PutObject");
  const DeleteObjectCommand = makeCmdClass("DeleteObject");
  const HeadObjectCommand = makeCmdClass("HeadObject");
  const ListObjectsV2Command = makeCmdClass("ListObjectsV2");

  const sendCalls = [];

  class S3Client {
    constructor(opts) {
      this.opts = opts;
    }
    async send(cmd) {
      sendCalls.push({ tag: cmd._tag, input: cmd.input });
      switch (cmd._tag) {
        case "HeadBucket":
          return HeadBucket(cmd.input);
        case "PutObject":
          return PutObject(cmd.input);
        case "DeleteObject":
          return DeleteObject(cmd.input);
        case "HeadObject":
          return HeadObject(cmd.input);
        case "ListObjectsV2":
          return ListObjectsV2(cmd.input);
        default:
          throw new Error("Unknown command tag: " + cmd._tag);
      }
    }
  }

  const mod = {
    S3Client,
    HeadBucketCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
  };
  return { mod, sendCalls };
}

function injectFake(fakeMod) {
  _setS3LoaderForTest(async () => fakeMod);
}

function newClient(overrides = {}) {
  return new OSSClient({
    endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
    region: "oss-cn-hangzhou",
    bucket: "my-cc-backup",
    accessKeyId: "AK",
    secretAccessKey: "SK",
    remotePath: "chainlesschain",
    ...overrides,
  });
}

beforeEach(() => {
  _resetS3LoaderForTest();
});

// ── constructor ─────────────────────────────────────────────────────

describe("OSSClient · constructor", () => {
  it("requires endpoint", () => {
    expect(
      () =>
        new OSSClient({
          bucket: "b",
          accessKeyId: "k",
          secretAccessKey: "s",
        }),
    ).toThrow(/endpoint 必填/);
  });

  it("requires bucket", () => {
    expect(
      () =>
        new OSSClient({
          endpoint: "https://x",
          accessKeyId: "k",
          secretAccessKey: "s",
        }),
    ).toThrow(/bucket 必填/);
  });

  it("requires both credentials", () => {
    expect(() => new OSSClient({ endpoint: "https://x", bucket: "b" })).toThrow(
      /accessKeyId/,
    );
  });

  it("normalizes remotePath (strips leading/trailing slashes)", () => {
    const c = newClient({ remotePath: "///foo/bar///" });
    expect(c.remotePath).toBe("foo/bar");
  });

  it("forcePathStyle defaults false; honors explicit true", () => {
    const a = newClient({ forcePathStyle: undefined });
    expect(a.forcePathStyle).toBe(false);
    const b = newClient({ forcePathStyle: true });
    expect(b.forcePathStyle).toBe(true);
  });
});

describe("OSSClient · _resolveKey", () => {
  it("joins remotePath + filename without double slashes", () => {
    const c = newClient({ remotePath: "cc/data" });
    expect(c._resolveKey("foo.md")).toBe("cc/data/foo.md");
  });

  it("handles filename with leading slashes", () => {
    const c = newClient({ remotePath: "cc" });
    expect(c._resolveKey("///foo.md")).toBe("cc/foo.md");
  });

  it("empty remotePath returns just filename", () => {
    const c = newClient({ remotePath: "" });
    expect(c._resolveKey("foo.md")).toBe("foo.md");
  });
});

// ── testConnection ──────────────────────────────────────────────────

describe("OSSClient · testConnection", () => {
  it("ok on successful HeadBucket", async () => {
    const { mod, sendCalls } = makeFakeS3();
    injectFake(mod);
    const c = newClient();
    const res = await c.testConnection();
    expect(res.ok).toBe(true);
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0].tag).toBe("HeadBucket");
    expect(sendCalls[0].input.Bucket).toBe("my-cc-backup");
  });

  it("returns 404 with friendly bucket message", async () => {
    const { mod } = makeFakeS3({
      HeadBucket: async () => {
        throw new S3Error(404);
      },
    });
    injectFake(mod);
    const res = await newClient().testConnection();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.error).toMatch(/Bucket .* 不存在/);
  });

  it("returns 403 with friendly auth message", async () => {
    const { mod } = makeFakeS3({
      HeadBucket: async () => {
        throw new S3Error(403, "Forbidden");
      },
    });
    injectFake(mod);
    const res = await newClient().testConnection();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.error).toMatch(/认证失败/);
  });

  it("301 region mismatch returns friendly error", async () => {
    const { mod } = makeFakeS3({
      HeadBucket: async () => {
        throw new S3Error(301, "PermanentRedirect");
      },
    });
    injectFake(mod);
    const res = await newClient().testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/endpoint \/ region/);
  });
});

// ── putFile ─────────────────────────────────────────────────────────

describe("OSSClient · putFile", () => {
  it("happy path returns etag (unquoted)", async () => {
    const { mod, sendCalls } = makeFakeS3({
      PutObject: async () => ({ ETag: '"freshETag123"' }),
    });
    injectFake(mod);
    const res = await newClient().putFile("note.md", "hello");
    expect(res.ok).toBe(true);
    expect(res.etag).toBe("freshETag123"); // quotes stripped
    expect(sendCalls[0].tag).toBe("PutObject");
    expect(sendCalls[0].input.Key).toBe("chainlesschain/note.md");
    expect(sendCalls[0].input.Body).toBe("hello");
    expect(sendCalls[0].input.IfMatch).toBeUndefined();
  });

  it("sends IfMatch header when etag provided", async () => {
    const { mod, sendCalls } = makeFakeS3();
    injectFake(mod);
    await newClient().putFile("note.md", "hi", "prevETag");
    expect(sendCalls[0].input.IfMatch).toBe("prevETag");
  });

  it("412 → conflict (not retried)", async () => {
    let calls = 0;
    const { mod } = makeFakeS3({
      PutObject: async () => {
        calls++;
        throw new S3Error(412, "PreconditionFailed");
      },
    });
    injectFake(mod);
    const res = await newClient().putFile("a.md", "x", "etag");
    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(true);
    expect(res.status).toBe(412);
    expect(calls).toBe(1); // no retry for 412
  });

  it("501 → conflict (IfMatch not supported degrade)", async () => {
    const { mod } = makeFakeS3({
      PutObject: async () => {
        throw new S3Error(501, "NotImplemented");
      },
    });
    injectFake(mod);
    const res = await newClient().putFile("a.md", "x", "etag");
    expect(res.ok).toBe(false);
    expect(res.conflict).toBe(true);
  });

  it("5xx retries up to RETRY_MAX then fails", async () => {
    let calls = 0;
    const { mod } = makeFakeS3({
      PutObject: async () => {
        calls++;
        throw new S3Error(503, "ServiceUnavailable");
      },
    });
    injectFake(mod);
    const res = await newClient().putFile("a.md", "x");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
    expect(calls).toBe(3); // RETRY_MAX
  });

  it("4xx non-412 fails immediately (no retry)", async () => {
    let calls = 0;
    const { mod } = makeFakeS3({
      PutObject: async () => {
        calls++;
        throw new S3Error(400, "InvalidRequest");
      },
    });
    injectFake(mod);
    const res = await newClient().putFile("a.md", "x");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(calls).toBe(1);
  });
});

// ── deleteFile ──────────────────────────────────────────────────────

describe("OSSClient · deleteFile", () => {
  it("happy path returns ok", async () => {
    const { mod, sendCalls } = makeFakeS3();
    injectFake(mod);
    const res = await newClient().deleteFile("a.md");
    expect(res.ok).toBe(true);
    expect(sendCalls[0].tag).toBe("DeleteObject");
    expect(sendCalls[0].input.Key).toBe("chainlesschain/a.md");
  });

  it("404 reported as idempotent ok with alreadyAbsent", async () => {
    const { mod } = makeFakeS3({
      DeleteObject: async () => {
        throw new S3Error(404);
      },
    });
    injectFake(mod);
    const res = await newClient().deleteFile("a.md");
    expect(res.ok).toBe(true);
    expect(res.alreadyAbsent).toBe(true);
  });

  it("5xx retries then fails", async () => {
    let calls = 0;
    const { mod } = makeFakeS3({
      DeleteObject: async () => {
        calls++;
        throw new S3Error(503);
      },
    });
    injectFake(mod);
    const res = await newClient().deleteFile("a.md");
    expect(res.ok).toBe(false);
    expect(calls).toBe(3);
  });
});

// ── getEtag ─────────────────────────────────────────────────────────

describe("OSSClient · getEtag", () => {
  it("returns unquoted etag", async () => {
    const { mod } = makeFakeS3({
      HeadObject: async () => ({ ETag: '"xyz789"' }),
    });
    injectFake(mod);
    const etag = await newClient().getEtag("a.md");
    expect(etag).toBe("xyz789");
  });

  it("404 → null", async () => {
    const { mod } = makeFakeS3({
      HeadObject: async () => {
        throw new S3Error(404);
      },
    });
    injectFake(mod);
    const etag = await newClient().getEtag("missing.md");
    expect(etag).toBe(null);
  });

  it("5xx throws after retries", async () => {
    const { mod } = makeFakeS3({
      HeadObject: async () => {
        throw new S3Error(500);
      },
    });
    injectFake(mod);
    await expect(newClient().getEtag("a.md")).rejects.toMatchObject({
      $metadata: { httpStatusCode: 500 },
    });
  });
});

// ── listRemote ──────────────────────────────────────────────────────

describe("OSSClient · listRemote", () => {
  it("filters non-.md files + extracts basename", async () => {
    const { mod } = makeFakeS3({
      ListObjectsV2: async () => ({
        Contents: [
          { Key: "chainlesschain/note-a.md", ETag: '"e1"', Size: 100 },
          {
            Key: "chainlesschain/attachments/img.png",
            ETag: '"e2"',
            Size: 1024,
          },
          { Key: "chainlesschain/note-b.md", ETag: '"e3"', Size: 200 },
        ],
        IsTruncated: false,
      }),
    });
    injectFake(mod);
    const items = await newClient().listRemote();
    expect(items).toHaveLength(2);
    expect(items[0].filename).toBe("note-a.md");
    expect(items[0].etag).toBe("e1");
    expect(items[1].filename).toBe("note-b.md");
  });

  it("paginates with continuation token", async () => {
    let page = 0;
    const { mod, sendCalls } = makeFakeS3({
      ListObjectsV2: async (input) => {
        page++;
        if (page === 1) {
          return {
            Contents: [{ Key: "cc/a.md", ETag: '"e1"', Size: 1 }],
            IsTruncated: true,
            NextContinuationToken: "tok-2",
          };
        }
        // Page 2: ContinuationToken must have been passed
        expect(input.ContinuationToken).toBe("tok-2");
        return {
          Contents: [{ Key: "cc/b.md", ETag: '"e2"', Size: 2 }],
          IsTruncated: false,
        };
      },
    });
    injectFake(mod);
    const items = await newClient().listRemote();
    expect(page).toBe(2);
    expect(items).toHaveLength(2);
    expect(sendCalls).toHaveLength(2);
  });
});

// ── retry classification ────────────────────────────────────────────

describe("OSSClient · retry policy", () => {
  it("429 retries", async () => {
    let calls = 0;
    const { mod } = makeFakeS3({
      HeadBucket: async () => {
        calls++;
        if (calls < 3) {
          throw new S3Error(429, "TooManyRequests");
        }
        return {};
      },
    });
    injectFake(mod);
    const res = await newClient().testConnection();
    expect(res.ok).toBe(true);
    expect(calls).toBe(3);
  }, 10_000);

  it("503 retries", async () => {
    let calls = 0;
    const { mod } = makeFakeS3({
      HeadBucket: async () => {
        calls++;
        if (calls < 2) {
          throw new S3Error(503);
        }
        return {};
      },
    });
    injectFake(mod);
    const res = await newClient().testConnection();
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  }, 10_000);

  it("4xx (non-retriable) fails immediately", async () => {
    let calls = 0;
    const { mod } = makeFakeS3({
      HeadBucket: async () => {
        calls++;
        throw new S3Error(403);
      },
    });
    injectFake(mod);
    await newClient().testConnection();
    expect(calls).toBe(1);
  });
});
