/**
 * Social Graph Analytics — centrality, community detection, shortest path,
 * and composite influence scoring on snapshots produced by `social-graph.js`.
 *
 * Scope (CLI-first):
 *   - Pure functions over snapshots `{nodes, edges}` — no DB, no state
 *   - Callers feed a snapshot from `getGraphSnapshot()` (or any source with
 *     the same shape) and receive deterministic numeric scores keyed by DID
 *   - All metrics support optional edge-type filtering so analytics can be
 *     computed per relationship kind (e.g. only `follow` edges)
 *
 * What this module is NOT:
 *   - A visualization layer. Callers drive rendering from the numeric results.
 *   - A real-time stream. It operates on point-in-time snapshots. Callers that
 *     need live updates should subscribe to `social-graph.subscribe()` and
 *     re-run the relevant metric after each mutation batch.
 *   - An approximation service. Metrics are exact for the input; there is no
 *     sampling or Monte Carlo. Costs are O(n+m) to O(n*m) depending on the
 *     metric — fine for typical CLI-scale graphs (low thousands of nodes).
 *
 * Algorithms:
 *   - Degree: simple in/out/total counts, optionally normalized by (n-1)
 *   - Closeness: BFS from each node, harmonic mean of reciprocal distances
 *     (handles disconnected graphs without producing Infinity)
 *   - Betweenness: Brandes' algorithm (O(nm) for unweighted graphs)
 *   - Eigenvector: power iteration with L2 normalization, converges on
 *     strongly-connected components; otherwise converges to dominant one
 *   - Communities: label propagation with deterministic tie-breaks (sort
 *     by DID lexicographically); cheaper than full Louvain and matches
 *     the existing CLI's preference for deterministic output
 *   - Shortest path: BFS (unweighted); returns path of DIDs or `{found: false}`
 *   - Influence: weighted linear combination of normalized centralities
 */

/* ── Public catalog ───────────────────────────────────────────── */

export const METRICS = Object.freeze([
  "degree",
  "closeness",
  "betweenness",
  "eigenvector",
  "influence",
]);

export const DEFAULT_INFLUENCE_WEIGHTS = Object.freeze({
  degree: 0.25,
  closeness: 0.25,
  betweenness: 0.25,
  eigenvector: 0.25,
});

/* ── Snapshot helpers ─────────────────────────────────────────── */

function _assertSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("snapshot must be an object with {nodes, edges}");
  }
  if (!Array.isArray(snapshot.nodes)) {
    throw new Error("snapshot.nodes must be an array");
  }
  if (!Array.isArray(snapshot.edges)) {
    throw new Error("snapshot.edges must be an array");
  }
}

function _filterEdges(edges, edgeTypes) {
  if (!edgeTypes || edgeTypes.length === 0) return edges;
  const set = new Set(edgeTypes);
  return edges.filter((e) => set.has(e.edgeType));
}

/**
 * Collect unique DIDs from nodes AND edges (some edges may reference DIDs
 * that never appeared as standalone nodes if the caller curated nodes[]).
 */
function _allDids(snapshot, edges) {
  const dids = new Set();
  for (const n of snapshot.nodes) if (n && n.did) dids.add(n.did);
  for (const e of edges) {
    if (e.sourceDid) dids.add(e.sourceDid);
    if (e.targetDid) dids.add(e.targetDid);
  }
  return [...dids].sort();
}

/**
 * Build a directed adjacency map: Map<did, Map<neighborDid, totalWeight>>.
 * Parallel edges of different types between the same pair collapse by
 * summing weights (default 1 if edge.weight is missing).
 */
function _directedAdjacency(edges) {
  const adj = new Map();
  for (const e of edges) {
    if (!e.sourceDid || !e.targetDid) continue;
    if (!adj.has(e.sourceDid)) adj.set(e.sourceDid, new Map());
    const bucket = adj.get(e.sourceDid);
    const w = typeof e.weight === "number" ? e.weight : 1;
    bucket.set(e.targetDid, (bucket.get(e.targetDid) || 0) + w);
  }
  return adj;
}

