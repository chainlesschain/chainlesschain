# 企业知识图谱

> **版本: v4.5.0 | 状态: ✅ 生产就绪 | 8 IPC Handlers | 2 数据库表 | Phase 94**

ChainlessChain 企业知识图谱提供自动实体抽取与关系发现（NER）、知识图谱可视化（力导向布局）、类 Cypher 图查询语言、推理引擎（规则推理 + GNN 图神经网络）以及 GraphRAG 深度融合，构建企业级知识管理和智能检索能力。

## 概述

企业知识图谱模块通过 NER 自动实体抽取、类 Cypher 图查询、规则+GNN 推理引擎和 GraphRAG 增强检索，为企业构建结构化知识网络。系统支持多种可视化布局（力导向/层级/环形/径向）和批量导入导出（文档/CSV/JSON/RDF），提供 8 个 IPC 接口和 2 张核心数据表，实现从知识录入到智能检索的完整闭环。

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
├──────────┴──────────┴──────────┴────────────────┤
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

### 实体抽取结果为空

**现象**: `kg:import` 或 `kg:add-entity`（`autoExtract: true`）未抽取到任何实体。

**排查步骤**:
1. 确认输入文档内容为非空文本，且语言为 NER 模型支持的语言
2. 检查 `ner.minConfidence` 配置是否设置过高（默认 0.6），过高会过滤掉低置信度实体
3. 确认 `ner.entityTypes` 列表包含目标实体类型（如 Person、Technology）
4. 对于短文本或专业术语密集的内容，NER 效果有限，建议配合手动添加

### 图查询超时

**现象**: `kg:query` 执行时间过长或返回超时错误。

**排查步骤**:
1. 检查查询是否包含未限制的全图遍历（添加 `LIMIT` 子句限制结果数量）
2. 确认 `kg_entities` 和 `kg_relations` 表上的索引完整（`source_id`、`target_id`、`type`）
3. 对于包含大量关系的实体，使用 `filters` 限制查询的关系类型范围
4. 通过 `kg:get-stats` 查看图谱规模，节点/边过多时考虑分域查询

## 使用示例

### 从文档自动抽取实体与关系

```javascript
// 批量导入文档并自动抽取
const result = await window.electron.ipcRenderer.invoke("kg:import", {
  source: "documents",
  config: { path: "./docs/", recursive: true, deduplication: true },
});
// result.imported = { entities: 342, relations: 578 }

// 对单个实体开启自动关系抽取
await window.electron.ipcRenderer.invoke("kg:add-entity", {
  entity: { name: "Vue3", type: "Technology", properties: { description: "渐进式JavaScript框架..." } },
  autoExtract: true,
});
```

### 图查询与推理

```javascript
// 查询某技术的所有使用者
const users = await window.electron.ipcRenderer.invoke("kg:query", {
  cypher: "MATCH (o)-[:USES_TECHNOLOGY]->(t) WHERE t.name = 'Electron' RETURN o.name, o.type",
});

// 推理潜在关系
const inferred = await window.electron.ipcRenderer.invoke("kg:reason", {
  mode: "hybrid",
  query: { startEntity: "ent-001", targetRelation: "RELATED_TO" },
});
// inferred.inferences 包含规则和 GNN 推理出的新关系
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/enterprise/knowledge-graph.js` | 知识图谱核心引擎 |
| `desktop-app-vue/src/main/enterprise/ner-extractor.js` | NER 命名实体抽取 |
| `desktop-app-vue/src/main/enterprise/cypher-query-engine.js` | 类 Cypher 图查询引擎 |
| `desktop-app-vue/src/main/enterprise/reasoning-engine.js` | 推理引擎（Rules + GNN） |
| `desktop-app-vue/src/main/enterprise/graphrag-search.js` | GraphRAG 知识增强检索 |
| `desktop-app-vue/src/main/enterprise/kg-ipc.js` | 知识图谱 8 个 IPC Handler |

## 故障排查

### 常见问题

