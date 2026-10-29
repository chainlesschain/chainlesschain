import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  assertCompleteScanHistory,
  collectHistoryPages,
  copyHistoryRollouts,
  observeRawThreadHistory,
  observeThreadHistory,
} from "../../scripts/codex-app-server-history-probe.mjs";

describe("bounded Codex history pagination", () => {
  it("passes opaque cursors back with the original filters and keeps chronological identities", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: "old", createdAt: 10 }],
        nextCursor: "opaque+/==",
      })
      .mockResolvedValueOnce({
        data: [{ id: "new", createdAt: 10 }],
        nextCursor: null,
      });
    const result = await collectHistoryPages(request, "thread/turns/list", {
      threadId: "main",
      limit: 1,
      sortDirection: "asc",
    });
    expect(result.data).toEqual([
      { id: "old", createdAt: 10 },
      { id: "new", createdAt: 10 },
    ]);
    expect(request.mock.calls).toEqual([
      [
        "thread/turns/list",
        { threadId: "main", limit: 1, sortDirection: "asc" },
      ],
      [
        "thread/turns/list",
        {
          threadId: "main",
          limit: 1,
          sortDirection: "asc",
          cursor: "opaque+/==",
        },
      ],
    ]);
    expect(result.pages).toHaveLength(2);
  });
  it("accepts an empty terminal page", async () => {
    await expect(
      collectHistoryPages(
        async () => ({ data: [], nextCursor: null }),
        "thread/list",
        {},
      ),
    ).resolves.toEqual({ data: [], pages: [{ ids: [], nextCursor: null }] });
  });
  it("preserves database and recency filters with an opaque identity cursor for tied threads", async () => {
    const cursor = "2026-10-28T00:00:00Z|thread-a";
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: "thread-a", createdAt: 10 }],
        nextCursor: cursor,
      })
      .mockResolvedValueOnce({
        data: [{ id: "thread-b", createdAt: 10 }],
        nextCursor: null,
      });
    const params = {
      limit: 1,
      sortKey: "recency_at",
      sortDirection: "asc",
      useStateDbOnly: true,
    };
    const result = await collectHistoryPages(request, "thread/list", params);
    expect(result.data.map((entry) => entry.id)).toEqual([
      "thread-a",
      "thread-b",
    ]);
    expect(request).toHaveBeenNthCalledWith(2, "thread/list", {
      ...params,
      cursor,
    });
  });
  it.each([
    {},
    { data: null, nextCursor: null },
    { data: [], nextCursor: undefined },
    { data: [], nextCursor: "" },
    { data: [], nextCursor: 1 },
    { data: [{}], nextCursor: null },
  ])("rejects malformed history response %j", async (response) => {
    await expect(
      collectHistoryPages(async () => response, "thread/list", {}),
    ).rejects.toThrow();
  });
  it("refuses repeated identities even when a cursor advances", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "same" }], nextCursor: "next" })
      .mockResolvedValueOnce({ data: [{ id: "same" }], nextCursor: null });
    await expect(
      collectHistoryPages(request, "thread/list", {}),
    ).rejects.toThrow(/duplicate history identity/);
  });
  it("refuses a repeated cursor and never issues a third request", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "a" }], nextCursor: "same" })
      .mockResolvedValueOnce({ data: [{ id: "b" }], nextCursor: "same" });
    await expect(
      collectHistoryPages(request, "thread/list", {}),
    ).rejects.toThrow(/repeated history cursor/);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("refuses an empty page that claims more results", async () => {
    await expect(
      collectHistoryPages(
        async () => ({ data: [], nextCursor: "next" }),
        "thread/list",
        {},
      ),
    ).rejects.toThrow(/empty nonterminal/);
  });
  it("bounds a server that keeps issuing fresh cursors", async () => {
    const request = vi.fn(async () => ({
      data: [{ id: String(request.mock.calls.length) }],
      nextCursor: String(request.mock.calls.length),
    }));
    await expect(
      collectHistoryPages(request, "thread/list", {}, 2),
    ).rejects.toThrow(/exceeded its bound/);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([0, -1, 33, 1.5])(
    "rejects an invalid page bound %s before an RPC",
    async (limit) => {
      const request = vi.fn();
      await expect(
        collectHistoryPages(request, "thread/list", {}, limit),
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );
});

describe("Codex rollout scan observations", () => {
  it("retains raw diagnostic errors and parameters while supported observations still reject", async () => {
    const params = {
      limit: 1,
      sortKey: "created_at",
      sortDirection: "asc",
    };
    const request = vi.fn(async () => ({
      data: [{ id: "a" }],
      nextCursor: "repeated-cursor",
    }));
    const raw = await observeRawThreadHistory(request, params, ["a", "b"]);
    expect(raw).toMatchObject({
      params,
      complete: false,
      error: {
        name: "AssertionError",
        message: expect.stringContaining("duplicate history identity"),
      },
    });
    const supported = {
      ...params,
      sortKey: "recency_at",
      useStateDbOnly: false,
    };
    await expect(
      observeThreadHistory(request, supported, ["a", "b"]),
    ).rejects.toThrow(/duplicate history identity/);
    expect(() => assertCompleteScanHistory({ asc: raw, desc: raw })).toThrow(
      /omitted/,
    );
  });

  it("records missing identities even when raw created_at pagination terminates normally", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: "a" }],
        nextCursor: "timestamp-only",
      })
      .mockResolvedValueOnce({ data: [], nextCursor: null })
      .mockResolvedValueOnce({
        data: [{ id: "a" }, { id: "b" }],
        nextCursor: null,
      });
    const params = {
      limit: 1,
      cwd: "/fixture",
      sortDirection: "asc",
      sortKey: "created_at",
    };
    const observed = await observeThreadHistory(request, params, ["a", "b"]);
    expect(observed).toMatchObject({
      complete: false,
      ids: ["a"],
      allIds: ["a", "b"],
      missingIds: ["b"],
    });
    expect(request.mock.calls).toEqual([
      ["thread/list", params],
      ["thread/list", { ...params, cursor: "timestamp-only" }],
      ["thread/list", { ...params, limit: 100 }],
    ]);
    expect(() =>
      assertCompleteScanHistory({ asc: observed, desc: observed }),
    ).toThrow(/omitted/);
  });

  it("checks both scan directions with opaque cursors and unchanged scan and filter parameters", async () => {
    const request = vi.fn(async (method, params) => {
      expect(method).toBe("thread/list");
      const ids = params.sortDirection === "asc" ? ["a", "b"] : ["b", "a"];
      return params.limit === 100
        ? { data: ids.map((id) => ({ id, createdAt: 10 })), nextCursor: null }
        : {
            data: [{ id: ids[params.cursor ? 1 : 0], createdAt: 10 }],
            nextCursor: params.cursor ? null : "opaque|+/==",
          };
    });
    const observations = {};
    for (const sortDirection of ["asc", "desc"]) {
      const params = {
        limit: 1,
        cwd: "/fixture",
        modelProviders: ["fixture"],
        sourceKinds: ["vscode"],
        useStateDbOnly: false,
        sortKey: "recency_at",
        sortDirection,
      };
      observations[sortDirection] = await observeThreadHistory(
        request,
        params,
        ["a", "b"],
      );
      expect(request).toHaveBeenCalledWith("thread/list", {
        ...params,
        cursor: "opaque|+/==",
      });
    }
    expect(() => assertCompleteScanHistory(observations)).not.toThrow();
    expect(request).toHaveBeenCalledTimes(6);
    expect(() =>
      assertCompleteScanHistory({ ...observations, desc: observations.asc }),
    ).toThrow(/reverse/);
    expect(() =>
      assertCompleteScanHistory({
        ...observations,
        asc: { ...observations.asc, pages: [{}] },
      }),
    ).toThrow(/continuation/);
  });

  it("does not label a complete paged response as verified when the full query disagrees", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "a" }], nextCursor: "next" })
      .mockResolvedValueOnce({ data: [{ id: "b" }], nextCursor: null })
      .mockResolvedValueOnce({
        data: [{ id: "a" }, { id: "unexpected" }],
        nextCursor: null,
      });
    expect(
      await observeThreadHistory(request, { limit: 1 }, ["a", "b"]),
    ).toMatchObject({ complete: false });
  });
});