/**
 * Build an undirected adjacency map by summing weights in both directions.
 */
function _undirectedAdjacency(edges) {
  const adj = new Map();
  const add = (a, b, w) => {
    if (!adj.has(a)) adj.set(a, new Map());
    const bucket = adj.get(a);
    bucket.set(b, (bucket.get(b) || 0) + w);
  };
  for (const e of edges) {
    if (!e.sourceDid || !e.targetDid) continue;
    if (e.sourceDid === e.targetDid) continue;
    const w = typeof e.weight === "number" ? e.weight : 1;
    add(e.sourceDid, e.targetDid, w);
    add(e.targetDid, e.sourceDid, w);
  }
  return adj;
}

/* ── Degree centrality ─────────────────────────────────────── */

/**
 * Degree centrality per DID.
 *
 * @param {object} snapshot — {nodes, edges}
 * @param {object} [opts]
 * @param {"in"|"out"|"both"} [opts.direction="both"]
 * @param {boolean} [opts.normalize=true] — divide by (n-1)
 * @param {string[]} [opts.edgeTypes] — restrict to these edge types
 * @returns {object} dict keyed by DID → score
 */
export function degreeCentrality(snapshot, opts = {}) {
  _assertSnapshot(snapshot);
  const { direction = "both", normalize = true, edgeTypes } = opts;
  const edges = _filterEdges(snapshot.edges, edgeTypes);
  const dids = _allDids(snapshot, edges);
  const scores = {};
  for (const d of dids) scores[d] = 0;

  for (const e of edges) {
    if (!e.sourceDid || !e.targetDid) continue;
    if (direction === "out" || direction === "both") {
      scores[e.sourceDid] = (scores[e.sourceDid] || 0) + 1;
    }
    if (direction === "in" || direction === "both") {
      scores[e.targetDid] = (scores[e.targetDid] || 0) + 1;
    }
  }

  if (normalize && dids.length > 1) {
    const denom = dids.length - 1;
    for (const d of dids) scores[d] = scores[d] / denom;
  }
  return scores;
}

/* ── Closeness centrality ─────────────────────────────────── */

/**
 * BFS from `source` returning Map<did, distance>. Unreachable nodes are
 * excluded from the map.
 */
function _bfsDistances(source, adj) {
  const dist = new Map();
  dist.set(source, 0);
  const queue = [source];
  let head = 0;
  while (head < queue.length) {
    const u = queue[head++];
    const neighbors = adj.get(u);
    if (!neighbors) continue;
    for (const v of neighbors.keys()) {
      if (!dist.has(v)) {
        dist.set(v, dist.get(u) + 1);
        queue.push(v);
      }
    }
  }
  return dist;
}

/**
 * Closeness centrality (harmonic variant — handles disconnected graphs).
 * C(v) = (1 / (n-1)) * sum_{u != v, reachable} 1/d(v, u)
 *
 * @param {object} snapshot
 * @param {object} [opts]
 * @param {boolean} [opts.directed=false] — if false, collapse to undirected
 * @param {string[]} [opts.edgeTypes]
 * @param {boolean} [opts.normalize=true] — divide by (n-1)
 * @returns {object} dict DID → score
 */
export function closenessCentrality(snapshot, opts = {}) {
  _assertSnapshot(snapshot);
  const { directed = false, edgeTypes, normalize = true } = opts;
  const edges = _filterEdges(snapshot.edges, edgeTypes);
  const dids = _allDids(snapshot, edges);
  const adj = directed
    ? _directedAdjacency(edges)
    : _undirectedAdjacency(edges);

  const scores = {};
  for (const d of dids) scores[d] = 0;

  for (const source of dids) {
    const dist = _bfsDistances(source, adj);
    let sum = 0;
    for (const [target, dd] of dist) {
      if (target === source || dd === 0) continue;
      sum += 1 / dd;
    }
    scores[source] = sum;
  }

  if (normalize && dids.length > 1) {
    const denom = dids.length - 1;
    for (const d of dids) scores[d] = scores[d] / denom;
  }
  return scores;
}

