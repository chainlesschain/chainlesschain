// Frozen selection reference from 6b76d4fd5486f44c8cc662512edbb8db45b64266.
// Benchmark/test use only. Shared matching and ordering helpers are unchanged.
import {
  compareMemoryRows,
  matchesListQuery,
} from "../../src/lib/context-memory-kernel/memory-query-index.js";

export function* eagerSelectQueryRows(index, query, after = null) {
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
          JSON.stringify([scope.scope, scope.scopeId ?? null]),
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
