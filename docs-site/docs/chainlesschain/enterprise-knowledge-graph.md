# 企业知识图谱

> **版本: v4.5.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 2 数据库表 | Phase 94**

ChainlessChain 企业知识图谱提供自动实体抽取与关系发现（NER）、知识图谱可视化（力导向布局）、类 Cypher 图查询语言、推理引擎（规则推理 + GNN 图神经网络）以及 GraphRAG 深度融合，构建企业级知识管理和智能检索能力。

## 核心特性

- 🔍 **自动实体抽取**: NER 命名实体识别，自动从文档中提取人物、组织、地点、事件等实体及其关系
- 🌐 **知识图谱可视化**: 力导向图（Force-Directed Graph）布局，支持缩放、拖拽、聚类着色和关系过滤
- 💬 **图查询语言**: 类 Cypher 查询语法，支持模式匹配、路径查询、聚合统计
- 🧠 **推理引擎**: 规则推理（IF-THEN 规则链）+ GNN 图神经网络（链接预测、节点分类）
- 🔗 **GraphRAG 深度融合**: 知识图谱增强的 RAG 检索，结合图结构上下文提升生成质量

## 系统架构

```
┌─────────────────────────────────────────────────┐
│              应用层 (8 IPC Handlers)              │
│  add-entity │ query │ visualize │ reason │ ...   │
├─────────────┴───────┴───────────┴────────┴──────┤
│         Enterprise Knowledge Graph Engine        │
├──────────┬──────────┬──────────┬────────────────┤
│  NER     │ Cypher   │ 推理引擎  │ GraphRAG       │
│  实体    │ 图查询   │ Rules    │ 知识增强       │
│  抽取    │ 引擎     │ + GNN    │ RAG 检索       │
├──────────┴──────────┴──────────┴──────────────��─┤
│     可视化引擎 (力导向/层级/环形/径向布局)        │
├─────────────────────────────────────────────────┤
│  SQLite (kg_entities, kg_relations) + Embedding  │
└─────────────────────────────────────────────────┘
```

## 添加实体

```javascript
const result = await window.electron.ipcRenderer.invoke("kg:add-entity", {
  entity: {
    name: "ChainlessChain",
    type: "Organization", // Person | Organization | Location | Event | Concept | Technology
    properties: {
      description: "去中心化个人 AI 管理系统",
      founded: "2024",
      domain: "AI + Blockchain",
    },
  },
  relations: [
    {
      target: "Electron",
      type: "USES_TECHNOLOGY",
      properties: { since: "v1.0" },
    },
    { target: "Vue3", type: "USES_TECHNOLOGY", properties: { since: "v1.0" } },
  ],
  autoExtract: false, // true 则从 properties.description 自动抽取更多关系
});
// {
//   success: true,
//   entityId: "ent-001",
//   relationsCreated: 2,
//   autoExtracted: { entities: 0, relations: 0 }
// }
```

## 图查询

```javascript
const result = await window.electron.ipcRenderer.invoke("kg:query", {
  cypher:
    "MATCH (o:Organization)-[:USES_TECHNOLOGY]->(t:Technology) WHERE t.name = 'Vue3' RETURN o.name, o.domain",
  params: {},
  limit: 50,
  explain: false, // true 返回查询执行计划
});
// {
//   success: true,
//   results: [
//     { "o.name": "ChainlessChain", "o.domain": "AI + Blockchain" }
//   ],
//   count: 1,
//   executionTime: 12
// }
```

## 知识图谱可视化

```javascript
const result = await window.electron.ipcRenderer.invoke("kg:visualize", {
  centerEntity: "ent-001",
  depth: 2, // 展开深度
  maxNodes: 200,
  layout: "force-directed", // force-directed | hierarchical | circular | radial
  filters: {
    entityTypes: ["Organization", "Technology", "Person"],
    relationTypes: ["USES_TECHNOLOGY", "FOUNDED_BY", "WORKS_AT"],
  },
  clustering: true, // 按实体类型聚类着色
});
// {
//   success: true,
//   graph: {
//     nodes: [
//       { id: "ent-001", label: "ChainlessChain", type: "Organization", cluster: 0, x: 120, y: 85 },
//       { id: "ent-002", label: "Electron", type: "Technology", cluster: 1, x: 250, y: 130 },
//       ...
//     ],
//     edges: [
//       { source: "ent-001", target: "ent-002", type: "USES_TECHNOLOGY", label: "USES_TECHNOLOGY" },
//       ...
//     ],
//     clusters: [{ id: 0, label: "Organization", color: "#1890ff" }, { id: 1, label: "Technology", color: "#52c41a" }]
//   },
//   totalNodes: 47,
//   totalEdges: 63
// }
```

