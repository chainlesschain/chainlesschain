# graph-ipc

**Source**: `src/main/knowledge-graph/graph-ipc.js`

**Generated**: 2026-02-15T07:37:13.826Z

---

## const

```javascript
const
```

* Knowledge Graph IPC Handlers
 * 知识图谱系统 IPC 处理器
 *
 * 提供11个IPC处理器用于知识图谱的构建、查询和管理

---

## function registerGraphIPC(context)

```javascript
function registerGraphIPC(context)
```

* 注册知识图谱相关的IPC处理器
 * @param {Object} context - 上下文对象
 * @param {Object} context.database - 数据库管理器实例
 * @param {Object} context.graphExtractor - 图谱提取器实例
 * @param {Object} context.llmManager - LLM管理器实例

---

