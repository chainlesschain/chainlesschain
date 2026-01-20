# Bootstrap 模块使用指南

## 概述

Bootstrap 模块将 index.js 中的 3800+ 行初始化代码模块化，提供：

- **模块化初始化**: 将初始化逻辑按功能分组
- **依赖管理**: 自动处理模块间依赖
- **并行初始化**: 无依赖的模块并行初始化
- **懒加载支持**: 延迟初始化不常用的模块
- **进度报告**: 初始化进度回调
- **错误恢复**: 非必需模块失败不影响启动

## 目录结构

```
bootstrap/
├── index.js                 # 入口文件，导出所有模块
├── initializer-factory.js   # 初始化器工厂，核心调度逻辑
├── core-initializer.js      # 核心模块：数据库、LLM、RAG
├── social-initializer.js    # 社交模块：DID、P2P、联系人
├── ai-initializer.js        # AI 引擎：技能工具、MCP
├── trade-initializer.js     # 交易模块：资产、市场
└── USAGE.md                 # 本文档
```

## 快速开始

### 方式 1: 完整替换 onReady (推荐)

```javascript
// index.js
const {
  bootstrapApplication,
  getAllModules,
  lazyLoadModule,
} = require("./bootstrap");

class ChainlessChainApp {
  async onReady() {
    // 创建启动画面
    this.splashWindow = new SplashWindow();
    await this.splashWindow.create();

    // 执行初始化
    const instances = await bootstrapApplication({
      progressCallback: (message, progress) => {
        this.splashWindow?.updateProgress(message, progress);
      },
      context: { mainWindow: this.mainWindow },
    });

    // 保存实例引用
    Object.assign(this, instances);

    // 创建主窗口
    await this.createWindow();
  }

  // 懒加载区块链模块
  async initializeBlockchainModules() {
    const blockchain = await lazyLoadModule("blockchainModules");
    Object.assign(this, blockchain);
  }
}
```

### 方式 2: 渐进式迁移

保留现有 index.js 结构，逐步替换各模块初始化：

```javascript
// index.js - 渐进式迁移
const { initializerFactory, registerCoreInitializers } = require("./bootstrap");

class ChainlessChainApp {
  async onReady() {
    // 注册核心模块
    registerCoreInitializers(initializerFactory);

    // 只初始化核心模块
    await initializerFactory.runParallel([
      "database",
      "llmManager",
      "ragManager",
    ]);

    // 获取实例
    this.database = initializerFactory.getInstance("database");
    this.llmManager = initializerFactory.getInstance("llmManager");
    this.ragManager = initializerFactory.getInstance("ragManager");

    // 其余模块保持原有初始化方式
    // ...
  }
}
```

## 初始化阶段

模块按以下阶段初始化：

| 阶段 | 进度 | 模块                                                                   |
| ---- | ---- | ---------------------------------------------------------------------- |
| 1    | 10%  | database, graphExtractor, versionManager, performanceMonitor           |
| 2    | 20%  | fileImporter, templateManager, ukeyManager                             |
| 3    | 35%  | llmSelector, tokenTracker, promptCompressor, responseCache, llmManager |
| 4    | 45%  | sessionManager, errorMonitor, multiAgent, memoryBank                   |
| 5    | 55%  | ragManager, promptTemplateManager, gitManager                          |
| 6    | 65%  | didManager, p2pManager, contactManager, friendManager, postManager     |
| 7    | 75%  | organizationManager, collaborationManager, syncEngine, vcManager       |
| 8    | 85%  | webEngine, documentEngine, dataEngine, aiEngineManager, webideManager  |
| 9    | 90%  | toolManager, skillManager, skillExecutor, aiScheduler, chatSkillBridge |
| 10   | 95%  | assetManager, escrowManager, marketplaceManager, contractEngine        |

## 懒加载模块

以下模块配置为懒加载，仅在首次访问时初始化：

- `mcpSystem` - MCP 协议系统
- `pluginSystem` - 插件系统
- `blockchainModules` - 区块链模块

```javascript
// 懒加载示例
const { lazyLoadModule } = require("./bootstrap");

// 用户首次访问区块链功能时
async function onBlockchainAccess() {
  const blockchain = await lazyLoadModule("blockchainModules");
  // 使用 blockchain.walletManager, blockchain.blockchainAdapter 等
}
```

## 添加新模块

在相应的初始化器文件中注册：

```javascript
// ai-initializer.js
factory.register({
  name: "myNewModule",
  dependsOn: ["database", "llmManager"], // 依赖
  required: false, // 是否必需
  lazy: false, // 是否懒加载
  async init(context) {
    const MyModule = require("../my-module");
    const instance = new MyModule(context.database, context.llmManager);
    await instance.initialize();
    return instance;
  },
});
```

## API 参考

### bootstrapApplication(options)

执行完整的应用初始化。

```typescript
interface BootstrapOptions {
  progressCallback?: (message: string, progress: number) => void;
  context?: Record<string, any>;
}

function bootstrapApplication(
  options: BootstrapOptions,
): Promise<Record<string, any>>;
```

### lazyLoadModule(name, context?)

懒加载指定模块。

```typescript
function lazyLoadModule(
  name: string,
  context?: Record<string, any>,
): Promise<any>;
```

### getModule(name)

获取已初始化的模块实例。

```typescript
function getModule(name: string): any;
```

### getAllModules()

获取所有已初始化的模块实例。

```typescript
function getAllModules(): Record<string, any>;
```

## 预期效果

- **代码行数**: index.js 从 3805 行减少到 ~800 行
- **可维护性**: 按功能分组，易于定位和修改
- **测试性**: 各模块可独立测试
- **启动速度**: 懒加载减少初始化时间
- **扩展性**: 新模块只需在对应文件中注册

## 迁移检查清单

- [ ] 创建 bootstrap/ 目录 ✅
- [ ] 实现 initializer-factory.js ✅
- [ ] 实现 core-initializer.js ✅
- [ ] 实现 social-initializer.js ✅
- [ ] 实现 ai-initializer.js ✅
- [ ] 实现 trade-initializer.js ✅
- [ ] 更新 index.js 使用 bootstrap
- [ ] 测试所有模块初始化
- [ ] 验证懒加载功能
- [ ] 更新文档

## 注意事项

1. **事件监听器**: 部分事件监听器（如 UKey、Git）需要在初始化后单独设置
2. **IPC 注册**: IPC 处理器仍通过 `ipc-registry.js` 注册，bootstrap 不处理 IPC
3. **向后兼容**: 保留原有的属性名和方法签名
