# ChainlessChain 插件系统架构设计方案

## 1. 架构概览

### 1.1 核心组件关系

```
┌─────────────────────────────────────────────────────────────┐
│                     Main Process (Electron)                  │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │          PluginManager (插件管理器)                 │    │
│  │  - 生命周期管理                                      │    │
│  │  - 插件注册表                                        │    │
│  │  - 权限验证                                          │    │
│  └───────┬──────────────────────────────────┬─────────┘    │
│          │                                   │               │
│  ┌───────▼────────┐                 ┌───────▼─────────┐    │
│  │  PluginLoader  │                 │ PermissionSystem│    │
│  │  - 发现插件     │                 │ - 权限声明       │    │
│  │  - 验证manifest │                 │ - 授权管理       │    │
│  │  - 加载代码     │                 │ - API代理        │    │
│  └───────┬────────┘                 └─────────────────┘    │
│          │                                                   │
│  ┌───────▼──────────────────────────────────────────────┐  │
│  │              PluginSandbox (沙箱隔离)                 │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
│  │  │ Plugin A    │  │ Plugin B    │  │ Plugin C    │  │  │
│  │  │ (Worker)    │  │ (Worker)    │  │ (Worker)    │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
│          │                                                   │
│  ┌───────▼──────────────────────────────────────────────┐  │
│  │         Extension Points (扩展点系统)                 │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ │  │
│  │  │UI扩展点  │ │数据扩展点│ │AI扩展点  │ │生命周期 │ │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └─────────┘ │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────┬───────────────────────────────────────┘
                       │ IPC
┌──────────────────────▼───────────────────────────────────────┐
│                  Renderer Process (Vue3)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         PluginUIManager (UI插件管理器)                │   │
│  │  - 动态路由注册                                        │   │
│  │  - 组件挂载                                            │   │
│  │  - 菜单扩展                                            │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 技术栈选择

| 组件 | 技术选型 | 理由 |
|------|---------|------|
| 沙箱隔离 | Node.js Worker Threads | 轻量级、共享内存、易于通信、性能好 |
| 通信机制 | Worker MessagePort + IPC | 类型安全、双向通信、支持transferable |
| 权限控制 | Capability-based Security | 细粒度、可撤销、易于审计 |
| UI扩展 | Vue3 Dynamic Components | 与现有架构一致、支持异步组件 |
| 插件发现 | 文件系统扫描 + NPM | 支持混合模式、开发友好 |
| 配置存储 | SQLite (复用现有数据库) | 统一存储、事务支持、易于备份 |

---

## 2. 核心组件详细设计

### 2.1 PluginManager (插件管理器)

**职责**：
- 插件生命周期管理（加载、启用、禁用、卸载）
- 插件注册表维护
- 依赖解析
- 版本管理和更新

**核心API**：

```javascript
class PluginManager extends EventEmitter {
  constructor(database, config = {}) {
    super();
    this.database = database;
    this.registry = new PluginRegistry(database);
    this.loader = new PluginLoader();
    this.sandbox = new PluginSandbox();
    this.permissionManager = new PermissionManager(database);

    this.plugins = new Map(); // pluginId -> PluginInstance
    this.extensionPoints = new Map(); // 扩展点管理

    this.isInitialized = false;
  }

  async initialize() {
    // 1. 初始化数据库表
    await this.registry.initialize();

    // 2. 注册内置扩展点
    this.registerBuiltInExtensionPoints();

    // 3. 扫描并加载已安装的插件
    const installedPlugins = await this.registry.getInstalledPlugins();

    for (const pluginMeta of installedPlugins) {
      if (pluginMeta.enabled) {
        await this.loadPlugin(pluginMeta.id);
      }
    }

    this.isInitialized = true;
    this.emit('initialized', { pluginCount: this.plugins.size });
  }

  /**
   * 安装插件
   * @param {string} source - 插件来源（文件路径、NPM包名、ZIP路径）
   * @param {Object} options - 安装选项
   */
  async installPlugin(source, options = {}) {
    this.emit('plugin:installing', { source });

    try {
      // 1. 解析插件来源
      const pluginPath = await this.loader.resolve(source, options);

      // 2. 加载并验证 manifest
      const manifest = await this.loader.loadManifest(pluginPath);
      this.validateManifest(manifest);

      // 3. 检查兼容性
      this.checkCompatibility(manifest);

      // 4. 解析依赖
      await this.resolveDependencies(manifest);

      // 5. 请求权限授权
      const granted = await this.requestPermissions(manifest);
      if (!granted) {
        throw new Error('用户拒绝授权插件权限');
      }

      // 6. 复制插件到安装目录
      const installedPath = await this.loader.install(pluginPath, manifest);

      // 7. 注册到数据库
      await this.registry.register(manifest, installedPath);

      this.emit('plugin:installed', { pluginId: manifest.id });

      return { success: true, pluginId: manifest.id };
    } catch (error) {
      this.emit('plugin:install-failed', { source, error: error.message });
      throw error;
    }
  }

  /**
   * 加载插件
   */
  async loadPlugin(pluginId) {
    if (this.plugins.has(pluginId)) {
      console.warn(`[PluginManager] 插件已加载: ${pluginId}`);
      return;
    }

    const pluginMeta = await this.registry.getPlugin(pluginId);
    if (!pluginMeta) {
      throw new Error(`插件不存在: ${pluginId}`);
    }

    this.emit('plugin:loading', { pluginId });

    try {
      // 1. 创建沙箱环境
      const sandbox = await this.sandbox.createSandbox(pluginId, {
        permissions: pluginMeta.permissions,
        manifest: pluginMeta.manifest,
      });

      // 2. 加载插件代码
      const pluginCode = await this.loader.loadCode(pluginMeta.path);

      // 3. 在沙箱中执行
      const pluginInstance = await sandbox.execute(pluginCode);

      // 4. 调用插件的 onLoad 钩子
      if (pluginInstance.onLoad) {
        await pluginInstance.onLoad();
      }

      // 5. 保存插件实例
      this.plugins.set(pluginId, {
        id: pluginId,
        instance: pluginInstance,
        sandbox,
        manifest: pluginMeta.manifest,
        state: 'loaded',
      });

      this.emit('plugin:loaded', { pluginId });
    } catch (error) {
      this.emit('plugin:load-failed', { pluginId, error: error.message });
      throw error;
    }
  }

