/**
 * Bidirectional capability negotiation with N / N-1 downgrade for Agent
 * Protocol (agent-sdk docs/PROTOCOL.md §1.3).
 *
 * The CLI advertises what it can speak one-directionally (buildAgentCapabilities
 * → `cc agent --capabilities`, and the `system/init` line's protocol_version).
 * That is not negotiation: a client (VS Code / JetBrains panel) had no way to
 * announce what IT understands, and the CLI had no rule to pick a common level
 * or step DOWN when the two disagree. When the protocol later grows a v2 line
 * shape, a v1-only client would silently mis-parse it.
 *
 * This module is the missing algorithm. A client MAY send a `hello` as its
 * first stream-json input line:
 *   {"type":"hello","protocol_version":2,"min_protocol_version":1,
 *    "features":["event_seq","trace_id"]}
 * The CLI negotiates it against its own offer and echoes the agreed level as a
 * `system/negotiated` line, then honors it for the rest of the run.
 *
 * Rules:
 *   - agreedVersion = min(server.max, client.max)  — never above what either
 *     can parse.
 *   - Incompatible when agreedVersion < max(server.min, client.min): the two
 *     version ranges don't overlap. ok:false — the caller keeps a safe baseline
 *     or errors out; it never speaks a version the peer can't read.
 *   - effective features = the server-offered features the client also accepts
 *     (intersection), minus any whose minimum protocol version is above the
 *     agreed version (an N-only field is dropped for an N-1 session).
 *   - No client offer at all → legacy client that predates negotiation. The
 *     additive fields are defined "consumers MUST tolerate absence AND
 *     presence" (docs/PROTOCOL.md §1.2.1), so we keep FULL behavior unchanged
 *     (byte-for-byte) and mark clientAware:false. Negotiation only ever
 *     RESTRICTS when a client explicitly narrows the set.
 *
 * Pure: no fs / process / clock. The same algorithm is mirrored in the Java
 * twin (jetbrains-plugin CapabilityNegotiation.java); both read the shared
 * fixture __tests__/fixtures/capability-negotiation-cases.json.
 */

/** The current protocol version the CLI speaks (mirror of PROTOCOL_VERSION). */
export const PROTOCOL_VERSION = 1;

/**
 * The oldest protocol version the CLI can still speak end-to-end (the N-1 in
 * "N / N-1"). At v1 there is no older line shape, so min === current; once v2
 * ships this drops to 1 so a v1-only client negotiates a v1 session.
 */
export const PROTOCOL_MIN_VERSION = 1;

/**
 * The wire-protocol features subject to negotiation — the additive per-line
 * fields a client may or may not understand. Runtime capabilities (bare,
 * worktree, mcp, …) are NOT negotiated: they change what the CLI can do, not
 * the shape of a line the client must parse.
 */
export const PROTOCOL_FEATURES = ["event_seq", "tool_use_id", "trace_id"];

/**
 * Minimum protocol version a feature requires. Empty today (every current
 * feature is a v1 additive field). When a v2 field lands, add it here so an
 * N-1 (v1) session drops it automatically.
 * @type {Record<string, number>}
 */
export const FEATURE_MIN_VERSION = {};

