import { describe, it, expect, afterEach } from "vitest";
import {
  OSSClient,
  RETRY_MAX,
  _setS3LoaderForTest,
  _resetS3LoaderForTest,
} from "../../src/lib/sync-oss-client.js";

afterEach(() => {
  _resetS3LoaderForTest();
});

/**
 * Build a fake @aws-sdk/client-s3 module. `handlers` maps a command kind
 * ("PutObject", "HeadBucket", …) to a function (input) => result | throw.
 * The last-sent command's input is captured on `captured` for assertions.
 */
function installFakeS3(handlers, captured = {}) {
  const mk = (kind) =>
    class {
      constructor(input) {
        this.input = input;
        this.kind = kind;
      }
    };
  class S3Client {
    constructor(cfg) {
      this.cfg = cfg;
    }
    async send(cmd) {
      captured[cmd.kind] = cmd.input;
      captured.last = { kind: cmd.kind, input: cmd.input };
      const h = handlers[cmd.kind];
      if (!h) throw new Error(`no fake handler for ${cmd.kind}`);
      return await h(cmd.input);
    }
  }
  const mod = {
    S3Client,
    HeadBucketCommand: mk("HeadBucket"),
    PutObjectCommand: mk("PutObject"),
    DeleteObjectCommand: mk("DeleteObject"),
    HeadObjectCommand: mk("HeadObject"),
    ListObjectsV2Command: mk("ListObjects"),
  };
  _setS3LoaderForTest(async () => mod);
  return captured;
}

const baseOpts = {
  endpoint: "https://oss.example.com",
  bucket: "mybucket",
  accessKeyId: "AKID",
  secretAccessKey: "SECRET",
};

const httpErr = (status, message = "boom") => ({
  $metadata: { httpStatusCode: status },
  message,
});

describe("sync-oss-client — constructor validation", () => {
  it("requires endpoint, bucket, accessKeyId, secretAccessKey", () => {
    expect(() => new OSSClient({ ...baseOpts, endpoint: "" })).toThrow(
      /endpoint/,
    );
    expect(() => new OSSClient({ ...baseOpts, bucket: "" })).toThrow(/bucket/);
    expect(() => new OSSClient({ ...baseOpts, accessKeyId: "" })).toThrow(
      /accessKeyId/,
    );
    expect(() => new OSSClient({ ...baseOpts, secretAccessKey: "" })).toThrow(
      /secretAccessKey/,
    );
  });

  it("normalizes a remotePath (strips leading/trailing slashes)", () => {
    const c = new OSSClient({ ...baseOpts, remotePath: "/backups/notes/" });
    expect(c.remotePath).toBe("backups/notes");
  });

  it("defaults region to auto and forcePathStyle to false", () => {
    const c = new OSSClient(baseOpts);
    expect(c.region).toBe("auto");
    expect(c.forcePathStyle).toBe(false);
  });
});

describe("sync-oss-client — key resolution", () => {
  it("prefixes the remotePath and strips a leading slash from the filename", async () => {
    const cap = installFakeS3({ PutObject: () => ({ ETag: '"e"' }) });
    const c = new OSSClient({ ...baseOpts, remotePath: "backups" });
    await c.putFile("/note.md", "body");
    expect(cap.PutObject.Key).toBe("backups/note.md");
  });

  it("uses a bare key when there is no remotePath", async () => {
    const cap = installFakeS3({ PutObject: () => ({ ETag: '"e"' }) });
    const c = new OSSClient(baseOpts);
    await c.putFile("note.md", "body");
    expect(cap.PutObject.Key).toBe("note.md");
  });
});

describe("sync-oss-client — putFile", () => {
  it("returns the new etag with surrounding quotes stripped", async () => {
    installFakeS3({ PutObject: () => ({ ETag: '"abc123"' }) });
    const c = new OSSClient(baseOpts);
    const res = await c.putFile("a.md", "x");
    expect(res).toMatchObject({ ok: true, etag: "abc123" });
  });

  it("sends IfMatch when an etag is supplied", async () => {
    const cap = installFakeS3({ PutObject: () => ({ ETag: '"e"' }) });
    const c = new OSSClient(baseOpts);
    await c.putFile("a.md", "x", "prev-etag");
    expect(cap.PutObject.IfMatch).toBe("prev-etag");
  });

  it("maps 412 / 501 to a conflict result", async () => {
    // A fresh client per fake — OSSClient memoizes its S3 client after the
    // first _ensureClient(), so re-installing a fake needs a new instance.
    installFakeS3({
      PutObject: () => {
        throw httpErr(412);
      },
    });
    expect(await new OSSClient(baseOpts).putFile("a.md", "x")).toEqual({
      ok: false,
      conflict: true,
      status: 412,
    });
    installFakeS3({
      PutObject: () => {
        throw httpErr(501);
      },
    });
    expect(await new OSSClient(baseOpts).putFile("a.md", "x")).toEqual({
      ok: false,
      conflict: true,
      status: 501,
    });
  });

  it("maps other errors to an error result", async () => {
    installFakeS3({
      PutObject: () => {
        throw httpErr(400, "bad");
      },
    });
    const c = new OSSClient(baseOpts);
    expect(await c.putFile("a.md", "x")).toEqual({
      ok: false,
      error: "bad",
      status: 400,
    });
  });
});

