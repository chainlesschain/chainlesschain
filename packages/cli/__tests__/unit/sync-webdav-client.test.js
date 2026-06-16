import { describe, it, expect, afterEach } from "vitest";
import {
  WebDAVClient,
  RETRY_MAX,
  _setWebdavLoaderForTest,
  _resetWebdavLoaderForTest,
} from "../../src/lib/sync-webdav-client.js";

afterEach(() => {
  _resetWebdavLoaderForTest();
});

/**
 * Install a fake `webdav` module. `handlers` maps a method name
 * (stat / putFileContents / deleteFile / getDirectoryContents) to a
 * function returning a value or throwing. Call args are captured for
 * assertions; `captured.<method>` holds the args of the last such call.
 */
function installFakeWebdav(handlers, captured = {}) {
  const wrap =
    (name) =>
    async (...args) => {
      captured[name] = args;
      captured.last = { name, args };
      const h = handlers[name];
      if (!h) throw new Error(`no fake handler for ${name}`);
      return await h(...args);
    };
  const client = {
    stat: wrap("stat"),
    putFileContents: wrap("putFileContents"),
    deleteFile: wrap("deleteFile"),
    getDirectoryContents: wrap("getDirectoryContents"),
  };
  const mod = {
    createClient: (url, opts) => {
      captured.createClient = { url, opts };
      return client;
    },
  };
  _setWebdavLoaderForTest(async () => mod);
  return captured;
}

const baseOpts = {
  url: "https://dav.example.com/remote.php/dav",
  username: "alice",
  password: "pw",
};

const httpErr = (status, message = "boom") => ({ status, message });

describe("sync-webdav-client — constructor", () => {
  it("requires a url", () => {
    expect(() => new WebDAVClient({})).toThrow(/url/);
  });

  it("strips trailing slashes from remotePath", () => {
    expect(
      new WebDAVClient({ ...baseOpts, remotePath: "/notes/" }).remotePath,
    ).toBe("/notes");
  });

  it("falls back to / for an empty or slash-only remotePath", () => {
    expect(new WebDAVClient({ ...baseOpts, remotePath: "" }).remotePath).toBe(
      "/",
    );
    expect(
      new WebDAVClient({ ...baseOpts, remotePath: "///" }).remotePath,
    ).toBe("/");
  });

  it("passes the url + credentials to createClient", async () => {
    const cap = installFakeWebdav({ stat: () => ({}) });
    await new WebDAVClient(baseOpts).testConnection();
    expect(cap.createClient.url).toBe(baseOpts.url);
    expect(cap.createClient.opts).toEqual({
      username: "alice",
      password: "pw",
    });
  });
});

describe("sync-webdav-client — remote path resolution", () => {
  it("joins remotePath + filename and collapses double slashes", async () => {
    const cap = installFakeWebdav({
      putFileContents: () => ({}),
      stat: () => ({ etag: "e" }),
    });
    await new WebDAVClient({ ...baseOpts, remotePath: "/notes" }).putFile(
      "/a.md",
      "x",
    );
    expect(cap.putFileContents[0]).toBe("/notes/a.md");
  });

  it("collapses the // when remotePath is root", async () => {
    const cap = installFakeWebdav({
      putFileContents: () => ({}),
      stat: () => ({ etag: "e" }),
    });
    await new WebDAVClient({ ...baseOpts, remotePath: "/" }).putFile(
      "a.md",
      "x",
    );
    expect(cap.putFileContents[0]).toBe("/a.md");
  });
});

describe("sync-webdav-client — testConnection", () => {
  it("returns ok on success", async () => {
    installFakeWebdav({ stat: () => ({}) });
    expect(await new WebDAVClient(baseOpts).testConnection()).toEqual({
      ok: true,
    });
  });

  it("maps 404 to a missing-path error", async () => {
    installFakeWebdav({
      stat: () => {
        throw httpErr(404);
      },
    });
    const res = await new WebDAVClient(baseOpts).testConnection();
    expect(res).toMatchObject({ ok: false, status: 404 });
    expect(res.error).toMatch(/不存在/);
  });

  for (const status of [401, 403]) {
    it(`maps ${status} to an auth error`, async () => {
      installFakeWebdav({
        stat: () => {
          throw httpErr(status);
        },
      });
      const res = await new WebDAVClient(baseOpts).testConnection();
      expect(res).toMatchObject({ ok: false, status });
      expect(res.error).toMatch(/认证失败/);
    });
  }

  it("passes through other errors", async () => {
    installFakeWebdav({
      stat: () => {
        throw httpErr(400, "weird");
      },
    });
    expect(await new WebDAVClient(baseOpts).testConnection()).toEqual({
      ok: false,
      status: 400,
      error: "weird",
    });
  });
});