  /**
   * 启用插件
   */
  async enablePlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      await this.loadPlugin(pluginId);
    }

    const pluginObj = this.plugins.get(pluginId);

    if (pluginObj.state === 'enabled') {
      return;
    }

    this.emit('plugin:enabling', { pluginId });

    try {
      // 1. 调用 onEnable 钩子
      if (pluginObj.instance.onEnable) {
        await pluginObj.instance.onEnable();
      }

      // 2. 注册扩展点
      await this.registerPluginExtensions(pluginId, pluginObj);

      // 3. 更新状态
      pluginObj.state = 'enabled';
      await this.registry.updatePluginState(pluginId, 'enabled');

      this.emit('plugin:enabled', { pluginId });
    } catch (error) {
      this.emit('plugin:enable-failed', { pluginId, error: error.message });
      throw error;
    }
  }

  /**
   * 禁用插件
   */
  async disablePlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || plugin.state !== 'enabled') {
      return;
    }

    this.emit('plugin:disabling', { pluginId });

    try {
      // 1. 注销扩展点
      await this.unregisterPluginExtensions(pluginId);

      // 2. 调用 onDisable 钩子
      if (plugin.instance.onDisable) {
        await plugin.instance.onDisable();
      }

      // 3. 更新状态
      plugin.state = 'disabled';
      await this.registry.updatePluginState(pluginId, 'disabled');

      this.emit('plugin:disabled', { pluginId });
    } catch (error) {
      this.emit('plugin:disable-failed', { pluginId, error: error.message });
      throw error;
    }
  }

  /**
   * 卸载插件
   */
  async uninstallPlugin(pluginId) {
    // 1. 禁用插件
    if (this.plugins.has(pluginId)) {
      await this.disablePlugin(pluginId);
    }

    this.emit('plugin:uninstalling', { pluginId });

    try {
      // 2. 销毁沙箱
      const plugin = this.plugins.get(pluginId);
      if (plugin) {
        await plugin.sandbox.destroy();
        this.plugins.delete(pluginId);
      }

      // 3. 从文件系统删除
      const pluginMeta = await this.registry.getPlugin(pluginId);
      await this.loader.uninstall(pluginMeta.path);

      // 4. 从数据库删除
      await this.registry.unregister(pluginId);

      this.emit('plugin:uninstalled', { pluginId });
    } catch (error) {
      this.emit('plugin:uninstall-failed', { pluginId, error: error.message });
      throw error;
    }
  }

  /**
   * 注册扩展点
   */
  registerExtensionPoint(name, handler) {
    this.extensionPoints.set(name, {
      name,
      handler,
      extensions: [],
    });
  }

  /**
   * 触发扩展点
   */
  async triggerExtensionPoint(name, context) {
    const extensionPoint = this.extensionPoints.get(name);
    if (!extensionPoint) {
      return;
    }

    const results = [];

    for (const extension of extensionPoint.extensions) {
      try {
        const result = await extension.handler(context);
        results.push(result);
      } catch (error) {
        console.error(`[PluginManager] 扩展执行失败:`, error);
        this.emit('extension:error', { extension: extension.id, error });
      }
    }

    return results;
  }
}
```

**数据库Schema**：

```sql
-- 插件注册表
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,                    -- 插件ID (如 com.example.myplugin)
  name TEXT NOT NULL,                     -- 插件名称
  version TEXT NOT NULL,                  -- 版本号 (semver)
  author TEXT,                            -- 作者
  description TEXT,                       -- 描述
  path TEXT NOT NULL,                     -- 安装路径
  manifest TEXT NOT NULL,                 -- manifest JSON
  enabled INTEGER DEFAULT 1,              -- 是否启用
  state TEXT DEFAULT 'installed',         -- 状态: installed, enabled, disabled
  installed_at INTEGER NOT NULL,          -- 安装时间
  updated_at INTEGER NOT NULL,            -- 更新时间
  last_enabled_at INTEGER,                -- 最后启用时间

  UNIQUE(id)
);

