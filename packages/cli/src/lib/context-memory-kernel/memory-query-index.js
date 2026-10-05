import { createHash } from "node:crypto";

export const MEMORY_QUERY_INDEX_SCHEMA = "chainlesschain.memory-query-index/v1";
const CURSOR_SCHEMA = "chainlesschain.memory-list-cursor/v1";

export function queryDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function compareMemoryRows(left, right) {
  return (
    right.importance - left.importance ||
    right.updatedAt.localeCompare(left.updatedAt, "en") ||
    left.memoryId.localeCompare(right.memoryId, "en")
  );
}

// No content, evidence, or audit is copied into the derived index. The manifest
// binds these bytes to the immutable authority shard from which they were made.
export function encodeQueryIndex(state) {
  const rows = Object.values(state.records)
    .map((record) => ({
      memoryId: record.memoryId,
      category: record.category,
      scope: record.scope,
      scopeId: record.scopeId ?? null,
      state: record.state,
      importance: record.importance,
      updatedAt: record.updatedAt,
      tags: record.tags,
      allowedSinks: record.allowedSinks,
    }))
    .sort(compareMemoryRows);
  return Buffer.from(
    JSON.stringify({
      schema: MEMORY_QUERY_INDEX_SCHEMA,
      shardDigest: state.digest,
      rows,
    }),
  );
}

function scopeKey(scope, scopeId) {
  return JSON.stringify([scope, scopeId ?? null]);
}

export function compileQueryIndex(bytes, descriptor) {
  const value = JSON.parse(bytes.toString("utf8"));
  if (
    value.schema !== MEMORY_QUERY_INDEX_SCHEMA ||
    value.shardDigest !== descriptor.digest ||
    !Array.isArray(value.rows) ||
    value.rows.length !== descriptor.recordCount
  ) {
    throw new Error("query index does not match authority shard");
  }
  const fields = ["category", "scope", "state", "tag", "sink"];
  const postings = Object.fromEntries(
    fields.map((field) => [field, new Map()]),
  );
  const add = (field, key, index) => {
    const map = postings[field];
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(index);
  };
  value.rows.forEach((row, index) => {
    add("category", row.category, index);
    add("scope", scopeKey(row.scope, row.scopeId), index);
    add("state", row.state, index);
    for (const tag of row.tags) add("tag", tag, index);
    for (const sink of row.allowedSinks) add("sink", sink, index);
  });
  return { rows: value.rows, postings };
}

export function normalizeListQuery(options = {}) {
  const result = { includeTombstones: options.includeTombstones === true };
  if (options.category) result.category = String(options.category);
  if (options.sink) result.sink = String(options.sink);
  if (options.scopeAdmissions !== undefined) {
    if (!Array.isArray(options.scopeAdmissions))
      throw new TypeError("scopeAdmissions must be an array");
    result.scopeAdmissions = options.scopeAdmissions.map(
      ({ scope, scopeId }) => ({
        scope,
        scopeId: scopeId ?? null,
      }),
    );
  }
  if (options.tags !== undefined) {
    if (!Array.isArray(options.tags))
      throw new TypeError("tags must be an array");
    result.tags = [...new Set(options.tags.map(String))].sort();
  }
  if (options.states !== undefined) {
    if (!Array.isArray(options.states))
      throw new TypeError("states must be an array");
    result.states = [...new Set(options.states.map(String))].sort();
  }
  return result;
}

export function matchesListQuery(row, query) {
  return (
    (query.includeTombstones || !["deleted", "purged"].includes(row.state)) &&
    (!query.category || row.category === query.category) &&
    (!query.states || query.states.includes(row.state)) &&
    (!query.scopeAdmissions ||
      query.scopeAdmissions.some(
        (scope) =>
          scope.scope === row.scope &&
          (scope.scopeId ?? null) === (row.scopeId ?? null),
      )) &&
    (!query.sink ||
      row.allowedSinks.includes("*") ||
      row.allowedSinks.includes(query.sink)) &&
    (!query.tags?.length || row.tags.some((tag) => query.tags.includes(tag)))
  );
}

