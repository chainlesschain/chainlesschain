import { describe, it, expect } from "vitest";
import {
  METRICS,
  DEFAULT_INFLUENCE_WEIGHTS,
  degreeCentrality,
  closenessCentrality,
  betweennessCentrality,
  eigenvectorCentrality,
  influenceScore,
  detectCommunities,
  shortestPath,
  topByMetric,
  analyticsStats,
} from "../../src/lib/social-graph-analytics.js";

/* ── Fixtures ──────────────────────────────────────────────── */

// Line graph: A → B → C → D
const lineSnapshot = () => ({
  nodes: [{ did: "A" }, { did: "B" }, { did: "C" }, { did: "D" }],
  edges: [
    { sourceDid: "A", targetDid: "B", edgeType: "follow", weight: 1 },
    { sourceDid: "B", targetDid: "C", edgeType: "follow", weight: 1 },
    { sourceDid: "C", targetDid: "D", edgeType: "follow", weight: 1 },
  ],
});

// Triangle: A ↔ B ↔ C ↔ A (directed both ways)
const triangleSnapshot = () => ({
  nodes: [{ did: "A" }, { did: "B" }, { did: "C" }],
  edges: [
    { sourceDid: "A", targetDid: "B", edgeType: "follow", weight: 1 },
    { sourceDid: "B", targetDid: "A", edgeType: "follow", weight: 1 },
    { sourceDid: "B", targetDid: "C", edgeType: "follow", weight: 1 },
    { sourceDid: "C", targetDid: "B", edgeType: "follow", weight: 1 },
    { sourceDid: "A", targetDid: "C", edgeType: "follow", weight: 1 },
    { sourceDid: "C", targetDid: "A", edgeType: "follow", weight: 1 },
  ],
});

// Star: center S with 4 leaves A, B, C, D (directed: S → leaves + leaves → S)
const starSnapshot = () => ({
  nodes: [{ did: "S" }, { did: "A" }, { did: "B" }, { did: "C" }, { did: "D" }],
  edges: [
    { sourceDid: "S", targetDid: "A", edgeType: "follow", weight: 1 },
    { sourceDid: "A", targetDid: "S", edgeType: "follow", weight: 1 },
    { sourceDid: "S", targetDid: "B", edgeType: "follow", weight: 1 },
    { sourceDid: "B", targetDid: "S", edgeType: "follow", weight: 1 },
    { sourceDid: "S", targetDid: "C", edgeType: "follow", weight: 1 },
    { sourceDid: "C", targetDid: "S", edgeType: "follow", weight: 1 },
    { sourceDid: "S", targetDid: "D", edgeType: "follow", weight: 1 },
    { sourceDid: "D", targetDid: "S", edgeType: "follow", weight: 1 },
  ],
});

// Two separate triangles (disconnected)
const twoClustersSnapshot = () => ({
  nodes: [
    { did: "A" },
    { did: "B" },
    { did: "C" },
    { did: "X" },
    { did: "Y" },
    { did: "Z" },
  ],
  edges: [
    // Cluster 1
    { sourceDid: "A", targetDid: "B", edgeType: "follow", weight: 1 },
    { sourceDid: "B", targetDid: "A", edgeType: "follow", weight: 1 },
    { sourceDid: "B", targetDid: "C", edgeType: "follow", weight: 1 },
    { sourceDid: "C", targetDid: "B", edgeType: "follow", weight: 1 },
    { sourceDid: "A", targetDid: "C", edgeType: "follow", weight: 1 },
    { sourceDid: "C", targetDid: "A", edgeType: "follow", weight: 1 },
    // Cluster 2
    { sourceDid: "X", targetDid: "Y", edgeType: "follow", weight: 1 },
    { sourceDid: "Y", targetDid: "X", edgeType: "follow", weight: 1 },
    { sourceDid: "Y", targetDid: "Z", edgeType: "follow", weight: 1 },
    { sourceDid: "Z", targetDid: "Y", edgeType: "follow", weight: 1 },
    { sourceDid: "X", targetDid: "Z", edgeType: "follow", weight: 1 },
    { sourceDid: "Z", targetDid: "X", edgeType: "follow", weight: 1 },
  ],
});

/* ── Catalog ──────────────────────────────────────────────── */

