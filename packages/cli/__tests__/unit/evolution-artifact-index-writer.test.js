import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArtifactStore,
  ARTIFACT_STORE_DEFAULT_PUBLISH_DATA_ONCE,
  captureArtifactStoreTypedIndexPublisher,
} from "../../src/lib/artifact-store.js";
import { openArtifactByteFixture } from "../fixtures/evolution-artifact-bytes.js";
import { loadActualIndexCache } from "../helpers/evolution-index-cache-isolate.js";

describe("explicit Evolution index encoding", () => {
  let root;
  beforeEach(() => {
    root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), "cc-index-writer-"),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const options = (lineage) => ({
    data: "payload",
    fileName: "record.json",
    immutable: true,
    recordDigest: `sha256:${crypto.createHash("sha256").update("payload").digest("hex")}`,
    lineage,
  });

  it("writes genuine new Evolution rows with the existing canonical encoder and unchanged envelope/payload", () => {
    const fixture = openArtifactByteFixture(root, {
      value: { text: '雪 🦊 \\ "', value: 1.25 },
    });
    const cache = loadActualIndexCache();
    const bytes = fs.readFileSync(fixture.store._indexFile());
    expect(bytes.toString()).toBe(cache.canonical(fixture.entry) + "\n");
    expect(fixture.entry.lineage.envelope).toBe(fixture.publication.envelope);
    expect(fixture.entry.sha256).toBe(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(fixture.target))
        .digest("hex"),
    );
    const expected = fixture.read();
    cache.run({}, bytes);
    expect(cache.state().entries[0].alias).toBe(true);
    const repeated = fixture.ports.putCanonical(
      "evolution-ledger-v2-journal",
      { text: '雪 🦊 \\ "', value: 1.25 },
      { purpose: "evolution-ledger", retention: "ledger" },
    );
    expect(fs.readFileSync(fixture.store._indexFile())).toEqual(bytes);
    expect(repeated.ref).toEqual(fixture.publication.ref);
    expect(fixture.read()).toEqual(expected);
  });

  it("preserves the returned entry order, clock calls, append fsync and close", () => {
    const cache = loadActualIndexCache();
    const now = vi.fn(() => Date.UTC(2026, 0, 1));
    const sync = vi.spyOn(fs, "fsyncSync");
    const close = vi.spyOn(fs, "closeSync");
    const ordinary = new ArtifactStore({
      dir: path.join(root, "ordinary"),
      now,
    });
    const baseline = ordinary.publishDataOnce(options({ z: "z", a: "a" }));
    const baselineCounts = {
      sync: sync.mock.calls.length,
      close: close.mock.calls.length,
      now: now.mock.calls.length,
    };
    sync.mockClear();
    close.mockClear();
    now.mockClear();
    const typed = new ArtifactStore({ dir: path.join(root, "typed"), now });
    const encoder = vi.fn(cache.canonical);
    const publish = captureArtifactStoreTypedIndexPublisher(
      typed,
      ARTIFACT_STORE_DEFAULT_PUBLISH_DATA_ONCE,
      encoder,
    );
    const result = publish(options({ z: "z", a: "a" }));
    expect(encoder).toHaveBeenCalledOnce();
    expect(Object.keys(result.entry)).toEqual(Object.keys(baseline.entry));
    expect(Object.keys(result.entry.lineage)).toEqual(["z", "a"]);
    expect({
      sync: sync.mock.calls.length,
      close: close.mock.calls.length,
      now: now.mock.calls.length,
    }).toEqual(baselineCounts);
    expect(now).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(typed._indexFile(), "utf8")).toBe(
      cache.canonical(result.entry) + "\n",
    );
  });

  it("does not infer an opt-in from lineage/schema or public option names and preserves toJSON/integer keys", () => {
    const store = new ArtifactStore({ dir: root });
    const toJSON = vi.fn(() => ({
      schema: "chainlesschain.evolution-artifact-lineage/v1",
      z: "z",
      10: "ten",
      2: "two",
    }));
    const result = store.publishDataOnce({
      ...options({ toJSON }),
      canonical: true,
      indexEncoding: "canonical",
    });
    expect(toJSON).toHaveBeenCalledOnce();
    expect(fs.readFileSync(store._indexFile(), "utf8")).toBe(
      JSON.stringify(result.entry) + "\n",
    );
    expect(Object.keys(result.entry.lineage)).toEqual([
      "2",
      "10",
      "schema",
      "z",
    ]);
    expect(
      fs.readFileSync(store._indexFile(), "utf8").startsWith('{"id":'),
    ).toBe(true);
  });

  it.each([
    "publishDataOnce",
    "_publishDataUnlocked",
    "_readEntries",
    "_withIndexLock",
    "_ensureDirs",
    "_indexFile",
    "_filesDir",
    "_deleteStoredFile",
    "list",
    "get",
    "storedPath",
    "verifyIntegrity",
    "_indexLock",
  ])(
    "preserves a custom %s dependency without invoking the formatter",
    (method) => {
      const store = new ArtifactStore({ dir: root });
      const original = store[method];
      const custom = vi.fn(function (...args) {
        return original.apply(this, args);
      });
      store[method] = custom;
      const encoder = vi.fn(() => "must-not-be-used");
      const publish = captureArtifactStoreTypedIndexPublisher(
        store,
        store.publishDataOnce,
        encoder,
      );
      const result = publish(options({ z: 1, a: 2 }));
      expect(encoder).not.toHaveBeenCalled();
      expect(fs.readFileSync(store._indexFile(), "utf8")).toBe(
        JSON.stringify(result.entry) + "\n",
      );
    },
  );

  it("rechecks prototype dependencies after capture and after a clock callback", () => {
    const original = ArtifactStore.prototype._readEntries;
    let calls = 0;
    const store = new ArtifactStore({
      dir: root,
      now: () => {
        calls += 1;
        if (calls === 1)
          ArtifactStore.prototype._readEntries = function (...args) {
            return original.apply(this, args);
          };
        return Date.UTC(2026, 0, 1);
      },
    });
    const encoder = vi.fn(() => "must-not-be-used");
    const publish = captureArtifactStoreTypedIndexPublisher(
      store,
      store.publishDataOnce,
      encoder,
    );
    let result;
    try {
      result = publish(options({ z: 1, a: 2 }));
    } finally {
      ArtifactStore.prototype._readEntries = original;
    }
    expect(encoder).not.toHaveBeenCalled();
    expect(calls).toBe(2);
    expect(fs.readFileSync(store._indexFile(), "utf8")).toBe(
      JSON.stringify(result.entry) + "\n",
    );
  });

  it("preserves a captured custom method whose own call property is undefined", () => {
    const store = new ArtifactStore({ dir: root });
    const custom = function (input) {
      return { receiver: this, input };
    };
    Object.defineProperty(custom, "call", { value: undefined });
    store.publishDataOnce = custom;
    const input = options({ z: 1 });
    const baseline = Object.freeze(custom.bind(store));
    const encoder = vi.fn();
    const publish = captureArtifactStoreTypedIndexPublisher(
      store,
      custom,
      encoder,
    );
    expect(publish(input)).toEqual(baseline(input));
    expect(encoder).not.toHaveBeenCalled();
  });

  it("captures a custom bind exactly once and keeps its original returned hook", () => {
    const store = new ArtifactStore({ dir: root });
    const hook = vi.fn((input) => ({ receiver: store, input }));
    const bind = vi.fn(() => hook);
    const getBind = vi.fn(() => bind);
    const custom = function () {
      throw new Error("unbound hook called");
    };
    Object.defineProperty(custom, "bind", { configurable: true, get: getBind });
    store.publishDataOnce = custom;
    const encoder = vi.fn();
    const publish = captureArtifactStoreTypedIndexPublisher(
      store,
      custom,
      encoder,
    );
    expect(bind).toHaveBeenCalledExactlyOnceWith(store);
    expect(getBind).toHaveBeenCalledOnce();
    expect(Object.isFrozen(hook)).toBe(true);
    Object.defineProperty(custom, "bind", {
      value: () => {
        throw new Error("late bind called");
      },
    });
    const input = options({ z: 1 });
    expect(publish(input)).toEqual({ receiver: store, input });
    expect(publish(input)).toEqual({ receiver: store, input });
    expect(hook).toHaveBeenCalledTimes(2);
    expect(bind).toHaveBeenCalledOnce();
    expect(encoder).not.toHaveBeenCalled();
  });

  it("declines typed encoding when the default publication function has a custom bind", () => {
    const store = new ArtifactStore({ dir: root });
    const method = ARTIFACT_STORE_DEFAULT_PUBLISH_DATA_ONCE;
    const previous = Object.getOwnPropertyDescriptor(method, "bind");
    const nativeBind = Function.prototype.bind;
    const invoke = vi.fn();
    const bind = vi.fn(function (receiver) {
      const original = Reflect.apply(nativeBind, this, [receiver]);
      return (input) => {
        invoke(input);
        return original(input);
      };
    });
    const encoder = vi.fn(() => "must-not-be-used");
    let publish;
    try {
      Object.defineProperty(method, "bind", {
        configurable: true,
        value: bind,
      });
      publish = captureArtifactStoreTypedIndexPublisher(store, method, encoder);
    } finally {
      if (previous) Object.defineProperty(method, "bind", previous);
      else delete method.bind;
    }
    // Restoring the method before invocation must not upgrade the captured
    // custom wrapper into an eligible default publication.
    const input = options({ z: 1, a: 2 });
    const result = publish(input);
    expect(bind).toHaveBeenCalledExactlyOnceWith(store);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(input);
    expect(encoder).not.toHaveBeenCalled();
    expect(fs.readFileSync(store._indexFile(), "utf8")).toBe(
      JSON.stringify(result.entry) + "\n",
    );
  });

  it("keeps inherited toJSON on the original serialization path", () => {
    const store = new ArtifactStore({ dir: root });
    const encoder = vi.fn(() => "must-not-be-used");
    const publish = captureArtifactStoreTypedIndexPublisher(
      store,
      store.publishDataOnce,
      encoder,
    );
    const previous = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "toJSON",
    );
    let result;
    try {
      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        value() {
          return this;
        },
      });
      result = publish(options({ z: 1, a: 2 }));
    } finally {
      if (previous) Object.defineProperty(Object.prototype, "toJSON", previous);
      else delete Object.prototype.toJSON;
    }
    expect(encoder).not.toHaveBeenCalled();
    expect(fs.readFileSync(store._indexFile(), "utf8")).toBe(
      JSON.stringify(result.entry) + "\n",
    );
  });

  it("clears the per-call opt-in when an internal formatter throws", () => {
    const store = new ArtifactStore({ dir: root });
    const input = options({ z: 1, a: 2 });
    const encoder = vi.fn(() => {
      throw new Error("format failure");
    });
    const publish = captureArtifactStoreTypedIndexPublisher(
      store,
      store.publishDataOnce,
      encoder,
    );
    expect(() => publish(input)).toThrow("format failure");
    const result = store.publishDataOnce(input);
    expect(encoder).toHaveBeenCalledOnce();
    expect(fs.readFileSync(store._indexFile(), "utf8")).toBe(
      JSON.stringify(result.entry) + "\n",
    );
  });

  it("keeps custom publications on the legacy path and never rewrites their old rows", () => {
    class CustomStore extends ArtifactStore {
      publishDataOnce(input) {
        return super.publishDataOnce(input);
      }
    }
    const legacy = openArtifactByteFixture(root, { Store: CustomStore });
    const bytes = fs.readFileSync(legacy.store._indexFile());
    expect(bytes.toString()).toBe(JSON.stringify(legacy.entry) + "\n");
    expect(Object.keys(legacy.entry)[0]).toBe("id");
    const fresh = openArtifactByteFixture(root, { value: { second: true } });
    const combined = fs.readFileSync(fresh.store._indexFile());
    expect(combined.subarray(0, bytes.length)).toEqual(bytes);
    const cache = loadActualIndexCache();
    cache.run({}, combined);
    expect(cache.state().entries[0].alias).toBe(false);
    expect(legacy.read()).toBeDefined();
    expect(fresh.read()).toBeDefined();
  });
});
