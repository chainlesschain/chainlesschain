import { createHash } from "node:crypto";

export function modelInputNodeDigest(value) {
  const canonical = (entry) =>
    entry === null || typeof entry !== "object"
      ? JSON.stringify(entry)
      : Array.isArray(entry)
        ? "[" + entry.map(canonical).join(",") + "]"
        : "{" +
          Object.keys(entry)
            .sort()
            .map((key) => JSON.stringify(key) + ":" + canonical(entry[key]))
            .join(",") +
          "}";
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function freezeModelInputMapping(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeModelInputMapping);
    Object.freeze(value);
  }
  return value;
}
const empty = (reason, sourceCount = 0, sourcesTruncated = false) =>
  freezeModelInputMapping({
    covered: false,
    reason,
    sourceCount,
    sourcesTruncated,
    sources: [],
  });
const valueAtSlot = (request, slot) =>
  request?.[slot.kind === "message" ? "messages" : "tools"]?.[slot.index];

/** Relations come from the planner's private capability and authenticated ingress. */
export function createLogicalSourceMapping({
  planning,
  plan,
  rows,
  before,
  after,
  receipt,
  projectionExpected = false,
}) {
  const missing = (reason) =>
    empty(reason, planning.sourceCount, planning.sourcesTruncated);
  if (planning.sourcesTruncated) return missing("mapping_limit");
  if (!rows || !before) return missing("planning_unbound");
  if (projectionExpected && !receipt?.sourceMapping)
    return missing("projection_unbound");
  const admission = receipt?.sourceMapping;
  if (admission) {
    if (
      admission.inputDigest !== modelInputNodeDigest(before) ||
      admission.outputDigest !== modelInputNodeDigest(after)
    )
      return missing("projection_unbound");
  } else if (modelInputNodeDigest(before) !== modelInputNodeDigest(after)) {
    return missing("projection_unbound");
  }
  const offset = Math.min(plan?.dropped?.length || 0, 512);
  let slotCount = 0;
  const sources = [];
  for (const source of planning.sources) {
    if (source.disposition === "excluded") {
      sources.push({
        ordinal: source.ordinal,
        input: [],
        logical: [],
        changed: null,
        redactionTouched: null,
        injectionTouched: null,
        derived: null,
      });
      continue;
    }
    const row = rows.find(
      (candidate) => candidate.selectedIndex === source.ordinal - offset,
    );
    if (!row || row.digest !== source.digest || row.kind !== source.kind)
      return missing("planning_unbound");
    const input = [],
      logical = [];
    let redactionTouched = admission ? false : null;
    let injectionTouched = admission ? false : null;
    for (const slot of row.slots) {
      if (++slotCount > 4096 || slot.index >= 4096)
        return missing("mapping_limit");
      const original = valueAtSlot(before, slot);
      const bound = admission?.slots.find(
        (entry) => entry.kind === slot.kind && entry.index === slot.index,
      );
      if (admission && !bound) return missing("projection_unbound");
      const target = {
        kind: slot.kind,
        index: bound?.logicalIndex ?? slot.index,
      };
      if (target.index >= 4096) return missing("mapping_limit");
      const projected = valueAtSlot(after, target);
      if (original === undefined || projected === undefined)
        return missing("projection_unbound");
      input.push({ ...slot, digest: modelInputNodeDigest(original) });
      logical.push({ ...target, digest: modelInputNodeDigest(projected) });
      if (bound) {
        redactionTouched ||= bound.redactionTouched;
        injectionTouched ||= bound.injectionTouched;
      }
    }
    sources.push({
      ordinal: source.ordinal,
      input,
      logical,
      changed: input.some((slot, i) => slot.digest !== logical[i].digest),
      redactionTouched,
      injectionTouched,
      derived: row.derived,
    });
  }
  return freezeModelInputMapping({
    covered: true,
    reason: "complete",
    sourceCount: planning.sourceCount,
    sourcesTruncated: planning.sourcesTruncated,
    sources,
  });
}