describe("isolated generated rollout copying", () => {
  const roots = [];
  afterEach(() => {
    for (const root of roots.splice(0)) {
      const resolved = path.resolve(root);
      expect(path.dirname(resolved)).toBe(fs.realpathSync.native(os.tmpdir()));
      expect(path.basename(resolved)).toMatch(/^cc-history-copy-/u);
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  });

  function fixture() {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-history-copy-"),
    );
    roots.push(root);
    const sourceHome = path.join(root, "source");
    const targetHome = path.join(root, "target");
    const source = path.join(
      sourceHome,
      "sessions",
      "2026",
      "10",
      "29",
      "rollout.jsonl",
    );
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.mkdirSync(targetHome);
    const bytes = Buffer.from(
      JSON.stringify({ type: "session_meta", payload: { id: "thread-a" } }) +
        "\n",
    );
    fs.writeFileSync(source, bytes);
    return {
      root,
      sourceHome,
      targetHome,
      source,
      bytes,
      thread: { id: "thread-a", path: source },
    };
  }

  it("copies only matching session evidence with identical bytes and digest, without a state DB", () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.sourceHome, "state_5.sqlite"), "not copied");
    const copied = copyHistoryRollouts([f.thread], f.sourceHome, f.targetHome);
    expect(copied).toEqual([
      {
        threadId: "thread-a",
        relativePath: path.relative(f.sourceHome, f.source),
        bytes: f.bytes.length,
        sha256: createHash("sha256").update(f.bytes).digest("hex"),
      },
    ]);
    expect(
      fs.readFileSync(path.join(f.targetHome, copied[0].relativePath)),
    ).toEqual(f.bytes);
    expect(fs.existsSync(path.join(f.targetHome, "state_5.sqlite"))).toBe(
      false,
    );
  });

  it("rejects paths outside the isolated sessions tree and mismatched thread identities", () => {
    const f = fixture();
    expect(() =>
      copyHistoryRollouts(
        [{ ...f.thread, path: path.join(f.root, "outside.jsonl") }],
        f.sourceHome,
        f.targetHome,
      ),
    ).toThrow(/inside/);
    expect(() =>
      copyHistoryRollouts(
        [{ ...f.thread, id: "another-thread" }],
        f.sourceHome,
        f.targetHome,
      ),
    ).toThrow(/identity mismatch/);
    expect(fs.readdirSync(f.targetHome)).toEqual([]);
  });

  it("rejects hard-linked source rollouts", () => {
    const f = fixture();
    fs.linkSync(f.source, path.join(f.root, "linked.jsonl"));
    expect(() =>
      copyHistoryRollouts([f.thread], f.sourceHome, f.targetHome),
    ).toThrow(/links/);
  });

  it.each(["source", "destination"])(
    "rejects a real %s directory link before copying through it",
    (side) => {
      const f = fixture();
      const external = path.join(f.root, "external");
      const linked = path.join(
        side === "source" ? f.sourceHome : f.targetHome,
        "sessions",
      );
      if (side === "source") fs.renameSync(linked, external);
      else fs.mkdirSync(external);
      fs.symlinkSync(
        external,
        linked,
        process.platform === "win32" ? "junction" : "dir",
      );
      expect(() =>
        copyHistoryRollouts([f.thread], f.sourceHome, f.targetHome),
      ).toThrow(/links/);
      if (side === "destination") expect(fs.readdirSync(external)).toEqual([]);
    },
  );
});