## 推理

```javascript
const result = await window.electron.ipcRenderer.invoke("kg:reason", {
  mode: "rules", // rules | gnn | hybrid
  query: {
    startEntity: "ent-001",
    targetRelation: "COMPETES_WITH", // 推理潜在竞争关系
  },
  rules: [
    {
      name: "same-domain-competitor",
      condition: "MATCH (a)-[:IN_DOMAIN]->(d)<-[:IN_DOMAIN]-(b) WHERE a <> b",
      conclusion: "(a)-[:COMPETES_WITH]->(b)",
      confidence: 0.7,
    },
  ],
  gnnConfig: {
    model: "GAT", // GAT | GCN | GraphSAGE
    task: "link_prediction", // link_prediction | node_classification
    threshold: 0.8,
  },
});
// {
//   success: true,
//   inferences: [
//     { source: "ChainlessChain", target: "CompetitorX", relation: "COMPETES_WITH", confidence: 0.85, method: "rules" },
//     { source: "ChainlessChain", target: "CompetitorY", relation: "COMPETES_WITH", confidence: 0.82, method: "gnn" }
//   ],
//   rulesApplied: 1,
//   gnnPredictions: 1
// }
```

## GraphRAG 搜索

```javascript
const result = await window.electron.ipcRenderer.invoke("kg:graphrag-search", {
  query: "ChainlessChain 使用了哪些核心技术，这些技术之间有什么关联？",
  mode: "global", // local | global | hybrid
  graphDepth: 3,
  maxContext: 5000, // tokens
  includeSubgraph: true,
  rerankByRelevance: true,
});
// {
//   success: true,
//   answer: "ChainlessChain 使用了 Electron、Vue3、SQLite 等核心技术...",
//   subgraph: { nodes: [...], edges: [...] },
//   sources: [
//     { entityId: "ent-001", name: "ChainlessChain", relevance: 0.95 },
//     { entityId: "ent-002", name: "Electron", relevance: 0.88 }
//   ],
//   graphContext: "Organization(ChainlessChain) -[USES_TECHNOLOGY]-> Technology(Electron, Vue3, SQLite) ..."
// }
```

## 导入知识

```javascript
const result = await window.electron.ipcRenderer.invoke("kg:import", {
  source: "documents", // documents | csv | json | rdf
  config: {
    path: "/data/knowledge-base/",
    recursive: true,
    nerModel: "default", // default | custom
    batchSize: 100,
    deduplication: true,
  },
});
// { success: true, imported: { entities: 342, relations: 578, duplicatesSkipped: 23 }, duration: 45000 }
```

## 导出知识图谱

```javascript
const result = await window.electron.ipcRenderer.invoke("kg:export", {
  format: "json", // json | rdf | csv | graphml
  filters: {
    entityTypes: ["Organization", "Technology"],
  },
  includeProperties: true,
});
// { success: true, exportPath: "/exports/knowledge-graph-20260310.json", entities: 342, relations: 578, size: 2097152 }
```

## 获取统计

```javascript
const result = await window.electron.ipcRenderer.invoke("kg:get-stats");
// {
//   success: true,
//   stats: {
//     totalEntities: 1523,
//     totalRelations: 4217,
//     entityTypes: { Organization: 120, Person: 450, Technology: 280, Concept: 673 },
//     relationTypes: { USES_TECHNOLOGY: 350, WORKS_AT: 280, RELATED_TO: 1200, ... },
//     avgDegree: 5.5,
//     graphDensity: 0.0036,
//     lastUpdated: 1710100000000
//   }
// }
```

## IPC 接口完整列表

### 知识图谱操作（8 个）

| 通道                 | 功能          | 说明                       |
| -------------------- | ------------- | -------------------------- |
| `kg:add-entity`      | 添加实体      | 支持自动关系抽取（NER）    |
| `kg:query`           | 图查询        | 类 Cypher 查询语法         |
| `kg:visualize`       | 可视化        | 力导向/层级/环形/径向布局  |
| `kg:reason`          | 推理          | 规则推理 + GNN 图神经网络  |
| `kg:graphrag-search` | GraphRAG 搜索 | 知识图谱增强的 RAG 检索    |
| `kg:import`          | 导入知识      | 文档/CSV/JSON/RDF 批量导入 |
| `kg:export`          | 导出图谱      | JSON/RDF/CSV/GraphML 导出  |
| `kg:get-stats`       | 获取统计      | 实体数、关系数、图密度等   |

