import { readFileSync } from "node:fs";
import vm from "node:vm";
import { resolve } from "node:path";

import { Window } from "happy-dom";
import { describe, expect, it, vi } from "vitest";

const contentSource = readFileSync(
  resolve(process.cwd(), "src/main/remote/browser-extension/content.js"),
  "utf8",
);

function loadContent(initialAnnotations = [], options = {}) {
  const page = new Window({ url: "https://example.test/page" });
  page.document.body.innerHTML = '<main id="target">select me</main>';
  const mutationObservers = [];
  let messageListener;

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      mutationObservers.push(this);
    }

    observe(target, options) {
      this.target = target;
      this.options = options;
    }

    disconnect() {
      this.disconnected = true;
    }

    trigger(mutations) {
      this.callback(mutations);
    }
  }

  const storageSet = vi.fn();
  const chrome = {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener) => {
          messageListener = listener;
        }),
      },
      sendMessage: vi.fn(),
    },
    storage: {
      local: {
        get: vi.fn((_keys, callback) => {
          callback({ annotations: initialAnnotations });
        }),
        set: storageSet,
      },
    },
  };
  const context = vm.createContext({
    window: page,
    document: page.document,
    chrome,
    MutationObserver: FakeMutationObserver,
    TextEncoder,
    Node: page.Node,
    console: {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
    setTimeout: options.setTimeout || setTimeout,
    clearTimeout,
  });
  vm.runInContext(contentSource, context, { filename: "content.js" });

  const send = (message) =>
    new Promise((resolveResponse) => {
      messageListener(message, {}, resolveResponse);
    });

  return { chrome, mutationObservers, page, send, storageSet };
}

function mutation(index, oldValue = "old") {
  return {
    type: "attributes",
    target: { tagName: `DIV-${index}` },
    addedNodes: { length: index },
    removedNodes: { length: 0 },
    attributeName: "data-value",
    oldValue,
  };
}

function annotation(index, overrides = {}) {
  return {
    id: `annotation-${index}`,
    type: "note",
    text: `text-${index}`,
    note: `note-${index}`,
    color: "#fff",
    url: "https://example.test/page",
    selector: "",
    xpath: "",
    tags: [],
    createdAt: new Date(index).toISOString(),
    position: null,
    ...overrides,
  };
}

describe("content script mutation observer bounds", () => {
  it("bounds mutation batches and releases the observer plus timeout", async () => {
    const { mutationObservers, page, send } = loadContent();
    const response = send({
      type: "observeMutations",
      id: "bounded",
      selector: "#target",
      options: { maxMutations: 2, timeout: 60_000 },
    });

    mutationObservers[0].trigger([
      mutation(1, "x".repeat(3000)),
      mutation(2),
      mutation(3),
    ]);
    await expect(response).resolves.toMatchObject({
      accepted: true,
      count: 2,
      droppedMutations: 1,
      limit: { maxMutations: 2 },
    });
    expect(mutationObservers[0].disconnected).toBe(true);
    expect((await response).mutations[0].oldValue.length).toBe(2048);
    page.close();
  });

  it("rejects duplicate IDs and counts anonymous observers toward capacity", async () => {
    const duplicate = loadContent();
    const original = duplicate.send({
      type: "observeMutations",
      id: "same",
      options: { timeout: 60_000 },
    });
    await expect(
      duplicate.send({
        type: "observeMutations",
        id: "same",
        options: { timeout: 60_000 },
      }),
    ).resolves.toMatchObject({ accepted: false, code: "CONFLICT" });
    duplicate.page.dispatchEvent(new duplicate.page.Event("pagehide"));
    await expect(original).resolves.toMatchObject({ code: "CANCELED" });
    duplicate.page.close();

    const bounded = loadContent();
    const pending = [];
    for (let index = 0; index < 16; index += 1) {
      pending.push(
        bounded.send({
          type: "observeMutations",
          options: { timeout: 60_000 },
        }),
      );
    }
    await expect(
      bounded.send({
        type: "observeMutations",
        options: { timeout: 60_000 },
      }),
    ).resolves.toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "mutation_observers",
    });
    bounded.page.dispatchEvent(new bounded.page.Event("pagehide"));
    const canceled = await Promise.all(pending);
    expect(canceled).toHaveLength(16);
    expect(canceled.every((result) => result.code === "CANCELED")).toBe(true);
    bounded.page.close();
  });

  it("clamps timeouts and rejects overlong selectors and observer IDs", async () => {
    const { page, send } = loadContent();
    await expect(
      send({
        type: "observeMutations",
        selector: "x".repeat(4097),
      }),
    ).resolves.toMatchObject({ accepted: false, code: "INVALID_ARGUMENT" });
    await expect(
      send({
        type: "observeMutations",
        id: "x".repeat(257),
      }),
    ).resolves.toMatchObject({ accepted: false, code: "INVALID_ARGUMENT" });
    await expect(
      send({ type: "observeMutations", options: { timeout: 1 } }),
    ).resolves.toMatchObject({
      accepted: true,
      timedOut: true,
      limit: { maxTimeoutMs: 1 },
    });
    page.close();
  });
});