-- 插件权限
CREATE TABLE IF NOT EXISTS plugin_permissions (
  plugin_id TEXT NOT NULL,
  permission TEXT NOT NULL,               -- 权限名称 (如 database.read)
  granted INTEGER DEFAULT 0,              -- 是否已授权
  granted_at INTEGER,                     -- 授权时间

  PRIMARY KEY (plugin_id, permission),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

-- 插件依赖
CREATE TABLE IF NOT EXISTS plugin_dependencies (
  plugin_id TEXT NOT NULL,
  dependency_id TEXT NOT NULL,            -- 依赖的插件ID或NPM包
  dependency_type TEXT DEFAULT 'plugin',  -- 类型: plugin, npm
  version_constraint TEXT,                -- 版本约束 (如 ^1.0.0)

  PRIMARY KEY (plugin_id, dependency_id),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

-- 扩展点注册
CREATE TABLE IF NOT EXISTS plugin_extensions (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  extension_point TEXT NOT NULL,          -- 扩展点名称
  config TEXT,                            -- 扩展配置 JSON
  priority INTEGER DEFAULT 100,           -- 优先级 (数字越小优先级越高)

  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

CREATE INDEX idx_plugins_enabled ON plugins(enabled);
CREATE INDEX idx_plugin_extensions_point ON plugin_extensions(extension_point);
```

---

### 2.2 PluginLoader (插件加载器)

**职责**：
- 支持多种插件来源（本地文件夹、NPM包、ZIP压缩包）
- 验证插件manifest
- 插件代码加载

**核心实现**：

```javascript
class PluginLoader {
  constructor() {
    this.pluginsDir = path.join(app.getPath('userData'), 'plugins');
    this.tempDir = path.join(app.getPath('temp'), 'chainlesschain-plugins');
  }

  /**
   * 解析插件来源
   * @param {string} source - 可以是：
   *   - 本地路径: /path/to/plugin
   *   - NPM包名: @org/plugin-name 或 plugin-name
   *   - ZIP文件: /path/to/plugin.zip
   */
  async resolve(source, options = {}) {
    // 1. 检查是否为本地路径
    if (fs.existsSync(source)) {
      const stat = fs.statSync(source);

      if (stat.isDirectory()) {
        return source; // 开发模式：直接使用本地目录
      }

      if (stat.isFile() && source.endsWith('.zip')) {
        // 解压ZIP到临时目录
        const extractPath = path.join(this.tempDir, `extract_${Date.now()}`);
        await this.extractZip(source, extractPath);
        return extractPath;
      }
    }

    // 2. 尝试作为NPM包处理
    if (this.isNpmPackage(source)) {
      return await this.installFromNpm(source, options);
    }

    throw new Error(`无法解析插件来源: ${source}`);
  }

  /**
   * 加载插件manifest
   */
  async loadManifest(pluginPath) {
    const manifestPath = path.join(pluginPath, 'plugin.json');

    if (!fs.existsSync(manifestPath)) {
      // 回退到 package.json
      const packagePath = path.join(pluginPath, 'package.json');
      if (fs.existsSync(packagePath)) {
        return this.parsePackageJson(packagePath);
      }

      throw new Error('找不到 plugin.json 或 package.json');
    }

    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * 安装插件到插件目录
   */
  async install(sourcePath, manifest) {
    const targetPath = path.join(
      this.pluginsDir,
      manifest.category || 'custom',
      manifest.id
    );

    // 创建目标目录
    fs.mkdirSync(targetPath, { recursive: true });

    // 复制文件
    await this.copyDirectory(sourcePath, targetPath);

    // 安装NPM依赖（如果有）
    if (manifest.dependencies && Object.keys(manifest.dependencies).length > 0) {
      await this.installNpmDependencies(targetPath);
    }

    return targetPath;
  }

  /**
   * 从NPM安装
   */
  async installFromNpm(packageName, options) {
    const { version } = options;
    const versionSuffix = version ? `@${version}` : '';
    const fullPackage = `${packageName}${versionSuffix}`;

    const installPath = path.join(this.tempDir, `npm_${Date.now()}`);
    fs.mkdirSync(installPath, { recursive: true });

    // 执行 npm install
    await this.execCommand(`npm install ${fullPackage} --prefix ${installPath}`);

    // 返回安装后的路径
    return path.join(installPath, 'node_modules', packageName);
  }

  /**
   * 加载插件代码
   */
  async loadCode(pluginPath) {
    const manifest = await this.loadManifest(pluginPath);
    const entryFile = manifest.main || 'index.js';
    const entryPath = path.join(pluginPath, entryFile);

    if (!fs.existsSync(entryPath)) {
      throw new Error(`插件入口文件不存在: ${entryPath}`);
    }

    // 读取代码
    const code = fs.readFileSync(entryPath, 'utf-8');

    return {
      code,
      entryPath,
      manifest,
    };
  }

  /**
   * 卸载插件
   */
  async uninstall(pluginPath) {
    if (fs.existsSync(pluginPath)) {
      await fs.promises.rm(pluginPath, { recursive: true, force: true });
    }
  }
}
```

---

### 2.3 PluginSandbox (沙箱隔离)

**职责**：
- 在隔离环境中运行插件代码
- 提供受限的API访问
- 防止恶意代码执行

**技术选型**：使用 Node.js Worker Threads

```javascript
const { Worker } = require('worker_threads');

class PluginSandbox {
  constructor() {
    this.sandboxes = new Map(); // pluginId -> Worker
  }

  /**
   * 创建沙箱
   */
  async createSandbox(pluginId, options = {}) {
    const { permissions, manifest } = options;

    // 创建 Worker 线程
    const worker = new Worker(path.join(__dirname, 'plugin-worker.js'), {
      workerData: {
        pluginId,
        permissions,
        manifest,
      },
    });

    // 设置通信
    const messagePort = worker;

    const sandbox = {
      pluginId,
      worker,
      messagePort,
      permissions,

      // 执行插件代码
      async execute(pluginCode) {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('插件加载超时'));
          }, 30000); // 30秒超时

          worker.once('message', (message) => {
            clearTimeout(timeout);

            if (message.type === 'loaded') {
              resolve(new PluginProxy(worker, pluginId));
            } else if (message.type === 'error') {
              reject(new Error(message.error));
            }
          });

          // 发送代码到 Worker
          worker.postMessage({
            type: 'load',
            code: pluginCode.code,
            entryPath: pluginCode.entryPath,
          });
        });
      },

      // 销毁沙箱
      async destroy() {
        await worker.terminate();
        this.sandboxes.delete(pluginId);
      },
    };

    this.sandboxes.set(pluginId, sandbox);

    return sandbox;
  }
}

/**
 * 插件代理类 - 封装与Worker的通信
 */
class PluginProxy {
  constructor(worker, pluginId) {
    this.worker = worker;
    this.pluginId = pluginId;
    this.requestId = 0;
    this.pendingRequests = new Map();

    // 监听Worker消息
    this.worker.on('message', (message) => {
      this.handleMessage(message);
    });
  }

  /**
   * 调用插件方法
   */
  async call(method, ...args) {
    const requestId = ++this.requestId;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      this.worker.postMessage({
        type: 'call',
        requestId,
        method,
        args,
      });

      // 超时处理
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`插件方法调用超时: ${method}`));
        }
      }, 10000);
    });
  }

  handleMessage(message) {
    if (message.type === 'response') {
      const pending = this.pendingRequests.get(message.requestId);
      if (pending) {
        this.pendingRequests.delete(message.requestId);

        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.result);
        }
      }
    }
  }

  // 便捷方法
  async onLoad() {
    return this.call('onLoad');
  }

  async onEnable() {
    return this.call('onEnable');
  }

  async onDisable() {
    return this.call('onDisable');
  }
}
```

**Worker线程代码** (`plugin-worker.js`)：

```javascript
const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');

const { pluginId, permissions, manifest } = workerData;

let pluginInstance = null;