function intOr(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * Coerce a features declaration into a sorted, de-duplicated array of keys.
 * Accepts an array of strings, or an object whose truthy keys are the features
 * (the nested manifest shape). Anything else → [].
 * @returns {string[]}
 */
export function normalizeFeatureList(input) {
  let keys;
  if (Array.isArray(input)) {
    keys = input.filter((k) => typeof k === "string" && k);
  } else if (input && typeof input === "object") {
    keys = Object.keys(input).filter((k) => input[k]);
  } else {
    return [];
  }
  return [...new Set(keys)].sort();
}

/**
 * Extract the server's negotiation offer from a `cc agent --capabilities`
 * manifest (buildAgentCapabilities output). Only the negotiable wire features
 * the manifest advertises truthy are offered.
 * @param {object} manifest
 * @returns {{protocolVersion:number, minProtocolVersion:number, features:string[]}}
 */
export function buildServerOffer(manifest = {}) {
  const protocolVersion = intOr(manifest.protocol_version, PROTOCOL_VERSION);
  const minProtocolVersion = intOr(
    manifest.min_protocol_version,
    Math.min(PROTOCOL_MIN_VERSION, protocolVersion),
  );
  const advertised = normalizeFeatureList(manifest.features);
  const features = PROTOCOL_FEATURES.filter((f) => advertised.includes(f));
  return { protocolVersion, minProtocolVersion, features };
}

/**
 * Negotiate the effective protocol version + feature set between a server offer
 * and a client offer.
 *
 * @param {{protocolVersion:number, minProtocolVersion?:number, features:string[]}} server
 * @param {null|{protocolVersion?:number, minProtocolVersion?:number, features?:string[]}} clientOffer
 * @param {object} [opts]
 * @param {Record<string,number>} [opts.featureMinVersion=FEATURE_MIN_VERSION]
 * @returns {{
 *   ok:boolean, agreedVersion:(number|null), features:string[],
 *   downgraded:boolean, disabledFeatures:string[], clientAware:boolean,
 *   reason:(string|null)
 * }}
 */
export function negotiateProtocol(server = {}, clientOffer = null, opts = {}) {
  const featureMinVersion = opts.featureMinVersion || FEATURE_MIN_VERSION;
  const serverMax = intOr(server.protocolVersion, PROTOCOL_VERSION);
  const serverMin = intOr(server.minProtocolVersion, serverMax);
  const serverFeatures = normalizeFeatureList(server.features);

  const versionOk = (f, v) => (featureMinVersion[f] || 0) <= v;

  // No client offer → legacy peer. Keep full behavior (only version-gate the
  // server's own features against its own max), byte-for-byte unchanged.
  if (clientOffer == null) {
    return {
      ok: true,
      agreedVersion: serverMax,
      features: serverFeatures.filter((f) => versionOk(f, serverMax)),
      downgraded: false,
      disabledFeatures: [],
      clientAware: false,
      reason: null,
    };
  }

  const clientMax = intOr(clientOffer.protocolVersion, serverMax);
  const clientMin = intOr(clientOffer.minProtocolVersion, clientMax);
  const agreedVersion = Math.min(serverMax, clientMax);
  const floor = Math.max(serverMin, clientMin);

  if (agreedVersion < floor) {
    return {
      ok: false,
      agreedVersion: null,
      features: [],
      downgraded: true,
      disabledFeatures: [...serverFeatures].sort(),
      clientAware: true,
      reason:
        `no common protocol version (server ${serverMin}-${serverMax}, ` +
        `client ${clientMin}-${clientMax})`,
    };
  }

  // A client that omits `features` accepts whatever the agreed version offers;
  // a client that sends the array narrows to the intersection.
  const clientFeatures =
    clientOffer.features === undefined
      ? null
      : new Set(normalizeFeatureList(clientOffer.features));

  const enabled = [];
  const disabled = [];
  for (const f of serverFeatures) {
    const okVersion = versionOk(f, agreedVersion);
    const okClient = clientFeatures == null || clientFeatures.has(f);
    if (okVersion && okClient) enabled.push(f);
    else disabled.push(f);
  }

  return {
    ok: true,
    agreedVersion,
    features: enabled.sort(),
    downgraded: agreedVersion < serverMax || disabled.length > 0,
    disabledFeatures: disabled.sort(),
    clientAware: true,
    reason: null,
  };
}

/** Feature key → the stream line field it gates. */
const FEATURE_TO_FIELD = {
  event_seq: "seq",
  trace_id: "trace_id",
  tool_use_id: "tool_use_id",
};

/**
 * Fold a negotiation result into a live field-gate the emitter reads per line:
 * a field stays stamped only if its feature survived negotiation. On an
 * incompatible (ok:false) result nothing is changed (the caller keeps its safe
 * baseline). Mutates `gate` in place and returns it.
 *
 * @param {{features:string[], ok:boolean}} result
 * @param {{seq?:boolean, trace_id?:boolean, tool_use_id?:boolean}} gate
 */
export function applyNegotiationToGate(result, gate = {}) {
  if (!result || result.ok === false) return gate;
  const enabled = new Set(result.features || []);
  for (const feature of PROTOCOL_FEATURES) {
    const field = FEATURE_TO_FIELD[feature];
    if (field) gate[field] = enabled.has(feature);
  }
  return gate;
}
