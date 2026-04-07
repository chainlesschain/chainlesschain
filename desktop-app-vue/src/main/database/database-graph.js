/**
 * database-graph — extracted from database.js as part of H3 split (v0.45.33).
 *
 * Each function takes the DatabaseManager instance and a logger; behavior
 * is byte-identical to the original DatabaseManager methods. The class
 * itself keeps thin delegate methods so the public API is unchanged.
 *
 * Extracted on 2026-04-07.
 */

function addRelation(
  dbManager,
  logger,
  sourceId,
  targetId,
  type,
  weight = 1.0,
  metadata = null,
) {
  const id = dbManager.generateId();
  const createdAt = Date.now();
  const metadataStr = metadata ? JSON.stringify(metadata) : null;

  const stmt = dbManager.db.prepare(`
    INSERT INTO knowledge_relations (id, source_id, target_id, relation_type, weight, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run([id, sourceId, targetId, type, weight, metadataStr, createdAt]);
  stmt.free();

  return { id, sourceId, targetId, type, weight, metadata, createdAt };
}

function addRelations(dbManager, logger, relations) {
  if (!relations || relations.length === 0) {
    return 0;
  }

  const stmt = dbManager.db.prepare(`
    INSERT OR IGNORE INTO knowledge_relations (id, source_id, target_id, relation_type, weight, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;
  relations.forEach((rel) => {
    const id = dbManager.generateId();
    const createdAt = Date.now();
    const metadataStr = rel.metadata ? JSON.stringify(rel.metadata) : null;

    try {
      stmt.run([
        id,
        rel.sourceId,
        rel.targetId,
        rel.type,
        rel.weight || 1.0,
        metadataStr,
        createdAt,
      ]);
      count++;
    } catch (error) {
      logger.error(
        `[Database] 添加关系失败 (${rel.sourceId} -> ${rel.targetId}):`,
        error,
      );
    }
  });

  stmt.free();
  return count;
}

function deleteRelations(dbManager, logger, noteId, types = []) {
  if (!noteId) {
    return 0;
  }

  let query;
  let params;

  if (types && types.length > 0) {
    const placeholders = types.map(() => "?").join(",");
    query = `
      DELETE FROM knowledge_relations
      WHERE (source_id = ? OR target_id = ?)
      AND relation_type IN (${placeholders})
    `;
    params = [noteId, noteId, ...types];
  } else {
    query = `
      DELETE FROM knowledge_relations
      WHERE source_id = ? OR target_id = ?
    `;
    params = [noteId, noteId];
  }

  const stmt = dbManager.db.prepare(query);
  stmt.run(params);
  const changes = dbManager.db.getRowsModified();
  stmt.free();

  return changes;
}

function getGraphData(dbManager, logger, options = {}) {
  const {
    relationTypes = ["link", "tag", "semantic", "temporal"],
    minWeight = 0.0,
    nodeTypes = ["note", "document", "conversation", "web_clip"],
    limit = 500,
  } = options;

  // 1. 查询涉及关系的所有笔记ID
  const relationTypesList = relationTypes.map(() => "?").join(",");
  const relStmt = dbManager.db.prepare(`
    SELECT DISTINCT source_id as id FROM knowledge_relations
    WHERE relation_type IN (${relationTypesList}) AND weight >= ?
    UNION
    SELECT DISTINCT target_id as id FROM knowledge_relations
    WHERE relation_type IN (${relationTypesList}) AND weight >= ?
    LIMIT ?
  `);
  relStmt.bind([
    ...relationTypes,
    minWeight,
    ...relationTypes,
    minWeight,
    limit,
  ]);

  const nodeIds = [];
  while (relStmt.step()) {
    nodeIds.push(relStmt.getAsObject().id);
  }
  relStmt.free();

  // 2. 查询这些笔记的详细信息
  const nodes = [];
  if (nodeIds.length > 0) {
    const nodeTypesFilter = nodeTypes.map(() => "?").join(",");
    const idsFilter = nodeIds.map(() => "?").join(",");
    const nodeStmt = dbManager.db.prepare(`
      SELECT id, title, type, created_at, updated_at
      FROM knowledge_items
      WHERE id IN (${idsFilter}) AND type IN (${nodeTypesFilter})
    `);
    nodeStmt.bind([...nodeIds, ...nodeTypes]);

    while (nodeStmt.step()) {
      const node = nodeStmt.getAsObject();
      nodes.push({
        id: node.id,
        title: node.title,
        type: node.type,
        createdAt: node.created_at,
        updatedAt: node.updated_at,
      });
    }
    nodeStmt.free();
  }

  // 3. 查询这些节点之间的关系
  const edges = [];
  if (nodeIds.length > 0) {
    const idsFilter = nodeIds.map(() => "?").join(",");
    const relationTypesFilter = relationTypes.map(() => "?").join(",");
    const edgeStmt = dbManager.db.prepare(`
      SELECT id, source_id, target_id, relation_type, weight, metadata
      FROM knowledge_relations
      WHERE source_id IN (${idsFilter})
        AND target_id IN (${idsFilter})
        AND relation_type IN (${relationTypesFilter})
        AND weight >= ?
    `);
    edgeStmt.bind([...nodeIds, ...nodeIds, ...relationTypes, minWeight]);

    while (edgeStmt.step()) {
      const edge = edgeStmt.getAsObject();
      edges.push({
        id: edge.id,
        source: edge.source_id,
        target: edge.target_id,
        type: edge.relation_type,
        weight: edge.weight,
        metadata: edge.metadata ? JSON.parse(edge.metadata) : null,
      });
    }
    edgeStmt.free();
  }

  return { nodes, edges };
}

function getKnowledgeRelations(dbManager, logger, knowledgeId) {
  const stmt = dbManager.db.prepare(`
    SELECT * FROM knowledge_relations
    WHERE source_id = ? OR target_id = ?
    ORDER BY weight DESC
  `);
  stmt.bind([knowledgeId, knowledgeId]);

  const relations = [];
  while (stmt.step()) {
    const rel = stmt.getAsObject();
    relations.push({
      id: rel.id,
      source: rel.source_id,
      target: rel.target_id,
      type: rel.relation_type,
      weight: rel.weight,
      metadata: rel.metadata ? JSON.parse(rel.metadata) : null,
      createdAt: rel.created_at,
    });
  }
  stmt.free();

  return relations;
}

function findRelationPath(dbManager, logger, sourceId, targetId, maxDepth = 3) {
  if (sourceId === targetId) {
    return { nodes: [sourceId], edges: [], length: 0 };
  }

  // BFS算法
  const queue = [{ id: sourceId, path: [sourceId], edgePath: [] }];
  const visited = new Set([sourceId]);

  // 获取所有关系（双向）
  const stmt = dbManager.db.prepare(`
    SELECT source_id, target_id, id as edge_id, relation_type, weight
    FROM knowledge_relations
  `);

  const graph = new Map();
  while (stmt.step()) {
    const rel = stmt.getAsObject();

    // 正向边
    if (!graph.has(rel.source_id)) {
      graph.set(rel.source_id, []);
    }
    graph.get(rel.source_id).push({
      to: rel.target_id,
      edgeId: rel.edge_id,
      type: rel.relation_type,
      weight: rel.weight,
    });

    // 反向边（无向图）
    if (!graph.has(rel.target_id)) {
      graph.set(rel.target_id, []);
    }
    graph.get(rel.target_id).push({
      to: rel.source_id,
      edgeId: rel.edge_id,
      type: rel.relation_type,
      weight: rel.weight,
    });
  }
  stmt.free();

  // BFS搜索
  while (queue.length > 0) {
    const current = queue.shift();

    if (current.path.length > maxDepth) {
      continue;
    }

    const neighbors = graph.get(current.id) || [];
    for (const neighbor of neighbors) {
      if (neighbor.to === targetId) {
        // 找到目标
        return {
          nodes: [...current.path, targetId],
          edges: [...current.edgePath, neighbor.edgeId],
          length: current.path.length,
        };
      }

      if (!visited.has(neighbor.to)) {
        visited.add(neighbor.to);
        queue.push({
          id: neighbor.to,
          path: [...current.path, neighbor.to],
          edgePath: [...current.edgePath, neighbor.edgeId],
        });
      }
    }
  }

  return null; // 未找到路径
}

function getKnowledgeNeighbors(dbManager, logger, knowledgeId, depth = 1) {
  const allNodes = new Set([knowledgeId]);
  const allEdges = new Map();
  let currentLevel = [knowledgeId];

  for (let d = 0; d < depth; d++) {
    const nextLevel = [];

    currentLevel.forEach((nodeId) => {
      const stmt = dbManager.db.prepare(`
        SELECT id, source_id, target_id, relation_type, weight, metadata
        FROM knowledge_relations
        WHERE source_id = ? OR target_id = ?
      `);
      stmt.bind([nodeId, nodeId]);

      while (stmt.step()) {
        const edge = stmt.getAsObject();
        const otherId =
          edge.source_id === nodeId ? edge.target_id : edge.source_id;

        if (!allNodes.has(otherId)) {
          allNodes.add(otherId);
          nextLevel.push(otherId);
        }

        if (!allEdges.has(edge.id)) {
          allEdges.set(edge.id, {
            id: edge.id,
            source: edge.source_id,
            target: edge.target_id,
            type: edge.relation_type,
            weight: edge.weight,
            metadata: edge.metadata ? JSON.parse(edge.metadata) : null,
          });
        }
      }
      stmt.free();
    });

    currentLevel = nextLevel;
  }

  // 查询节点详情
  const nodes = [];
  const nodeIds = Array.from(allNodes);
  if (nodeIds.length > 0) {
    const idsFilter = nodeIds.map(() => "?").join(",");
    const stmt = dbManager.db.prepare(`
      SELECT id, title, type, created_at, updated_at
      FROM knowledge_items
      WHERE id IN (${idsFilter})
    `);
    stmt.bind(nodeIds);

    while (stmt.step()) {
      const node = stmt.getAsObject();
      nodes.push({
        id: node.id,
        title: node.title,
        type: node.type,
        createdAt: node.created_at,
        updatedAt: node.updated_at,
      });
    }
    stmt.free();
  }

  return {
    nodes,
    edges: Array.from(allEdges.values()),
  };
}

function buildTagRelations(dbManager, logger) {
  // 清除旧的标签关系
  const deleteStmt = dbManager.db.prepare(`
    DELETE FROM knowledge_relations WHERE relation_type = 'tag'
  `);
  deleteStmt.step();
  deleteStmt.free();

  // 查询共享标签的笔记对
  const stmt = dbManager.db.prepare(`
    SELECT
      k1.knowledge_id as source_id,
      k2.knowledge_id as target_id,
      COUNT(*) as shared_tags
    FROM knowledge_tags k1
    JOIN knowledge_tags k2 ON k1.tag_id = k2.tag_id
    WHERE k1.knowledge_id < k2.knowledge_id
    GROUP BY k1.knowledge_id, k2.knowledge_id
    HAVING shared_tags > 0
  `);

  const relations = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();

    // 计算权重：共享标签数 / 最大标签数
    const source = dbManager.getKnowledgeTags(row.source_id);
    const target = dbManager.getKnowledgeTags(row.target_id);
    const maxTags = Math.max(source.length, target.length);
    const weight = maxTags > 0 ? row.shared_tags / maxTags : 0;

    relations.push({
      sourceId: row.source_id,
      targetId: row.target_id,
      type: "tag",
      weight: weight,
      metadata: { sharedTags: row.shared_tags },
    });
  }
  stmt.free();

  // 批量插入
  return dbManager.addRelations(relations);
}

function buildTemporalRelations(dbManager, logger, windowDays = 7) {
  // 清除旧的时间关系
  const deleteStmt = dbManager.db.prepare(`
    DELETE FROM knowledge_relations WHERE relation_type = 'temporal'
  `);
  deleteStmt.step();
  deleteStmt.free();

  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  // 查询时间接近的笔记对
  const stmt = dbManager.db.prepare(`
    SELECT
      k1.id as source_id,
      k2.id as target_id,
      k1.created_at as source_time,
      k2.created_at as target_time
    FROM knowledge_items k1
    JOIN knowledge_items k2 ON k1.id < k2.id
    WHERE ABS(k1.created_at - k2.created_at) <= ?
    ORDER BY k1.created_at ASC
  `);
  stmt.bind([windowMs]);

  const relations = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const timeDiff = Math.abs(row.target_time - row.source_time);
    const daysDiff = timeDiff / (24 * 60 * 60 * 1000);

    // 权重：时间越近权重越高
    const weight = 1 / (1 + daysDiff);

    relations.push({
      sourceId:
        row.source_time < row.target_time ? row.source_id : row.target_id,
      targetId:
        row.source_time < row.target_time ? row.target_id : row.source_id,
      type: "temporal",
      weight: weight,
      metadata: { daysDiff: daysDiff.toFixed(2) },
    });
  }
  stmt.free();

  return dbManager.addRelations(relations);
}

module.exports = {
  addRelation,
  addRelations,
  deleteRelations,
  getGraphData,
  getKnowledgeRelations,
  findRelationPath,
  getKnowledgeNeighbors,
  buildTagRelations,
  buildTemporalRelations,
};
