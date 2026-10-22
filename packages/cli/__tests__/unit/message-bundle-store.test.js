import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import { canonicalJson } from "@chainlesschain/context-memory-kernel";
import {
  appendAssistantMessage,
  appendUserMessage,
  deleteJsonlSession,
  rebuildMessages,
  startSession,
} from "../../src/harness/jsonl-session-store.js";
import {
  _messageBundleStore,
  readSessionMessageBundle,
  storeSessionMessageBundle,
} from "../../src/lib/context-memory-kernel/message-bundle-store.js";
import {
  contextItemsToMessages,
  messagesToContextItems,
} from "../../src/lib/context-memory-kernel/message-adapter.js";
import { compactLiveMessagesCanonical } from "../../src/lib/context-memory-kernel/live-compaction.js";

const STORE_MODULE_URL = new URL(
  "../../src/lib/context-memory-kernel/message-bundle-store.js",
  import.meta.url,
).href;
const IMAGE_MESSAGE = {
  role: "user",
  content: [
    { type: "text", text: "Inspect this image" },
    {
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${Buffer.alloc(
          3 * 1024 * 1024 + 128,
          7,
        ).toString("base64")}`,
        detail: "high",
      },
    },
  ],
};
const CONTENT = canonicalJson({
  schema: "chainlesschain.cli-context-message-bundle/v1",
  durableSystemKinds: [null],
  messages: [IMAGE_MESSAGE],
});

const TEMP_ROOT = fs.realpathSync.native(tmpdir());
let directory;
let sessionId;
let previousHome;
let previousSecurityHome;

beforeEach(() => {
  directory = fs.mkdtempSync(join(TEMP_ROOT, "cc-image-bundle-store-"));
  sessionId = "image-bundle-store-main";
  previousHome = process.env.CHAINLESSCHAIN_HOME;
  previousSecurityHome = process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
  process.env.CHAINLESSCHAIN_HOME = join(directory, "home");
  process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = join(directory, "security");
  startSession(sessionId, { provider: "local", model: "bundle-store-fixture" });
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.CHAINLESSCHAIN_HOME;
  else process.env.CHAINLESSCHAIN_HOME = previousHome;
  if (previousSecurityHome === undefined)
    delete process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME;
  else process.env.CHAINLESSCHAIN_SECURITY_ANCHOR_HOME = previousSecurityHome;
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

describe("session message bundle store", () => {
  it("binds a large bundle to the active JSONL generation", () => {
    const { reference } = storedBundle();
    const paths = _messageBundleStore.storePaths(false);
    const metadata = JSON.parse(
      fs.readFileSync(
        join(paths.sessionRoot, `${sessionId}.meta.json`),
        "utf8",
      ),
    );

    expect(reference.objectId).toMatch(/^bundle-[a-f0-9]{64}$/u);
    expect(metadata.generation.generationId).toMatch(/^generation-/u);
    expect(readSessionMessageBundle(reference, sessionId)).toBe(CONTENT);
  });

  it("reads the published bundle after a separate Node process starts", () => {
    const { reference } = storedBundle();
    const childSource = [
      `import { readSessionMessageBundle } from ${JSON.stringify(STORE_MODULE_URL)};`,
      'import { createHash } from "node:crypto";',
      "const content = readSessionMessageBundle(JSON.parse(process.env.CC_STORE_REF), process.env.CC_STORE_SESSION_ID);",
      'process.stdout.write(createHash("sha256").update(content).digest("hex"));',
    ].join("\n");
    const child = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", childSource],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CC_STORE_REF: JSON.stringify(reference),
          CC_STORE_SESSION_ID: sessionId,
        },
      },
    );

    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe(
      createHash("sha256").update(CONTENT).digest("hex"),
    );
  });

  it("settles and restores a large image through real persistent compaction", async () => {
    for (let index = 0; index < 4; index += 1) {
      appendAssistantMessage(
        sessionId,
        `Earlier work ${index}: ${"x".repeat(24000)}`,
      );
    }
    appendUserMessage(sessionId, IMAGE_MESSAGE.content);
    const messages = rebuildMessages(sessionId);
    const compressor = {
      maxTokens: 16_384,
      compress: async () => ({
        messages: [
          { role: "assistant", content: "Earlier work was summarized." },
        ],
        stats: { strategy: "semantic", saved: 1000, degraded: false },
      }),
    };

    const result = await compactLiveMessagesCanonical(messages, {
      sessionId,
      operationId: "image-bundle-real-compaction",
      compressor,
      env: { CHAINLESSCHAIN_CONTEXT_MEMORY_CLI_STAGE: "canonical_default" },
      memoryFilePath: join(directory, "memory.json"),
    });

    expect(result.receipt.status).toBe("committed");
    expect(result.messages).toContainEqual(IMAGE_MESSAGE);
    const outputItems = messagesToContextItems(result.messages, {
      sessionId,
      allowExternalization: true,
    });
    const imageBundle = outputItems.find((item) => item.contentRef);
    expect(imageBundle).toBeDefined();
    expect(contextItemsToMessages([imageBundle], { sessionId })).toContainEqual(
      IMAGE_MESSAGE,
    );
  });

  it("cleans the object directory before rejecting a deleted session tombstone", () => {
    const { reference, paths, hash, objectsDir } = storedBundle();
    const metadata = JSON.parse(
      fs.readFileSync(
        join(paths.sessionRoot, `${sessionId}.meta.json`),
        "utf8",
      ),
    );
    fs.writeFileSync(
      join(paths.tombstones, `${hash}.deleted`),
      canonicalJson({
        schema: "chainlesschain.cli-session-message-bundle-deleted/v1",
        sessionHash: hash,
        generationId: metadata.generation.generationId,
      }),
      { mode: 0o600 },
    );
    fs.unlinkSync(join(paths.sessionRoot, `${sessionId}.jsonl`));

    expect(() => readSessionMessageBundle(reference, sessionId)).toThrowError(
      expect.objectContaining({ code: "SESSION_DELETED" }),
    );
    expect(fs.existsSync(objectsDir)).toBe(false);
  });

  it("retires the old generation after deletion and refuses its references", () => {
    const { reference: oldReference } = storedBundle();
    expect(deleteJsonlSession(sessionId)).toBe(true);

    startSession(sessionId, { provider: "local", model: "recreated-session" });
    const newReference = storeSessionMessageBundle({
      sessionId,
      content: CONTENT,
    });

    expect(newReference.objectId).not.toBe(oldReference.objectId);
    expect(readSessionMessageBundle(newReference, sessionId)).toBe(CONTENT);
    expect(() => readSessionMessageBundle(oldReference, sessionId)).toThrow(
      /another session generation/u,
    );
  });
});
