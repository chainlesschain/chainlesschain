# Bootstrap 初始化失败分析和解决方案

## 问题总结

应用启动时出现两类重复错误，根本原因是 **Bootstrap 初始化失败**，导致 `templateManager` 和 `organizationManager` 未正确初始化（值为 `undefined`）。

## 关键证据

### 1. 日志证据

```
[2026-02-04T07:51:50.122Z] [INFO] [main] [Bootstrap] 开始应用初始化...
[2026-02-04T07:51:50.123Z] [ERROR] [main] [Main] Bootstrap 初始化失败:  ← 但没有具体错误信息！
[2026-02-04T07:51:50.329Z] [INFO] [main] [Template IPC] templateManager初始化状态: {
  "exists": false,    ← templateManager 是 undefined
  "type": "undefined"
}
```

### 2. 代码分析

**主进程 (`index.js:165-189`)**:

```javascript
try {
  const instances = await bootstrapApplication({...});
  this.applyInstances(instances); // 如果 instances 是 undefined，所有管理器都会是 undefined
  logger.info("[Main] Bootstrap 初始化完成");
} catch (error) {
  logger.error("[Main] Bootstrap 初始化失败:", error); // ← 捕获但只记录，继续执行
}
```

**问题**:
- Bootstrap 抛出错误，被 catch 捕获
- 只记录了 "[Main] Bootstrap 初始化失败:" 但**没有记录 error 对象**！
- 应用继续执行，但 `instances` 是 undefined
- `applyInstances(undefined)` 导致所有管理器都是 undefined

**InitializerFactory (`initializer-factory.js:145-170`)**:

```javascript
} catch (error) {
  const result = {
    success: false,
    name,
    duration,
    error,
  };

  this.results.set(name, result);

  if (config.required) {
    logger.error(`[InitializerFactory] ✗ ${name} 初始化失败 (必需模块):`, error);
    throw error; // ← 必需模块失败会抛出错误
  } else {
    logger.warn(`[InitializerFactory] ⚠ ${name} 初始化失败 (非必需，继续启动):`, error.message);
    // ← 非必需模块失败只警告，不抛出错误
  }

  return result;
}
```

**Bootstrap 配置**:

```javascript
// core-initializer.js:104-113
factory.register({
  name: "templateManager",
  dependsOn: ["database"],
  // 没有 required: true，默认是非必需模块
  async init(context) {
    const ProjectTemplateManager = require("../template/template-manager");
    const manager = new ProjectTemplateManager(context.database);
    await manager.initialize();
    return manager;
  },
});

// social-initializer.js:140-151
factory.register({
  name: "organizationManager",
  dependsOn: ["database", "didManager", "p2pManager"],
  // 没有 required: true，默认是非必需模块
  async init(context) {
    const OrganizationManager = require("../organization/organization-manager");
    return new OrganizationManager(
      context.database,
      context.didManager,
      context.p2pManager,
    );
  },
});
```

## 根本原因推测

基于证据，可能的失败原因有：

### 假设 1: 必需依赖模块失败（最可能）

`templateManager` 依赖 `database`，`organizationManager` 依赖 `database`, `didManager`, `p2pManager`。

如果 `database` 或其他必需依赖模块（配置了 `required: true`）初始化失败，会抛出错误，导致整个 Bootstrap 失败。

**需要检查的模块**: `database`, `didManager`, `p2pManager`

### 假设 2: 循环依赖检测失败

Bootstrap 会检测循环依赖：

```javascript
if (canRun.length === 0 && pending.size > 0) {
  logger.error("[InitializerFactory] 检测到循环依赖:", Array.from(pending));
  throw new Error("初始化器存在循环依赖");
}
```

### 假设 3: Promise.all 失败

`runParallel` 使用 `Promise.all`，如果任何模块抛出错误（必需模块），整个 Promise.all 会拒绝。

## 解决方案

### 方案 1: 改进错误日志 ✅ 最重要

**问题**: `index.js:188` 只记录了 "Bootstrap 初始化失败:" 但没有记录 `error` 对象！

**修复**:

```javascript
// desktop-app-vue/src/main/index.js:188
} catch (error) {
  logger.error("[Main] Bootstrap 初始化失败:", error);  // ← 原代码
  logger.error("[Main] Bootstrap 初始化失败 - 错误类型:", error?.name);
  logger.error("[Main] Bootstrap 初始化失败 - 错误消息:", error?.message);
  logger.error("[Main] Bootstrap 初始化失败 - 错误堆栈:", error?.stack);
}
```

### 方案 2: Bootstrap 失败时停止启动（推荐）

如果 Bootstrap 失败，不应该继续启动应用，因为关键组件未初始化。

```javascript
} catch (error) {
  logger.error("[Main] Bootstrap 初始化失败:", error);
  logger.error("[Main] Bootstrap 初始化失败 - 错误详情:", {
    name: error?.name,
    message: error?.message,
    stack: error?.stack
  });

  // 显示错误对话框
  const { dialog } = require('electron');
  dialog.showErrorBox(
    '应用初始化失败',
    `应用初始化过程中发生错误，无法继续启动。\n\n错误: ${error?.message || '未知错误'}\n\n请查看日志文件获取详细信息。`
  );

  // 退出应用
  app.quit();
  return; // ← 停止执行
}
```