describe("sync-webdav-client — putFile", () => {
  it("returns the new etag from a post-put stat", async () => {
    installFakeWebdav({
      putFileContents: () => ({ raw: 1 }),
      stat: () => ({ etag: "new-etag" }),
    });
    const res = await new WebDAVClient(baseOpts).putFile("a.md", "x");
    expect(res).toMatchObject({ ok: true, etag: "new-etag" });
  });

  it("falls back to props.getetag", async () => {
    installFakeWebdav({
      putFileContents: () => ({}),
      stat: () => ({ props: { getetag: "p-etag" } }),
    });
    expect((await new WebDAVClient(baseOpts).putFile("a.md", "x")).etag).toBe(
      "p-etag",
    );
  });

  it("still succeeds (etag null) when the post-put stat fails", async () => {
    installFakeWebdav({
      putFileContents: () => ({}),
      stat: () => {
        throw httpErr(500);
      },
    });
    expect(await new WebDAVClient(baseOpts).putFile("a.md", "x")).toMatchObject(
      {
        ok: true,
        etag: null,
      },
    );
  });

  it("sends an If-Match header when an etag is supplied", async () => {
    const cap = installFakeWebdav({
      putFileContents: () => ({}),
      stat: () => ({ etag: "e" }),
    });
    await new WebDAVClient(baseOpts).putFile("a.md", "x", "prev");
    expect(cap.putFileContents[2].headers["If-Match"]).toBe("prev");
  });

  it("maps 412 to a conflict", async () => {
    installFakeWebdav({
      putFileContents: () => {
        throw httpErr(412);
      },
    });
    expect(await new WebDAVClient(baseOpts).putFile("a.md", "x")).toEqual({
      ok: false,
      conflict: true,
      status: 412,
    });
  });

  it("maps other errors", async () => {
    installFakeWebdav({
      putFileContents: () => {
        throw httpErr(400, "bad");
      },
    });
    expect(await new WebDAVClient(baseOpts).putFile("a.md", "x")).toEqual({
      ok: false,
      error: "bad",
      status: 400,
    });
  });
});

describe("sync-webdav-client — deleteFile", () => {
  it("returns ok on success", async () => {
    installFakeWebdav({ deleteFile: () => ({}) });
    expect(await new WebDAVClient(baseOpts).deleteFile("a.md")).toEqual({
      ok: true,
    });
  });

  it("treats 404 as already-absent", async () => {
    installFakeWebdav({
      deleteFile: () => {
        throw httpErr(404);
      },
    });
    expect(await new WebDAVClient(baseOpts).deleteFile("a.md")).toEqual({
      ok: true,
      alreadyAbsent: true,
    });
  });

  it("maps 412 to a conflict", async () => {
    installFakeWebdav({
      deleteFile: () => {
        throw httpErr(412);
      },
    });
    expect(await new WebDAVClient(baseOpts).deleteFile("a.md")).toEqual({
      ok: false,
      conflict: true,
      status: 412,
    });
  });

  it("sends an If-Match header when an etag is supplied", async () => {
    const cap = installFakeWebdav({ deleteFile: () => ({}) });
    await new WebDAVClient(baseOpts).deleteFile("a.md", "prev");
    expect(cap.deleteFile[1].headers["If-Match"]).toBe("prev");
  });
});

describe("sync-webdav-client — getEtag", () => {
  it("returns the etag", async () => {
    installFakeWebdav({ stat: () => ({ etag: "zz" }) });
    expect(await new WebDAVClient(baseOpts).getEtag("a.md")).toBe("zz");
  });

  it("returns null on 404", async () => {
    installFakeWebdav({
      stat: () => {
        throw httpErr(404);
      },
    });
    expect(await new WebDAVClient(baseOpts).getEtag("a.md")).toBeNull();
  });

  it("rethrows non-404 errors", async () => {
    installFakeWebdav({
      stat: () => {
        throw httpErr(400, "nope");
      },
    });
    await expect(new WebDAVClient(baseOpts).getEtag("a.md")).rejects.toThrow(
      /nope/,
    );
  });
});

describe("sync-webdav-client — listRemote", () => {
  it("keeps only .md files and maps the fields", async () => {
    installFakeWebdav({
      getDirectoryContents: () => [
        { type: "file", basename: "a.md", etag: "e1", size: 11, lastmod: "L1" },
        { type: "file", basename: "skip.txt", etag: "e2", size: 2 },
        { type: "directory", basename: "sub", etag: "e3" },
        null,
      ],
    });
    const items = await new WebDAVClient(baseOpts).listRemote();
    expect(items).toEqual([
      { filename: "a.md", etag: "e1", size: 11, lastmod: "L1" },
    ]);
  });
});

describe("sync-webdav-client — retry", () => {
  it("retries a retriable status then succeeds", async () => {
    let n = 0;
    installFakeWebdav({
      deleteFile: () => {
        n += 1;
        if (n === 1) throw httpErr(503);
        return {};
      },
    });
    expect(await new WebDAVClient(baseOpts).deleteFile("a.md")).toEqual({
      ok: true,
    });
    expect(n).toBe(2);
  });

  it("does not retry a non-retriable status", async () => {
    let n = 0;
    installFakeWebdav({
      deleteFile: () => {
        n += 1;
        throw httpErr(403);
      },
    });
    await new WebDAVClient(baseOpts).deleteFile("a.md");
    expect(n).toBe(1);
  });

  it("gives up after RETRY_MAX on a persistent retriable error", async () => {
    let n = 0;
    installFakeWebdav({
      deleteFile: () => {
        n += 1;
        throw httpErr(503);
      },
    });
    const res = await new WebDAVClient(baseOpts).deleteFile("a.md");
    expect(res).toMatchObject({ ok: false, status: 503 });
    expect(n).toBe(RETRY_MAX);
  });
});