// 创建受限的全局API
const createPluginAPI = () => {
  return {
    // 受限的console
    console: {
      log: (...args) => parentPort.postMessage({ type: 'log', level: 'info', args }),
      error: (...args) => parentPort.postMessage({ type: 'log', level: 'error', args }),
      warn: (...args) => parentPort.postMessage({ type: 'log', level: 'warn', args }),
    },

    // 权限检查的API调用
    api: {
      database: createDatabaseAPI(permissions),
      llm: createLLMAPI(permissions),
      rag: createRAGAPI(permissions),
      ui: createUIAPI(permissions),
      filesystem: createFilesystemAPI(permissions),
    },

    // 基础功能
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    Promise,

    // 不允许的全局对象
    process: undefined,
    require: undefined, // 禁止require
    __dirname: undefined,
    __filename: undefined,
  };
};

// 创建数据库API（基于权限）
function createDatabaseAPI(permissions) {
  const hasRead = permissions.includes('database.read');
  const hasWrite = permissions.includes('database.write');

  return {
    async query(sql, params) {
      if (!hasRead) {
        throw new Error('缺少权限: database.read');
      }

      // 通过消息传递请求主进程执行
      return await sendAPIRequest('database.query', { sql, params });
    },

    async execute(sql, params) {
      if (!hasWrite) {
        throw new Error('缺少权限: database.write');
      }

      return await sendAPIRequest('database.execute', { sql, params });
    },
  };
}

// API请求函数
async function sendAPIRequest(apiMethod, params) {
  return new Promise((resolve, reject) => {
    const requestId = Date.now() + Math.random();

    const listener = (message) => {
      if (message.type === 'api-response' && message.requestId === requestId) {
        parentPort.off('message', listener);

        if (message.error) {
          reject(new Error(message.error));
        } else {
          resolve(message.result);
        }
      }
    };

    parentPort.on('message', listener);

    parentPort.postMessage({
      type: 'api-request',
      requestId,
      method: apiMethod,
      params,
    });
  });
}

// 处理主进程消息
parentPort.on('message', async (message) => {
  try {
    if (message.type === 'load') {
      // 加载插件代码
      const pluginAPI = createPluginAPI();

      // 使用vm创建沙箱上下文
      const context = vm.createContext(pluginAPI);

      // 执行插件代码
      const script = new vm.Script(message.code, {
        filename: message.entryPath,
      });

      pluginInstance = script.runInContext(context);

      parentPort.postMessage({ type: 'loaded' });

    } else if (message.type === 'call') {
      // 调用插件方法
      const { requestId, method, args } = message;

      if (!pluginInstance || typeof pluginInstance[method] !== 'function') {
        parentPort.postMessage({
          type: 'response',
          requestId,
          error: `方法不存在: ${method}`,
        });
        return;
      }

      const result = await pluginInstance[method](...args);

      parentPort.postMessage({
        type: 'response',
        requestId,
        result,
      });
    }
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error.message,
      stack: error.stack,
    });
  }
});
```

---

### 2.4 PermissionSystem (权限系统)

**权限定义**：

```javascript
const PERMISSIONS = {
  // 数据库权限
  'database.read': {
    description: '读取数据库',
    risk: 'low',
  },
  'database.write': {
    description: '写入数据库',
    risk: 'high',
  },
  'database.delete': {
    description: '删除数据',
    risk: 'critical',
  },

  // 文件系统权限
  'filesystem.read': {
    description: '读取文件',
    risk: 'medium',
  },
  'filesystem.write': {
    description: '写入文件',
    risk: 'high',
  },

  // 网络权限
  'network.http': {
    description: '发起HTTP请求',
    risk: 'medium',
  },
  'network.socket': {
    description: '使用Socket连接',
    risk: 'high',
  },

  // LLM权限
  'llm.query': {
    description: '调用LLM服务',
    risk: 'medium',
  },
  'llm.config': {
    description: '修改LLM配置',
    risk: 'high',
  },

  // UI权限
  'ui.page': {
    description: '添加新页面',
    risk: 'low',
  },
  'ui.menu': {
    description: '添加菜单项',
    risk: 'low',
  },
  'ui.notification': {
    description: '发送通知',
    risk: 'low',
  },

  // IPC权限
  'ipc.send': {
    description: '发送IPC消息',
    risk: 'medium',
  },

  // 系统权限
  'system.exec': {
    description: '执行系统命令',
    risk: 'critical',
  },
};

class PermissionManager {
  constructor(database) {
    this.database = database;
  }

  /**
   * 请求权限授权
   */
  async requestPermissions(manifest) {
    const { id, name, permissions = [] } = manifest;

    // 检查是否所有权限都是已知的
    for (const perm of permissions) {
      if (!PERMISSIONS[perm]) {
        throw new Error(`未知权限: ${perm}`);
      }
    }

    // 显示权限请求对话框
    const granted = await this.showPermissionDialog(name, permissions);

    if (granted) {
      // 保存授权记录
      for (const perm of permissions) {
        await this.database.run(`
          INSERT OR REPLACE INTO plugin_permissions (plugin_id, permission, granted, granted_at)
          VALUES (?, ?, 1, ?)
        `, [id, perm, Date.now()]);
      }
    }

    return granted;
  }

  /**
   * 检查权限
   */
  async checkPermission(pluginId, permission) {
    const result = await this.database.get(`
      SELECT granted FROM plugin_permissions
      WHERE plugin_id = ? AND permission = ?
    `, [pluginId, permission]);

    return result && result.granted === 1;
  }

