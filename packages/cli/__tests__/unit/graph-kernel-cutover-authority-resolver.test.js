import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonlRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { GraphCutoverAuthorityResolver } from "../../src/lib/graph-kernel/cutover-authority-resolver.js";
import { GraphCutoverLedger } from "../../src/lib/graph-kernel/cutover-ledger.js";
import {
  graphRuntimeEntryManifestDigest,
  loadGraphRuntimeSurfaceManifest,
} from "../../src/lib/graph-kernel/runtime-surface-manifest.js";

const DIGEST = (character) => `sha256:${character.repeat(64)}`;
const roots = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-graph-cutover-authority-"),
  );
  roots.push(root);
  const manifest = loadGraphRuntimeSurfaceManifest();
  const store = new JsonlRolloutStore({ directory: root });
  const ledger = new GraphCutoverLedger({ store });
  const resolver = new GraphCutoverAuthorityResolver({
    surface: "cowork",
    entryId: "cli-cowork",
    ledger,
    manifest,
  });
  return { root, manifest, store, ledger, resolver };
}

describe("GraphCutoverAuthorityResolver", () => {
  it("uses the declared feature flag only until the entry ledger exists", () => {
    const { resolver } = fixture();
    expect(resolver.resolve()).toMatchObject({
      mode: "legacy",
      stage: null,
      source: "feature_flag_fallback",
    });
    const initialized = resolver.begin();
    expect(initialized.manifestDigest).toBe(resolver.manifestDigest);
    expect(resolver.resolve({ fallbackMode: "canonical" })).toMatchObject({
      mode: "legacy",
      stage: "legacy",
      source: "cutover_ledger",
      eventHead: initialized.eventHead,
    });
  });

  it("makes the durable entry stage authoritative over process flags", () => {
    const { resolver, ledger } = fixture();
    let state = resolver.begin();
    state = ledger.transition("cowork", "cli-cowork", "shadow", {
      inventoryDigest: resolver.manifestDigest,
      unknownWriterCount: 0,
      shadowEffectInvocationCount: 0,
    });
    expect(
      resolver.resolve({ runKey: "run-1", fallbackMode: "canonical" }),
    ).toMatchObject({
      mode: "shadow",
      stage: "shadow",
      eventHead: state.eventHead,
    });
  });

  it("requires stable run identity for percentage canary selection", () => {
    const { resolver, ledger } = fixture();
    resolver.begin();
    ledger.transition("cowork", "cli-cowork", "shadow", {
      inventoryDigest: resolver.manifestDigest,
      unknownWriterCount: 0,
      shadowEffectInvocationCount: 0,
    });
    ledger.transition("cowork", "cli-cowork", "canary", {
      shadowReportDigest: DIGEST("a"),
      shadowRunCount: 20,
      divergenceCount: 0,
      unknownEffectCount: 0,
      shadowEffectInvocationCount: 0,
      canaryPercent: 25,
      optInOnly: false,
    });
    expect(() => resolver.resolve()).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_CUTOVER_RUN_KEY_REQUIRED" }),
    );
    const first = resolver.resolve({ runKey: "stable-run" });
    const second = resolver.resolve({ runKey: "stable-run" });
    expect(second.mode).toBe(first.mode);
    expect(["shadow", "canonical"]).toContain(first.mode);
  });

  it("supports opt-in canary without silently enrolling other runs", () => {
    const { resolver, ledger } = fixture();
    resolver.begin();
    ledger.transition("cowork", "cli-cowork", "shadow", {
      inventoryDigest: resolver.manifestDigest,
      unknownWriterCount: 0,
      shadowEffectInvocationCount: 0,
    });
    ledger.transition("cowork", "cli-cowork", "canary", {
      shadowReportDigest: DIGEST("b"),
      shadowRunCount: 5,
      divergenceCount: 0,
      unknownEffectCount: 0,
      shadowEffectInvocationCount: 0,
      canaryPercent: 1,
      optInOnly: true,
    });
    expect(resolver.resolve().mode).toBe("shadow");
    expect(resolver.resolve({ optIn: true }).mode).toBe("canonical");
  });

  it("fails closed when durable authority is bound to a stale manifest", () => {
    const { manifest, store, resolver } = fixture();
    const staleLedger = new GraphCutoverLedger({ store });
    staleLedger.begin({
      surface: "scheduler",
      entryId: "cli-scheduler",
      manifestDigest: DIGEST("c"),
      stores: ["SchedulerKernelStore", "SchedulerGraphDispatchJournal"],
    });
    const staleResolver = new GraphCutoverAuthorityResolver({
      surface: "scheduler",
      entryId: "cli-scheduler",
      ledger: staleLedger,
      manifest,
    });
    expect(() =>
      staleResolver.resolve({ runKey: "occurrence-1" }),
    ).toThrowError(
      expect.objectContaining({ code: "CC_GRAPH_CUTOVER_MANIFEST_CONFLICT" }),
    );
    expect(
      graphRuntimeEntryManifestDigest(manifest, "cowork", "cli-cowork"),
    ).toBe(resolver.manifestDigest);
  });

  it("recovers the exact stage through a fresh JSONL store instance", () => {
    const { root, manifest, resolver, ledger } = fixture();
    resolver.begin();
    ledger.transition("cowork", "cli-cowork", "shadow", {
      inventoryDigest: resolver.manifestDigest,
      unknownWriterCount: 0,
      shadowEffectInvocationCount: 0,
    });
    const recovered = new GraphCutoverAuthorityResolver({
      surface: "cowork",
      entryId: "cli-cowork",
      manifest,
      ledger: new GraphCutoverLedger({
        store: new JsonlRolloutStore({ directory: root }),
      }),
    });
    expect(recovered.resolve({ runKey: "fresh-process" })).toMatchObject({
      mode: "shadow",
      stage: "shadow",
      source: "cutover_ledger",
    });
  });

  it("separates staged retirement from disabled non-durable entries", () => {
    const { manifest } = fixture();
    const store = new JsonlRolloutStore({
      directory: fs.mkdtempSync(
        path.join(os.tmpdir(), "cc-graph-cutover-strategies-"),
      ),
    });
    roots.push(store.directory);
    const ledger = new GraphCutoverLedger({ store });
    const retirement = new GraphCutoverAuthorityResolver({
      surface: "desktop",
      entryId: "desktop-legacy-workflow",
      manifest,
      ledger,
    });
    expect(retirement.writerStores).toEqual(["WorkflowEngine.executions"]);
    expect(retirement.stores).toEqual([]);
    expect(retirement.begin()).toMatchObject({
      cutoverStrategy: "retire",
      stores: [],
    });

    const disabled = new GraphCutoverAuthorityResolver({
      surface: "browser",
      entryId: "browser-workflow",
      manifest,
      ledger,
      fallbackMode: "canonical",
    });
    expect(disabled.resolve({ optIn: true })).toMatchObject({
      mode: "legacy",
      source: "disabled_manifest",
      cutoverStrategy: "disabled",
    });
    expect(disabled.begin()).toMatchObject({
      cutoverStrategy: "disabled",
      stores: [],
    });
    expect(disabled.resolve({ optIn: true })).toMatchObject({
      mode: "legacy",
      stage: "legacy",
      source: "disabled_manifest",
    });
  });
});