| 症状 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 实体抽取结果为空 | 输入文本格式不支持或 NER 模型未加载 | 确认输入为纯文本/Markdown，检查模型状态 `kg model-status` |
| 关系重复导致图谱膨胀 | 去重策略未启用或实体归一化不完整 | 启用 `deduplication`，执行 `kg entity-merge` |
| 图查询超时 | 查询复杂度高或索引缺失 | 简化查询路径深度，执行 `kg index-rebuild` |
| 知识图谱导入失败 | 数据格式不符合 schema 或文件过大 | 验证导入文件格式，分批导入大文件 |
| 实体关系链断裂 | 中间实体被删除或合并不当 | 执行 `kg integrity-check` 修复断裂关系 |

### 常见错误修复

**错误: `ENTITY_EXTRACTION_EMPTY` 实体抽取为空**

```bash
# 检查 NER 模型状态
chainlesschain kg model-status

# 使用调试模式查看抽取过程
chainlesschain kg extract --input <file> --debug
```

**错误: `DUPLICATE_RELATIONS` 关系重复**

```bash
# 执行实体合并去重
chainlesschain kg entity-merge --threshold 0.85

# 查看重复关系统计
chainlesschain kg stats --duplicates
```

**错误: `QUERY_TIMEOUT` 图查询超时**

```bash
# 重建图索引
chainlesschain kg index-rebuild

# 限制查询深度重试
chainlesschain kg query "<query>" --max-depth 3
```

## 配置参考

在 `.chainlesschain/config.json` 中完整配置企业知识图谱：

```javascript
{
  "knowledgeGraph": {
    // 全局开关
    "enabled": true,

    // NER 命名实体抽取
    "ner": {
      "model": "default",              // "default" | "custom" — 自定义模型需指定 modelPath
      "modelPath": null,               // 自定义 NER 模型路径（model="custom" 时必填）
      "entityTypes": [
        "Person", "Organization", "Location",
        "Event", "Concept", "Technology"
      ],
      "minConfidence": 0.6,            // 低于此值的实体标记为待审核
      "batchSize": 100,                // 批量导入时每批处理文档数
      "maxEntitiesPerDoc": 500         // 单文档最大抽取实体数，防止超长文档爆炸
    },

    // 可视化引擎
    "visualization": {
      "defaultLayout": "force-directed", // "force-directed" | "hierarchical" | "circular" | "radial"
      "maxNodes": 500,                   // 单次可视化最大节点数
      "clustering": true,                // 按实体类型聚类着色
      "physics": {
        "repulsion": -300,               // 节点排斥力（负值）
        "springLength": 150,             // 弹簧连接长度（px）
        "damping": 0.9                   // 阻尼系数（0~1，越大收敛越快）
      },
      "edgeRenderThreshold": 2000        // 边数超过此值时降级为简化渲染
    },

    // 推理引擎
    "reasoning": {
      "defaultMode": "hybrid",           // "rules" | "gnn" | "hybrid"
      "gnn": {
        "model": "GAT",                  // "GAT" | "GCN" | "GraphSAGE"
        "embeddingDim": 128,             // 向量维度
        "threshold": 0.8,               // 链接预测最小置信度
        "trainingEpochs": 50            // 增量训练轮数（图谱数据变化时触发）
      },
      "maxInferences": 100,             // 单次推理最大结果数，防止规则链爆炸
      "inferredRelationTTL": 86400000   // 推理关系 TTL（ms），过期后重新计算
    },

    // GraphRAG 搜索
    "graphrag": {
      "enabled": true,
      "maxGraphDepth": 3,               // 从锚点实体展开的最大跳数
      "contextTokenLimit": 5000,        // 注入 LLM 的图谱上下文最大 token 数
      "rerankEnabled": true,            // 按相关度对检索结果重排序
      "mode": "hybrid"                  // "local" | "global" | "hybrid"
    },

    // 导入导出
    "import": {
      "deduplication": true,            // 基于 (name, type) 唯一索引去重
      "autoExtractRelations": false,    // 导入时自动触发 NER 关系抽取
      "maxFileSizeMB": 100             // 单文件最大导入体积
    }
  }
}
```

