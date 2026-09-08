import path from "node:path";
import { ensurePrivateDirectory } from "../secure-fs.js";

export const EVOLUTION_SEGMENTED_WITNESS_SCHEMA =
  "chainlesschain.evolution-file-witness-store/v2";
const SEGMENT_SCHEMA = "chainlesschain.evolution-file-witness-segment/v1";
export const EVOLUTION_WITNESS_SEGMENT_RECORDS = 256;
const MAX_RECORDS = 262_144;
const MAX_SEGMENTS = MAX_RECORDS / EVOLUTION_WITNESS_SEGMENT_RECORDS;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HEAD_KEYS = new Set([
  "schema",
  "current",
  "segments",
  "history",
  "discardedAnchors",
]);
const SEGMENT_KEYS = new Set(["schema", "history", "discardedAnchors"]);

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.size ||
    Object.keys(value).some((key) => !keys.has(key))
  ) {
    throw new Error(`${label} fields are invalid`);
  }
}

function matchesDiscard(entry, snapshot) {
  return (
    snapshot &&
    (entry.anchorDigest === snapshot.anchorDigest ||
      entry.headDigest === snapshot.headDigest ||
      entry.segmentDigest === snapshot.segmentDigest)
  );
}

/** Internal storage adapter. Record signatures and trust policy stay with the witness. */
export function createEvolutionWitnessSegments({
  filePath,
  fsImpl,
  readBytes,
  writeBytes,
  confirmDurable,
  validateStore,
  legacySchema,
  canonical,
  hash,
  encodeRecord,
  maximumHistoryBytes,
}) {
  const segmentDirectory = `${filePath}.segments-v2`;
  const secureOptions = { deps: { fs: fsImpl }, failIfUnavailable: true };
  const metadata = new WeakMap();
  const cache = new Map();
  let cacheBytes = 0;

  const segmentPath = (digest) => {
    if (!DIGEST.test(digest || ""))
      throw new Error("witness segment digest is invalid");
    return path.join(segmentDirectory, `${digest.slice(7)}.json`);
  };

  const assertDirectory = () => {
    ensurePrivateDirectory(segmentDirectory, secureOptions);
    const observed = fsImpl.lstatSync(segmentDirectory);
    if (!observed.isDirectory() || observed.isSymbolicLink()) {
      throw new Error("witness segment directory is invalid");
    }
  };

  const validateSegment = (segment, previous, trustEpoch) => {
    exact(segment, SEGMENT_KEYS, "witness segment");
    if (
      segment.schema !== SEGMENT_SCHEMA ||
      !Array.isArray(segment.history) ||
      segment.history.length !== EVOLUTION_WITNESS_SEGMENT_RECORDS
    ) {
      throw new Error("witness segment length or schema is invalid");
    }
    validateStore(
      {
        schema: legacySchema,
        current: segment.history.at(-1),
        history: segment.history,
        discardedAnchors: segment.discardedAnchors,
      },
      trustEpoch,
      previous,
    );
    return segment;
  };

  const observe = (records, discardedAnchors, observations) => {
    for (const query of observations.discards) {
      if (
        discardedAnchors.some((entry) => matchesDiscard(entry, query.snapshot))
      ) {
        query.matched = true;
      }
    }
    for (const query of observations.records) {
      const firstGeneration = records[0].generation;
      const index = query.checkpoint.generation - firstGeneration;
      if (Number.isSafeInteger(index) && index >= 0 && index < records.length) {
        const record = records[index];
        if (record.witnessDigest === query.checkpoint.witnessDigest)
          query.record = record;
      }
    }
  };

  const remember = (digest, segment, trustEpoch) => {
    if (trustEpoch === null) return;
    // A cached decision belongs only to bytes rehashed on this read and a
    // current verifier epoch. Copy through a small encoding so no parser
    // substring can retain a whole source segment.
    const encoded = canonical({
      first: segment.history[0],
      last: segment.history.at(-1),
      discardedAnchors: segment.discardedAnchors,
    });
    const bytes = 6 * encoded.length;
    const existing = cache.get(digest);
    if (existing) cacheBytes -= existing.bytes;
    cache.delete(digest);
    if (cache.size >= MAX_SEGMENTS || cacheBytes + bytes > MAX_CACHE_BYTES)
      return;
    cache.set(digest, { ...JSON.parse(encoded), trustEpoch, bytes });
    cacheBytes += bytes;
  };

  const load = (head, trustEpoch, options = {}) => {
    exact(head, HEAD_KEYS, "segmented witness store");
    if (
      head.schema !== EVOLUTION_SEGMENTED_WITNESS_SCHEMA ||
      !Array.isArray(head.segments) ||
      head.segments.length < 1 ||
      head.segments.length >= MAX_SEGMENTS ||
      !Array.isArray(head.history) ||
      head.history.length < 1 ||
      head.history.length > EVOLUTION_WITNESS_SEGMENT_RECORDS ||
      head.segments.length * EVOLUTION_WITNESS_SEGMENT_RECORDS +
        head.history.length >
        MAX_RECORDS
    ) {
      throw new Error("segmented witness store capacity or schema is invalid");
    }
    assertDirectory();
    const seen = new Set();
    const observations = {
      discards: (options.discards || [])
        .filter(Boolean)
        .map((snapshot) => ({ snapshot, matched: false })),
      records: (options.records || []).map((checkpoint) => ({
        checkpoint,
        record: null,
      })),
    };
    let previous = null;
    let storedBytes = options.headBytes;
    if (
      !Number.isSafeInteger(storedBytes) ||
      storedBytes < 1 ||
      storedBytes > maximumHistoryBytes
    ) {
      throw new Error("witness history exceeds its configured maximum size");
    }
    for (const digest of head.segments) {
      if (seen.has(digest)) throw new Error("witness segment is repeated");
      seen.add(digest);
      const bytes = readBytes(
        segmentPath(digest),
        maximumHistoryBytes - storedBytes,
      );
      storedBytes += bytes.length;
      if (hash(bytes) !== digest)
        throw new Error("witness segment bytes changed");
      const cached = cache.get(digest);
      const canReuse =
        cached && trustEpoch !== null && cached.trustEpoch === trustEpoch;
      const needsRecord = observations.records.some(
        ({ checkpoint }) =>
          canReuse &&
          checkpoint.generation >= cached.first.generation &&
          checkpoint.generation <= cached.last.generation,
      );
      if (canReuse) {
        if (
          (!previous && cached.first.generation !== 0) ||
          (previous &&
            (cached.first.generation !== previous.generation + 1 ||
              cached.first.previousWitnessDigest !== previous.witnessDigest))
        ) {
          throw new Error("witness segment history is not contiguous");
        }
        for (const query of observations.discards) {
          if (
            cached.discardedAnchors.some((entry) =>
              matchesDiscard(entry, query.snapshot),
            )
          ) {
            query.matched = true;
          }
        }
        if (needsRecord) {
          const parsed = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
          observe(parsed.history, parsed.discardedAnchors, observations);
        }
        previous = cached.last;
        continue;
      }
      const parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
      const segment = validateSegment(parsed, previous, trustEpoch);
      observe(segment.history, segment.discardedAnchors, observations);
      remember(digest, segment, trustEpoch);
      previous = segment.history.at(-1);
    }
    const store = validateStore(
      {
        schema: legacySchema,
        current: head.current,
        history: head.history,
        discardedAnchors: head.discardedAnchors,
      },
      trustEpoch,
      previous,
    );
    observe(store.history, store.discardedAnchors, observations);
    metadata.set(store, {
      segments: [...head.segments],
      observations,
      tailPreviousDiscardDigest: previous.discardAccumulatorDigest,
      segmentBytes: storedBytes - options.headBytes,
    });
    return store;
  };

  const publish = (store) => {
    const existing = metadata.get(store);
    const segments = [...(existing?.segments || [])];
    if (
      segments.length * EVOLUTION_WITNESS_SEGMENT_RECORDS +
        store.history.length >
      MAX_RECORDS
    ) {
      throw new Error("witness history exceeds its configured record capacity");
    }
    assertDirectory();
    let history = store.history;
    let discardedAnchors = store.discardedAnchors;
    let segmentBytes = existing?.segmentBytes ?? 0;
    let accumulator =
      existing?.tailPreviousDiscardDigest ??
      history[0].discardAccumulatorDigest;
    while (history.length > EVOLUTION_WITNESS_SEGMENT_RECORDS) {
      const records = history.slice(0, EVOLUTION_WITNESS_SEGMENT_RECORDS);
      let discardCount = 0;
      // The first record's predecessor may belong to the preceding segment.
      // The caller carries the exact predecessor accumulator when loading.
      for (const record of records) {
        if (record.discardAccumulatorDigest !== accumulator) discardCount++;
        accumulator = record.discardAccumulatorDigest;
      }
      const part = {
        schema: SEGMENT_SCHEMA,
        history: records,
        discardedAnchors: discardedAnchors.slice(0, discardCount),
      };
      const bytes = Buffer.from(`${canonical(part)}\n`, "utf8");
      segmentBytes += bytes.length;
      if (segmentBytes > maximumHistoryBytes) {
        throw new Error("witness history exceeds its configured maximum size");
      }
      const digest = hash(bytes);
      const destination = segmentPath(digest);
      if (fsImpl.existsSync(destination)) {
        if (!readBytes(destination).equals(bytes)) {
          throw new Error(
            "existing witness segment differs from its content address",
          );
        }
        // A previous process may have stopped after rename and before fsync of
        // the directory. Reuse requires that durability boundary again.
        confirmDurable(destination, bytes);
      } else {
        // The witness CAS lock serializes publication. Only complete, fsynced
        // bytes are renamed into this immutable content address before HEAD.
        writeBytes(destination, bytes);
      }
      segments.push(digest);
      history = history.slice(EVOLUTION_WITNESS_SEGMENT_RECORDS);
      discardedAnchors = discardedAnchors.slice(discardCount);
    }
    const encoded = `{"current":${encodeRecord(store.current)},"discardedAnchors":${canonical(discardedAnchors)},"history":[${history.map(encodeRecord).join(",")}],"schema":${JSON.stringify(EVOLUTION_SEGMENTED_WITNESS_SCHEMA)},"segments":${canonical(segments)}}`;
    const headBytes = Buffer.from(`${encoded}\n`, "utf8");
    if (segmentBytes + headBytes.length > maximumHistoryBytes) {
      throw new Error("witness history exceeds its configured maximum size");
    }
    writeBytes(filePath, headBytes);
    return store.current;
  };

  return {
    load,
    publish,
    handles: (store) =>
      metadata.has(store) ||
      store.history.length > EVOLUTION_WITNESS_SEGMENT_RECORDS,
    isSegmented: (store) => metadata.has(store),
    isDiscarded: (store, snapshot) =>
      metadata
        .get(store)
        ?.observations.discards.find((query) => query.snapshot === snapshot)
        ?.matched === true,
    lookup: (store, checkpoint) =>
      metadata
        .get(store)
        ?.observations.records.find((query) => query.checkpoint === checkpoint)
        ?.record ?? null,
  };
}
