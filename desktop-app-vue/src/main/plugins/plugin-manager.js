/**
 * PluginManager - 插件管理器（核心协调器）
 *
 * 职责：
 * - 插件生命周期管理（安装、加载、启用、禁用、卸载）
 * - 扩展点管理
 * - 插件间依赖解析
 * - 事件协调
 */

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
    console.log("[PluginManager] 系统上下文已设置");
  }

  /**
   * 初始化插件管理器
   */
  async initialize() {
    console.log("[PluginManager] 初始化插件管理器...");

    try {
      // 1. 初始化注册表（创建数据库表）
      await this.registry.initialize();

      // 2. 注册内置扩展点
      this.registerBuiltInExtensionPoints();

      // 3. 加载已安装且启用的插件
      const installedPlugins = this.registry.getInstalledPlugins({
        enabled: true,
      });

      console.log(
        `[PluginManager] 找到 ${installedPlugins.length} 个已启用的插件`,
      );

      for (const pluginMeta of installedPlugins) {
        try {
          // Phase 2: 实际加载插件
          await this.loadPlugin(pluginMeta.id);

          console.log(`[PluginManager] 插件 ${pluginMeta.id} 加载成功`);
        } catch (error) {
          console.error(
            `[PluginManager] 加载插件失败: ${pluginMeta.id}`,
            error,
          );
          await this.registry.recordError(pluginMeta.id, error);
        }
      }

      this.isInitialized = true;
      this.emit("initialized", { pluginCount: installedPlugins.length });

      console.log("[PluginManager] 初始化完成");
    } catch (error) {
      console.error("[PluginManager] 初始化失败:", error);
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

    console.log("[PluginManager] 内置扩展点已注册");
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
      console.log(`[PluginManager] 解析插件来源: ${source}`);
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

      console.log(`[PluginManager] 插件安装成功: ${manifest.id}`);

      return {
        success: true,
        pluginId: manifest.id,
        path: installedPath,
      };
    } catch (error) {
      this.emit("plugin:install-failed", { source, error: error.message });
      console.error("[PluginManager] 安装插件失败:", error);
      throw error;
    }
  }

  /**
   * 检查兼容性
   * @param {Object} manifest - 插件manifest
   */
  checkCompatibility(manifest) {
    if (!manifest.compatibility || !manifest.compatibility.chainlesschain) {
      console.warn("[PluginManager] 插件未声明兼容性，跳过检查");
      return;
    }

    // 获取当前应用版本
    const currentVersion = this._getCurrentVersion();
    const requiredVersion = manifest.compatibility.chainlesschain;

    console.log(
      `[PluginManager] 检查兼容性: 需要 ${requiredVersion}, 当前 ${currentVersion}`,
    );

    // 使用 semver 进行精确版本检查
    if (!semver.satisfies(currentVersion, requiredVersion)) {
      throw new Error(
        `插件 ${manifest.id} 不兼容当前版本。` +
          `需要: ${requiredVersion}, 当前: ${currentVersion}`,
      );
    }

    console.log(`[PluginManager] 插件 ${manifest.id} 兼容性检查通过`);
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
      console.warn("[PluginManager] 无法读取 package.json:", error.message);
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

    console.log(
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
      console.warn(`[PluginManager] 缺失依赖: ${missingList}`);
      // 可以选择抛出错误或继续
      // throw new Error(`插件 ${manifest.id} 缺失依赖: ${missingList}`);
    }

    if (incompatibleDeps.length > 0) {
      const incompatList = incompatibleDeps
        .map((d) => `${d.name} (需要 ${d.required}, 已安装 ${d.installed})`)
        .join(", ");
      console.warn(`[PluginManager] 不兼容依赖: ${incompatList}`);
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

    console.log(`[PluginManager] 插件请求权限:`, permissions);

    try {
      // 使用权限对话框管理器请求用户授权
      const permissionDialogManager = getPermissionDialogManager();
      const result = await permissionDialogManager.requestPermissions(manifest);

      if (!result.granted) {
        console.log(`[PluginManager] 用户拒绝了插件 ${manifest.id} 的权限请求`);
        return false;
      }

      // 根据用户的选择更新权限
      const grantedPermissions = result.permissions || {};
      for (const permission of permissions) {
        const granted = grantedPermissions[permission] === true;
        await this.registry.updatePermission(manifest.id, permission, granted);
      }

      // 检查是否有任何权限被授予
      const anyGranted = Object.values(grantedPermissions).some((v) => v === true);
      if (!anyGranted) {
        console.log(`[PluginManager] 用户未授予插件 ${manifest.id} 任何权限`);
        return false;
      }

      console.log(`[PluginManager] 插件 ${manifest.id} 权限已更新:`, grantedPermissions);
      return true;
    } catch (error) {
      console.error(`[PluginManager] 权限请求失败:`, error);
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
      console.warn(`[PluginManager] 插件已加载: ${pluginId}`);
      return;
    }

    const pluginMeta = this.registry.getPlugin(pluginId);
    if (!pluginMeta) {
      throw new Error(`插件不存在: ${pluginId}`);
    }

    this.emit("plugin:loading", { pluginId });

    try {
      console.log(`[PluginManager] 加载插件: ${pluginId}`);

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

      console.log(`[PluginManager] 插件加载成功: ${pluginId}`);
    } catch (error) {
      this.emit("plugin:load-failed", { pluginId, error: error.message });
      await this.registry.recordError(pluginId, error);
      console.error(`[PluginManager] 插件加载失败: ${pluginId}`, error);
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
      console.log(`[PluginManager] 插件已启用: ${pluginId}`);
      return;
    }

    this.emit("plugin:enabling", { pluginId });

    try {
      console.log(`[PluginManager] 启用插件: ${pluginId}`);

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

      console.log(`[PluginManager] 插件已启用: ${pluginId}`);
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
      console.log(`[PluginManager] 插件未启用: ${pluginId}`);
      return;
    }

    this.emit("plugin:disabling", { pluginId });

    try {
      console.log(`[PluginManager] 禁用插件: ${pluginId}`);

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

      console.log(`[PluginManager] 插件已禁用: ${pluginId}`);
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
      console.log(`[PluginManager] 卸载插件: ${pluginId}`);

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

      console.log(`[PluginManager] 插件已卸载: ${pluginId}`);
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
      console.warn(`[PluginManager] 未知扩展点: ${name}`);
      return [];
    }

    const results = [];

    for (const extension of extensionPoint.extensions) {
      try {
        const result = await extension.handler(context);
        results.push(result);
      } catch (error) {
        console.error(`[PluginManager] 扩展执行失败:`, error);
        this.emit("extension:error", { extension: extension.id, error });
      }
    }

    return results;
  }

  // ============================================
  // 扩展点处理函数（Phase 3-4 实现）
  // ============================================

  async handleUIPageExtension(context) {
    console.log("[PluginManager] 处理UI页面扩展:", context);
    // Phase 3 实现
  }

  async handleUIMenuExtension(context) {
    console.log("[PluginManager] 处理UI菜单扩展:", context);
    // Phase 3 实现
  }

  async handleUIComponentExtension(context) {
    console.log("[PluginManager] 处理UI组件扩展:", context);
    // Phase 3 实现
  }

  async handleDataImporterExtension(context) {
    console.log("[PluginManager] 处理数据导入器扩展:", context);
    // Phase 4 实现
  }

  async handleDataExporterExtension(context) {
    console.log("[PluginManager] 处理数据导出器扩展:", context);
    // Phase 4 实现
  }

  async handleAILLMProviderExtension(context) {
    console.log("[PluginManager] 处理AI LLM提供商扩展:", context);
    // Phase 4 实现
  }

  async handleAIFunctionToolExtension(context) {
    console.log("[PluginManager] 处理AI Function工具扩展:", context);

    const { pluginId, config } = context;
    const { tools = [], skills = [] } = config;

    try {
      // 1. 注册插件提供的工具
      for (const toolDef of tools) {
        const toolId = `${pluginId}_${toolDef.name}`;

        // 获取插件实例以绑定handler
        const plugin = this.plugins.get(pluginId);
        if (!plugin || !plugin.sandbox) {
          console.warn(`[PluginManager] 插件未加载，跳过工具注册: ${pluginId}`);
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
          console.warn(`[PluginManager] 工具handler无效: ${toolDef.name}`);
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

          console.log(`[PluginManager] 插件工具已注册: ${toolDef.name}`);
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
                console.warn(
                  `[PluginManager] 工具不存在，跳过关联: ${toolName}`,
                );
              }
            }
          }

          console.log(`[PluginManager] 插件技能已注册: ${skillDef.name}`);
        }
      }

      console.log("[PluginManager] AI工具扩展处理完成");
    } catch (error) {
      console.error("[PluginManager] 处理AI工具扩展失败:", error);
      throw error;
    }
  }

  async handleLifecycleHookExtension(context) {
    console.log("[PluginManager] 处理生命周期钩子扩展:", context);
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

    for (const ext of extensionPoints) {
      try {
        const { point, config, priority = 100 } = ext;

        // 注册到数据库
        await this.registry.registerExtension(
          pluginId,
          point,
          config,
          priority,
        );

        console.log(`[PluginManager] 注册扩展点: ${pluginId} -> ${point}`);
      } catch (error) {
        console.error(`[PluginManager] 注册扩展点失败:`, error);
      }
    }
  }

  /**
   * 注销插件的扩展点
   * @param {string} pluginId - 插件ID
   */
  async unregisterPluginExtensions(pluginId) {
    try {
      await this.registry.unregisterExtensions(pluginId);
      console.log(`[PluginManager] 注销扩展点: ${pluginId}`);
    } catch (error) {
      console.error(`[PluginManager] 注销扩展点失败:`, error);
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