## 数据库 Schema

**2 张核心表**:

| 表名           | 用途     | 关键字段                                   |
| -------------- | -------- | ------------------------------------------ |
| `kg_entities`  | 实体存储 | id, name, type, properties, embedding      |
| `kg_relations` | 关系存储 | id, source_id, target_id, type, properties |

### kg_entities 表

```sql
CREATE TABLE IF NOT EXISTS kg_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                  -- Person | Organization | Location | Event | Concept | Technology
  properties TEXT,                     -- JSON: 实体属性
  embedding BLOB,                      -- 实体向量嵌入（用于 GNN 和语义搜索）
  source TEXT,                         -- 来源文档或导入批次
  confidence REAL DEFAULT 1.0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_kg_ent_name ON kg_entities(name);
CREATE INDEX IF NOT EXISTS idx_kg_ent_type ON kg_entities(type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kg_ent_name_type ON kg_entities(name, type);
```

### kg_relations 表

```sql
CREATE TABLE IF NOT EXISTS kg_relations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,                  -- USES_TECHNOLOGY | WORKS_AT | RELATED_TO | COMPETES_WITH | ...
  properties TEXT,                     -- JSON: 关系属性
  confidence REAL DEFAULT 1.0,
  inferred INTEGER DEFAULT 0,          -- 0: 显式 | 1: 推理得出
  inference_method TEXT,               -- rules | gnn | hybrid
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
  FOREIGN KEY (source_id) REFERENCES kg_entities(id),
  FOREIGN KEY (target_id) REFERENCES kg_entities(id)
);
CREATE INDEX IF NOT EXISTS idx_kg_rel_source ON kg_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_kg_rel_target ON kg_relations(target_id);
CREATE INDEX IF NOT EXISTS idx_kg_rel_type ON kg_relations(type);
```

## 配置

在 `.chainlesschain/config.json` 中配置：

```json
{
  "knowledgeGraph": {
    "enabled": true,
    "ner": {
      "model": "default",
      "entityTypes": [
        "Person",
        "Organization",
        "Location",
        "Event",
        "Concept",
        "Technology"
      ],
      "minConfidence": 0.6,
      "batchSize": 100
    },
    "visualization": {
      "defaultLayout": "force-directed",
      "maxNodes": 500,
      "clustering": true,
      "physics": {
        "repulsion": -300,
        "springLength": 150,
        "damping": 0.9
      }
    },
    "reasoning": {
      "defaultMode": "hybrid",
      "gnn": {
        "model": "GAT",
        "embeddingDim": 128,
        "threshold": 0.8
      },
      "maxInferences": 100
    },
    "graphrag": {
      "enabled": true,
      "maxGraphDepth": 3,
      "contextTokenLimit": 5000,
      "rerankEnabled": true
    }
  }
}
```

## 故障排除

| 问题                    | 解决方案                                          |
| ----------------------- | ------------------------------------------------- |
| NER 抽取实体不准确      | 调高 minConfidence 阈值或使用自定义模型           |
| 可视化节点太多导致卡顿  | 减小 maxNodes 或增大展开深度限制                  |
| Cypher 查询语法错误     | 检查节点/关系标签拼写，确认语法与 Cypher 标准一致 |
| GNN 推理结果置信度低    | 增加训练数据量，确保图谱中有足够的标注关系        |
| GraphRAG 检索结果不相关 | 调整 graphDepth 和 contextTokenLimit 参数         |

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/enterprise/knowledge-graph.js` | 知识图谱核心引擎 |
| `desktop-app-vue/src/main/enterprise/ner-extractor.js` | NER 命名实体抽取 |
| `desktop-app-vue/src/main/enterprise/cypher-query-engine.js` | 类 Cypher 图查询引擎 |
| `desktop-app-vue/src/main/enterprise/reasoning-engine.js` | 推理引擎（Rules + GNN） |
| `desktop-app-vue/src/main/enterprise/graphrag-search.js` | GraphRAG 知识增强检索 |
| `desktop-app-vue/src/main/enterprise/kg-ipc.js` | 知识图谱 8 个 IPC Handler |

## 相关文档

- [知识库管理](/chainlesschain/knowledge)
- [RAG 搜索](/chainlesschain/rag)
- [BI 智能分析](/chainlesschain/bi-engine)
- [低代码/无代码平台](/chainlesschain/low-code-platform)