### 关键配置项速查

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `ner.minConfidence` | `0.6` | NER 置信度下限，越高精度越高但召回率越低 |
| `visualization.maxNodes` | `500` | 超出此值自动截断，避免浏览器渲染卡顿 |
| `reasoning.maxInferences` | `100` | 推理结果上限，防止规则链无限扩散 |
| `graphrag.contextTokenLimit` | `5000` | 图谱上下文 token 预算，影响 LLM 生成质量 |
| `reasoning.inferredRelationTTL` | `86400000` | 推理关系有效期（24 小时），到期重算 |

---

## 性能指标

### 典型场景基准（8 核 / 16 GB RAM）

| 操作 | 图谱规模 | 典型耗时 | 说明 |
| --- | --- | --- | --- |
| NER 实体抽取 | 单文档 ≤ 10 KB | < 200 ms | 使用默认模型 |
| 批量导入 | 100 文档 / 批 | 30–60 s | 含 NER + 去重 |
| 类 Cypher 查询 | 1 万节点 / 5 万边 | < 50 ms | 有索引，简单模式匹配 |
| 类 Cypher 查询 | 10 万节点 / 50 万边 | < 500 ms | 有索引，深度 ≤ 3 |
| 可视化渲染 | 500 节点 / 2000 边 | < 100 ms | 力导向布局初始化 |
| GNN 推理（GAT）| 1 万节点 | 1–3 s | 链接预测，GPU 可降至 < 200 ms |
| GraphRAG 搜索 | 全图 | 1–5 s | 含图遍历 + LLM 生成 |
| JSON 导出 | 1 万实体 / 5 万关系 | 2–5 s | 含序列化 |

### 容量建议

| 图谱规模 | 推荐配置 | 备注 |
| --- | --- | --- |
| < 10 万节点 | 4 核 / 8 GB | 默认配置即可 |
| 10–50 万节点 | 8 核 / 16 GB | 建议启用 WAL 模式 + 增大索引缓存 |
| > 50 万节点 | 16 核 / 32 GB + SSD | 考虑分域查询和图分片策略 |

### 性能调优建议

- **索引维护**: 大批量导入后执行 `kg index-rebuild` 重建统计信息，提升查询计划质量
- **查询优化**: Cypher 查询添加 `LIMIT` 子句；路径查询深度控制在 ≤ 4 跳以内
- **可视化分页**: `maxNodes` 调低至 200 以内可显著提升前端渲染帧率
- **GNN 加速**: 启用 CUDA 时 GAT 推理可加速 10–15 倍，通过 `CUDA_VISIBLE_DEVICES` 指定 GPU
- **GraphRAG 缓存**: `contextTokenLimit` 降低可减少 LLM token 消耗，同时缩短响应时间

---

## 测试覆盖率

### 测试文件结构

```
desktop-app-vue/tests/unit/enterprise/
├── knowledge-graph.test.js          # 核心引擎单元测试（实体 CRUD、图查询）
├── ner-extractor.test.js            # NER 抽取准确率和边界测试
├── cypher-query-engine.test.js      # Cypher 解析器 + 执行器测试
├── reasoning-engine.test.js         # 规则推理 + GNN 链接预测测试
├── graphrag-search.test.js          # GraphRAG 检索 + 上下文注入测试
└── kg-ipc.test.js                   # 8 个 IPC Handler 集成测试
```

### 测试覆盖列表