/* ── Betweenness centrality (Brandes' algorithm) ──────────── */

/**
 * Betweenness centrality via Brandes' algorithm for unweighted graphs.
 * O(V * E) time.
 *
 * @param {object} snapshot
 * @param {object} [opts]
 * @param {boolean} [opts.directed=false]
 * @param {string[]} [opts.edgeTypes]
 * @param {boolean} [opts.normalize=true] — for undirected: 2/((n-1)(n-2))
 * @returns {object} dict DID → score
 */
export function betweennessCentrality(snapshot, opts = {}) {
  _assertSnapshot(snapshot);
  const { directed = false, edgeTypes, normalize = true } = opts;
  const edges = _filterEdges(snapshot.edges, edgeTypes);
  const dids = _allDids(snapshot, edges);
  const adj = directed
    ? _directedAdjacency(edges)
    : _undirectedAdjacency(edges);

  const scores = {};
  for (const d of dids) scores[d] = 0;

  for (const s of dids) {
    const stack = [];
    const pred = new Map();
    const sigma = new Map();
    const dist = new Map();
    for (const v of dids) {
      pred.set(v, []);
      sigma.set(v, 0);
      dist.set(v, -1);
    }
    sigma.set(s, 1);
    dist.set(s, 0);

    const queue = [s];
    let head = 0;
    while (head < queue.length) {
      const v = queue[head++];
      stack.push(v);
      const neighbors = adj.get(v);
      if (!neighbors) continue;
      for (const w of neighbors.keys()) {
        if (dist.get(w) < 0) {
          queue.push(w);
          dist.set(w, dist.get(v) + 1);
        }
        if (dist.get(w) === dist.get(v) + 1) {
          sigma.set(w, sigma.get(w) + sigma.get(v));
          pred.get(w).push(v);
        }
      }
    }

    const delta = new Map();
    for (const v of dids) delta.set(v, 0);
    while (stack.length > 0) {
      const w = stack.pop();
      for (const v of pred.get(w)) {
        const contrib = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
        delta.set(v, delta.get(v) + contrib);
      }
      if (w !== s) scores[w] += delta.get(w);
    }
  }

  // For undirected graphs, Brandes' formulation double-counts each pair.
  if (!directed) {
    for (const d of dids) scores[d] = scores[d] / 2;
  }

  if (normalize && dids.length > 2) {
    const n = dids.length;
    const denom = directed ? (n - 1) * (n - 2) : ((n - 1) * (n - 2)) / 2;
    if (denom > 0) {
      for (const d of dids) scores[d] = scores[d] / denom;
    }
  }
  return scores;
}

/* ── Eigenvector centrality ───────────────────────────────── */

/**
 * Eigenvector centrality via power iteration.
 *
 * @param {object} snapshot
 * @param {object} [opts]
 * @param {boolean} [opts.directed=false]
 * @param {string[]} [opts.edgeTypes]
 * @param {number} [opts.iterations=100]
 * @param {number} [opts.tolerance=1e-6]
 * @returns {object} dict DID → score (L2-normalized, non-negative)
 */
