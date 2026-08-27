import path from "node:path";
import {
  defaultRolloutStoreDirectory,
  JsonlRolloutStore,
} from "../app-server/rollout-store.js";
import { GraphCutoverLedger } from "./cutover-ledger.js";
import {
  graphRuntimeEntryManifestDigest,
  graphRuntimeSurfaceEntry,
  loadGraphRuntimeSurfaceManifest,
} from "./runtime-surface-manifest.js";

const AUTHORITY_MODES = new Set(["legacy", "shadow", "canonical"]);

function resolverError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "GraphCutoverAuthorityResolverError";
  error.code = code;
  Object.assign(error, details);
  return error;
}

function authorityMode(value, field = "fallbackMode") {
  const mode = String(value || "")
    .trim()
    .toLowerCase();
  if (!AUTHORITY_MODES.has(mode)) {
    throw resolverError(
      "CC_GRAPH_AUTHORITY_MODE_INVALID",
      `${field} must be legacy, shadow, or canonical`,
      { field, value },
    );
  }
  return mode;
}

function missingLedger(error) {
  return ["CC_GRAPH_CUTOVER_NOT_FOUND", "CC_ROLLOUT_THREAD_NOT_FOUND"].includes(
    error?.code,
  );
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export class GraphCutoverAuthorityResolver {
  constructor({
    surface,
    entryId,
    ledger = new GraphCutoverLedger(),
    manifest = loadGraphRuntimeSurfaceManifest(),
    fallbackMode = undefined,
  } = {}) {
    const declared = graphRuntimeSurfaceEntry(manifest, surface, entryId);
    this.surface = declared.surface.originSurface;
    this.entryId = declared.entry.id;
    this.entry = declared.entry;
    this.manifest = manifest;
    this.manifestDigest = graphRuntimeEntryManifestDigest(
      manifest,
      this.surface,
      this.entryId,
    );
    this.stores = [...declared.entry.stores].sort();
    this.ledger = ledger;
    this.fallbackMode =
      fallbackMode === undefined
        ? declared.surface.featureFlag.default === "disabled"
          ? "legacy"
          : authorityMode(declared.surface.featureFlag.default)
        : authorityMode(fallbackMode);
  }

  _recover() {
    let state;
    try {
      state = this.ledger.recover(this.surface, this.entryId);
    } catch (error) {
      if (missingLedger(error)) return null;
      throw error;
    }
    if (state.manifestDigest !== this.manifestDigest) {
      throw resolverError(
        "CC_GRAPH_CUTOVER_MANIFEST_CONFLICT",
        "cutover authority is bound to a stale runtime entry manifest",
        {
          expectedManifestDigest: this.manifestDigest,
          actualManifestDigest: state.manifestDigest,
        },
      );
    }
    if (JSON.stringify(state.stores) !== JSON.stringify(this.stores)) {
      throw resolverError(
        "CC_GRAPH_CUTOVER_STORE_INVENTORY_CONFLICT",
        "cutover authority is bound to a stale store inventory",
        { expectedStores: this.stores, actualStores: state.stores },
      );
    }
    return state;
  }

  begin() {
    return this.ledger.begin({
      surface: this.surface,
      entryId: this.entryId,
      manifestDigest: this.manifestDigest,
      stores: this.stores,
    });
  }

  resolve({ runKey, optIn = false, fallbackMode = undefined } = {}) {
    const state = this._recover();
    if (!state) {
      const mode =
        fallbackMode === undefined
          ? this.fallbackMode
          : authorityMode(fallbackMode);
      return Object.freeze({
        surface: this.surface,
        entryId: this.entryId,
        mode,
        stage: null,
        source: "feature_flag_fallback",
        eventHead: null,
        manifestDigest: this.manifestDigest,
      });
    }
    if (
      state.stage === "canary" &&
      state.optInOnly !== true &&
      (runKey == null || String(runKey).trim() === "")
    ) {
      throw resolverError(
        "CC_GRAPH_CUTOVER_RUN_KEY_REQUIRED",
        "percentage canary authority requires a stable per-run key",
        { surface: this.surface, entryId: this.entryId },
      );
    }
    const mode = this.ledger.authorityMode(this.surface, this.entryId, {
      runKey,
      optIn,
    });
    return Object.freeze({
      surface: this.surface,
      entryId: this.entryId,
      mode,
      stage: state.stage,
      source: "cutover_ledger",
      eventHead: state.eventHead,
      manifestDigest: state.manifestDigest,
      canaryPercent: state.canaryPercent,
      optInOnly: state.optInOnly,
    });
  }

  status() {
    const state = this._recover();
    return state ? Object.freeze(clone(state)) : null;
  }
}

export function createGraphCutoverAuthorityResolver(options) {
  return new GraphCutoverAuthorityResolver(options);
}

export function createRuntimeGraphCutoverAuthorityResolver({
  env = process.env,
  stateDirectory = undefined,
  ledger = undefined,
  ...options
} = {}) {
  const resolvedLedger =
    ledger ||
    new GraphCutoverLedger({
      store: new JsonlRolloutStore({
        directory: path.resolve(
          stateDirectory ||
            env.CHAINLESSCHAIN_GRAPH_CUTOVER_STATE_DIR ||
            defaultRolloutStoreDirectory(),
        ),
      }),
    });
  return new GraphCutoverAuthorityResolver({
    ...options,
    ledger: resolvedLedger,
  });
}