// Each posting is already in the public list order. Pick the narrowest posting
// before applying the remaining predicates; no full-record scan or top-k before
// permission filtering. Recall uses these gates but retains kernel ranking.
export function* selectQueryRows(index, query, after = null) {
  const candidates = [];
  const union = (field, keys) => {
    const lists = keys
      .map((key) => index.postings[field].get(key))
      .filter(Boolean);
    return lists.length < 2
      ? lists[0] || []
      : [...new Set(lists.flat())].sort((a, b) => a - b);
  };
  if (query.category)
    candidates.push(index.postings.category.get(query.category) || []);
  if (query.scopeAdmissions)
    candidates.push(
      union(
        "scope",
        query.scopeAdmissions.map((scope) =>
          scopeKey(scope.scope, scope.scopeId),
        ),
      ),
    );
  if (query.states) candidates.push(union("state", query.states));
  if (query.tags?.length) candidates.push(union("tag", query.tags));
  if (query.sink) candidates.push(union("sink", ["*", query.sink]));
  candidates.sort((a, b) => a.length - b.length);
  const positions = candidates[0];
  const length = positions ? positions.length : index.rows.length;
  const rowAt = (offset) => index.rows[positions ? positions[offset] : offset];
  let start = 0;
  if (after) {
    let end = length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      if (compareMemoryRows(rowAt(middle), after) <= 0) start = middle + 1;
      else end = middle;
    }
  }
  for (let offset = start; offset < length; offset++) {
    const row = rowAt(offset);
    if (matchesListQuery(row, query)) yield row;
  }
}

export function* mergeQueryRows(heads) {
  const heap = [];
  const less = (left, right) => compareMemoryRows(left.row, right.row) < 0;
  const push = (head) => {
    let at = heap.length;
    heap.push(head);
    while (at > 0) {
      const parent = Math.floor((at - 1) / 2);
      if (!less(head, heap[parent])) break;
      heap[at] = heap[parent];
      at = parent;
    }
    heap[at] = head;
  };
  for (const head of heads) push(head);
  while (heap.length) {
    const first = heap[0];
    const last = heap.pop();
    if (heap.length) {
      let at = 0;
      while (at * 2 + 1 < heap.length) {
        let child = at * 2 + 1;
        if (child + 1 < heap.length && less(heap[child + 1], heap[child]))
          child++;
        if (!less(heap[child], last)) break;
        heap[at] = heap[child];
        at = child;
      }
      heap[at] = last;
    }
    yield { bucket: first.bucket, row: first.row };
    const next = first.iterator.next();
    if (!next.done) push({ ...first, row: next.value });
  }
}

export function cursorError(reason) {
  return Object.assign(new Error(`Memory list cursor is invalid: ${reason}`), {
    code: "CONTEXT_MEMORY_CURSOR_INVALID",
  });
}

export function listCursorBinding(filePath, generation, query) {
  return queryDigest(
    JSON.stringify({
      filePath,
      generation,
      query,
      order: "importance-desc,updatedAt-desc,memoryId-en-asc/v1",
    }),
  );
}

export function decodeListCursor(cursor, binding) {
  if (cursor == null) return null;
  if (
    typeof cursor !== "string" ||
    cursor.length > 4096 ||
    !/^[\w-]+$/u.test(cursor)
  )
    throw cursorError("encoding");
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw cursorError("encoding");
  }
  if (
    !decoded ||
    decoded.schema !== CURSOR_SCHEMA ||
    decoded.binding !== binding ||
    !decoded.after ||
    typeof decoded.after.memoryId !== "string" ||
    typeof decoded.after.updatedAt !== "string" ||
    !Number.isFinite(decoded.after.importance) ||
    decoded.digest !==
      queryDigest(
        JSON.stringify({
          schema: decoded.schema,
          binding: decoded.binding,
          after: decoded.after,
        }),
      )
  ) {
    throw cursorError("generation, filters, or checksum changed");
  }
  return decoded.after;
}

export function encodeListCursor(binding, row) {
  const value = {
    schema: CURSOR_SCHEMA,
    binding,
    after: {
      memoryId: row.memoryId,
      updatedAt: row.updatedAt,
      importance: row.importance,
    },
  };
  return Buffer.from(
    JSON.stringify({ ...value, digest: queryDigest(JSON.stringify(value)) }),
  ).toString("base64url");
}

export function pageLimit(value, fallback = 20) {
  const number = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 10000)
    throw new RangeError(
      "memory page limit must be an integer from 1 to 10000",
    );
  return number;
}