  /**
   * 撤销权限
   */
  async revokePermission(pluginId, permission) {
    await this.database.run(`
      UPDATE plugin_permissions
      SET granted = 0
      WHERE plugin_id = ? AND permission = ?
    `, [pluginId, permission]);
  }
}
```

---

## 3. 扩展点系统设计

### 3.1 UI扩展点

**扩展点定义**：

```javascript
class UIExtensionPoint {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
    this.routes = [];
    this.menuItems = [];
    this.components = new Map();
  }

  /**
   * 注册页面路由
   */
  registerPage(pluginId, pageConfig) {
    const { path, component, meta = {} } = pageConfig;

    this.routes.push({
      pluginId,
      path: `/plugin/${pluginId}${path}`,
      component: () => this.loadPluginComponent(pluginId, component),
      meta: {
        ...meta,
        plugin: pluginId,
      },
    });

    // 通知渲染进程更新路由
    this.notifyRenderer('ui:route-added', { pluginId, path });
  }

  /**
   * 注册菜单项
   */
  registerMenuItem(pluginId, menuConfig) {
    const { id, label, icon, action, position = 'tools' } = menuConfig;

    this.menuItems.push({
      pluginId,
      id: `plugin_${pluginId}_${id}`,
      label,
      icon,
      action,
      position,
    });

    this.notifyRenderer('ui:menu-added', { pluginId, menuConfig });
  }

  /**
   * 注册Vue组件
   */
  registerComponent(pluginId, componentConfig) {
    const { name, component } = componentConfig;

    this.components.set(`plugin-${pluginId}-${name}`, {
      pluginId,
      component,
    });

    this.notifyRenderer('ui:component-added', { pluginId, name });
  }

  /**
   * 加载插件组件
   */
  async loadPluginComponent(pluginId, componentPath) {
    // 从插件目录加载Vue组件文件
    const plugin = await this.pluginManager.registry.getPlugin(pluginId);
    const fullPath = path.join(plugin.path, componentPath);

    // 返回异步组件
    return () => import(fullPath);
  }
}
```

**插件使用示例**：

```javascript
// 插件代码
module.exports = {
  async onEnable() {
    // 注册页面
    await api.ui.registerPage({
      path: '/my-feature',
      component: './components/MyFeaturePage.vue',
      meta: {
        title: '我的功能',
        icon: 'custom-icon',
      },
    });

    // 注册菜单项
    await api.ui.registerMenuItem({
      id: 'my-action',
      label: '执行自定义操作',
      icon: 'mdi-cog',
      action: async () => {
        // 执行操作
        const result = await api.llm.query('你好');
        api.ui.showNotification('操作完成', result);
      },
      position: 'tools',
    });
  },
};
```

### 3.2 数据处理扩展点

```javascript
class DataExtensionPoint {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
    this.importers = new Map();
    this.exporters = new Map();
    this.transformers = new Map();
  }

  /**
   * 注册文件导入器
   */
  registerImporter(pluginId, importerConfig) {
    const { id, name, fileTypes, handler } = importerConfig;

    this.importers.set(`${pluginId}:${id}`, {
      pluginId,
      id,
      name,
      fileTypes, // ['.custom', '.xyz']
      handler,
    });
  }

  /**
   * 触发文件导入
   */
  async importFile(filePath) {
    const ext = path.extname(filePath);

    // 查找支持该扩展名的导入器
    for (const [key, importer] of this.importers.entries()) {
      if (importer.fileTypes.includes(ext)) {
        try {
          const result = await this.executeInPlugin(
            importer.pluginId,
            importer.handler,
            { filePath }
          );
          return result;
        } catch (error) {
          console.error(`[DataExtension] 导入失败:`, error);
        }
      }
    }

    throw new Error(`不支持的文件类型: ${ext}`);
  }
}
```

### 3.3 AI能力扩展点

```javascript
class AIExtensionPoint {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
    this.llmProviders = new Map();
    this.ragAlgorithms = new Map();
    this.functionTools = new Map();
  }

  /**
   * 注册LLM提供商
   */
  registerLLMProvider(pluginId, providerConfig) {
    const { id, name, models, handler } = providerConfig;

    this.llmProviders.set(id, {
      pluginId,
      id,
      name,
      models,
      handler,
    });

    // 通知LLMManager有新提供商
    const { getLLMManager } = require('../llm/llm-manager');
    const llmManager = getLLMManager();
    llmManager.registerProvider(id, handler);
  }

  /**
   * 注册Function Calling工具
   */
  registerFunctionTool(pluginId, toolConfig) {
    const { name, description, parameters, handler } = toolConfig;

    this.functionTools.set(`${pluginId}:${name}`, {
      pluginId,
      schema: {
        name,
        description,
        parameters,
      },
      handler,
    });

    // 注册到FunctionCaller
    const { getFunctionCaller } = require('../ai-engine/function-caller');
    const functionCaller = getFunctionCaller();

    functionCaller.registerTool(
      name,
      async (params, context) => {
        return await this.executeInPlugin(pluginId, handler, params, context);
      },
      { name, description, parameters }
    );
  }
}
```

### 3.4 生命周期钩子

```javascript
class LifecycleHooks {
  constructor(pluginManager) {
    this.pluginManager = pluginManager;
    this.hooks = {
      'app:before-ready': [],
      'app:ready': [],
      'app:before-quit': [],
      'database:before-write': [],
      'database:after-write': [],
      'knowledge:before-add': [],
      'knowledge:after-add': [],
      'llm:before-query': [],
      'llm:after-query': [],
    };
  }

  /**
   * 注册钩子
   */
  registerHook(pluginId, hookName, handler) {
    if (!this.hooks[hookName]) {
      throw new Error(`未知钩子: ${hookName}`);
    }

    this.hooks[hookName].push({
      pluginId,
      handler,
      priority: 100,
    });

    // 按优先级排序
    this.hooks[hookName].sort((a, b) => a.priority - b.priority);
  }

