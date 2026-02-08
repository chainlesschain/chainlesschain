# ChainlessChain 主进程类型声明

本目录包含 ChainlessChain 主进程（Electron Main Process）的 TypeScript 类型声明文件。

## 📁 目录结构

```
src/main/types/
├── index.d.ts                    # 统一导出文件
├── database.d.ts                 # 数据库模块类型
├── session-manager.d.ts          # 会话管理类型
├── rag.d.ts                      # RAG 系统类型
├── permission.d.ts               # 权限系统类型
├── browser.d.ts                  # 浏览器自动化类型
├── context-engineering.d.ts      # 上下文工程类型
├── memory.d.ts                   # 永久记忆系统类型
├── ai-engine.d.ts                # AI 引擎类型
└── README.md                     # 本文件
```

## 🚀 使用方法

### 1. 导入单个模块类型

```typescript
// 导入数据库类型
import type { DatabaseManager, KnowledgeItem } from "@main/types/database";

// 导入会话管理类型
import type { SessionManager, Session } from "@main/types/session-manager";

// 导入 RAG 系统类型
import type { RAGManager, RAGDocument } from "@main/types/rag";
```

### 2. 从统一入口导入

```typescript
// 导入所有类型
import type {
  DatabaseManager,
  SessionManager,
  RAGManager,
  PermissionEngine,
  BrowserEngine,
} from "@main/types";
```

### 3. 在 JavaScript 文件中使用（JSDoc）

```javascript
/**
 * @typedef {import('@main/types/database').DatabaseManager} DatabaseManager
 * @typedef {import('@main/types/database').KnowledgeItem} KnowledgeItem
 */

/**
 * 添加知识库项目
 * @param {DatabaseManager} db - 数据库实例
 * @param {Partial<KnowledgeItem>} item - 知识库项目
 * @returns {Promise<number>} 新项目的 ID
 */
async function addKnowledgeItem(db, item) {
  return db.addKnowledgeItem(item);
}
```

### 4. 类型检查

```bash
# 运行 TypeScript 类型检查
npm run type-check

# 在开发时持续检查
npm run type-check -- --watch
```

## 📦 模块说明

### Database (`database.d.ts`)

数据库模块类型声明，包括：

- `DatabaseManager` - 主数据库管理类
- `KnowledgeItem` - 知识库项目
- `ChatSession` - 聊天会话
- `Project` - 项目信息
- `Permission` - 权限记录
- SQL 查询相关类型

**示例**：

```typescript
import type { DatabaseManager, KnowledgeItem } from "@main/types/database";

const db: DatabaseManager = getDatabase();
const items: KnowledgeItem[] = await db.getAllKnowledgeItems();
```

### Session Manager (`session-manager.d.ts`)

会话管理模块类型声明，包括：

- `SessionManager` - 会话管理器类
- `Session` - 会话数据
- `SessionMessage` - 会话消息
- `CompressionResult` - 压缩结果
- 搜索、导出、模板相关类型

**示例**：

```typescript
import type { SessionManager, Session } from "@main/types/session-manager";

const sessionManager: SessionManager = getSessionManager();
const session: Session = await sessionManager.createSession({
  title: "New Session",
});
```

### RAG System (`rag.d.ts`)

RAG 检索增强生成系统类型声明，包括：

- `RAGManager` - RAG 管理器类
- `HybridSearchEngine` - 混合搜索引擎
- `BM25Search` - BM25 搜索引擎
- `RAGDocument` - RAG 文档
- `RetrievalResult` - 检索结果

**示例**：

```typescript
import type { RAGManager, RAGDocument } from "@main/types/rag";

const ragManager: RAGManager = getRAGManager();
const results = await ragManager.retrieve("query text", { topK: 5 });
```

### Permission System (`permission.d.ts`)

权限系统类型声明，包括：

- `PermissionEngine` - 权限引擎类
- `TeamManager` - 团队管理器类
- `DelegationManager` - 委托管理器类
- `ApprovalWorkflowManager` - 审批工作流管理器类
- RBAC 相关类型

**示例**：

```typescript
import type {
  PermissionEngine,
  PermissionCheckResult,
} from "@main/types/permission";

const permissionEngine: PermissionEngine = getPermissionEngine();
const result: PermissionCheckResult = await permissionEngine.checkPermission(
  "user",
  "user-123",
  "knowledge",
  "doc-456",
  "read",
);
```

### Browser Automation (`browser.d.ts`)

浏览器自动化类型声明，包括：

- `BrowserEngine` - 浏览器引擎类
- `ElementLocatorService` - 元素定位服务
- `RecordingEngine` - 录制引擎
- `SnapshotEngine` - 快照引擎
- `SmartDiagnostics` - 智能诊断

**示例**：

```typescript
import type { BrowserEngine, RecordedAction } from "@main/types/browser";

const browser: BrowserEngine = createBrowserEngine({ headless: false });
await browser.goto("https://example.com");
await browser.click({ strategy: "css", selector: "#button" });
```

### Context Engineering (`context-engineering.d.ts`)

