package com.chainlesschain.android.feature.knowledgegraph.data

import com.chainlesschain.android.feature.knowledgegraph.domain.model.GraphData
import com.chainlesschain.android.feature.knowledgegraph.domain.model.GraphEdge
import com.chainlesschain.android.feature.knowledgegraph.domain.model.GraphNode
import com.chainlesschain.android.feature.knowledgegraph.domain.model.NodeType
import com.chainlesschain.android.feature.knowledgegraph.domain.model.RelationType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * [GraphAnalytics] 单测：知识图谱核心算法（最短路径 BFS + 度中心性），此前无直测。
 * 图算法算错会污染图谱分析/推荐。用已知答案的小图（有向链 + 无向图）钉确定行为，尤其有向性。
 */
class GraphAnalyticsTest {

    private val analytics = GraphAnalytics()

    private fun node(id: String) = GraphNode(id = id, label = id, type = NodeType.CONCEPT)

    private fun edge(from: String, to: String, directed: Boolean = true) =
        GraphEdge(id = "$from-$to", source = from, target = to, type = RelationType.RELATED_TO, directed = directed)

    /** 有向链 A→B→C→D + 孤立节点 E。 */
    private fun chainGraph() = GraphData(
        nodes = listOf("A", "B", "C", "D", "E").map(::node),
        edges = listOf(edge("A", "B"), edge("B", "C"), edge("C", "D")),
    )

    @Test
    fun `findShortestPath follows directed edges A to D`() {
        val path = analytics.findShortestPath(chainGraph(), "A", "D")
        assertEquals(listOf("A", "B", "C", "D"), path?.map { it.id })
    }

    @Test
    fun `findShortestPath returns single node for same source and target`() {
        assertEquals(listOf("A"), analytics.findShortestPath(chainGraph(), "A", "A")?.map { it.id })
    }

    @Test
    fun `findShortestPath returns null against edge direction`() {
        assertNull(analytics.findShortestPath(chainGraph(), "D", "A"))
    }

    @Test
    fun `findShortestPath returns null for unreachable isolated node`() {
        assertNull(analytics.findShortestPath(chainGraph(), "A", "E"))
    }

    @Test
    fun `findShortestPath traverses undirected edges both ways`() {
        val g = GraphData(
            nodes = listOf("A", "B", "C").map(::node),
            edges = listOf(edge("A", "B", directed = false), edge("B", "C", directed = false)),
        )
        assertEquals(listOf("C", "B", "A"), analytics.findShortestPath(g, "C", "A")?.map { it.id })
    }

    @Test
    fun `degreeCentrality counts incident edges normalized by max degree`() {
        val c = analytics.calculateDegreeCentrality(chainGraph())
        // 入射边数: A=1, B=2, C=2, D=1, E=0; 最大=2 → 归一化
        assertEquals(1.0, c.getValue("B"), 1e-9)
        assertEquals(1.0, c.getValue("C"), 1e-9)
        assertEquals(0.5, c.getValue("A"), 1e-9)
        assertEquals(0.5, c.getValue("D"), 1e-9)
        assertEquals(0.0, c.getValue("E"), 1e-9)
    }
}