  /**
   * 触发钩子
   */
  async triggerHook(hookName, context) {
    const handlers = this.hooks[hookName] || [];

    let modifiedContext = context;

    for (const hook of handlers) {
      try {
        const result = await this.executeInPlugin(
          hook.pluginId,
          hook.handler,
          modifiedContext
        );

        // 钩子可以修改上下文
        if (result && typeof result === 'object') {
          modifiedContext = { ...modifiedContext, ...result };
        }
      } catch (error) {
        console.error(`[LifecycleHooks] 钩子执行失败:`, error);
      }
    }

    return modifiedContext;
  }
}
```

---

## 4. 插件Manifest规范

### 4.1 plugin.json 格式

```json
{
  "id": "com.example.myplugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "Your Name <your@email.com>",
  "description": "A sample plugin for ChainlessChain",
  "homepage": "https://github.com/example/myplugin",
  "license": "MIT",

  "main": "index.js",

  "compatibility": {
    "chainlesschain": ">=0.16.0"
  },

  "permissions": [
    "database.read",
    "database.write",
    "llm.query",
    "ui.page",
    "ui.menu",
    "filesystem.read"
  ],

  "dependencies": {
    "lodash": "^4.17.21"
  },

  "extensions": {
    "ui": {
      "pages": [
        {
          "path": "/dashboard",
          "component": "./components/Dashboard.vue",
          "meta": {
            "title": "Dashboard",
            "icon": "mdi-view-dashboard"
          }
        }
      ],
      "menuItems": [
        {
          "id": "open-dashboard",
          "label": "打开Dashboard",
          "icon": "mdi-view-dashboard",
          "action": "openDashboard",
          "position": "tools"
        }
      ]
    },

    "data": {
      "importers": [
        {
          "id": "csv-importer",
          "name": "CSV导入器",
          "fileTypes": [".csv"],
          "handler": "handleCSVImport"
        }
      ]
    },

    "ai": {
      "functionTools": [
        {
          "name": "custom_search",
          "description": "执行自定义搜索",
          "parameters": {
            "query": { "type": "string", "description": "搜索查询" }
          },
          "handler": "handleCustomSearch"
        }
      ]
    },

    "lifecycle": {
      "hooks": [
        {
          "name": "knowledge:before-add",
          "handler": "beforeKnowledgeAdd"
        }
      ]
    }
  },

  "settings": {
    "apiKey": {
      "type": "string",
      "label": "API密钥",
      "description": "第三方服务的API密钥",
      "default": "",
      "secret": true
    },
    "enableFeatureX": {
      "type": "boolean",
      "label": "启用功能X",
      "default": true
    }
  },

  "icon": "icon.png",
  "category": "productivity",
  "tags": ["csv", "import", "data"]
}
```

### 4.2 package.json 兼容模式

```json
{
  "name": "@myscope/chainlesschain-plugin-example",
  "version": "1.0.0",
  "description": "Example plugin",
  "main": "dist/index.js",

  "chainlesschain": {
    "id": "com.myscope.example",
    "permissions": ["database.read", "llm.query"],
    "extensions": {
      "ui": {
        "pages": [...]
      }
    }
  },

  "keywords": ["chainlesschain-plugin"],
  "author": "Your Name",
  "license": "MIT"
}
```

---

## 5. 插件开发示例

### 5.1 完整插件示例

**目录结构**：

```
my-plugin/
├── plugin.json
├── index.js                 # 主入口
├── components/
│   └── Dashboard.vue        # Vue组件
├── lib/
│   └── utils.js            # 工具函数
└── icon.png
```

**index.js**：

```javascript
// 插件主入口
class MyPlugin {
  constructor() {
    this.config = {};
  }

  // 插件加载时调用
  async onLoad() {
    console.log('[MyPlugin] 插件已加载');
  }

  // 插件启用时调用
  async onEnable() {
    console.log('[MyPlugin] 插件已启用');

    // 注册UI扩展
    await api.ui.registerPage({
      path: '/dashboard',
      component: './components/Dashboard.vue',
      meta: {
        title: 'Dashboard',
        icon: 'mdi-view-dashboard',
      },
    });

    await api.ui.registerMenuItem({
      id: 'open-dashboard',
      label: '打开Dashboard',
      icon: 'mdi-view-dashboard',
      action: async () => {
        await api.ui.navigate('/plugin/com.example.myplugin/dashboard');
      },
    });

    // 注册Function Calling工具
    await api.ai.registerFunctionTool({
      name: 'get_weather',
      description: '获取城市天气',
      parameters: {
        city: { type: 'string', description: '城市名称', required: true },
      },
      handler: this.getWeather.bind(this),
    });

    // 注册生命周期钩子
    await api.lifecycle.registerHook('knowledge:before-add', async (context) => {
      const { item } = context;

      // 在知识库项添加前进行处理
      if (item.type === 'web_clip') {
        // 提取关键词
        const keywords = await this.extractKeywords(item.content);
        item.tags = [...item.tags, ...keywords];
      }

      return { item };
    });
  }

  // 插件禁用时调用
  async onDisable() {
    console.log('[MyPlugin] 插件已禁用');
  }

  // 自定义方法
  async getWeather(params) {
    const { city } = params;

    // 调用天气API
    const response = await api.network.fetch(`https://api.weather.com/v1/current?city=${city}`);
    const data = await response.json();

    return {
      city,
      temperature: data.temperature,
      condition: data.condition,
    };
  }

  async extractKeywords(text) {
    // 使用LLM提取关键词
    const prompt = `从以下文本中提取5个关键词，用逗号分隔：\n\n${text}`;
    const response = await api.llm.query(prompt);

    return response.split(',').map(k => k.trim());
  }
}

// 导出插件实例
module.exports = new MyPlugin();
```

**Dashboard.vue**：

```vue
<template>
  <div class="plugin-dashboard">
    <h1>My Plugin Dashboard</h1>

    <a-card title="天气查询">
      <a-input
        v-model:value="city"
        placeholder="输入城市名称"
        @pressEnter="getWeather"
      />
      <a-button @click="getWeather" type="primary">查询</a-button>

      <div v-if="weather" class="weather-result">
        <p>城市: {{ weather.city }}</p>
        <p>温度: {{ weather.temperature }}°C</p>
        <p>状况: {{ weather.condition }}</p>
      </div>
    </a-card>

    <a-card title="知识库统计">
      <p>总条目: {{ stats.totalItems }}</p>
      <p>今日新增: {{ stats.todayAdded }}</p>
    </a-card>
  </div>
</template>

<script>
export default {
  name: 'PluginDashboard',

  data() {
    return {
      city: '',
      weather: null,
      stats: {
        totalItems: 0,
        todayAdded: 0,
      },
    };
  },

  async mounted() {
    await this.loadStats();
  },

  methods: {
    async getWeather() {
      try {
        // 调用插件API
        this.weather = await window.pluginAPI.call('getWeather', { city: this.city });
      } catch (error) {
        this.$message.error('查询失败: ' + error.message);
      }
    },

    async loadStats() {
      // 通过IPC调用插件方法
      const result = await window.ipcRenderer.invoke('plugin:call', {
        pluginId: 'com.example.myplugin',
        method: 'getStats',
      });

      this.stats = result;
    },
  },
};
</script>