export function eigenvectorCentrality(snapshot, opts = {}) {
  _assertSnapshot(snapshot);
  const {
    directed = false,
    edgeTypes,
    iterations = 100,
    tolerance = 1e-6,
  } = opts;
  const edges = _filterEdges(snapshot.edges, edgeTypes);
  const dids = _allDids(snapshot, edges);
  const adj = directed
    ? _directedAdjacency(edges)
    : _undirectedAdjacency(edges);

  if (dids.length === 0) return {};

  // Initialize uniformly; converges to principal eigenvector.
  let x = new Map();
  const seed = 1 / Math.sqrt(dids.length);
  for (const d of dids) x.set(d, seed);

  for (let iter = 0; iter < iterations; iter++) {
    const xNew = new Map();
    for (const d of dids) xNew.set(d, 0);

    for (const [u, neighbors] of adj) {
      for (const [v, w] of neighbors) {
        xNew.set(v, (xNew.get(v) || 0) + w * x.get(u));
      }
    }

    // Shift by I (add x to xNew) to break bipartite oscillation. Mathematically
    // this yields the principal eigenvector of (I + A), which shares the same
    // principal eigenvector direction as A for connected non-negative graphs
    // but eliminates the +λ/-λ sign flip that causes power iteration to stall
    // on bipartite structures (e.g. star graphs).
    for (const d of dids) {
      xNew.set(d, xNew.get(d) + x.get(d));
    }

    // L2 normalize; if zero vector, seed back uniformly.
    let norm = 0;
    for (const d of dids) norm += xNew.get(d) * xNew.get(d);
    norm = Math.sqrt(norm);
    if (norm === 0) {
      for (const d of dids) xNew.set(d, seed);
    } else {
      for (const d of dids) xNew.set(d, xNew.get(d) / norm);
    }

    // Convergence check
    let diff = 0;
    for (const d of dids) diff += Math.abs(xNew.get(d) - x.get(d));
    x = xNew;
    if (diff < tolerance) break;
  }

  const scores = {};
  for (const d of dids) scores[d] = Math.abs(x.get(d));
  return scores;
}

/* ── Influence score (composite) ──────────────────────────── */

/**
 * Composite influence score: weighted linear combination of the four
 * centrality metrics, each normalized to [0, 1] before combining.
 *
 * @param {object} snapshot
 * @param {object} [opts]
 * @param {object} [opts.weights] — {degree, closeness, betweenness, eigenvector}
 * @param {string[]} [opts.edgeTypes]
 * @param {boolean} [opts.directed=false]
 * @returns {object} dict DID → score in [0, 1]
 */
export function influenceScore(snapshot, opts = {}) {
  _assertSnapshot(snapshot);
  const { weights: userWeights, edgeTypes, directed = false } = opts;
  const weights = { ...DEFAULT_INFLUENCE_WEIGHTS, ...(userWeights || {}) };

  // Normalize weights so they sum to 1 (allows callers to pass raw ratios).
  const wSum =
    (weights.degree || 0) +
    (weights.closeness || 0) +
    (weights.betweenness || 0) +
    (weights.eigenvector || 0);
  if (wSum <= 0) {
    throw new Error("influence weights must sum to a positive value");
  }
  const w = {
    degree: (weights.degree || 0) / wSum,
    closeness: (weights.closeness || 0) / wSum,
    betweenness: (weights.betweenness || 0) / wSum,
    eigenvector: (weights.eigenvector || 0) / wSum,
  };

  const passOpts = { edgeTypes, directed };
  const deg = degreeCentrality(snapshot, { ...passOpts, normalize: true });
  const close = closenessCentrality(snapshot, { ...passOpts, normalize: true });
  const btw = betweennessCentrality(snapshot, { ...passOpts, normalize: true });
  const eig = eigenvectorCentrality(snapshot, passOpts);

  const dids = Object.keys(deg);
  if (dids.length === 0) return {};

  // Normalize each metric vector by its max so all land in [0, 1].
  const _normalize = (m) => {
    const values = dids.map((d) => m[d] || 0);
    const max = Math.max(...values, 0);
    if (max === 0) return dids.reduce((acc, d) => ((acc[d] = 0), acc), {});
    const out = {};
    for (const d of dids) out[d] = (m[d] || 0) / max;
    return out;
  };
  const dN = _normalize(deg);
  const cN = _normalize(close);
  const bN = _normalize(btw);
  const eN = _normalize(eig);

  const out = {};
  for (const d of dids) {
    out[d] =
      w.degree * dN[d] +
      w.closeness * cN[d] +
      w.betweenness * bN[d] +
      w.eigenvector * eN[d];
  }
  return out;
}

