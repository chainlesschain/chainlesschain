import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs, { fsyncSync, opendirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, isAbsolute } from "node:path";
import { canonicalJson } from "@chainlesschain/context-memory-kernel";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: actual.default,
    fsyncSync: vi.fn(actual.fsyncSync),
    opendirSync: vi.fn(actual.opendirSync),
  };
});

import {
  _messageBundleStore,
  readSessionMessageBundle,
  storeSessionMessageBundle,
  withSessionMessageBundleDeletion,
} from "../../src/lib/context-memory-kernel/message-bundle-store.js";
import { startSession } from "../../src/harness/jsonl-session-store.js";
import { compactLiveMessagesCanonical } from "../../src/lib/context-memory-kernel/live-compaction.js";

const TEMP_ROOT = fs.realpathSync.native(tmpdir());
const CONTENT = canonicalJson({
  schema: "chainlesschain.cli-context-message-bundle/v1",
  durableSystemKinds: [null],
  messages: [
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${Buffer.alloc(3 * 1024 * 1024 + 128).toString("base64")}`,
            detail: "high",
          },
        },
      ],
    },
  ],
});

let directory;
let sessionId;

beforeEach(() => {
  directory = fs.mkdtempSync(join(TEMP_ROOT, "cc-image-bundle-recovery-"));
  sessionId = "image-bundle-recovery";
  vi.stubEnv("CHAINLESSCHAIN_HOME", join(directory, "home"));
  vi.stubEnv(
    "CHAINLESSCHAIN_SECURITY_ANCHOR_HOME",
    join(directory, "security"),
  );
  vi.mocked(fsyncSync).mockImplementation(fs.fsyncSync);
  vi.mocked(opendirSync).mockImplementation(fs.opendirSync);
  startSession(sessionId, { provider: "local", model: "recovery-fixture" });
});

afterEach(() => {
  vi.mocked(fsyncSync).mockImplementation(fs.fsyncSync);
  vi.mocked(opendirSync).mockImplementation(fs.opendirSync);
  vi.unstubAllEnvs();
  const location = relative(TEMP_ROOT, resolve(directory));
  if (!location || location.startsWith("..") || isAbsolute(location)) {
    throw new Error("Refusing to clean a fixture outside its temporary root");
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

function storedBundle() {
  const reference = storeSessionMessageBundle({ sessionId, content: CONTENT });
  const paths = _messageBundleStore.storePaths(false);
  const hash = _messageBundleStore.sessionHash(sessionId);
  const objectsDir = join(paths.sessions, hash, "objects");
  const target = join(objectsDir, `${reference.objectId}.json`);
  return { reference, paths, hash, objectsDir, target };
}

// Force a directory order with the recovery target beyond both the normal
// 32-entry work budget and the 256-entry scan budget, on every operating system.
function hideBehindDirectoryWindow(targetDirectory, tail, suffix = ".json") {
  const prefix = Array.from({ length: 300 }, (_, index) => ({
    name: `${suffix === ".json" ? "bundle-" : ""}${index.toString(16).padStart(64, "0")}${suffix}`,
  }));
  vi.mocked(opendirSync).mockImplementation((path, ...args) => {
    if (resolve(String(path)) !== resolve(targetDirectory)) {
      return fs.opendirSync(path, ...args);
    }
    const entries = [...prefix, { name: tail }];
    let index = 0;
    return {
      readSync: () => entries[index++] || null,
      closeSync: () => {},
    };
  });
}

describe("session image bundle publication recovery", () => {
  it("does not persist a large image when no-save compaction reuses a live session id", async () => {
    const compressor = {
      maxTokens: 1_000_000,
      compress: vi.fn(async () => {
        throw new Error(
          "The no-save image boundary must reject before summarization",
        );
      }),
    };
    await expect(
      compactLiveMessagesCanonical(JSON.parse(CONTENT).messages, {
        sessionId,
        persist: false,
        operationId: "no-save-image-compaction",
        compressor,
        env: { CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default" },
        memoryFilePath: join(directory, "memory.json"),
      }),
    ).rejects.toMatchObject({ code: "CC_CONTEXT_IMAGE_TRANSPORT_INVALID" });
    expect(compressor.compress).not.toHaveBeenCalled();
    expect(
      fs.existsSync(
        join(directory, "home", "sessions", ".context-message-bundles-v1"),
      ),
    ).toBe(false);
  });

  it("recovers the requested blob's publication hard link beyond the scan window", () => {
    const { reference, objectsDir, target } = storedBundle();
    const temporary = join(objectsDir, `.${basename(target)}.tmp`);
    fs.linkSync(target, temporary);
    hideBehindDirectoryWindow(objectsDir, basename(temporary));

    expect(readSessionMessageBundle(reference, sessionId)).toBe(CONTENT);
    expect(fs.existsSync(temporary)).toBe(false);
    expect(fs.lstatSync(target).nlink).toBe(1);
  });

  it.each(["pending", "deleted"])(
    "recovers the current %s tombstone beyond the scan window",
    (kind) => {
      const { reference, paths, hash, objectsDir } = storedBundle();
      const target = join(paths.tombstones, `${hash}.${kind}`);
      const temporary = join(paths.tombstones, `.${hash}.${kind}.tmp`);
      const generationId = JSON.parse(
        fs.readFileSync(
          join(paths.sessionRoot, `${sessionId}.meta.json`),
          "utf8",
        ),
      ).generation.generationId;
      fs.writeFileSync(
        target,
        canonicalJson(
          kind === "pending"
            ? {
                schema:
                  "chainlesschain.cli-session-message-bundle-delete-pending/v1",
                sessionId,
                generationId,
              }
            : {
                schema: "chainlesschain.cli-session-message-bundle-deleted/v1",
                sessionHash: hash,
                generationId,
              },
        ),
        { mode: 0o600 },
      );
      fs.unlinkSync(join(paths.sessionRoot, `${sessionId}.jsonl`));
      fs.linkSync(target, temporary);
      hideBehindDirectoryWindow(
        paths.tombstones,
        basename(temporary),
        ".deleted",
      );

      expect(() => readSessionMessageBundle(reference, sessionId)).toThrowError(
        expect.objectContaining({ code: "SESSION_DELETED" }),
      );
      expect(fs.existsSync(temporary)).toBe(false);
      expect(fs.existsSync(objectsDir)).toBe(false);
      expect(() =>
        storeSessionMessageBundle({ sessionId, content: CONTENT }),
      ).toThrow();
    },
  );

  it("refuses deletion when a hidden temporary object has an external hard link", () => {
    const { paths, hash, objectsDir, target } = storedBundle();
    const temporary = join(objectsDir, `.${basename(target)}.tmp`);
    const outsideLink = join(directory, "outside-link.bin");
    fs.writeFileSync(temporary, "unpublished image bytes", { mode: 0o600 });
    fs.linkSync(temporary, outsideLink);
    hideBehindDirectoryWindow(objectsDir, basename(temporary));
    const deleteTranscript = vi.fn(() => {
      fs.unlinkSync(join(paths.sessionRoot, `${sessionId}.jsonl`));
      return true;
    });

    expect(() =>
      withSessionMessageBundleDeletion(sessionId, deleteTranscript),
    ).toThrowError(
      expect.objectContaining({ code: "SESSION_IMAGE_BUNDLE_DELETE_FAILED" }),
    );
    expect(deleteTranscript).toHaveBeenCalledOnce();
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.existsSync(temporary)).toBe(true);
    expect(fs.readFileSync(outsideLink, "utf8")).toBe(
      "unpublished image bytes",
    );
    expect(fs.existsSync(join(paths.tombstones, `${hash}.deleted`))).toBe(true);
  });

  it("does not report publication as successful after repeated file fsync failures", () => {
    vi.mocked(fsyncSync).mockImplementation((descriptor) => {
      const current = fs.fstatSync(descriptor, { bigint: true });
      if (current.isFile()) {
        const error = new Error("injected publication fsync failure");
        error.code = "EIO";
        throw error;
      }
      return fs.fsyncSync(descriptor);
    });

    expect(() =>
      storeSessionMessageBundle({ sessionId, content: CONTENT }),
    ).toThrow();
    expect(() =>
      storeSessionMessageBundle({ sessionId, content: CONTENT }),
    ).toThrow();

    vi.mocked(fsyncSync).mockImplementation(fs.fsyncSync);
    const reference = storeSessionMessageBundle({
      sessionId,
      content: CONTENT,
    });
    expect(readSessionMessageBundle(reference, sessionId)).toBe(CONTENT);
  });

  it.skipIf(process.platform === "win32")(
    "settles publication durability again after a failed parent directory fsync",
    () => {
      let rejectedDirectorySyncs = 0;
      const objectsDir = join(
        directory,
        "home",
        "sessions",
        ".context-message-bundles-v1",
        "sessions",
        _messageBundleStore.sessionHash(sessionId),
        "objects",
      );
      vi.mocked(fsyncSync).mockImplementation((descriptor) => {
        const current = fs.fstatSync(descriptor, { bigint: true });
        const parent = fs.existsSync(objectsDir)
          ? fs.lstatSync(objectsDir, { bigint: true })
          : null;
        if (
          current.isDirectory() &&
          current.dev === parent?.dev &&
          current.ino === parent?.ino &&
          fs
            .readdirSync(objectsDir)
            .some((name) => /^bundle-[a-f0-9]{64}\.json$/u.test(name))
        ) {
          rejectedDirectorySyncs += 1;
          const error = new Error("injected parent directory fsync failure");
          error.code = "EIO";
          throw error;
        }
        return fs.fsyncSync(descriptor);
      });
      expect(() =>
        storeSessionMessageBundle({ sessionId, content: CONTENT }),
      ).toThrow();
      expect(rejectedDirectorySyncs).toBe(1);
      expect(() =>
        storeSessionMessageBundle({ sessionId, content: CONTENT }),
      ).toThrow();
      expect(rejectedDirectorySyncs).toBe(2);

      vi.mocked(fsyncSync).mockClear();
      vi.mocked(fsyncSync).mockImplementation(fs.fsyncSync);
      const reference = storeSessionMessageBundle({
        sessionId,
        content: CONTENT,
      });
      const descriptors = vi
        .mocked(fsyncSync)
        .mock.calls.map(([descriptor]) => descriptor);
      expect(descriptors.length).toBeGreaterThan(0);
      expect(readSessionMessageBundle(reference, sessionId)).toBe(CONTENT);
    },
  );
});
