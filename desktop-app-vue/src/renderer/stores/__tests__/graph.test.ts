/**
 * useGraphStore — Pinia store unit tests (knowledge graph)
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: nodeRelations (curried) / connectedNodes (curried, dedup) /
 *    relationsByType (group by edge.type, ignore unknown) / hasData
 *  - Pure actions: selectNode / hoverNode / clearSelection / setLayout /
 *    updateFilters (merge) / reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useGraphStore } from "../graph";
import type { GraphNode, GraphEdge } from "../graph";

function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return { id, label: id, type: "note", ...overrides };
}

function edge(
  source: string,
  target: string,
  type: GraphEdge["type"] = "link",
  overrides: Partial<GraphEdge> = {},
): GraphEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    type,
    weight: 1,
    ...overrides,
  };
}

describe("useGraphStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty with default filters and force layout", () => {
      const store = useGraphStore();
      expect(store.nodes).toEqual([]);
      expect(store.edges).toEqual([]);
      expect(store.selectedNode).toBeNull();
      expect(store.hoveredNode).toBeNull();
      expect(store.layout).toBe("force");
      expect(store.filters.relationTypes).toEqual([
        "link",
        "tag",
        "semantic",
        "temporal",
      ]);
      expect(store.filters.limit).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    function seed(store: ReturnType<typeof useGraphStore>) {
      store.nodes = [node("a"), node("b"), node("c"), node("d")];
      store.edges = [
        edge("a", "b", "link"),
        edge("a", "c", "tag"),
        edge("b", "c", "semantic"),
        // d is isolated
      ];
    }

    it("nodeRelations returns edges touching the node (as source or target)", () => {
      const store = useGraphStore();
      seed(store);
      expect(store.nodeRelations("a").map((e) => e.id)).toEqual(["a-b", "a-c"]);
      expect(store.nodeRelations("c").map((e) => e.id)).toEqual(["a-c", "b-c"]);
      expect(store.nodeRelations("d")).toEqual([]);
    });

    it("connectedNodes returns the neighbor nodes, deduped", () => {
      const store = useGraphStore();
      seed(store);
      expect(
        store
          .connectedNodes("a")
          .map((n) => n.id)
          .sort(),
      ).toEqual(["b", "c"]);
      expect(
        store
          .connectedNodes("c")
          .map((n) => n.id)
          .sort(),
      ).toEqual(["a", "b"]);
      expect(store.connectedNodes("d")).toEqual([]);
    });

    it("relationsByType groups edges by type and ignores unknown types", () => {
      const store = useGraphStore();
      store.edges = [
        edge("a", "b", "link"),
        edge("a", "c", "link"),
        edge("b", "c", "tag"),
        edge("x", "y", "bogus" as any),
      ];
      const g = store.relationsByType;
      expect(g.link.map((e) => e.id)).toEqual(["a-b", "a-c"]);
      expect(g.tag.map((e) => e.id)).toEqual(["b-c"]);
      expect(g.semantic).toEqual([]);
      expect(g.temporal).toEqual([]);
    });

    it("hasData requires both nodes and edges", () => {
      const store = useGraphStore();
      expect(store.hasData).toBe(false);
      store.nodes = [node("a")];
      expect(store.hasData).toBe(false); // edges still empty
      store.edges = [edge("a", "b")];
      expect(store.hasData).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Pure actions
  // -------------------------------------------------------------------------

  describe("pure actions", () => {
    it("selectNode / hoverNode / clearSelection manage selection", () => {
      const store = useGraphStore();
      store.selectNode("a");
      store.hoverNode("b");
      expect(store.selectedNode).toBe("a");
      expect(store.hoveredNode).toBe("b");
      store.clearSelection();
      expect(store.selectedNode).toBeNull();
      expect(store.hoveredNode).toBeNull();
    });

    it("setLayout updates the layout", () => {
      const store = useGraphStore();
      store.setLayout("circular");
      expect(store.layout).toBe("circular");
    });

    it("updateFilters merges into existing filters", () => {
      const store = useGraphStore();
      store.updateFilters({ minWeight: 0.5, limit: 100 });
      expect(store.filters.minWeight).toBe(0.5);
      expect(store.filters.limit).toBe(100);
      // untouched defaults remain
      expect(store.filters.relationTypes).toEqual([
        "link",
        "tag",
        "semantic",
        "temporal",
      ]);
    });

    it("reset clears nodes/edges/selection and zeroes stats", () => {
      const store = useGraphStore();
      store.nodes = [node("a")];
      store.edges = [edge("a", "b")];
      store.selectNode("a");
      store.stats.totalNodes = 5;
      store.reset();
      expect(store.nodes).toEqual([]);
      expect(store.edges).toEqual([]);
      expect(store.selectedNode).toBeNull();
      expect(store.stats.totalNodes).toBe(0);
    });
  });
});