| 测试文件 | 覆盖功能 | 测试数 |
| --- | --- | --- |
| `knowledge-graph.test.js` | 实体添加/查询/删除、关系 CRUD、去重逻辑 | 38 |
| `ner-extractor.test.js` | 6 种实体类型抽取、置信度过滤、批处理 | 24 |
| `cypher-query-engine.test.js` | MATCH 模式、WHERE 过滤、RETURN 投影、路径查询、聚合 | 31 |
| `reasoning-engine.test.js` | IF-THEN 规则链、GNN 链接预测、hybrid 模式、maxInferences 限制 | 27 |
| `graphrag-search.test.js` | local/global/hybrid 模式、上下文截断、来源追溯 | 19 |
| `kg-ipc.test.js` | 8 个 IPC 通道参数校验、错误响应格式 | 22 |
| **合计** | | **161** |

### 关键测试场景

✅ `kg:add-entity` 自动关系抽取（`autoExtract: true`）正确触发 NER  
✅ `kg:query` 类 Cypher MATCH 模式匹配多跳路径  
✅ `kg:query` 超时保护：深度 > 5 跳自动拒绝，返回 `QUERY_DEPTH_EXCEEDED`  
✅ `kg:visualize` force-directed 布局节点坐标非零（物理引擎稳定收敛）  
✅ `kg:reason` 规则链循环检测：存在循环规则时不无限递归  
✅ `kg:reason` GNN threshold 过滤：低置信度预测不出现在结果中  
✅ `kg:graphrag-search` contextTokenLimit 截断：超出 token 预算时截断最低相关度片段  
✅ `kg:import` CSV/JSON/RDF/文档四种格式导入均可正确解析  
✅ `kg:export` `filters.entityTypes` 过滤生效，敏感类型实体不出现在导出文件  
✅ `kg:get-stats` 返回 graphDensity 计算正确（关系数 / (节点数 × (节点数 - 1))）  
✅ NER `minConfidence` 低于阈值的实体标记 `pendingReview: true` 而非被丢弃  
✅ 唯一索引 `(name, type)` 阻止重复实体，返回现有实体 ID  
✅ 推理关系 `inferred: 1` 与显式关系区分存储，查询时可单独过滤  

---

## 安全考虑

### 数据访问控制
- **实体级权限**: 敏感实体（如人物、组织内部信息）应设置访问权限标签，图查询时根据用户角色过滤不可见实体
- **查询审计**: 所有 Cypher 查询操作记录到审计日志中，包含查询内容、执行者和返回结果数量，支持安全审计
- **导出脱敏**: 导出知识图谱时支持按实体类型过滤（`filters.entityTypes`），避免将内部敏感实体导出到外部

### NER 与推理安全
- **置信度阈值**: NER 自动抽取的实体设置最低置信度（`minConfidence: 0.6`），低于阈值的实体标记为待审核状态，防止错误实体污染图谱
- **推理结果标注**: GNN 和规则推理产生的关系标记 `inferred: 1` 和 `inference_method`，与人工标注的显式关系区分，避免推理错误被当作事实
- **推理数量限制**: `maxInferences` 限制单次推理最大结果数（默认 100），防止规则链爆炸导致性能问题和大量噪声关系

### GraphRAG 安全
- **上下文长度控制**: `contextTokenLimit` 限制注入 LLM 的图谱上下文大小（默认 5000 tokens），防止过大上下文导致 prompt injection 风险
- **来源可追溯**: GraphRAG 搜索结果包含 `sources` 字段，标注每个信息片段的来源实体和相关度，确保生成内容可溯源
- **数据不出域**: 知识图谱数据存储在本地 SQLite 中，GraphRAG 查询在本地完成，图谱数据不上传到外部 LLM 服务

### 导入安全
- **去重校验**: 批量导入时启用 `deduplication: true`，通过 `(name, type)` 唯一索引防止重复实体，保持图谱一致性
- **格式验证**: 导入 RDF/JSON/CSV 文件时自动校验数据格式和必填字段，拒绝格式不合规的数据

## 相关文档

- [知识库管理](/chainlesschain/knowledge)
- [RAG 搜索](/chainlesschain/rag)
- [BI 智能分析](/chainlesschain/bi-engine)
- [低代码/无代码平台](/chainlesschain/low-code-platform)