describe("content script annotation bounds", () => {
  it("keeps the newest 500 stored annotations and reports dropped entries", async () => {
    const initial = Array.from({ length: 505 }, (_, index) =>
      annotation(index),
    );
    initial[504] = annotation(504, {
      note: "n".repeat(10_000),
      tags: Array.from({ length: 30 }, () => "t".repeat(200)),
    });
    const { page, send } = loadContent(initial);

    const result = await send({ type: "getAnnotations" });
    expect(result.total).toBe(500);
    expect(result.droppedAnnotations).toBe(5);
    expect(result.annotations[0].id).toBe("annotation-5");
    expect(result.annotations.at(-1).note).toHaveLength(8192);
    expect(result.annotations.at(-1).tags).toHaveLength(20);
    expect(result.annotations.at(-1).tags[0]).toHaveLength(128);
    expect(result.retainedBytes).toBeLessThanOrEqual(2 * 1024 * 1024);

    result.annotations[0].text = "mutated";
    expect((await send({ type: "getAnnotations" })).annotations[0].text).toBe(
      "text-5",
    );
    await expect(
      send({ type: "addAnnotation", options: { text: "overflow" } }),
    ).resolves.toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "annotations",
    });
    page.close();
  });

  it("does not mutate the DOM when highlight admission is full", async () => {
    const initial = Array.from({ length: 500 }, (_, index) =>
      annotation(index),
    );
    const { page, send } = loadContent(initial);
    const target = page.document.getElementById("target");
    const range = page.document.createRange();
    range.selectNodeContents(target);
    page.getSelection().removeAllRanges();
    page.getSelection().addRange(range);

    await expect(
      send({ type: "highlightSelection", options: {} }),
    ).resolves.toMatchObject({
      accepted: false,
      code: "OVERLOADED",
      scope: "annotations",
    });
    expect(page.document.querySelector("mark")).toBeNull();
    expect(target.textContent).toBe("select me");
    page.close();
  });

  it("normalizes new annotations, persists snapshots, and removes safely", async () => {
    const { page, send, storageSet } = loadContent();
    const added = await send({
      type: "addAnnotation",
      options: {
        text: "text",
        note: "n".repeat(10_000),
        tags: Array.from({ length: 30 }, () => "t".repeat(200)),
      },
    });
    expect(added).toMatchObject({ success: true });
    expect(added.annotation.note).toHaveLength(8192);
    expect(added.annotation.tags).toHaveLength(20);
    expect(storageSet).toHaveBeenCalledTimes(1);

    const persisted = storageSet.mock.calls[0][0].annotations;
    persisted[0].text = "external mutation";
    expect((await send({ type: "getAnnotations" })).annotations[0].text).toBe(
      "text",
    );

    await expect(
      send({
        type: "addAnnotation",
        options: { selector: "x".repeat(2049) },
      }),
    ).resolves.toMatchObject({ accepted: false, code: "INVALID_ARGUMENT" });
    await expect(
      send({ type: "removeAnnotation", annotationId: added.annotation.id }),
    ).resolves.toEqual({ success: true });
    expect((await send({ type: "getAnnotations" })).total).toBe(0);
    page.close();
  });
});

describe("content script screenshot planning bounds", () => {
  it("caps full-page capture positions and rejects zero-step loops", async () => {
    const immediateTimeout = (callback) => {
      callback();
      return 1;
    };
    const { page, send } = loadContent([], { setTimeout: immediateTimeout });
    Object.defineProperty(page.document.documentElement, "scrollHeight", {
      configurable: true,
      value: 1000,
    });

    const result = await send({
      type: "scrollForFullPage",
      options: { step: 1, delay: 0, maxCaptures: Number.MAX_SAFE_INTEGER },
    });
    expect(result.positions).toHaveLength(100);
    expect(result).toMatchObject({
      totalCaptures: 100,
      droppedCaptures: 900,
      truncated: true,
      limit: { maxCaptures: 100 },
    });
    page.close();
  });
});