<style scoped>
.plugin-dashboard {
  padding: 20px;
}

.weather-result {
  margin-top: 20px;
  padding: 15px;
  background: #f0f0f0;
  border-radius: 4px;
}
</style>
```

---

## 6. 实现路线图

### Phase 1: 核心框架（2-3周）

**目标**: 建立基础的插件加载和管理系统

**任务**:
1. ✅ 创建 PluginManager 基础类
2. ✅ 实现 PluginLoader（支持本地文件夹）
3. ✅ 设计并实现数据库Schema
4. ✅ 实现插件注册表（PluginRegistry）
5. ✅ 基础的加载/启用/禁用/卸载功能
6. ✅ IPC处理器集成

**交付物**:
- `src/main/plugins/plugin-manager.js`
- `src/main/plugins/plugin-loader.js`
- `src/main/plugins/plugin-registry.js`
- 数据库迁移脚本
- 基础单元测试

---

### Phase 2: 沙箱和权限系统（2-3周）

**目标**: 实现安全隔离和权限控制

**任务**:
1. ✅ 实现 PluginSandbox（Worker Threads）
2. ✅ 创建 plugin-worker.js
3. ✅ 实现 PermissionManager
4. ✅ 设计并实现权限检查机制
5. ✅ 创建权限请求对话框（渲染进程）
6. ✅ 实现API代理层

**交付物**:
- `src/main/plugins/plugin-sandbox.js`
- `src/main/plugins/plugin-worker.js`
- `src/main/plugins/permission-manager.js`
- `src/main/plugins/plugin-api/`（各种API封装）
- 安全性测试

---

### Phase 3: UI扩展点（2周）

**目标**: 支持插件扩展UI

**任务**:
1. ✅ 实现 UIExtensionPoint
2. ✅ 渲染进程的 PluginUIManager
3. ✅ 动态路由注册
4. ✅ 菜单扩展支持
5. ✅ Vue组件加载机制
6. ✅ 插件设置页面UI

**交付物**:
- `src/main/plugins/extension-points/ui-extension.js`
- `src/renderer/plugins/plugin-ui-manager.js`
- UI组件示例
- 文档

---

### Phase 4: 数据和AI扩展点（2周）

**目标**: 支持数据处理和AI能力扩展

**任务**:
1. ✅ 实现 DataExtensionPoint（导入器/导出器）
2. ✅ 实现 AIExtensionPoint
3. ✅ LLM提供商注册机制
4. ✅ Function Calling工具注册
5. ✅ RAG算法扩展接口
6. ✅ 生命周期钩子系统

**交付物**:
- `src/main/plugins/extension-points/data-extension.js`
- `src/main/plugins/extension-points/ai-extension.js`
- `src/main/plugins/extension-points/lifecycle-hooks.js`
- 集成测试

---

### Phase 5: 高级功能（3-4周）

**目标**: 完善插件生态系统

**任务**:
1. ✅ NPM包安装支持
2. ✅ ZIP压缩包安装
3. ✅ 插件更新机制
4. ✅ 插件依赖解析
5. ✅ 热重载支持
6. ✅ 插件CLI工具（脚手架、打包）
7. ✅ 插件商店UI（可选）
8. ✅ 官方插件模板

**交付物**:
- 完整的 PluginLoader（支持所有来源）
- `cli/plugin-cli.js`（命令行工具）
- 插件开发文档
- 官方插件示例

---

### Phase 6: 文档和生态（持续）

**目标**: 建立开发者生态

**任务**:
1. ✅ 插件开发指南
2. ✅ API文档（自动生成）
3. ✅ 最佳实践指南
4. ✅ 官方插件库（3-5个示例插件）
5. ✅ 社区插件审核标准
6. ✅ 插件商店（可选）

**交付物**:
- `PLUGIN_DEVELOPMENT_GUIDE.md`
- `PLUGIN_API_REFERENCE.md`
- 示例插件（CSV导入、Notion集成、自定义LLM等）
- 社区指南

---

## 7. 关键技术决策

### 7.1 为什么选择 Worker Threads？

**对比方案**:

| 方案 | 优点 | 缺点 | 评分 |
|------|------|------|------|
| **Worker Threads** | 轻量级、共享内存、易通信、性能好 | 同进程内，隔离性稍弱 | ⭐⭐⭐⭐⭐ |
| Child Process | 完全隔离、独立进程 | IPC开销大、资源占用高 | ⭐⭐⭐ |
| VM Sandbox | 简单、无进程开销 | 隔离性差、易绕过 | ⭐⭐ |
| iframe (渲染进程) | 天然隔离、适合UI插件 | 不适合后端逻辑、性能差 | ⭐⭐ |

**最终选择**: Worker Threads + VM Sandbox 组合
- Worker Threads 提供进程级隔离
- VM 提供代码级隔离
- MessagePort 提供安全通信

### 7.2 权限系统设计

**采用 Capability-based Security**:

```javascript
// 权限即能力
const databaseAPI = {
  async read() {
    // 只有拥有这个对象引用才能调用
    return await actualDatabaseRead();
  },
};