/* ── Community detection (label propagation) ──────────────── */

/**
 * Label propagation community detection. Deterministic via
 * lexicographic DID ordering + tie-breaking by smallest label.
 *
 * @param {object} snapshot
 * @param {object} [opts]
 * @param {string[]} [opts.edgeTypes]
 * @param {number} [opts.maxIterations=20]
 * @param {number} [opts.minSize=1] — filter out communities below this size
 * @returns {{communities: Array, modularity: number}}
 */
export function detectCommunities(snapshot, opts = {}) {
  _assertSnapshot(snapshot);
  const { edgeTypes, maxIterations = 20, minSize = 1 } = opts;
  const edges = _filterEdges(snapshot.edges, edgeTypes);
  const dids = _allDids(snapshot, edges);
  const adj = _undirectedAdjacency(edges);

  if (dids.length === 0) {
    return { communities: [], modularity: 0 };
  }

  // Initialize: each node is its own community, labeled by its DID.
  const labels = new Map();
  for (const d of dids) labels.set(d, d);

  // Stable sort ensures deterministic traversal.
  const sortedDids = [...dids].sort();

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    for (const v of sortedDids) {
      const neighbors = adj.get(v);
      if (!neighbors || neighbors.size === 0) continue;

      // Tally label frequencies (weighted).
      const counts = new Map();
      for (const [u, w] of neighbors) {
        const lbl = labels.get(u);
        counts.set(lbl, (counts.get(lbl) || 0) + w);
      }

      // Pick the max-weight label; tie-break by smallest lexicographic label.
      let best = labels.get(v);
      let bestWeight = counts.get(best) || 0;
      const sortedLabels = [...counts.keys()].sort();
      for (const lbl of sortedLabels) {
        const w = counts.get(lbl);
        if (w > bestWeight) {
          best = lbl;
          bestWeight = w;
        }
      }
      if (best !== labels.get(v)) {
        labels.set(v, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Group by label.
  const groups = new Map();
  for (const d of sortedDids) {
    const lbl = labels.get(d);
    if (!groups.has(lbl)) groups.set(lbl, []);
    groups.get(lbl).push(d);
  }

  // Assign stable community IDs (c0, c1, ...) sorted by first member DID.
  const labelList = [...groups.keys()].sort((a, b) => {
    const aFirst = groups.get(a)[0];
    const bFirst = groups.get(b)[0];
    return aFirst < bFirst ? -1 : aFirst > bFirst ? 1 : 0;
  });

  const communities = [];
  let idx = 0;
  for (const lbl of labelList) {
    const members = groups.get(lbl);
    if (members.length < minSize) continue;
    communities.push({
      id: `c${idx++}`,
      label: lbl,
      members: [...members].sort(),
      size: members.length,
    });
  }

  // Modularity: Q = sum_c [L_c / m - (k_c / 2m)^2]
  let m = 0;
  for (const [, neighbors] of adj) {
    for (const [, w] of neighbors) m += w;
  }
  m = m / 2; // undirected
  let Q = 0;
  if (m > 0) {
    for (const c of communities) {
      const set = new Set(c.members);
      let Lc = 0;
      let kc = 0;
      for (const v of c.members) {
        const neighbors = adj.get(v);
        if (!neighbors) continue;
        for (const [u, w] of neighbors) {
          kc += w;
          if (set.has(u)) Lc += w;
        }
      }
      Lc = Lc / 2;
      Q += Lc / m - Math.pow(kc / (2 * m), 2);
    }
  }

  return { communities, modularity: Q };
}

/* ── Shortest path (BFS) ──────────────────────────────────── */

/**
 * Unweighted shortest path between two DIDs.
 *
 * @param {object} snapshot
 * @param {string} source
 * @param {string} target
 * @param {object} [opts]
 * @param {boolean} [opts.directed=true]
 * @param {string[]} [opts.edgeTypes]
 * @returns {{found: boolean, distance?: number, path?: string[]}}
 */
export function shortestPath(snapshot, source, target, opts = {}) {
  _assertSnapshot(snapshot);
  if (!source || !target) {
    return { found: false, reason: "missing source or target" };
  }
  if (source === target) {
    return { found: true, distance: 0, path: [source] };
  }
  const { directed = true, edgeTypes } = opts;
  const edges = _filterEdges(snapshot.edges, edgeTypes);
  const adj = directed
    ? _directedAdjacency(edges)
    : _undirectedAdjacency(edges);

  const parent = new Map();
  parent.set(source, null);
  const queue = [source];
  let head = 0;
  let found = false;
  while (head < queue.length) {
    const u = queue[head++];
    if (u === target) {
      found = true;
      break;
    }
    const neighbors = adj.get(u);
    if (!neighbors) continue;
    for (const v of neighbors.keys()) {
      if (!parent.has(v)) {
        parent.set(v, u);
        queue.push(v);
      }
    }
  }
  if (!found) return { found: false };

  // Reconstruct path.
  const path = [];
  let cur = target;
  while (cur !== null && cur !== undefined) {
    path.unshift(cur);
    cur = parent.get(cur);
  }
  return { found: true, distance: path.length - 1, path };
}

/* ── Top-N ranking ────────────────────────────────────────── */

/**
 * Rank DIDs by a named metric. Returns up to `limit` entries sorted
 * descending by score, ties broken by lexicographic DID order.
 *
 * @param {object} snapshot
 * @param {"degree"|"closeness"|"betweenness"|"eigenvector"|"influence"} metric
 * @param {object} [opts]
 * @param {number} [opts.limit=10]
 * @param {string[]} [opts.edgeTypes]
 * @param {boolean} [opts.directed=false]
 * @param {object} [opts.weights] — only used when metric="influence"
 * @returns {Array<{did: string, score: number}>}
 */
export function topByMetric(snapshot, metric, opts = {}) {
  if (!METRICS.includes(metric)) {
    throw new Error(
      `Unknown metric "${metric}"; expected one of ${METRICS.join(", ")}`,
    );
  }
  const { limit = 10 } = opts;
  let scores;
  switch (metric) {
    case "degree":
      scores = degreeCentrality(snapshot, opts);
      break;
    case "closeness":
      scores = closenessCentrality(snapshot, opts);
      break;
    case "betweenness":
      scores = betweennessCentrality(snapshot, opts);
      break;
    case "eigenvector":
      scores = eigenvectorCentrality(snapshot, opts);
      break;
    case "influence":
      scores = influenceScore(snapshot, opts);
      break;
  }
  const entries = Object.entries(scores || {}).map(([did, score]) => ({
    did,
    score,
  }));
  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.did < b.did ? -1 : a.did > b.did ? 1 : 0;
  });
  return entries.slice(0, Math.max(0, limit));
}

/* ── Summary stats ────────────────────────────────────────── */

/**
 * Convenience snapshot-level rollup: node/edge counts, density, and
 * the top-5 scorer by influence.
 */
export function analyticsStats(snapshot, opts = {}) {
  _assertSnapshot(snapshot);
  const { edgeTypes } = opts;
  const edges = _filterEdges(snapshot.edges, edgeTypes);
  const dids = _allDids(snapshot, edges);
  const n = dids.length;
  const maxPossibleDirected = n * (n - 1);
  const density =
    maxPossibleDirected > 0 ? edges.length / maxPossibleDirected : 0;

  const topInfluence =
    n > 0 ? topByMetric(snapshot, "influence", { ...opts, limit: 5 }) : [];

  return {
    nodeCount: n,
    edgeCount: edges.length,
    density,
    topInfluence,
    generatedAt: new Date().toISOString(),
  };
}