上下文工程类型声明，包括：

- `ContextEngineering` - 上下文工程类
- `TokenEstimate` - Token 估算
- `ContextOptimizationResult` - 上下文优化结果
- `KVCacheHitStats` - KV-Cache 统计
- 压缩策略相关类型

**示例**：

```typescript
import type {
  ContextEngineering,
  StructuredMessage,
} from "@main/types/context-engineering";

const contextEng: ContextEngineering = getContextEngineering();
const result = await contextEng.optimizeContext(messages, { maxTokens: 8000 });
```

### Permanent Memory (`memory.d.ts`)

永久记忆系统类型声明，包括：

- `PermanentMemoryManager` - 永久记忆管理器类
- `DailyNoteEntry` - Daily Note 条目
- `MemorySection` - 记忆段落
- `MemorySearchResult` - 记忆搜索结果
- 索引和刷新相关类型

**示例**：

```typescript
import type {
  PermanentMemoryManager,
  DailyNoteEntry,
} from "@main/types/memory";

const memoryManager: PermanentMemoryManager = getPermanentMemoryManager();
await memoryManager.logActivity({
  timestamp: new Date().toISOString(),
  content: "Completed feature implementation",
  type: "activity",
});
```

### AI Engine (`ai-engine.d.ts`)

AI 引擎类型声明，包括：

- `PlanModeManager` - 计划模式管理器
- `SkillManager` - 技能管理器
- `CoworkOrchestrator` - Cowork 编排器
- `Plan` - 计划定义
- `SkillDefinition` - 技能定义
- `Agent` - 智能体定义

**示例**：

```typescript
import type { PlanModeManager, Plan } from "@main/types/ai-engine";

const planMode: PlanModeManager = getPlanModeManager();
planMode.enterPlanMode();
const plan: Plan = planMode.createPlan("Refactor code", "Refactor modules", []);
```

## 🛠️ 开发指南

### 添加新的类型声明

1. 在相应模块目录下创建 `.d.ts` 文件
2. 导出类型定义
3. 在 `index.d.ts` 中添加导出

```typescript
// 新建 src/main/types/new-module.d.ts
export interface NewModule {
  // ...
}

// 在 index.d.ts 中添加
export * from "./new-module";
```

### 类型命名规范

- **接口/类型**: 使用 PascalCase（如 `DatabaseManager`）
- **常量**: 使用 UPPER_SNAKE_CASE（如 `MAX_RETRIES`）
- **函数**: 使用 camelCase（如 `getDatabase`）
- **事件名**: 使用 kebab-case（如 `'session-created'`）

### JSDoc 注释

为类型定义添加详细的 JSDoc 注释：

````typescript
/**
 * 数据库管理器配置选项
 *
 * @example
 * ```typescript
 * const options: DatabaseOptions = {
 *   password: 'secret',
 *   encryptionEnabled: true
 * };
 * ```
 */
export interface DatabaseOptions {
  /** 加密密码 */
  password?: string;
  /** 是否启用加密 (默认 true) */
  encryptionEnabled?: boolean;
}
````

## 📝 最佳实践

1. **优先使用类型导入**：

   ```typescript
   // ✅ 推荐
   import type { DatabaseManager } from "@main/types";

   // ❌ 避免（可能导致运行时导入）
   import { DatabaseManager } from "@main/types";
   ```

2. **使用泛型提高复用性**：

   ```typescript
   // 定义泛型类型
   export interface QueryResult<T> {
     data: T;
     total: number;
   }

   // 使用泛型类型
   const result: QueryResult<KnowledgeItem> = await db.query();
   ```

3. **善用联合类型和交叉类型**：

   ```typescript
   // 联合类型
   type Status = "pending" | "completed" | "failed";

   // 交叉类型
   type ExtendedSession = Session & { customField: string };
   ```

4. **保持类型定义与实现同步**：
   - 当修改实现代码时，同步更新类型声明
   - 使用 `npm run type-check` 验证类型正确性

## 🔍 故障排查

### 类型未找到

```bash
# 确保 tsconfig.json 包含类型声明文件
"include": ["src/**/*.d.ts"]

# 重启 TypeScript 服务器（VSCode）
Cmd/Ctrl + Shift + P -> "TypeScript: Restart TS Server"
```

### 类型冲突

```typescript
// 使用命名空间避免冲突
declare namespace Database {
  export interface Manager {
    // ...
  }
}

// 使用导入别名
import type { Manager as DBManager } from "@main/types/database";
```

## 📚 参考资源

- [TypeScript 官方文档](https://www.typescriptlang.org/docs/)
- [TypeScript 声明文件](https://www.typescriptlang.org/docs/handbook/declaration-files/introduction.html)
- [JSDoc 类型注释](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)

## 🤝 贡献

欢迎为类型声明文件贡献！请确保：

1. 类型定义准确反映实际实现
2. 添加详细的 JSDoc 注释
3. 遵循项目的命名规范
4. 运行 `npm run type-check` 确保无错误

## 📄 许可

MIT License - 与主项目保持一致