describe("METRICS catalog", () => {
  it("exposes five metric names", () => {
    expect(METRICS).toEqual([
      "degree",
      "closeness",
      "betweenness",
      "eigenvector",
      "influence",
    ]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(METRICS)).toBe(true);
  });

  it("exposes default influence weights summing to 1.0", () => {
    const sum =
      DEFAULT_INFLUENCE_WEIGHTS.degree +
      DEFAULT_INFLUENCE_WEIGHTS.closeness +
      DEFAULT_INFLUENCE_WEIGHTS.betweenness +
      DEFAULT_INFLUENCE_WEIGHTS.eigenvector;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("default weights object is frozen", () => {
    expect(Object.isFrozen(DEFAULT_INFLUENCE_WEIGHTS)).toBe(true);
  });
});

/* ── Snapshot validation ──────────────────────────────────── */

describe("snapshot validation", () => {
  it("rejects null snapshot", () => {
    expect(() => degreeCentrality(null)).toThrow(/must be an object/);
  });

  it("rejects non-array nodes", () => {
    expect(() => degreeCentrality({ nodes: {}, edges: [] })).toThrow(
      /nodes must be an array/,
    );
  });

  it("rejects non-array edges", () => {
    expect(() => degreeCentrality({ nodes: [], edges: null })).toThrow(
      /edges must be an array/,
    );
  });

  it("accepts an empty but well-formed snapshot", () => {
    const s = { nodes: [], edges: [] };
    expect(degreeCentrality(s)).toEqual({});
    expect(closenessCentrality(s)).toEqual({});
    expect(betweennessCentrality(s)).toEqual({});
    expect(eigenvectorCentrality(s)).toEqual({});
  });
});

/* ── Degree centrality ─────────────────────────────────────── */

describe("degreeCentrality", () => {
  it("counts outgoing edges when direction=out", () => {
    const s = lineSnapshot();
    const out = degreeCentrality(s, { direction: "out", normalize: false });
    expect(out.A).toBe(1);
    expect(out.B).toBe(1);
    expect(out.C).toBe(1);
    expect(out.D).toBe(0);
  });

  it("counts incoming edges when direction=in", () => {
    const s = lineSnapshot();
    const out = degreeCentrality(s, { direction: "in", normalize: false });
    expect(out.A).toBe(0);
    expect(out.B).toBe(1);
    expect(out.C).toBe(1);
    expect(out.D).toBe(1);
  });

  it("sums both directions by default", () => {
    const s = lineSnapshot();
    const out = degreeCentrality(s, { normalize: false });
    expect(out.A).toBe(1);
    expect(out.B).toBe(2);
    expect(out.C).toBe(2);
    expect(out.D).toBe(1);
  });

  it("normalizes by n-1 when normalize=true", () => {
    const s = lineSnapshot();
    const out = degreeCentrality(s, { direction: "out", normalize: true });
    // n-1 = 3
    expect(out.A).toBeCloseTo(1 / 3, 5);
    expect(out.D).toBeCloseTo(0, 5);
  });

  it("filters by edge type", () => {
    const s = {
      nodes: [{ did: "A" }, { did: "B" }],
      edges: [
        { sourceDid: "A", targetDid: "B", edgeType: "follow", weight: 1 },
        { sourceDid: "A", targetDid: "B", edgeType: "block", weight: 1 },
      ],
    };
    const out = degreeCentrality(s, {
      direction: "out",
      normalize: false,
      edgeTypes: ["follow"],
    });
    expect(out.A).toBe(1);
  });

  it("star center has highest degree", () => {
    const s = starSnapshot();
    const out = degreeCentrality(s, { normalize: false });
    expect(out.S).toBeGreaterThan(out.A);
    expect(out.A).toBe(out.B);
  });
});

/* ── Closeness centrality ──────────────────────────────────── */

describe("closenessCentrality", () => {
  it("center of a star has the highest closeness", () => {
    const s = starSnapshot();
    const out = closenessCentrality(s);
    expect(out.S).toBeGreaterThan(out.A);
  });

  it("endpoints in a line are less central than the middle", () => {
    const s = lineSnapshot();
    const out = closenessCentrality(s);
    expect(out.B).toBeGreaterThan(out.A);
    expect(out.C).toBeGreaterThan(out.A);
  });

  it("isolated node has closeness 0", () => {
    const s = {
      nodes: [{ did: "A" }, { did: "B" }, { did: "C" }],
      edges: [
        { sourceDid: "A", targetDid: "B", edgeType: "follow", weight: 1 },
        { sourceDid: "B", targetDid: "A", edgeType: "follow", weight: 1 },
      ],
    };
    const out = closenessCentrality(s);
    expect(out.C).toBe(0);
  });

  it("handles disconnected components without Infinity", () => {
    const s = twoClustersSnapshot();
    const out = closenessCentrality(s);
    for (const d of Object.keys(out)) {
      expect(Number.isFinite(out[d])).toBe(true);
    }
  });

  it("respects directed option", () => {
    const s = lineSnapshot();
    const directed = closenessCentrality(s, { directed: true });
    // D only has incoming edges, so its outward closeness is 0
    expect(directed.D).toBe(0);
  });
});

/* ── Betweenness centrality ────────────────────────────────── */

describe("betweennessCentrality", () => {
  it("middle node of a line has highest betweenness", () => {
    const s = lineSnapshot();
    const out = betweennessCentrality(s, { normalize: false });
    // B and C sit on all paths between endpoints
    expect(out.B).toBeGreaterThan(out.A);
    expect(out.C).toBeGreaterThan(out.A);
    expect(out.A).toBe(0);
    expect(out.D).toBe(0);
  });

  it("star center sits on all leaf-to-leaf paths", () => {
    const s = starSnapshot();
    const out = betweennessCentrality(s, { normalize: false });
    expect(out.S).toBeGreaterThan(0);
    for (const leaf of ["A", "B", "C", "D"]) {
      expect(out[leaf]).toBe(0);
    }
  });

  it("triangle has zero betweenness everywhere (direct edges)", () => {
    const s = triangleSnapshot();
    const out = betweennessCentrality(s, { normalize: false });
    for (const d of ["A", "B", "C"]) {
      expect(out[d]).toBe(0);
    }
  });

  it("normalizes to [0, 1]", () => {
    const s = starSnapshot();
    const out = betweennessCentrality(s, { normalize: true });
    expect(out.S).toBeLessThanOrEqual(1);
    expect(out.S).toBeGreaterThan(0);
  });
});

/* ── Eigenvector centrality ────────────────────────────────── */

describe("eigenvectorCentrality", () => {
  it("produces non-negative scores", () => {
    const s = triangleSnapshot();
    const out = eigenvectorCentrality(s);
    for (const d of Object.keys(out)) {
      expect(out[d]).toBeGreaterThanOrEqual(0);
    }
  });

  it("symmetric graph gives equal scores to equivalent nodes", () => {
    const s = triangleSnapshot();
    const out = eigenvectorCentrality(s);
    expect(out.A).toBeCloseTo(out.B, 4);
    expect(out.B).toBeCloseTo(out.C, 4);
  });

  it("star center outranks leaves", () => {
    const s = starSnapshot();
    const out = eigenvectorCentrality(s);
    expect(out.S).toBeGreaterThan(out.A);
  });

  it("converges within the default iteration budget", () => {
    const s = starSnapshot();
    const out = eigenvectorCentrality(s, { iterations: 50, tolerance: 1e-8 });
    // Should not throw; sanity-check that output contains all nodes
    expect(Object.keys(out).length).toBe(5);
  });

  it("returns empty object for empty graph", () => {
    const out = eigenvectorCentrality({ nodes: [], edges: [] });
    expect(out).toEqual({});
  });
});

/* ── Influence score ──────────────────────────────────────── */

describe("influenceScore", () => {
  it("returns scores in [0, 1] with default weights", () => {
    const s = starSnapshot();
    const out = influenceScore(s);
    for (const d of Object.keys(out)) {
      expect(out[d]).toBeGreaterThanOrEqual(0);
      expect(out[d]).toBeLessThanOrEqual(1);
    }
  });

  it("star center has highest influence", () => {
    const s = starSnapshot();
    const out = influenceScore(s);
    for (const leaf of ["A", "B", "C", "D"]) {
      expect(out.S).toBeGreaterThan(out[leaf]);
    }
  });

  it("custom weights affect ranking", () => {
    const s = lineSnapshot();
    const balanced = influenceScore(s);
    const degreeOnly = influenceScore(s, {
      weights: { degree: 1, closeness: 0, betweenness: 0, eigenvector: 0 },
    });
    // Middle nodes: similar degree to endpoints after undirected collapse
    // (A/D have degree 1, B/C have degree 2 → normalized 1 for B/C, 0.5 for A/D)
    expect(degreeOnly.B).toBeCloseTo(1, 5);
    expect(balanced.B).toBeLessThanOrEqual(1);
  });

  it("rejects all-zero weights", () => {
    expect(() =>
      influenceScore(lineSnapshot(), {
        weights: { degree: 0, closeness: 0, betweenness: 0, eigenvector: 0 },
      }),
    ).toThrow(/positive value/);
  });

  it("normalizes raw weight ratios (doesn't require summing to 1)", () => {
    const s = triangleSnapshot();
    const a = influenceScore(s, {
      weights: { degree: 1, closeness: 1, betweenness: 1, eigenvector: 1 },
    });
    const b = influenceScore(s, {
      weights: {
        degree: 0.25,
        closeness: 0.25,
        betweenness: 0.25,
        eigenvector: 0.25,
      },
    });
    for (const d of Object.keys(a)) {
      expect(a[d]).toBeCloseTo(b[d], 5);
    }
  });
});

/* ── Community detection ──────────────────────────────────── */

describe("detectCommunities", () => {
  it("returns empty result for empty graph", () => {
    const out = detectCommunities({ nodes: [], edges: [] });
    expect(out.communities).toEqual([]);
    expect(out.modularity).toBe(0);
  });

  it("finds two separate communities in two disconnected clusters", () => {
    const s = twoClustersSnapshot();
    const out = detectCommunities(s);
    expect(out.communities.length).toBe(2);
    const sizes = out.communities.map((c) => c.size).sort();
    expect(sizes).toEqual([3, 3]);
  });

  it("positive modularity for well-clustered graph", () => {
    const s = twoClustersSnapshot();
    const out = detectCommunities(s);
    expect(out.modularity).toBeGreaterThan(0);
  });

  it("assigns stable community IDs c0, c1, ... sorted by first member", () => {
    const s = twoClustersSnapshot();
    const out = detectCommunities(s);
    expect(out.communities[0].id).toBe("c0");
    expect(out.communities[1].id).toBe("c1");
    // First community's first member should be lex-smallest among all communities
    const firstMembers = out.communities.map((c) => c.members[0]);
    expect(firstMembers[0] < firstMembers[1]).toBe(true);
  });

  it("filters out communities smaller than minSize", () => {
    const s = {
      nodes: [{ did: "A" }, { did: "B" }, { did: "C" }],
      edges: [
        { sourceDid: "A", targetDid: "B", edgeType: "follow", weight: 1 },
        { sourceDid: "B", targetDid: "A", edgeType: "follow", weight: 1 },
      ],
    };
    const out = detectCommunities(s, { minSize: 2 });
    // C is isolated and gets filtered out
    expect(out.communities.every((c) => c.size >= 2)).toBe(true);
  });

  it("returns deterministic community assignment across runs", () => {
    const s = twoClustersSnapshot();
    const a = detectCommunities(s);
    const b = detectCommunities(s);
    expect(a.communities).toEqual(b.communities);
  });

  it("members within each community are sorted", () => {
    const s = twoClustersSnapshot();
    const out = detectCommunities(s);
    for (const c of out.communities) {
      const sorted = [...c.members].sort();
      expect(c.members).toEqual(sorted);
    }
  });
});

/* ── Shortest path ────────────────────────────────────────── */

describe("shortestPath", () => {
  it("finds a direct edge", () => {
    const s = lineSnapshot();
    const out = shortestPath(s, "A", "B");
    expect(out.found).toBe(true);
    expect(out.distance).toBe(1);
    expect(out.path).toEqual(["A", "B"]);
  });

  it("finds a multi-hop path", () => {
    const s = lineSnapshot();
    const out = shortestPath(s, "A", "D");
    expect(out.found).toBe(true);
    expect(out.distance).toBe(3);
    expect(out.path).toEqual(["A", "B", "C", "D"]);
  });

  it("returns {found: false} if unreachable", () => {
    const s = twoClustersSnapshot();
    // In directed mode, A can reach C but not X
    const out = shortestPath(s, "A", "X", { directed: true });
    expect(out.found).toBe(false);
  });

  it("returns {found: true, distance: 0} if source==target", () => {
    const s = lineSnapshot();
    const out = shortestPath(s, "A", "A");
    expect(out.found).toBe(true);
    expect(out.distance).toBe(0);
    expect(out.path).toEqual(["A"]);
  });

  it("handles undirected paths", () => {
    const s = lineSnapshot();
    // Directed: no path from D back to A
    expect(shortestPath(s, "D", "A", { directed: true }).found).toBe(false);
    // Undirected: D → C → B → A
    const out = shortestPath(s, "D", "A", { directed: false });
    expect(out.found).toBe(true);
    expect(out.distance).toBe(3);
  });

  it("filters by edge type", () => {
    const s = {
      nodes: [{ did: "A" }, { did: "B" }, { did: "C" }],
      edges: [
        { sourceDid: "A", targetDid: "B", edgeType: "follow", weight: 1 },
        { sourceDid: "B", targetDid: "C", edgeType: "block", weight: 1 },
      ],
    };
    const withAll = shortestPath(s, "A", "C");
    const onlyFollow = shortestPath(s, "A", "C", { edgeTypes: ["follow"] });
    expect(withAll.found).toBe(true);
    expect(onlyFollow.found).toBe(false);
  });

  it("rejects missing source/target", () => {
    const s = lineSnapshot();
    expect(shortestPath(s, null, "A").found).toBe(false);
    expect(shortestPath(s, "A", "").found).toBe(false);
  });
});

/* ── Top-N ranking ────────────────────────────────────────── */

describe("topByMetric", () => {
  it("throws on unknown metric", () => {
    expect(() => topByMetric(lineSnapshot(), "pagerank")).toThrow(
      /Unknown metric/,
    );
  });

  it("returns entries sorted descending by score", () => {
    const s = starSnapshot();
    const out = topByMetric(s, "degree");
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
    }
  });

  it("respects the limit", () => {
    const s = starSnapshot();
    const out = topByMetric(s, "degree", { limit: 2 });
    expect(out.length).toBe(2);
  });

  it("breaks ties lexicographically", () => {
    const s = {
      nodes: [{ did: "B" }, { did: "A" }],
      edges: [
        { sourceDid: "B", targetDid: "A", edgeType: "follow", weight: 1 },
      ],
    };
    const out = topByMetric(s, "degree", { normalize: false });
    // Both A and B have degree 1 (in-deg A + out-deg B, both=both) → tie
    // Lex order → A first
    expect(out.map((e) => e.did)).toEqual(["A", "B"]);
  });

  it("supports all 5 metrics", () => {
    const s = starSnapshot();
    for (const m of METRICS) {
      const out = topByMetric(s, m, { limit: 1 });
      expect(out.length).toBe(1);
      expect(typeof out[0].score).toBe("number");
    }
  });

  it("star center wins across all four base metrics", () => {
    const s = starSnapshot();
    for (const m of ["degree", "closeness", "betweenness", "eigenvector"]) {
      const out = topByMetric(s, m, { limit: 1 });
      expect(out[0].did).toBe("S");
    }
  });

  it("returns empty array if limit is 0", () => {
    const s = lineSnapshot();
    expect(topByMetric(s, "degree", { limit: 0 })).toEqual([]);
  });
});

/* ── Analytics stats rollup ───────────────────────────────── */

describe("analyticsStats", () => {
  it("reports node and edge counts", () => {
    const s = starSnapshot();
    const stats = analyticsStats(s);
    expect(stats.nodeCount).toBe(5);
    expect(stats.edgeCount).toBe(8);
  });

  it("computes density in [0, 1]", () => {
    const s = lineSnapshot();
    const stats = analyticsStats(s);
    expect(stats.density).toBeGreaterThanOrEqual(0);
    expect(stats.density).toBeLessThanOrEqual(1);
  });

  it("top influence list has at most 5 entries", () => {
    const s = twoClustersSnapshot();
    const stats = analyticsStats(s);
    expect(stats.topInfluence.length).toBeLessThanOrEqual(5);
  });

  it("includes ISO timestamp", () => {
    const s = triangleSnapshot();
    const stats = analyticsStats(s);
    expect(stats.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("handles empty snapshot", () => {
    const stats = analyticsStats({ nodes: [], edges: [] });
    expect(stats.nodeCount).toBe(0);
    expect(stats.edgeCount).toBe(0);
    expect(stats.density).toBe(0);
    expect(stats.topInfluence).toEqual([]);
  });

  it("filters stats by edge type", () => {
    const s = {
      nodes: [{ did: "A" }, { did: "B" }],
      edges: [
        { sourceDid: "A", targetDid: "B", edgeType: "follow", weight: 1 },
        { sourceDid: "A", targetDid: "B", edgeType: "block", weight: 1 },
      ],
    };
    const withAll = analyticsStats(s);
    const onlyFollow = analyticsStats(s, { edgeTypes: ["follow"] });
    expect(withAll.edgeCount).toBe(2);
    expect(onlyFollow.edgeCount).toBe(1);
  });
});

/* ── Integration with edge type filter on metrics ──────────── */

describe("edge type filtering", () => {
  const mixedSnapshot = () => ({
    nodes: [{ did: "A" }, { did: "B" }, { did: "C" }],
    edges: [
      { sourceDid: "A", targetDid: "B", edgeType: "follow", weight: 1 },
      { sourceDid: "B", targetDid: "C", edgeType: "follow", weight: 1 },
      { sourceDid: "A", targetDid: "C", edgeType: "block", weight: 1 },
    ],
  });

  it("degree respects edgeTypes", () => {
    const s = mixedSnapshot();
    const all = degreeCentrality(s, { normalize: false });
    const onlyFollow = degreeCentrality(s, {
      normalize: false,
      edgeTypes: ["follow"],
    });
    expect(all.A).toBeGreaterThan(onlyFollow.A);
  });

  it("betweenness respects edgeTypes", () => {
    const s = mixedSnapshot();
    const all = betweennessCentrality(s, { normalize: false });
    const onlyFollow = betweennessCentrality(s, {
      normalize: false,
      edgeTypes: ["follow"],
    });
    // In follow-only: A → B → C, so B has betweenness > 0
    // In all edges: also A → C directly, so B has less
    expect(onlyFollow.B).toBeGreaterThanOrEqual(all.B);
  });

  it("communities respect edgeTypes", () => {
    const s = mixedSnapshot();
    const out = detectCommunities(s, { edgeTypes: ["follow"] });
    // A-B-C all connected via follow → one community
    expect(out.communities.length).toBe(1);
    expect(out.communities[0].members.length).toBe(3);
  });
});

/* ── Weighted edges ──────────────────────────────────────── */

describe("weighted edges", () => {
  it("respects weights in eigenvector (heavier edges → higher influence)", () => {
    const s = {
      nodes: [{ did: "A" }, { did: "B" }, { did: "C" }, { did: "D" }],
      edges: [
        // Heavy edge A ↔ B
        { sourceDid: "A", targetDid: "B", edgeType: "follow", weight: 10 },
        { sourceDid: "B", targetDid: "A", edgeType: "follow", weight: 10 },
        // Light edges C and D
        { sourceDid: "C", targetDid: "A", edgeType: "follow", weight: 0.1 },
        { sourceDid: "D", targetDid: "B", edgeType: "follow", weight: 0.1 },
      ],
    };
    const out = eigenvectorCentrality(s);
    // A and B should both outrank C and D
    expect(out.A).toBeGreaterThan(out.C);
    expect(out.B).toBeGreaterThan(out.D);
  });

  it("ignores missing weight (defaults to 1)", () => {
    const s = {
      nodes: [{ did: "A" }, { did: "B" }],
      edges: [{ sourceDid: "A", targetDid: "B", edgeType: "follow" }],
    };
    const out = degreeCentrality(s, { normalize: false });
    expect(out.A).toBe(1);
    expect(out.B).toBe(1);
  });
});

/* ── Edges referencing unknown DIDs ──────────────────────── */

describe("edges referencing DIDs not in nodes[]", () => {
  it("auto-includes DIDs from edges", () => {
    const s = {
      nodes: [{ did: "A" }],
      edges: [
        { sourceDid: "A", targetDid: "B", edgeType: "follow", weight: 1 },
      ],
    };
    const out = degreeCentrality(s, { normalize: false });
    expect(out.A).toBe(1);
    expect(out.B).toBe(1);
  });
});