export function modelInputBodyRoots(body) {
  return Object.fromEntries(
    ["messages", "system", "input", "tools", "instructions"].map((key) => [
      key,
      Object.hasOwn(body, key) ? body[key] : null,
    ]),
  );
}
function fragmentValue(body, descriptor) {
  let value = body;
  for (const key of descriptor.path.slice(1).split("/")) value = value?.[key];
  if (descriptor.start !== null) {
    if (typeof value !== "string" || descriptor.end > value.length)
      return undefined;
    value = value.slice(descriptor.start, descriptor.end);
  }
  return value;
}
export function createBodySourceMapping(logical, protocol, body) {
  const missing = (reason) =>
    freezeModelInputMapping({
      ...empty(
        reason,
        logical?.sourceCount || 0,
        logical?.sourcesTruncated || false,
      ),
      protocol: protocol?.protocol || null,
    });
  if (!logical?.covered) return missing(logical?.reason || "planning_unbound");
  if (!protocol) return missing("protocol_unmapped");
  if (typeof body !== "string") return missing("body_unavailable");
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return missing("body_unavailable");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    modelInputNodeDigest(modelInputBodyRoots(parsed)) !== protocol.rootsDigest
  )
    return missing("body_mismatch");
  let fragmentCount = 0;
  const sources = [];
  for (const source of logical.sources) {
    const fragments = [];
    const seen = new Set();
    for (const slot of source.logical) {
      const descriptors = (
        slot.kind === "message" ? protocol.messages : protocol.tools
      )[slot.index];
      if (!Array.isArray(descriptors)) return missing("protocol_unmapped");
      for (const descriptor of descriptors) {
        const identity = JSON.stringify(descriptor);
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (++fragmentCount > 4096) return missing("mapping_limit");
        const value = fragmentValue(parsed, descriptor);
        if (value === undefined) return missing("body_mismatch");
        const encoded = JSON.stringify(value);
        fragments.push({
          ...descriptor,
          digest: modelInputNodeDigest(value),
          bytes: Buffer.byteLength(encoded, "utf8"),
        });
      }
    }
    sources.push({
      ordinal: source.ordinal,
      status:
        source.input.length === 0
          ? "excluded"
          : fragments.length
            ? "mapped"
            : "omitted",
      fragments,
    });
  }
  return freezeModelInputMapping({
    covered: true,
    reason: "complete",
    protocol: protocol.protocol,
    sourceCount: logical.sourceCount,
    sourcesTruncated: logical.sourcesTruncated,
    sources,
  });
}

const REASONS = new Set([
  "complete",
  "planning_unbound",
  "projection_unbound",
  "mapping_limit",
  "protocol_unmapped",
  "body_unavailable",
  "body_mismatch",
]);
const PROTOCOLS = new Set([
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
  "ollama-chat",
]);
export function projectSourceMapping(value, phase) {
  const check = (condition) => {
    if (!condition) throw new TypeError("Invalid model input source mapping");
  };
  const count = (v) => {
    check(Number.isSafeInteger(v) && v >= 0);
    return v;
  };
  const hash = (v) => {
    check(typeof v === "string" && /^[a-f0-9]{64}$/u.test(v));
    return v;
  };
  check(
    value && typeof value.covered === "boolean" && REASONS.has(value.reason),
  );
  check(value.covered === (value.reason === "complete"));
  check(
    typeof value.sourcesTruncated === "boolean" &&
      Array.isArray(value.sources) &&
      value.sources.length <= 512,
  );
  const sourceCount = count(value.sourceCount);
  check(
    sourceCount >= value.sources.length &&
      (value.covered || value.sources.length === 0),
  );
  if (value.covered)
    check(!value.sourcesTruncated && sourceCount === value.sources.length);
  if (phase === "body-prepared" && value.covered)
    check(PROTOCOLS.has(value.protocol));
  let total = 0;
  const slot = (entry) => {
    check(++total <= 8192 && ["message", "tool"].includes(entry.kind));
    const index = count(entry.index);
    check(index < 4096);
    return { kind: entry.kind, index, digest: hash(entry.digest) };
  };
  const sources = value.sources.map((source, index) => {
    check(source.ordinal === index);
    if (phase === "logical-input") {
      check(
        Array.isArray(source.input) &&
          Array.isArray(source.logical) &&
          source.input.length === source.logical.length,
      );
      for (const key of [
        "changed",
        "redactionTouched",
        "injectionTouched",
        "derived",
      ])
        check(source[key] === null || typeof source[key] === "boolean");
      return {
        ordinal: index,
        input: source.input.map(slot),
        logical: source.logical.map(slot),
        changed: source.changed,
        redactionTouched: source.redactionTouched,
        injectionTouched: source.injectionTouched,
        derived: source.derived,
      };
    }
    check(
      ["mapped", "excluded", "omitted"].includes(source.status) &&
        Array.isArray(source.fragments),
    );
    const fragments = source.fragments.map((fragment) => {
      check(
        ++total <= 4096 &&
          typeof fragment.path === "string" &&
          /^\/(?:messages\/\d+(?:\/content\/\d+)?|input\/\d+|tools\/\d+|system(?:\/0\/text)?)$/u.test(
            fragment.path,
          ) &&
          fragment.path.length <= 96,
      );
      check(
        (fragment.start === null && fragment.end === null) ||
          (Number.isSafeInteger(fragment.start) &&
            Number.isSafeInteger(fragment.end) &&
            fragment.start >= 0 &&
            fragment.end >= fragment.start),
      );
      return {
        path: fragment.path,
        start: fragment.start,
        end: fragment.end,
        digest: hash(fragment.digest),
        bytes: count(fragment.bytes),
      };
    });
    check(
      source.status === "mapped"
        ? fragments.length > 0
        : fragments.length === 0,
    );
    return { ordinal: index, status: source.status, fragments };
  });
  return {
    covered: value.covered,
    reason: value.reason,
    sourceCount,
    sourcesTruncated: value.sourcesTruncated,
    sources,
    ...(phase === "body-prepared"
      ? {
          protocol:
            (check(value.protocol === null || PROTOCOLS.has(value.protocol)),
            value.protocol),
        }
      : {}),
  };
}