// 插件只能访问被授予的API
pluginContext.api = {
  database: hasPermission('database.read') ? databaseAPI : null,
};
```

**优势**:
- 细粒度控制
- 可撤销（删除引用即可）
- 易于审计

### 7.3 UI扩展机制

**采用 Vue3 异步组件 + 动态路由**:

```javascript
// 动态添加路由
router.addRoute({
  path: '/plugin/:pluginId/:page',
  component: () => import(`/plugins/${pluginId}/${page}.vue`),
});
```

**优势**:
- 与现有Vue架构一致
- 支持懒加载
- 易于调试

---

## 8. 风险和挑战

### 8.1 安全风险

**挑战**: 插件可能包含恶意代码

**缓解措施**:
1. ✅ Worker Threads 进程隔离
2. ✅ 严格的权限控制
3. ✅ API调用审计日志
4. ✅ 代码签名验证（未来）
5. ✅ 社区审核机制

### 8.2 性能问题

**挑战**: 大量插件可能影响性能

**缓解措施**:
1. ✅ 按需加载（用户启用时才加载）
2. ✅ Worker线程池管理
3. ✅ API调用限流
4. ✅ 插件资源使用监控
5. ✅ 禁用低质量插件

### 8.3 兼容性问题

**挑战**: 插件API变化导致旧插件不可用

**缓解措施**:
1. ✅ Semantic Versioning
2. ✅ API版本声明
3. ✅ 兼容性检查
4. ✅ 废弃警告机制
5. ✅ 长期支持版本

### 8.4 开发者体验

**挑战**: 插件开发门槛高

**缓解措施**:
1. ✅ 详细的文档和示例
2. ✅ CLI脚手架工具
3. ✅ TypeScript类型定义
4. ✅ 开发者工具（调试、日志）
5. ✅ 社区支持

---

## 9. 关键文件清单

### 9.1 核心插件系统

```
src/main/plugins/
├── plugin-manager.js          # 插件管理器（核心）
├── plugin-loader.js           # 插件加载器
├── plugin-sandbox.js          # 沙箱实现
├── plugin-worker.js           # Worker线程代码
├── plugin-registry.js         # 插件注册表
├── permission-manager.js      # 权限管理器
│
├── extension-points/          # 扩展点实现
│   ├── ui-extension.js        # UI扩展点
│   ├── data-extension.js      # 数据扩展点
│   ├── ai-extension.js        # AI扩展点
│   └── lifecycle-hooks.js     # 生命周期钩子
│
└── plugin-api/                # 插件API封装
    ├── database-api.js        # 数据库API
    ├── filesystem-api.js      # 文件系统API
    ├── llm-api.js            # LLM API
    ├── rag-api.js            # RAG API
    ├── ui-api.js             # UI API
    └── network-api.js        # 网络API
```

### 9.2 渲染进程

```
src/renderer/plugins/
├── plugin-ui-manager.js       # UI插件管理器
├── plugin-settings.vue        # 插件设置页面
└── plugin-marketplace.vue     # 插件商店（可选）
```

### 9.3 CLI工具

```
cli/
├── plugin-cli.js              # 命令行工具
├── templates/                 # 插件模板
│   ├── basic/                 # 基础模板
│   ├── ui-extension/          # UI扩展模板
│   └── ai-tool/              # AI工具模板
└── utils/
    ├── bundler.js            # 打包工具
    └── validator.js          # Manifest验证
```

### 9.4 数据库迁移

```
src/main/database/migrations/
└── 001_plugin_system.sql      # 插件系统表结构
```

---

## 10. 集成到现有系统

### 10.1 修改主入口 (index.js)

```javascript
// 在 ChainlessChainApp 类中添加

constructor() {
  // ... 现有代码 ...
  this.pluginManager = null;
}

async onReady() {
  // ... 现有初始化代码 ...

  // 在所有核心模块初始化后，初始化插件系统
  try {
    console.log('初始化插件系统...');

    const { PluginManager } = require('./plugins/plugin-manager');
    this.pluginManager = new PluginManager(this.database, {
      pluginsDir: path.join(app.getPath('userData'), 'plugins'),
    });

    await this.pluginManager.initialize();

    // 设置全局单例
    const { setPluginManager } = require('./plugins/plugin-manager');
    setPluginManager(this.pluginManager);

    // 注册插件相关的IPC处理器
    this.setupPluginIPC();

    console.log('插件系统初始化成功');
  } catch (error) {
    console.error('插件系统初始化失败:', error);
    // 不影响应用启动
  }
}

setupPluginIPC() {
  // 列出所有插件
  ipcMain.handle('plugin:list', async () => {
    return await this.pluginManager.registry.getInstalledPlugins();
  });

  // 安装插件
  ipcMain.handle('plugin:install', async (_event, source, options) => {
    return await this.pluginManager.installPlugin(source, options);
  });

  // 启用插件
  ipcMain.handle('plugin:enable', async (_event, pluginId) => {
    return await this.pluginManager.enablePlugin(pluginId);
  });

  // 禁用插件
  ipcMain.handle('plugin:disable', async (_event, pluginId) => {
    return await this.pluginManager.disablePlugin(pluginId);
  });

  // 卸载插件
  ipcMain.handle('plugin:uninstall', async (_event, pluginId) => {
    return await this.pluginManager.uninstallPlugin(pluginId);
  });

  // 调用插件方法
  ipcMain.handle('plugin:call', async (_event, { pluginId, method, args }) => {
    const plugin = this.pluginManager.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`插件不存在: ${pluginId}`);
    }

    return await plugin.instance.call(method, ...args);
  });
}
```

### 10.2 不破坏现有模块

**原则**:
- 插件系统作为可选模块
- 现有Manager类无需改造
- 通过EventEmitter集成

**示例 - 集成到LLMManager**:

```javascript
// 在 LLMManager 中添加插件支持（无侵入）

class LLMManager extends EventEmitter {
  async initialize() {
    // ... 现有初始化代码 ...

    // 检查是否有插件系统
    try {
      const { getPluginManager } = require('../plugins/plugin-manager');
      const pluginManager = getPluginManager();

      if (pluginManager && pluginManager.isInitialized) {
        // 触发扩展点，让插件注册LLM提供商
        await pluginManager.triggerExtensionPoint('llm:register-providers', {
          llmManager: this,
        });
      }
    } catch (error) {
      // 插件系统未初始化，忽略
    }
  }
}
```

---

## 11. 总结

这个插件系统架构设计提供了：

✅ **企业级安全**: Worker Threads沙箱 + 细粒度权限控制
✅ **灵活的扩展点**: UI、数据、AI、生命周期全覆盖
✅ **混合分发模式**: 本地文件夹、NPM包、ZIP包
✅ **开发者友好**: CLI工具、TypeScript支持、丰富文档
✅ **向后兼容**: 不破坏现有架构，渐进式集成
✅ **高性能**: 按需加载、Worker线程池、API限流

**核心优势**:
1. 复用现有EventEmitter、IPC、配置系统
2. 与Vue3、Electron架构深度集成
3. 安全性和易用性的良好平衡
4. 清晰的实现路线图

**后续步骤**:
1. 用户审批此架构方案
2. 按Phase 1-6逐步实现
3. 开发官方插件示例
4. 建立社区插件生态
