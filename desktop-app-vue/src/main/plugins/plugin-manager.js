/**
 * PluginManager - 插件管理器（核心协调器）
 *
 * 职责：
 * - 插件生命周期管理（安装、加载、启用、禁用、卸载）
 * - 扩展点管理
 * - 插件间依赖解析
 * - 事件协调
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const PluginRegistry = require("./plugin-registry");
const PluginLoader = require("./plugin-loader");
const PermissionChecker = require("./permission-checker");
const PluginAPI = require("./plugin-api");
const PluginSandbox = require("./plugin-sandbox");
const semver = require("./semver-utils");
const { getPermissionDialogManager } = require("./permission-dialog-manager");

class PluginManager extends EventEmitter {
  constructor(database, config = {}) {
    super();

    this.database = database;
    this.config = config;

    // 子组件
    this.registry = new PluginRegistry(database);
    this.loader = new PluginLoader();
    this.permissionChecker = new PermissionChecker(this.registry);

    // 运行时状态
    this.plugins = new Map(); // pluginId -> { id, manifest, state, sandbox, api }
    this.extensionPoints = new Map(); // 扩展点注册表

    // UI 注册表
    this.uiRegistry = {
      pages: new Map(), // routePath -> { pluginId, component, title, icon, ... }
      menus: new Map(), // menuId -> { pluginId, label, icon, action, position, ... }
      components: new Map(), // componentId -> { pluginId, component, slots, props, ... }
      // v6 shell 扩展点（桌面版 UI 重构）
      spaces: new Map(), // spaceId -> { pluginId, template, name, icon, ragPreset, ... }
      artifacts: new Map(), // artifactType -> { pluginId, renderer, actions, icon, ... }
      slashCommands: new Map(), // trigger -> { pluginId, handler, description, icon, ... }
      mentionSources: new Map(), // prefix -> { pluginId, source, label, ... }
      statusBarWidgets: new Map(), // widgetId -> { pluginId, component, position, order, ... }
      homeWidgets: new Map(), // widgetId -> { pluginId, component, size, order, ... }
      composerSlots: new Map(), // slotId -> { pluginId, component, position, order, ... }
      // P3 企业定制扩展点
      brandThemes: new Map(), // themeId -> { pluginId, tokens, mode, priority }
      brandIdentities: new Map(), // identityId -> { pluginId, productName, logo, splash, eula, links, priority }
      // P4 企业能力扩展点
      llmProviders: new Map(), // providerId -> { pluginId, name, models, endpoints, priority, capabilities }
      authProviders: new Map(), // providerId -> { pluginId, name, kind, priority, endpoints, scopes }
      dataStorages: new Map(), // storageId -> { pluginId, name, kind, priority, capabilities }
      dataCryptos: new Map(), // cryptoId -> { pluginId, name, algs, priority, capabilities }
      complianceAudits: new Map(), // auditId -> { pluginId, name, kind, priority, sinks }
    };

    // 系统服务上下文（传递给插件API）
    this.systemContext = {};

    this.isInitialized = false;
  }

  /**
   * 设置系统上下文（在initialize之前调用）
   * @param {Object} context - 系统服务上下文
   */
  setSystemContext(context) {
    this.systemContext = {
      ...this.systemContext,
      ...context,
    };
    logger.info("[PluginManager] 系统上下文已设置");
  }

  /**
   * 初始化插件管理器
   */
  async initialize() {
    logger.info("[PluginManager] 初始化插件管理器...");

    try {
      // 1. 初始化注册表（创建数据库表）
      await this.registry.initialize();

      // 2. 注册内置扩展点
      this.registerBuiltInExtensionPoints();

      // 3. 加载 first-party 内置插件（跳过 DB / 沙箱 / 权限检查）
      await this.loadFirstPartyPlugins();

      // 4. 加载已安装且启用的插件
      const installedPlugins = this.registry.getInstalledPlugins({
        enabled: true,
      });

      logger.info(
        `[PluginManager] 找到 ${installedPlugins.length} 个已启用的插件`,
      );

      for (const pluginMeta of installedPlugins) {
        try {
          // Phase 2: 实际加载插件
          await this.loadPlugin(pluginMeta.id);

          logger.info(`[PluginManager] 插件 ${pluginMeta.id} 加载成功`);
        } catch (error) {
          logger.error(`[PluginManager] 加载插件失败: ${pluginMeta.id}`, error);
          await this.registry.recordError(pluginMeta.id, error);
        }
      }

      this.isInitialized = true;
      this.emit("initialized", { pluginCount: installedPlugins.length });

      logger.info("[PluginManager] 初始化完成");
    } catch (error) {
      logger.error("[PluginManager] 初始化失败:", error);
      throw error;
    }
  }

  /**
   * 注册内置扩展点
   */
  registerBuiltInExtensionPoints() {
    // UI扩展点
    this.registerExtensionPoint(
      "ui.page",
      this.handleUIPageExtension.bind(this),
    );
    this.registerExtensionPoint(
      "ui.menu",
      this.handleUIMenuExtension.bind(this),
    );
    this.registerExtensionPoint(
      "ui.component",
      this.handleUIComponentExtension.bind(this),
    );

    // 数据扩展点
    this.registerExtensionPoint(
      "data.importer",
      this.handleDataImporterExtension.bind(this),
    );
    this.registerExtensionPoint(
      "data.exporter",
      this.handleDataExporterExtension.bind(this),
    );

    // AI扩展点
    this.registerExtensionPoint(
      "ai.llm-provider",
      this.handleAILLMProviderExtension.bind(this),
    );
    this.registerExtensionPoint(
      "ai.function-tool",
      this.handleAIFunctionToolExtension.bind(this),
    );

    // 生命周期钩子
    this.registerExtensionPoint(
      "lifecycle.hook",
      this.handleLifecycleHookExtension.bind(this),
    );

    // v6 shell 扩展点
    this.registerExtensionPoint(
      "ui.space",
      this.handleUISpaceExtension.bind(this),
    );
    this.registerExtensionPoint(
      "ui.artifact",
      this.handleUIArtifactExtension.bind(this),
    );
    this.registerExtensionPoint(
      "ui.slash",
      this.handleUISlashExtension.bind(this),
    );
    this.registerExtensionPoint(
      "ui.mention",
      this.handleUIMentionExtension.bind(this),
    );
    this.registerExtensionPoint(
      "ui.status-bar",
      this.handleUIStatusBarExtension.bind(this),
    );
    this.registerExtensionPoint(
      "ui.home-widget",
      this.handleUIHomeWidgetExtension.bind(this),
    );
    this.registerExtensionPoint(
      "ui.composer-slot",
      this.handleUIComposerSlotExtension.bind(this),
    );

    // P3 企业定制扩展点
    this.registerExtensionPoint(
      "brand.theme",
      this.handleBrandThemeExtension.bind(this),
    );
    this.registerExtensionPoint(
      "brand.identity",
      this.handleBrandIdentityExtension.bind(this),
    );

    // P4 企业能力扩展点
    this.registerExtensionPoint(
      "auth.provider",
      this.handleAuthProviderExtension.bind(this),
    );
    this.registerExtensionPoint(
      "data.storage",
      this.handleDataStorageExtension.bind(this),
    );
    this.registerExtensionPoint(
      "data.crypto",
      this.handleDataCryptoExtension.bind(this),
    );
    this.registerExtensionPoint(
      "compliance.audit",
      this.handleComplianceAuditExtension.bind(this),
    );

    logger.info("[PluginManager] 内置扩展点已注册");
  }

  /**
   * 加载 first-party 内置插件
   *
   * 扫描多个目录，顺序：
   *   1. src/main/plugins-builtin/       — 应用内置默认（最低优先级）
   *   2. 注入的 mdmExtractDir（可选）     — MDM Profile 解包目录（最高优先级）
   *
   * 同 id 的插件后注册者胜出；但贡献本身由 priority 决定最终生效项，
   * 因此 Profile 里的高 priority 贡献会自动覆盖默认值。
   *
   * first-party 插件是受信代码，不走 DB / sandbox / permission 流程。
   */
  async loadFirstPartyPlugins() {
    const dirs = [path.resolve(__dirname, "..", "plugins-builtin")];
    if (this.mdmExtractDir && fs.existsSync(this.mdmExtractDir)) {
      dirs.push(this.mdmExtractDir);
    }

    for (const baseDir of dirs) {
      if (!fs.existsSync(baseDir)) {
        continue;
      }
      const entries = fs
        .readdirSync(baseDir, { withFileTypes: true })
        .filter((e) => e.isDirectory());
      logger.info(
        `[PluginManager] 扫描 ${entries.length} 个 first-party 插件（${baseDir}）`,
      );

      for (const entry of entries) {
        const manifestPath = path.join(baseDir, entry.name, "plugin.json");
        if (!fs.existsSync(manifestPath)) {
          logger.warn(
            `[PluginManager] first-party 插件 ${entry.name} 无 plugin.json，跳过`,
          );
          continue;
        }

        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
          const pluginId = manifest.id || entry.name;

          if (this.plugins.has(pluginId)) {
            logger.info(
              `[PluginManager] first-party 插件 ${pluginId} 已加载，跳过`,
            );
            continue;
          }

          this.plugins.set(pluginId, {
            id: pluginId,
            manifest,
            state: "enabled",
            firstParty: true,
            sandbox: null,
            api: null,
            instance: null,
          });

          await this.registerPluginExtensions(pluginId);

          this.emit("plugin:first-party-loaded", { pluginId, baseDir });
          logger.info(
            `[PluginManager] ✓ first-party 插件已加载: ${pluginId} (${baseDir})`,
          );
        } catch (error) {
          logger.error(
            `[PluginManager] 加载 first-party 插件失败: ${entry.name}`,
            error,
          );
        }
      }
    }
  }

  /**
   * 设置 MDM profile 解包目录；在 initialize() 之前调用才生效
   */
  setMDMExtractDir(dir) {
    this.mdmExtractDir = dir;
  }

  /**
   * 注册扩展点
   * @param {string} name - 扩展点名称
   * @param {Function} handler - 处理函数
   */
  registerExtensionPoint(name, handler) {
    this.extensionPoints.set(name, {
      name,
      handler,
      extensions: [],
    });
  }

  /**
   * 安装插件
   * @param {string} source - 插件来源
   * @param {Object} options - 选项
   * @returns {Promise<Object>} 安装结果
   */
  async installPlugin(source, options = {}) {
    this.emit("plugin:installing", { source });

    try {
      // 1. 解析插件来源
      logger.info(`[PluginManager] 解析插件来源: ${source}`);
      const pluginPath = await this.loader.resolve(source, options);

      // 2. 加载并验证 manifest
      const manifest = await this.loader.loadManifest(pluginPath);

      // 3. 检查兼容性
      this.checkCompatibility(manifest);

      // 4. 检查是否已安装
      const existing = this.registry.getPlugin(manifest.id);
      if (existing) {
        throw new Error(`插件已安装: ${manifest.id}，请先卸载`);
      }

      // 5. 解析依赖
      await this.resolveDependencies(manifest);

      // 6. 请求权限授权（暂时自动授予）
      const granted = await this.requestPermissions(manifest);
      if (!granted) {
        throw new Error("用户拒绝授权插件权限");
      }

      // 7. 安装插件到插件目录
      const installedPath = await this.loader.install(pluginPath, manifest);

      // 8. 注册到数据库
      await this.registry.register(manifest, installedPath);

      this.emit("plugin:installed", { pluginId: manifest.id });

      logger.info(`[PluginManager] 插件安装成功: ${manifest.id}`);

      return {
        success: true,
        pluginId: manifest.id,
        path: installedPath,
      };
    } catch (error) {
      this.emit("plugin:install-failed", { source, error: error.message });
      logger.error("[PluginManager] 安装插件失败:", error);
      throw error;
    }
  }

  /**
   * 检查兼容性
   * @param {Object} manifest - 插件manifest
   */
  checkCompatibility(manifest) {
    if (!manifest.compatibility || !manifest.compatibility.chainlesschain) {
      logger.warn("[PluginManager] 插件未声明兼容性，跳过检查");
      return;
    }

    // 获取当前应用版本
    const currentVersion = this._getCurrentVersion();
    const requiredVersion = manifest.compatibility.chainlesschain;

    logger.info(
      `[PluginManager] 检查兼容性: 需要 ${requiredVersion}, 当前 ${currentVersion}`,
    );

    // 使用 semver 进行精确版本检查
    if (!semver.satisfies(currentVersion, requiredVersion)) {
      throw new Error(
        `插件 ${manifest.id} 不兼容当前版本。` +
          `需要: ${requiredVersion}, 当前: ${currentVersion}`,
      );
    }

    logger.info(`[PluginManager] 插件 ${manifest.id} 兼容性检查通过`);
  }

  /**
   * 获取当前应用版本
   * @private
   */
  _getCurrentVersion() {
    // 尝试从 package.json 读取
    try {
      const packagePath = path.resolve(__dirname, "../../..", "package.json");
      if (fs.existsSync(packagePath)) {
        const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        return pkg.version || "0.20.0";
      }
    } catch (error) {
      logger.warn("[PluginManager] 无法读取 package.json:", error.message);
    }

    // 默认版本
    return "0.20.0";
  }

  /**
   * 解析依赖
   * @param {Object} manifest - 插件manifest
   */
  async resolveDependencies(manifest) {
    if (
      !manifest.dependencies ||
      Object.keys(manifest.dependencies).length === 0
    ) {
      return;
    }

    logger.info(
      `[PluginManager] 解析依赖:`,
      Object.keys(manifest.dependencies),
    );

    const missingDeps = [];
    const incompatibleDeps = [];

    for (const [depName, depVersion] of Object.entries(manifest.dependencies)) {
      // 检查是否是插件依赖（以 @ 或 chainlesschain- 开头）
      if (
        depName.startsWith("@chainlesschain/") ||
        depName.startsWith("chainlesschain-")
      ) {
        // 检查插件依赖
        const depPlugin = this.registry.getPlugin(depName);
        if (!depPlugin) {
          missingDeps.push({
            name: depName,
            version: depVersion,
            type: "plugin",
          });
          continue;
        }

        // 检查版本兼容性
        if (!semver.satisfies(depPlugin.version, depVersion)) {
          incompatibleDeps.push({
            name: depName,
            required: depVersion,
            installed: depPlugin.version,
            type: "plugin",
          });
        }
      } else {
        // NPM 依赖 - 检查是否在 node_modules 中
        try {
          const depPath = require.resolve(depName, { paths: [process.cwd()] });
          const depPkgPath = path.join(path.dirname(depPath), "package.json");

          if (fs.existsSync(depPkgPath)) {
            const depPkg = JSON.parse(fs.readFileSync(depPkgPath, "utf8"));
            if (!semver.satisfies(depPkg.version, depVersion)) {
              incompatibleDeps.push({
                name: depName,
                required: depVersion,
                installed: depPkg.version,
                type: "npm",
              });
            }
          }
        } catch (error) {
          // 依赖不存在
          missingDeps.push({ name: depName, version: depVersion, type: "npm" });
        }
      }
    }

    // 报告问题
    if (missingDeps.length > 0) {
      const missingList = missingDeps
        .map((d) => `${d.name}@${d.version}`)
        .join(", ");
      logger.warn(`[PluginManager] 缺失依赖: ${missingList}`);
      // 可以选择抛出错误或继续
      // throw new Error(`插件 ${manifest.id} 缺失依赖: ${missingList}`);
    }

    if (incompatibleDeps.length > 0) {
      const incompatList = incompatibleDeps
        .map((d) => `${d.name} (需要 ${d.required}, 已安装 ${d.installed})`)
        .join(", ");
      logger.warn(`[PluginManager] 不兼容依赖: ${incompatList}`);
      // throw new Error(`插件 ${manifest.id} 依赖版本不兼容: ${incompatList}`);
    }

    return {
      missing: missingDeps,
      incompatible: incompatibleDeps,
      resolved: missingDeps.length === 0 && incompatibleDeps.length === 0,
    };
  }

  /**
   * 请求权限授权
   * @param {Object} manifest - 插件manifest
   * @returns {Promise<boolean>} 是否授予
   */
  async requestPermissions(manifest) {
    const { permissions = [] } = manifest;

    if (permissions.length === 0) {
      return true;
    }

    logger.info(`[PluginManager] 插件请求权限:`, permissions);

    try {
      // 使用权限对话框管理器请求用户授权
      const permissionDialogManager = getPermissionDialogManager();
      const result = await permissionDialogManager.requestPermissions(manifest);

      if (!result.granted) {
        logger.info(`[PluginManager] 用户拒绝了插件 ${manifest.id} 的权限请求`);
        return false;
      }

      // 根据用户的选择更新权限
      const grantedPermissions = result.permissions || {};
      for (const permission of permissions) {
        const granted = grantedPermissions[permission] === true;
        await this.registry.updatePermission(manifest.id, permission, granted);
      }

      // 检查是否有任何权限被授予
      const anyGranted = Object.values(grantedPermissions).some(
        (v) => v === true,
      );
      if (!anyGranted) {
        logger.info(`[PluginManager] 用户未授予插件 ${manifest.id} 任何权限`);
        return false;
      }

      logger.info(
        `[PluginManager] 插件 ${manifest.id} 权限已更新:`,
        grantedPermissions,
      );
      return true;
    } catch (error) {
      logger.error(`[PluginManager] 权限请求失败:`, error);
      // 如果权限对话框失败（例如：窗口不可用），返回失败
      return false;
    }
  }

  /**
   * 加载插件（Phase 2实现 - 使用沙箱）
   * @param {string} pluginId - 插件ID
   */
  async loadPlugin(pluginId) {
    if (this.plugins.has(pluginId)) {
      logger.warn(`[PluginManager] 插件已加载: ${pluginId}`);
      return;
    }

    const pluginMeta = this.registry.getPlugin(pluginId);
    if (!pluginMeta) {
      throw new Error(`插件不存在: ${pluginId}`);
    }

    this.emit("plugin:loading", { pluginId });

    try {
      logger.info(`[PluginManager] 加载插件: ${pluginId}`);

      // 1. 创建插件API实例
      const pluginAPI = new PluginAPI(pluginId, this.permissionChecker, {
        database: this.database,
        ...this.systemContext,
      });

      // 2. 创建沙箱实例
      const sandbox = new PluginSandbox(
        pluginId,
        pluginMeta.path,
        pluginMeta.manifest,
        pluginAPI,
      );

      // 3. 在沙箱中加载插件代码
      await sandbox.load();

      // 4. 保存到插件映射
      this.plugins.set(pluginId, {
        id: pluginId,
        manifest: pluginMeta.manifest,
        state: "loaded",
        sandbox,
        api: pluginAPI,
        instance: sandbox.getInstance(),
      });

      // 5. 更新数据库状态
      await this.registry.updatePluginState(pluginId, "loaded");

      this.emit("plugin:loaded", { pluginId });

      logger.info(`[PluginManager] 插件加载成功: ${pluginId}`);
    } catch (error) {
      this.emit("plugin:load-failed", { pluginId, error: error.message });
      await this.registry.recordError(pluginId, error);
      logger.error(`[PluginManager] 插件加载失败: ${pluginId}`, error);
      throw error;
    }
  }

  /**
   * 启用插件
   * @param {string} pluginId - 插件ID
   */
  async enablePlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);

    if (!plugin) {
      // 如果未加载，先加载
      await this.loadPlugin(pluginId);
    }

    const pluginObj = this.plugins.get(pluginId);

    if (pluginObj.state === "enabled") {
      logger.info(`[PluginManager] 插件已启用: ${pluginId}`);
      return;
    }

    this.emit("plugin:enabling", { pluginId });

    try {
      logger.info(`[PluginManager] 启用插件: ${pluginId}`);

      // Phase 2 实现：调用插件的 onEnable 钩子
      if (pluginObj.sandbox) {
        await pluginObj.sandbox.enable();
      }

      // Phase 2 实现：注册扩展点
      await this.registerPluginExtensions(pluginId);

      pluginObj.state = "enabled";
      await this.registry.updatePluginState(pluginId, "enabled");
      await this.registry.updateEnabled(pluginId, true);

      this.emit("plugin:enabled", { pluginId });

      logger.info(`[PluginManager] 插件已启用: ${pluginId}`);
    } catch (error) {
      this.emit("plugin:enable-failed", { pluginId, error: error.message });
      await this.registry.recordError(pluginId, error);
      throw error;
    }
  }

  /**
   * 禁用插件
   * @param {string} pluginId - 插件ID
   */
  async disablePlugin(pluginId) {
    const plugin = this.plugins.get(pluginId);

    if (!plugin || plugin.state !== "enabled") {
      logger.info(`[PluginManager] 插件未启用: ${pluginId}`);
      return;
    }

    this.emit("plugin:disabling", { pluginId });

    try {
      logger.info(`[PluginManager] 禁用插件: ${pluginId}`);

      // Phase 2 实现：注销扩展点
      await this.unregisterPluginExtensions(pluginId);

      // Phase 2 实现：调用插件的 onDisable 钩子
      if (plugin.sandbox) {
        await plugin.sandbox.disable();
      }

      plugin.state = "disabled";
      await this.registry.updatePluginState(pluginId, "disabled");
      await this.registry.updateEnabled(pluginId, false);

      this.emit("plugin:disabled", { pluginId });

      logger.info(`[PluginManager] 插件已禁用: ${pluginId}`);
    } catch (error) {
      this.emit("plugin:disable-failed", { pluginId, error: error.message });
      await this.registry.recordError(pluginId, error);
      throw error;
    }
  }

  /**
   * 卸载插件
   * @param {string} pluginId - 插件ID
   */
  async uninstallPlugin(pluginId) {
    // 1. 先禁用
    if (this.plugins.has(pluginId)) {
      await this.disablePlugin(pluginId);
    }

    this.emit("plugin:uninstalling", { pluginId });

    try {
      logger.info(`[PluginManager] 卸载插件: ${pluginId}`);

      // 2. 销毁沙箱（Phase 2）
      const plugin = this.plugins.get(pluginId);
      if (plugin) {
        // 调用卸载钩子
        if (plugin.sandbox) {
          await plugin.sandbox.unload();
          plugin.sandbox.destroy();
        }

        this.plugins.delete(pluginId);
      }

      // 3. 从文件系统删除
      const pluginMeta = this.registry.getPlugin(pluginId);
      if (pluginMeta) {
        await this.loader.uninstall(pluginMeta.path);
      }

      // 4. 从数据库删除
      await this.registry.unregister(pluginId);

      this.emit("plugin:uninstalled", { pluginId });

      logger.info(`[PluginManager] 插件已卸载: ${pluginId}`);
    } catch (error) {
      this.emit("plugin:uninstall-failed", { pluginId, error: error.message });
      throw error;
    }
  }

  /**
   * 获取所有插件
   * @param {Object} filters - 过滤条件
   * @returns {Array} 插件列表
   */
  getPlugins(filters = {}) {
    return this.registry.getInstalledPlugins(filters);
  }

  /**
   * 获取单个插件信息
   * @param {string} pluginId - 插件ID
   * @returns {Object|null} 插件信息
   */
  getPlugin(pluginId) {
    return this.registry.getPlugin(pluginId);
  }

  /**
   * 触发扩展点
   * @param {string} name - 扩展点名称
   * @param {Object} context - 上下文
   * @returns {Promise<Array>} 扩展点执行结果
   */
  async triggerExtensionPoint(name, context = {}) {
    const extensionPoint = this.extensionPoints.get(name);
    if (!extensionPoint) {
      logger.warn(`[PluginManager] 未知扩展点: ${name}`);
      return [];
    }

    const results = [];

    for (const extension of extensionPoint.extensions) {
      try {
        const result = await extension.handler(context);
        results.push(result);
      } catch (error) {
        logger.error(`[PluginManager] 扩展执行失败:`, error);
        this.emit("extension:error", { extension: extension.id, error });
      }
    }

    return results;
  }

  // ============================================
  // 扩展点处理函数（Phase 3-4 实现）
  // ============================================

  /**
   * 处理UI页面扩展
   * @param {Object} context - 扩展上下文
   * @param {string} context.pluginId - 插件ID
   * @param {Object} context.config - 页面配置
   */
  async handleUIPageExtension(context) {
    const { pluginId, config } = context;
    logger.info("[PluginManager] 处理UI页面扩展:", pluginId, config);

    const {
      path: routePath,
      title,
      icon,
      component,
      componentPath,
      requireAuth = false,
      meta = {},
    } = config;

    if (!routePath) {
      throw new Error("页面路由路径(path)是必需的");
    }

    const pageId = `plugin:${pluginId}:${routePath}`;

    this.uiRegistry.pages.set(pageId, {
      id: pageId,
      pluginId,
      path: `/plugin/${pluginId}${routePath}`,
      originalPath: routePath,
      title: title || pluginId,
      icon: icon || "AppstoreOutlined",
      component,
      componentPath,
      requireAuth,
      meta: {
        ...meta,
        isPluginPage: true,
        pluginId,
      },
      registeredAt: Date.now(),
    });

    logger.info(`[PluginManager] ✓ 页面已注册: ${pageId}`);
    this.emit("ui:page:registered", { pluginId, pageId, path: routePath });

    return { success: true, pageId };
  }

  /**
   * 处理UI菜单扩展
   * @param {Object} context - 扩展上下文
   * @param {string} context.pluginId - 插件ID
   * @param {Object} context.config - 菜单配置
   */
  async handleUIMenuExtension(context) {
    const { pluginId, config } = context;
    logger.info("[PluginManager] 处理UI菜单扩展:", pluginId, config);

    const {
      id: menuId,
      label,
      icon,
      action,
      route,
      position = "sidebar",
      order = 100,
      parent = null,
      children = [],
      visible = true,
    } = config;

    const fullMenuId = `plugin:${pluginId}:${menuId || label}`;

    this.uiRegistry.menus.set(fullMenuId, {
      id: fullMenuId,
      pluginId,
      label,
      icon: icon || "AppstoreOutlined",
      action,
      route: route ? `/plugin/${pluginId}${route}` : null,
      position,
      order,
      parent,
      children: children.map((child) => ({
        ...child,
        id: `plugin:${pluginId}:${child.id || child.label}`,
        route: child.route ? `/plugin/${pluginId}${child.route}` : null,
      })),
      visible,
      registeredAt: Date.now(),
    });

    logger.info(`[PluginManager] ✓ 菜单已注册: ${fullMenuId}`);
    this.emit("ui:menu:registered", { pluginId, menuId: fullMenuId });

    return { success: true, menuId: fullMenuId };
  }

  /**
   * 处理UI组件扩展
   * @param {Object} context - 扩展上下文
   * @param {string} context.pluginId - 插件ID
   * @param {Object} context.config - 组件配置
   */
  async handleUIComponentExtension(context) {
    const { pluginId, config } = context;
    logger.info("[PluginManager] 处理UI组件扩展:", pluginId, config);

    const {
      name,
      component,
      componentPath,
      slot,
      props = {},
      order = 100,
    } = config;

    if (!name) {
      throw new Error("组件名称(name)是必需的");
    }

    const componentId = `plugin:${pluginId}:${name}`;

    this.uiRegistry.components.set(componentId, {
      id: componentId,
      pluginId,
      name,
      component,
      componentPath,
      slot,
      props,
      order,
      registeredAt: Date.now(),
    });

    logger.info(`[PluginManager] ✓ 组件已注册: ${componentId}`);
    this.emit("ui:component:registered", { pluginId, componentId });

    return { success: true, componentId };
  }

  // ============================================
  // v6 Shell 扩展点 handlers
  // ============================================

  /**
   * 处理 Space 扩展：注册个人空间模板
   * config: { id, name, icon, description, ragPreset, systemPrompt, contactsGroup, permissions }
   */
  async handleUISpaceExtension(context) {
    const { pluginId, config } = context;
    if (!config.id) {
      throw new Error("Space id 是必需的");
    }
    const spaceId = `${pluginId}:${config.id}`;
    this.uiRegistry.spaces.set(spaceId, {
      id: spaceId,
      pluginId,
      name: config.name || config.id,
      icon: config.icon || "AppstoreOutlined",
      description: config.description || "",
      ragPreset: config.ragPreset || null,
      systemPrompt: config.systemPrompt || "",
      contactsGroup: config.contactsGroup || null,
      permissions: config.permissions || [],
      order: config.order || 100,
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Space 已注册: ${spaceId}`);
    this.emit("ui:space:registered", { pluginId, spaceId });
    return { success: true, spaceId };
  }

  /**
   * 处理 Artifact 扩展：注册 Artifact 类型与渲染器
   * config: { type, renderer, rendererPath, actions, icon, label }
   */
  async handleUIArtifactExtension(context) {
    const { pluginId, config } = context;
    if (!config.type) {
      throw new Error("Artifact type 是必需的");
    }
    const artifactKey = `${pluginId}:${config.type}`;
    this.uiRegistry.artifacts.set(artifactKey, {
      id: artifactKey,
      pluginId,
      type: config.type,
      renderer: config.renderer || null,
      rendererPath: config.rendererPath || null,
      actions: config.actions || [],
      icon: config.icon || "FileOutlined",
      label: config.label || config.type,
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Artifact 已注册: ${artifactKey}`);
    this.emit("ui:artifact:registered", {
      pluginId,
      artifactType: config.type,
    });
    return { success: true, artifactKey };
  }

  /**
   * 处理 Slash 命令扩展：注册 / 命令
   * config: { trigger, handler, description, icon, requirePermissions }
   */
  async handleUISlashExtension(context) {
    const { pluginId, config } = context;
    if (!config.trigger) {
      throw new Error("Slash trigger 是必需的");
    }
    const key = `${pluginId}:${config.trigger}`;
    this.uiRegistry.slashCommands.set(key, {
      id: key,
      pluginId,
      trigger: config.trigger,
      handler: config.handler || null,
      description: config.description || "",
      icon: config.icon || "ThunderboltOutlined",
      requirePermissions: config.requirePermissions || [],
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Slash 命令已注册: ${key}`);
    this.emit("ui:slash:registered", { pluginId, trigger: config.trigger });
    return { success: true, key };
  }

  /**
   * 处理 Mention 源扩展：注册 @ 自动补全源
   * config: { prefix, source, label, icon }
   */
  async handleUIMentionExtension(context) {
    const { pluginId, config } = context;
    if (!config.prefix) {
      throw new Error("Mention prefix 是必需的");
    }
    const key = `${pluginId}:${config.prefix}`;
    this.uiRegistry.mentionSources.set(key, {
      id: key,
      pluginId,
      prefix: config.prefix,
      source: config.source || null,
      label: config.label || config.prefix,
      icon: config.icon || "UserOutlined",
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Mention 源已注册: ${key}`);
    this.emit("ui:mention:registered", { pluginId, prefix: config.prefix });
    return { success: true, key };
  }

  /**
   * 处理 StatusBar 小组件扩展
   * config: { id, component, componentPath, position, order, tooltip }
   */
  async handleUIStatusBarExtension(context) {
    const { pluginId, config } = context;
    if (!config.id) {
      throw new Error("StatusBar widget id 是必需的");
    }
    const key = `${pluginId}:${config.id}`;
    this.uiRegistry.statusBarWidgets.set(key, {
      id: key,
      pluginId,
      component: config.component || null,
      componentPath: config.componentPath || null,
      position: config.position || "right",
      order: config.order || 100,
      tooltip: config.tooltip || "",
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ StatusBar 小组件已注册: ${key}`);
    this.emit("ui:status-bar:registered", { pluginId, widgetId: key });
    return { success: true, key };
  }

  /**
   * 处理 HomeWidget 扩展：Today 页卡片
   * config: { id, component, componentPath, size, order, title }
   */
  async handleUIHomeWidgetExtension(context) {
    const { pluginId, config } = context;
    if (!config.id) {
      throw new Error("Home widget id 是必需的");
    }
    const key = `${pluginId}:${config.id}`;
    this.uiRegistry.homeWidgets.set(key, {
      id: key,
      pluginId,
      component: config.component || null,
      componentPath: config.componentPath || null,
      size: config.size || "medium",
      order: config.order || 100,
      title: config.title || "",
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Home 卡片已注册: ${key}`);
    this.emit("ui:home-widget:registered", { pluginId, widgetId: key });
    return { success: true, key };
  }

  /**
   * 处理 ComposerSlot 扩展：输入框行内槽
   * config: { id, component, componentPath, position, order }
   */
  async handleUIComposerSlotExtension(context) {
    const { pluginId, config } = context;
    if (!config.id) {
      throw new Error("Composer slot id 是必需的");
    }
    const key = `${pluginId}:${config.id}`;
    this.uiRegistry.composerSlots.set(key, {
      id: key,
      pluginId,
      component: config.component || null,
      componentPath: config.componentPath || null,
      position: config.position || "left",
      order: config.order || 100,
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Composer 槽已注册: ${key}`);
    this.emit("ui:composer-slot:registered", { pluginId, slotId: key });
    return { success: true, key };
  }

  /**
   * 处理 brand.theme 扩展：企业主题
   * config: { id, name, mode: "light"|"dark"|"auto", tokens: { ... }, priority }
   */
  async handleBrandThemeExtension(context) {
    const { pluginId, config } = context;
    if (!config.id) {
      throw new Error("brand.theme id 是必需的");
    }
    const key = `${pluginId}:${config.id}`;
    this.uiRegistry.brandThemes.set(key, {
      id: key,
      pluginId,
      themeId: config.id,
      name: config.name || config.id,
      mode: config.mode || "light",
      tokens: config.tokens || {},
      priority: config.priority || 100,
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Brand theme 已注册: ${key}`);
    this.emit("brand:theme:registered", { pluginId, themeId: key });
    return { success: true, key };
  }

  /**
   * 处理 brand.identity 扩展：企业品牌标识
   * config: { id, productName, logo, splash, eula, links, priority }
   */
  async handleBrandIdentityExtension(context) {
    const { pluginId, config } = context;
    if (!config.id) {
      throw new Error("brand.identity id 是必需的");
    }
    const key = `${pluginId}:${config.id}`;
    this.uiRegistry.brandIdentities.set(key, {
      id: key,
      pluginId,
      identityId: config.id,
      productName: config.productName || null,
      tagline: config.tagline || null,
      logo: config.logo || null,
      splash: config.splash || null,
      favicon: config.favicon || null,
      eula: config.eula || null,
      links: config.links || {},
      priority: config.priority || 100,
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Brand identity 已注册: ${key}`);
    this.emit("brand:identity:registered", { pluginId, identityId: key });
    return { success: true, key };
  }

  // ============================================
  // UI 注册表查询方法
  // ============================================

  /**
   * 获取所有注册的页面
   * @param {string} pluginId - 可选，按插件ID过滤
   * @returns {Array} 页面列表
   */
  getRegisteredPages(pluginId = null) {
    const pages = Array.from(this.uiRegistry.pages.values());
    if (pluginId) {
      return pages.filter((p) => p.pluginId === pluginId);
    }
    return pages;
  }

  /**
   * 获取所有注册的菜单
   * @param {string} position - 可选，按位置过滤 (sidebar/header/context)
   * @param {string} pluginId - 可选，按插件ID过滤
   * @returns {Array} 菜单列表
   */
  getRegisteredMenus(position = null, pluginId = null) {
    let menus = Array.from(this.uiRegistry.menus.values());

    if (position) {
      menus = menus.filter((m) => m.position === position);
    }
    if (pluginId) {
      menus = menus.filter((m) => m.pluginId === pluginId);
    }

    return menus.sort((a, b) => a.order - b.order);
  }

  /**
   * 获取所有注册的组件
   * @param {string} slot - 可选，按插槽过滤
   * @param {string} pluginId - 可选，按插件ID过滤
   * @returns {Array} 组件列表
   */
  getRegisteredComponents(slot = null, pluginId = null) {
    let components = Array.from(this.uiRegistry.components.values());

    if (slot) {
      components = components.filter((c) => c.slot === slot);
    }
    if (pluginId) {
      components = components.filter((c) => c.pluginId === pluginId);
    }

    return components.sort((a, b) => a.order - b.order);
  }

  // ============================================
  // v6 Shell 查询方法
  // ============================================

  getRegisteredSpaces(pluginId = null) {
    let items = Array.from(this.uiRegistry.spaces.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items.sort((a, b) => a.order - b.order);
  }

  getRegisteredArtifacts(pluginId = null) {
    let items = Array.from(this.uiRegistry.artifacts.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items;
  }

  getArtifactRenderer(type) {
    for (const item of this.uiRegistry.artifacts.values()) {
      if (item.type === type) {
        return item;
      }
    }
    return null;
  }

  getRegisteredSlashCommands(pluginId = null) {
    let items = Array.from(this.uiRegistry.slashCommands.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items;
  }

  getRegisteredMentionSources(pluginId = null) {
    let items = Array.from(this.uiRegistry.mentionSources.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items;
  }

  getRegisteredStatusBarWidgets(position = null, pluginId = null) {
    let items = Array.from(this.uiRegistry.statusBarWidgets.values());
    if (position) {
      items = items.filter((x) => x.position === position);
    }
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items.sort((a, b) => a.order - b.order);
  }

  getRegisteredHomeWidgets(pluginId = null) {
    let items = Array.from(this.uiRegistry.homeWidgets.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items.sort((a, b) => a.order - b.order);
  }

  getRegisteredComposerSlots(position = null, pluginId = null) {
    let items = Array.from(this.uiRegistry.composerSlots.values());
    if (position) {
      items = items.filter((x) => x.position === position);
    }
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items.sort((a, b) => a.order - b.order);
  }

  /**
   * 获取全部已注册的 brand.theme 贡献（按 priority 降序）
   */
  getRegisteredBrandThemes(pluginId = null) {
    let items = Array.from(this.uiRegistry.brandThemes.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取当前激活的 brand.theme（最高 priority；后续 Profile 会显式 pin）
   */
  getActiveBrandTheme() {
    const themes = this.getRegisteredBrandThemes();
    return themes.length > 0 ? themes[0] : null;
  }

  /**
   * 获取全部已注册的 brand.identity 贡献（按 priority 降序）
   */
  getRegisteredBrandIdentities(pluginId = null) {
    let items = Array.from(this.uiRegistry.brandIdentities.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 获取当前激活的 brand.identity（最高 priority）
   */
  getActiveBrandIdentity() {
    const ids = this.getRegisteredBrandIdentities();
    return ids.length > 0 ? ids[0] : null;
  }

  /**
   * P4 能力点 getters：按 priority 降序；空列表返回 null 的 active-getter
   */
  getRegisteredLLMProviders(pluginId = null) {
    let items = Array.from(this.uiRegistry.llmProviders.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items.sort((a, b) => b.priority - a.priority);
  }

  getActiveLLMProvider() {
    const items = this.getRegisteredLLMProviders();
    return items.length > 0 ? items[0] : null;
  }

  getRegisteredAuthProviders(pluginId = null) {
    let items = Array.from(this.uiRegistry.authProviders.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items.sort((a, b) => b.priority - a.priority);
  }

  getActiveAuthProvider() {
    const items = this.getRegisteredAuthProviders();
    return items.length > 0 ? items[0] : null;
  }

  getRegisteredDataStorages(pluginId = null) {
    let items = Array.from(this.uiRegistry.dataStorages.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items.sort((a, b) => b.priority - a.priority);
  }

  getActiveDataStorage() {
    const items = this.getRegisteredDataStorages();
    return items.length > 0 ? items[0] : null;
  }

  getRegisteredDataCryptos(pluginId = null) {
    let items = Array.from(this.uiRegistry.dataCryptos.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items.sort((a, b) => b.priority - a.priority);
  }

  getActiveDataCrypto() {
    const items = this.getRegisteredDataCryptos();
    return items.length > 0 ? items[0] : null;
  }

  getRegisteredComplianceAudits(pluginId = null) {
    let items = Array.from(this.uiRegistry.complianceAudits.values());
    if (pluginId) {
      items = items.filter((x) => x.pluginId === pluginId);
    }
    return items.sort((a, b) => b.priority - a.priority);
  }

  getActiveComplianceAudit() {
    const items = this.getRegisteredComplianceAudits();
    return items.length > 0 ? items[0] : null;
  }

  /**
   * 注销插件的所有UI扩展
   * @param {string} pluginId - 插件ID
   */
  unregisterPluginUI(pluginId) {
    // 移除页面
    for (const [id, page] of this.uiRegistry.pages) {
      if (page.pluginId === pluginId) {
        this.uiRegistry.pages.delete(id);
        this.emit("ui:page:unregistered", { pluginId, pageId: id });
      }
    }

    // 移除菜单
    for (const [id, menu] of this.uiRegistry.menus) {
      if (menu.pluginId === pluginId) {
        this.uiRegistry.menus.delete(id);
        this.emit("ui:menu:unregistered", { pluginId, menuId: id });
      }
    }

    // 移除组件
    for (const [id, component] of this.uiRegistry.components) {
      if (component.pluginId === pluginId) {
        this.uiRegistry.components.delete(id);
        this.emit("ui:component:unregistered", { pluginId, componentId: id });
      }
    }

    // v6 shell 扩展 + P3 企业定制扩展
    const v6Maps = [
      ["spaces", "ui:space:unregistered"],
      ["artifacts", "ui:artifact:unregistered"],
      ["slashCommands", "ui:slash:unregistered"],
      ["mentionSources", "ui:mention:unregistered"],
      ["statusBarWidgets", "ui:status-bar:unregistered"],
      ["homeWidgets", "ui:home-widget:unregistered"],
      ["composerSlots", "ui:composer-slot:unregistered"],
      ["brandThemes", "brand:theme:unregistered"],
      ["brandIdentities", "brand:identity:unregistered"],
      ["llmProviders", "ai:llm-provider:unregistered"],
      ["authProviders", "auth:provider:unregistered"],
      ["dataStorages", "data:storage:unregistered"],
      ["dataCryptos", "data:crypto:unregistered"],
      ["complianceAudits", "compliance:audit:unregistered"],
    ];
    for (const [mapKey, eventName] of v6Maps) {
      const map = this.uiRegistry[mapKey];
      for (const [id, item] of map) {
        if (item.pluginId === pluginId) {
          map.delete(id);
          this.emit(eventName, { pluginId, id });
        }
      }
    }

    logger.info(`[PluginManager] 已注销插件 ${pluginId} 的所有UI扩展`);
  }

  async handleDataImporterExtension(context) {
    logger.info("[PluginManager] 处理数据导入器扩展:", context);
    // Phase 4 实现
  }

  async handleDataExporterExtension(context) {
    logger.info("[PluginManager] 处理数据导出器扩展:", context);
    // Phase 4 实现
  }

  /**
   * 处理 ai.llm-provider 扩展：LLM 推理后端
   * config: { id, name, models, endpoint, priority, capabilities }
   */
  async handleAILLMProviderExtension(context) {
    const { pluginId, config } = context;
    if (!config.id) {
      throw new Error("ai.llm-provider id 是必需的");
    }
    const key = `${pluginId}:${config.id}`;
    this.uiRegistry.llmProviders.set(key, {
      id: key,
      pluginId,
      providerId: config.id,
      name: config.name || config.id,
      models: Array.isArray(config.models) ? config.models : [],
      endpoint: config.endpoint || null,
      priority: config.priority || 100,
      capabilities: config.capabilities || {},
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ LLM provider 已注册: ${key}`);
    this.emit("ai:llm-provider:registered", { pluginId, providerId: key });
    return { success: true, key };
  }

  /**
   * 处理 auth.provider 扩展：认证/单点登录提供方
   * config: { id, name, kind: "local"|"oidc"|"saml"|"ldap"|"did", endpoints, scopes, priority }
   */
  async handleAuthProviderExtension(context) {
    const { pluginId, config } = context;
    if (!config.id) {
      throw new Error("auth.provider id 是必需的");
    }
    const key = `${pluginId}:${config.id}`;
    this.uiRegistry.authProviders.set(key, {
      id: key,
      pluginId,
      providerId: config.id,
      name: config.name || config.id,
      kind: config.kind || "local",
      endpoints: config.endpoints || {},
      scopes: Array.isArray(config.scopes) ? config.scopes : [],
      priority: config.priority || 100,
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Auth provider 已注册: ${key}`);
    this.emit("auth:provider:registered", { pluginId, providerId: key });
    return { success: true, key };
  }

  /**
   * 处理 data.storage 扩展：数据存储后端
   * config: { id, name, kind: "sqlite"|"postgres"|"ipfs"|"s3"|"custom", capabilities, priority }
   */
  async handleDataStorageExtension(context) {
    const { pluginId, config } = context;
    if (!config.id) {
      throw new Error("data.storage id 是必需的");
    }
    const key = `${pluginId}:${config.id}`;
    this.uiRegistry.dataStorages.set(key, {
      id: key,
      pluginId,
      storageId: config.id,
      name: config.name || config.id,
      kind: config.kind || "custom",
      capabilities: config.capabilities || {},
      priority: config.priority || 100,
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Data storage 已注册: ${key}`);
    this.emit("data:storage:registered", { pluginId, storageId: key });
    return { success: true, key };
  }

  /**
   * 处理 data.crypto 扩展：加密服务提供方
   * config: { id, name, algs, capabilities: { sign, encrypt, hash, pqc }, priority }
   */
  async handleDataCryptoExtension(context) {
    const { pluginId, config } = context;
    if (!config.id) {
      throw new Error("data.crypto id 是必需的");
    }
    const key = `${pluginId}:${config.id}`;
    this.uiRegistry.dataCryptos.set(key, {
      id: key,
      pluginId,
      cryptoId: config.id,
      name: config.name || config.id,
      algs: Array.isArray(config.algs) ? config.algs : [],
      capabilities: config.capabilities || {},
      priority: config.priority || 100,
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Data crypto 已注册: ${key}`);
    this.emit("data:crypto:registered", { pluginId, cryptoId: key });
    return { success: true, key };
  }

  /**
   * 处理 compliance.audit 扩展：审计/合规输出端
   * config: { id, name, kind: "syslog"|"file"|"splunk"|"siem"|"custom", sinks, priority }
   */
  async handleComplianceAuditExtension(context) {
    const { pluginId, config } = context;
    if (!config.id) {
      throw new Error("compliance.audit id 是必需的");
    }
    const key = `${pluginId}:${config.id}`;
    this.uiRegistry.complianceAudits.set(key, {
      id: key,
      pluginId,
      auditId: config.id,
      name: config.name || config.id,
      kind: config.kind || "custom",
      sinks: Array.isArray(config.sinks) ? config.sinks : [],
      priority: config.priority || 100,
      registeredAt: Date.now(),
    });
    logger.info(`[PluginManager] ✓ Compliance audit 已注册: ${key}`);
    this.emit("compliance:audit:registered", { pluginId, auditId: key });
    return { success: true, key };
  }

  async handleAIFunctionToolExtension(context) {
    logger.info("[PluginManager] 处理AI Function工具扩展:", context);

    const { pluginId, config } = context;
    const { tools = [], skills = [] } = config;

    try {
      // 1. 注册插件提供的工具
      for (const toolDef of tools) {
        const toolId = `${pluginId}_${toolDef.name}`;

        // 获取插件实例以绑定handler
        const plugin = this.plugins.get(pluginId);
        if (!plugin || !plugin.sandbox) {
          logger.warn(`[PluginManager] 插件未加载，跳过工具注册: ${pluginId}`);
          continue;
        }

        // 从插件实例获取handler方法
        let handler = null;
        if (typeof toolDef.handler === "string") {
          // handler是方法名，从插件实例获取
          handler = async (params, context) => {
            return await plugin.sandbox.callMethod(
              toolDef.handler,
              params,
              context,
            );
          };
        } else if (typeof toolDef.handler === "function") {
          handler = toolDef.handler;
        }

        if (!handler) {
          logger.warn(`[PluginManager] 工具handler无效: ${toolDef.name}`);
          continue;
        }

        // 注册工具到ToolManager
        if (this.systemContext.toolManager) {
          await this.systemContext.toolManager.registerTool(
            {
              id: toolId,
              name: toolDef.name,
              display_name: toolDef.displayName || toolDef.name,
              description: toolDef.description || "",
              category: toolDef.category || "custom",
              parameters_schema: toolDef.parameters || {},
              return_schema: toolDef.returnSchema || {},
              plugin_id: pluginId,
              is_builtin: 0,
              enabled: 1,
              tool_type: toolDef.type || "function",
              required_permissions: toolDef.requiredPermissions || [],
              risk_level: toolDef.riskLevel || 2,
            },
            handler,
          );

          logger.info(`[PluginManager] 插件工具已注册: ${toolDef.name}`);
        }
      }

      // 2. 注册插件提供的技能
      for (const skillDef of skills) {
        const skillId = `${pluginId}_${skillDef.id}`;

        if (this.systemContext.skillManager) {
          await this.systemContext.skillManager.registerSkill({
            id: skillId,
            name: skillDef.name,
            display_name: skillDef.displayName || skillDef.name,
            description: skillDef.description || "",
            category: skillDef.category || "custom",
            icon: skillDef.icon || null,
            plugin_id: pluginId,
            is_builtin: 0,
            enabled: 1,
            tags: skillDef.tags || [],
            config: skillDef.config || {},
          });

          // 3. 关联技能和工具
          if (skillDef.tools && skillDef.tools.length > 0) {
            for (let i = 0; i < skillDef.tools.length; i++) {
              const toolName = skillDef.tools[i];
              const toolId = `${pluginId}_${toolName}`;

              // 查找工具
              const tool =
                (await this.systemContext.toolManager.getToolByName(
                  toolName,
                )) || (await this.systemContext.toolManager.getTool(toolId));

              if (tool) {
                await this.systemContext.skillManager.addToolToSkill(
                  skillId,
                  tool.id,
                  i === 0 ? "primary" : "secondary",
                  skillDef.tools.length - i,
                );
              } else {
                logger.warn(
                  `[PluginManager] 工具不存在，跳过关联: ${toolName}`,
                );
              }
            }
          }

          logger.info(`[PluginManager] 插件技能已注册: ${skillDef.name}`);
        }
      }

      logger.info("[PluginManager] AI工具扩展处理完成");
    } catch (error) {
      logger.error("[PluginManager] 处理AI工具扩展失败:", error);
      throw error;
    }
  }

  async handleLifecycleHookExtension(context) {
    logger.info("[PluginManager] 处理生命周期钩子扩展:", context);
    // Phase 4 实现
  }

  // ============================================
  // 扩展点注册/注销辅助方法（Phase 2）
  // ============================================

  /**
   * 注册插件的扩展点
   * @param {string} pluginId - 插件ID
   */
  async registerPluginExtensions(pluginId) {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return;
    }

    const { extensionPoints = [] } = plugin.manifest;
    const isFirstParty = plugin.firstParty === true;

    for (const ext of extensionPoints) {
      try {
        const { point, config, priority = 100 } = ext;

        if (!isFirstParty) {
          await this.registry.registerExtension(
            pluginId,
            point,
            config,
            priority,
          );
        }

        await this.applyExtension(pluginId, point, config, priority);

        logger.info(`[PluginManager] 注册扩展点: ${pluginId} -> ${point}`);
      } catch (error) {
        logger.error(`[PluginManager] 注册扩展点失败:`, error);
      }
    }
  }

  /**
   * 应用单个扩展：调用扩展点 handler 并将其记入 extensions 数组，
   * 以便 uiRegistry 同步更新，triggerExtensionPoint 可遍历执行。
   * @param {string} pluginId
   * @param {string} point - 扩展点名
   * @param {Object} config - 扩展配置
   * @param {number} priority
   */
  async applyExtension(pluginId, point, config, priority = 100) {
    const extensionPoint = this.extensionPoints.get(point);
    if (!extensionPoint) {
      logger.warn(`[PluginManager] 未知扩展点: ${point}`);
      return null;
    }

    const context = { pluginId, config, priority };
    const result = await extensionPoint.handler(context);

    extensionPoint.extensions.push({
      id: `${pluginId}:${point}:${config?.id || config?.trigger || config?.type || config?.prefix || extensionPoint.extensions.length}`,
      pluginId,
      config,
      priority,
      handler: extensionPoint.handler,
      result,
    });

    return result;
  }

  /**
   * 注销插件的扩展点
   * @param {string} pluginId - 插件ID
   */
  async unregisterPluginExtensions(pluginId) {
    try {
      const plugin = this.plugins.get(pluginId);
      const isFirstParty = plugin?.firstParty === true;

      if (!isFirstParty) {
        await this.registry.unregisterExtensions(pluginId);
      }

      for (const ep of this.extensionPoints.values()) {
        ep.extensions = ep.extensions.filter((e) => e.pluginId !== pluginId);
      }
      this.unregisterPluginUI(pluginId);

      logger.info(`[PluginManager] 注销扩展点: ${pluginId}`);
    } catch (error) {
      logger.error(`[PluginManager] 注销扩展点失败:`, error);
    }
  }

  /**
   * 获取插件已授予的权限
   * @param {string} pluginId
   * @returns {Array}
   */
  getPluginPermissions(pluginId) {
    return this.registry.getPluginPermissions(pluginId) || [];
  }

  /**
   * 更新插件权限
   * @param {string} pluginId
   * @param {string} permission
   * @param {boolean} granted
   */
  async updatePluginPermission(pluginId, permission, granted) {
    await this.registry.updatePermission(pluginId, permission, granted);
    return this.getPluginPermissions(pluginId);
  }

  /**
   * 获取插件目录
   * @returns {string}
   */
  getPluginsDirectory() {
    return this.loader?.pluginsDir;
  }
}

// ============================================
// 单例模式导出
// ============================================

let pluginManagerInstance = null;

/**
 * 获取PluginManager单例
 * @param {Object} database - 数据库实例
 * @param {Object} config - 配置
 * @returns {PluginManager}
 */
function getPluginManager(database, config) {
  if (!pluginManagerInstance && database) {
    pluginManagerInstance = new PluginManager(database, config);
  }
  return pluginManagerInstance;
}

/**
 * 设置PluginManager单例
 * @param {PluginManager} manager - PluginManager实例
 */
function setPluginManager(manager) {
  pluginManagerInstance = manager;
}

module.exports = {
  PluginManager,
  getPluginManager,
  setPluginManager,
};