describe("sync-oss-client — testConnection status mapping", () => {
  const cases = [
    [404, /不存在/],
    [403, /认证失败/],
    [301, /endpoint \/ region/],
    [400, /endpoint \/ region/],
  ];
  for (const [status, re] of cases) {
    it(`maps ${status} to a descriptive error`, async () => {
      installFakeS3({
        HeadBucket: () => {
          throw httpErr(status);
        },
      });
      const c = new OSSClient(baseOpts);
      const res = await c.testConnection();
      expect(res.ok).toBe(false);
      expect(res.status).toBe(status);
      expect(res.error).toMatch(re);
    });
  }

  it("returns ok on success", async () => {
    installFakeS3({ HeadBucket: () => ({}) });
    const c = new OSSClient(baseOpts);
    expect(await c.testConnection()).toEqual({ ok: true });
  });
});

describe("sync-oss-client — deleteFile", () => {
  it("returns ok on success", async () => {
    installFakeS3({ DeleteObject: () => ({}) });
    const c = new OSSClient(baseOpts);
    expect(await c.deleteFile("a.md")).toEqual({ ok: true });
  });

  it("treats a 404 as already-absent success", async () => {
    installFakeS3({
      DeleteObject: () => {
        throw httpErr(404);
      },
    });
    const c = new OSSClient(baseOpts);
    expect(await c.deleteFile("a.md")).toEqual({
      ok: true,
      alreadyAbsent: true,
    });
  });

  it("reports other errors", async () => {
    installFakeS3({
      DeleteObject: () => {
        throw httpErr(403, "denied");
      },
    });
    const c = new OSSClient(baseOpts);
    expect(await c.deleteFile("a.md")).toEqual({
      ok: false,
      error: "denied",
      status: 403,
    });
  });
});

describe("sync-oss-client — getEtag", () => {
  it("returns the etag without quotes", async () => {
    installFakeS3({ HeadObject: () => ({ ETag: '"zzz"' }) });
    const c = new OSSClient(baseOpts);
    expect(await c.getEtag("a.md")).toBe("zzz");
  });

  it("returns null on 404", async () => {
    installFakeS3({
      HeadObject: () => {
        throw httpErr(404);
      },
    });
    const c = new OSSClient(baseOpts);
    expect(await c.getEtag("a.md")).toBeNull();
  });

  it("rethrows non-404 errors", async () => {
    installFakeS3({
      HeadObject: () => {
        throw httpErr(500, "server");
      },
    });
    const c = new OSSClient(baseOpts);
    await expect(c.getEtag("a.md")).rejects.toThrow(/server/);
  });
});

describe("sync-oss-client — listRemote", () => {
  it("returns only .md objects, mapped, and follows pagination", async () => {
    let call = 0;
    const cap = installFakeS3({
      ListObjects: () => {
        call += 1;
        if (call === 1) {
          return {
            Contents: [
              {
                Key: "n/a.md",
                ETag: '"e1"',
                Size: 10,
                LastModified: "2024-01-02T03:04:05.000Z",
              },
              { Key: "n/skip.txt", ETag: '"e2"', Size: 5 },
            ],
            IsTruncated: true,
            NextContinuationToken: "TOKEN2",
          };
        }
        return {
          Contents: [{ Key: "n/b.md", ETag: '"e3"', Size: 20 }],
          IsTruncated: false,
        };
      },
    });
    const c = new OSSClient({ ...baseOpts, remotePath: "n" });
    const items = await c.listRemote();
    expect(call).toBe(2);
    expect(cap.last.input.ContinuationToken).toBe("TOKEN2");
    expect(items).toEqual([
      {
        filename: "a.md",
        key: "n/a.md",
        etag: "e1",
        size: 10,
        lastmod: "2024-01-02T03:04:05.000Z",
      },
      { filename: "b.md", key: "n/b.md", etag: "e3", size: 20, lastmod: null },
    ]);
  });
});

describe("sync-oss-client — retry", () => {
  it("retries a retriable status then succeeds", async () => {
    let n = 0;
    installFakeS3({
      PutObject: () => {
        n += 1;
        if (n === 1) throw httpErr(503);
        return { ETag: '"ok"' };
      },
    });
    const c = new OSSClient(baseOpts);
    const res = await c.putFile("a.md", "x");
    expect(res.ok).toBe(true);
    expect(n).toBe(2);
  });

  it("does not retry a non-retriable status", async () => {
    let n = 0;
    installFakeS3({
      DeleteObject: () => {
        n += 1;
        throw httpErr(403);
      },
    });
    const c = new OSSClient(baseOpts);
    await c.deleteFile("a.md");
    expect(n).toBe(1);
  });

  it("gives up after RETRY_MAX attempts on a persistent retriable error", async () => {
    let n = 0;
    installFakeS3({
      PutObject: () => {
        n += 1;
        throw httpErr(503);
      },
    });
    const c = new OSSClient(baseOpts);
    const res = await c.putFile("a.md", "x");
    expect(res).toEqual({ ok: false, error: "boom", status: 503 });
    expect(n).toBe(RETRY_MAX);
  });
});