### 方案 3: 防御性编程 - IPC 注册时检查管理器

在 IPC 注册阶段增加更多检查：

```javascript
// desktop-app-vue/src/main/ipc/ipc-registry.js
// 模板管理 (函数模式 - 大模块，20 handlers)
if (app.templateManager) {
  logger.info("[IPC Registry] Registering Template IPC...");
  const { registerTemplateIPC } = require("../template/template-ipc");
  registerTemplateIPC({
    templateManager: app.templateManager,
  });
  logger.info("[IPC Registry] ✓ Template IPC registered (20 handlers)");
} else {
  logger.error("[IPC Registry] ❌ templateManager 未初始化，跳过 Template IPC 注册");
}

// 组织管理 (函数模式 - 大模块，32 handlers)
if (app.organizationManager || app.database) {
  logger.info("[IPC Registry] Registering Organization IPC...");
  const { registerOrganizationIPC } = require("../organization/organization-ipc");
  registerOrganizationIPC({
    organizationManager: app.organizationManager,
    dbManager: app.database,
    versionManager: app.versionManager,
  });
  logger.info("[IPC Registry] ✓ Organization IPC registered (32 handlers)");
} else {
  logger.error("[IPC Registry] ❌ organizationManager/database 未初始化，跳过 Organization IPC 注册");
}
```

### 方案 4: 将关键模块设置为必需 required

```javascript
// desktop-app-vue/src/main/bootstrap/core-initializer.js
factory.register({
  name: "templateManager",
  required: true, // ← 设置为必需
  dependsOn: ["database"],
  async init(context) {
    const ProjectTemplateManager = require("../template/template-manager");
    const manager = new ProjectTemplateManager(context.database);
    await manager.initialize();
    return manager;
  },
});
```

但这可能会导致整个应用无法启动，如果模板功能不是核心功能的话。

## 立即行动步骤

### 步骤 1: 改进错误日志（最高优先级）

修复 `index.js:188` 以记录完整的错误信息。

### 步骤 2: 重新启动并查看详细错误

重新运行应用，查看完整的 Bootstrap 失败原因。

### 步骤 3: 根据具体错误修复

根据步骤 2 的日志，确定具体是哪个模块初始化失败，然后修复该模块。

### 步骤 4: 添加防御性代码

实施方案 2（停止启动）或方案 3（IPC 注册检查）。

## 下一步诊断

如果改进日志后仍然看不到具体错误，可以在 Bootstrap 代码中添加更多日志：

```javascript
// desktop-app-vue/src/main/bootstrap/index.js
async function bootstrapApplication(options = {}) {
  const { progressCallback, context = {} } = options;

  logger.info("=".repeat(60));
  logger.info("[Bootstrap] 开始应用初始化...");
  logger.info("=".repeat(60));

  try {
    const startTime = Date.now();

    // 重置工厂状态
    initializerFactory.reset();

    // 设置进度回调
    if (progressCallback) {
      initializerFactory.setProgressCallback(progressCallback);
    }

    // 注册所有初始化器
    logger.info("[Bootstrap] 注册所有初始化器...");
    registerAllInitializers(initializerFactory);
    logger.info("[Bootstrap] 初始化器注册完成");

    // 执行分阶段初始化
    logger.info("[Bootstrap] 开始分阶段初始化...");
    await initializerFactory.runPhased(INIT_PHASES, context);
    logger.info("[Bootstrap] 分阶段初始化完成");

    // 获取所有实例
    const instances = initializerFactory.getAllInstances();
    logger.info("[Bootstrap] 获取实例完成，实例数量:", Object.keys(instances).length);

    // 🔥 Post-init: 绑定 Hooks 到其他管理器
    try {
      logger.info("[Bootstrap] 绑定 Hooks 到管理器...");
      await bindHooksToManagers(instances);
      logger.info("[Bootstrap] Hooks 绑定完成");
    } catch (error) {
      logger.warn("[Bootstrap] Hooks 绑定失败 (非致命):", error.message);
    }

    // 打印统计信息
    initializerFactory.printStats();

    const duration = Date.now() - startTime;
    logger.info("=".repeat(60));
    logger.info(`[Bootstrap] 应用初始化完成，总耗时: ${duration}ms`);
    logger.info("=".repeat(60));

    return instances;
  } catch (error) {
    logger.error("[Bootstrap] 初始化过程中发生错误:", error);
    logger.error("[Bootstrap] 错误详情:", {
      name: error?.name,
      message: error?.message,
      stack: error?.stack
    });
    throw error; // ← 重新抛出以便上层捕获
  }
}
```

---

**生成时间**: 2026-02-04
**生成者**: Claude Sonnet 4.5
**优先级**: P0 (Critical)
**预计修复时间**: 5-10分钟（改进日志） + 根据具体错误确定
