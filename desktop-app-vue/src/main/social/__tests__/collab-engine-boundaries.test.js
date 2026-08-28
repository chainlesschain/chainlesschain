import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("uuid", () => ({
  v4: () => "bounded-doc-id",
}));

const {
  SocialCollabEngine,
  ContentType,
  Visibility,
} = require("../collab-engine");

const engines = [];

function createFixture(options = {}) {
  let currentDid = "did:test:alice";
  const statements = [];
  const databaseHandle = {
    exec: vi.fn(),
    prepare: vi.fn((sql) => {
      const statement = {
        all: vi.fn().mockReturnValue([]),
        get: vi.fn((docId) =>
          sql.includes("social_collab_documents")
            ? {
                id: docId,
                title: "Bounded document",
                content_type: "markdown",
                owner_did: currentDid,
                visibility: "private",
                status: "active",
                created_at: 1,
                updated_at: 1,
              }
            : null,
        ),
        run: vi.fn(),
      };
      statements.push({ sql, statement });
      return statement;
    }),
  };
  const database = { db: databaseHandle };
  const didManager = {
    getCurrentIdentity: vi.fn(() => ({ did: currentDid })),
  };
  const engine = new SocialCollabEngine(
    database,
    didManager,
    options.yjsCollabManager || null,
    { boundaries: options.boundaries || {} },
  );
  engines.push(engine);
  return {
    databaseHandle,
    engine,
    setCurrentDid(did) {
      currentDid = did;
    },
    statements,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(engines.splice(0).map((engine) => engine.destroy()));
});

describe("social collaboration engine boundaries", () => {
  it("rejects oversized titles and unknown document enums before writing", async () => {
    const { databaseHandle, engine } = createFixture({
      boundaries: { maxDocumentTitleBytes: 4 },
    });

    await expect(engine.createDocument({ title: "12345" })).rejects.toThrow(
      /title exceeds/i,
    );
    await expect(
      engine.createDocument({
        title: "1234",
        contentType: "binary",
        visibility: Visibility.PRIVATE,
      }),
    ).rejects.toThrow(/invalid content type/i);
    await expect(
      engine.createDocument({
        title: "1234",
        contentType: ContentType.MARKDOWN,
        visibility: "public",
      }),
    ).rejects.toThrow(/invalid visibility/i);
    expect(databaseHandle.prepare).not.toHaveBeenCalled();
  });

  it("bounds open documents without retaining a rejected entry", async () => {
    const { engine } = createFixture({
      boundaries: { maxActiveDocuments: 1 },
    });

    await engine.openDocument("doc-1");
    await expect(engine.openDocument("doc-2")).rejects.toThrow(
      /document capacity/i,
    );

    expect([...engine.openDocuments.keys()]).toEqual(["doc-1"]);
  });

  it("bounds collaborators without retaining the rejected identity", async () => {
    const { engine, setCurrentDid } = createFixture({
      boundaries: { maxPeersPerDocument: 1 },
    });
    await engine.openDocument("doc-1");
    setCurrentDid("did:test:bob");

    await expect(engine.openDocument("doc-1")).rejects.toThrow(
      /peer capacity/i,
    );

    expect([...engine.openDocuments.get("doc-1").users]).toEqual([
      "did:test:alice",
    ]);
  });

  it("rejects invalid pagination and caps pending invite queries", async () => {
    const { engine, statements } = createFixture({
      boundaries: { maxQueryItems: 5, maxQueryOffset: 10 },
    });

    await expect(engine.getMyDocuments({ limit: 6 })).resolves.toMatchObject({
      success: false,
      documents: [],
    });
    await expect(
      engine.getSharedDocuments({ limit: 1, offset: 11 }),
    ).resolves.toMatchObject({ success: false, documents: [] });

    await engine.getPendingInvites({ limit: 5, offset: 2 });
    const pending = statements.find(({ sql }) =>
      sql.includes("ORDER BY i.created_at DESC"),
    );
    expect(pending.sql).toContain("LIMIT ? OFFSET ?");
    expect(pending.statement.all).toHaveBeenCalledWith("did:test:alice", 5, 2);
  });

  it("fences an open that resolves after destroy and keeps state empty", async () => {
    let resolveOpen;
    const yjsCollabManager = {
      openDocument: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveOpen = resolve;
          }),
      ),
      closeDocument: vi.fn().mockResolvedValue(undefined),
    };
    const { engine } = createFixture({ yjsCollabManager });
    const opening = engine.openDocument("doc-late");
    await vi.waitFor(() => expect(resolveOpen).toBeTypeOf("function"));

    await engine.destroy();
    resolveOpen({ type: "ydoc" });

    await expect(opening).rejects.toMatchObject({
      code: "ERR_SOCIAL_COLLAB_DESTROYED",
    });
    expect(engine.openDocuments.size).toBe(0);
    expect(yjsCollabManager.closeDocument).toHaveBeenCalledWith("doc-late");
  });

  it("does not let a stuck close block destroy past the shared deadline", async () => {
    vi.useFakeTimers();
    const yjsCollabManager = {
      openDocument: vi.fn().mockResolvedValue({ type: "ydoc" }),
      closeDocument: vi.fn(() => new Promise(() => {})),
    };
    const { engine } = createFixture({
      yjsCollabManager,
      boundaries: { streamDeadlineMs: 5 },
    });
    await engine.openDocument("doc-1");

    const destroying = engine.destroy();
    await vi.advanceTimersByTimeAsync(6);

    await expect(destroying).resolves.toBeUndefined();
    expect(engine.openDocuments.size).toBe(0);
  });

  it("keeps application shutdown wired to the production instance", () => {
    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(
      path.resolve(testDirectory, "..", "..", "index.js"),
      "utf8",
    );
    expect(mainSource).toContain("this.collabEngine = instances.collabEngine");
    expect(mainSource).toContain("await this.collabEngine.destroy?.()");
  });
});
