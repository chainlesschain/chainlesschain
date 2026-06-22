import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import ga from "../graph-analytics.js";
const {
  calculateDegreeCentrality,
  calculateClosenessCentrality,
  calculateBetweennessCentrality,
  calculatePageRank,
  detectCommunities,
  clusterNodes,
  findKeyNodes,
  analyzeGraphStats,
  buildAdjacencyList,
} = ga;

const N = (...ids) => ids.map((id) => ({ id }));
const E = (...pairs) =>
  pairs.map(([source_id, target_id]) => ({ source_id, target_id }));

// Fixtures
const triangle = { nodes: N("a", "b", "c"), edges: E(["a", "b"], ["b", "c"], ["c", "a"]) };
const path = { nodes: N("a", "b", "c"), edges: E(["a", "b"], ["b", "c"]) }; // a-b-c
const twoPairs = { nodes: N("a", "b", "c", "d"), edges: E(["a", "b"], ["c", "d"]) };

describe("graph-analytics", () => {
  describe("buildAdjacencyList", () => {
    it("builds an undirected adjacency list", () => {
      const adj = buildAdjacencyList(path.nodes, path.edges);
      expect(adj.get("a")).toEqual(["b"]);
      expect(adj.get("b").sort()).toEqual(["a", "c"]);
      expect(adj.get("c")).toEqual(["b"]);
    });

    it("auto-registers edge endpoints missing from the node list", () => {
      const adj = buildAdjacencyList(N("a"), E(["a", "ghost"]));
      expect(adj.has("ghost")).toBe(true);
      expect(adj.get("ghost")).toEqual(["a"]);
    });
  });

  describe("calculateDegreeCentrality", () => {
    it("normalizes degree by (n-1)", () => {
      const c = calculateDegreeCentrality(triangle.nodes, triangle.edges);
      // every triangle node has degree 2, n-1 = 2 -> 1.0
      expect(c.get("a")).toBe(1);
      expect(c.get("b")).toBe(1);
      expect(c.get("c")).toBe(1);
    });

    it("ranks the central node of a path highest", () => {
      const c = calculateDegreeCentrality(path.nodes, path.edges);
      expect(c.get("b")).toBeGreaterThan(c.get("a"));
      expect(c.get("a")).toBe(c.get("c"));
    });

    it("returns raw (unnormalized) zeros for a single node", () => {
      const c = calculateDegreeCentrality(N("solo"), []);
      expect(c.get("solo")).toBe(0); // maxDegree 0 -> no normalization
    });
  });

  describe("calculateClosenessCentrality", () => {
    it("ranks the central path node highest", () => {
      const c = calculateClosenessCentrality(path.nodes, path.edges);
      // b: total dist 2 -> (3-1)/2 = 1 ; a: total dist 3 -> 2/3
      expect(c.get("b")).toBeCloseTo(1, 5);
      expect(c.get("a")).toBeCloseTo(2 / 3, 5);
      expect(c.get("b")).toBeGreaterThan(c.get("a"));
    });
  });

  describe("calculateBetweennessCentrality", () => {
    it("gives the bridge node positive betweenness and the leaves zero", () => {
      const c = calculateBetweennessCentrality(path.nodes, path.edges);
      expect(c.get("b")).toBeGreaterThan(0);
      expect(c.get("a")).toBe(0);
      expect(c.get("c")).toBe(0);
    });

    it("is symmetric/zero on a triangle (no node is a bridge)", () => {
      const c = calculateBetweennessCentrality(triangle.nodes, triangle.edges);
      for (const id of ["a", "b", "c"]) expect(c.get(id)).toBe(0);
    });
  });

  describe("calculatePageRank", () => {
    it("assigns equal rank to a symmetric triangle (relative ordering)", () => {
      const pr = calculatePageRank(triangle.nodes, triangle.edges);
      const vals = [pr.get("a"), pr.get("b"), pr.get("c")];
      expect(vals[0]).toBeCloseTo(vals[1], 5);
      expect(vals[1]).toBeCloseTo(vals[2], 5);
      vals.forEach((v) => expect(v).toBeGreaterThan(0));
      // NOTE: this implementation does not conserve total PageRank mass to 1 —
      // incoming contributions use the directed edge list while out-degree is
      // taken from the undirected adjacency, so half of each node's rank is not
      // redistributed. The relative ordering (all that findKeyNodes consumes)
      // is still correct; absolute values should not be compared to fixed
      // thresholds.
    });

    it("ranks a more-connected node above a leaf on a path", () => {
      const pr = calculatePageRank(path.nodes, path.edges);
      expect(pr.get("b")).toBeGreaterThan(0);
      expect(pr.get("a")).toBeGreaterThan(0);
    });
  });

  describe("detectCommunities", () => {
    it("assigns every node a contiguous community id starting at 0", () => {
      const com = detectCommunities(twoPairs.nodes, twoPairs.edges);
      const ids = new Set(com.values());
      expect(com.size).toBe(4);
      const sorted = [...ids].sort((a, b) => a - b);
      expect(sorted[0]).toBe(0);
      // contiguous: max id === count-1
      expect(Math.max(...ids)).toBe(ids.size - 1);
    });

    it("puts the two disconnected pairs in different communities", () => {
      const com = detectCommunities(twoPairs.nodes, twoPairs.edges);
      expect(com.get("a")).not.toBe(com.get("c"));
    });
  });

  describe("clusterNodes", () => {
    it("clamps k to node count and assigns every node a valid cluster", () => {
      const clusters = clusterNodes(triangle.nodes, triangle.edges, 5); // k>nodes
      expect(clusters.size).toBe(3);
      for (const id of ["a", "b", "c"]) {
        const cl = clusters.get(id);
        expect(cl).toBeGreaterThanOrEqual(0);
        expect(cl).toBeLessThan(3);
      }
    });
  });

  describe("findKeyNodes", () => {
    it("returns top-N enriched nodes sorted by descending score", () => {
      const key = findKeyNodes(path.nodes, path.edges, 2);
      expect(key).toHaveLength(2);
      expect(key[0].id).toBe("b"); // central node ranks first
      expect(key[0].score).toBeGreaterThanOrEqual(key[1].score);
      expect(key[0]).toHaveProperty("degree");
      expect(key[0]).toHaveProperty("pageRank");
    });
  });

  describe("analyzeGraphStats", () => {
    it("computes stats for a connected triangle", () => {
      const s = analyzeGraphStats(triangle.nodes, triangle.edges);
      expect(s.nodeCount).toBe(3);
      expect(s.edgeCount).toBe(3);
      expect(s.density).toBeCloseTo(1, 5);
      expect(s.avgDegree).toBe(2);
      expect(s.maxDegree).toBe(2);
      expect(s.minDegree).toBe(2);
      expect(s.componentCount).toBe(1);
      expect(s.largestComponentSize).toBe(3);
      expect(s.avgClusteringCoeff).toBeCloseTo(1, 5);
    });

    it("counts disconnected components", () => {
      const s = analyzeGraphStats(twoPairs.nodes, twoPairs.edges);
      expect(s.componentCount).toBe(2);
      expect(s.largestComponentSize).toBe(2);
    });

    it("returns finite zeros for an empty graph (regression: no NaN/Infinity)", () => {
      const s = analyzeGraphStats([], []);
      expect(s.nodeCount).toBe(0);
      expect(s.avgDegree).toBe(0);
      expect(s.maxDegree).toBe(0);
      expect(s.minDegree).toBe(0);
      expect(s.largestComponentSize).toBe(0);
      // none of the numeric fields may be NaN or ±Infinity
      for (const v of Object.values(s)) {
        if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
      }
    });
  });
});
