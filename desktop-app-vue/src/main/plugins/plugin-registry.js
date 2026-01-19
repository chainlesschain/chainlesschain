const { logger, createLogger } = require('../utils/logger.js');

/**
 * PluginRegistry - 插件注册表
 *
 * 职责：
 * - 管理插件的元数据
 * - 与数据库交互
 * - 提供插件查询和管理接口
 */

class PluginRegistry {
  constructor(database) {
    this.database = database;
    this.isInitialized = false;
  }

  /**
   * 初始化插件注册表
   * 创建必要的数据库表
   */
  async initialize() {
    logger.info('[PluginRegistry] 初始化插件注册表...');

    try {
      // 读取并执行迁移脚本
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(__dirname, '../database/migrations/001_plugin_system.sql');

      if (fs.existsSync(migrationPath)) {
        const sql = fs.readFileSync(migrationPath, 'utf-8');

        // 移除注释行
        const cleanedSQL = sql
          .split('\n')
          .filter(line => !line.trim().startsWith('--'))
          .join('\n');

        // 使用 exec 执行整个 SQL 脚本（更可靠）
        try {
          this.database.db.exec(cleanedSQL);
          logger.info('[PluginRegistry] 数据库表创建成功');
        } catch (error) {
          // 如果整体执行失败，尝试逐个执行（跳过失败的语句）
          logger.warn('[PluginRegistry] 整体执行失败，尝试逐个执行...', error.message);

          const statements = cleanedSQL
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

          let successCount = 0;
          let failCount = 0;

          for (const statement of statements) {
            try {
              this.database.db.exec(statement);
              successCount++;
            } catch (err) {
              // 忽略 "already exists" 类型的错误
              if (!err.message.includes('already exists')) {
                logger.warn('[PluginRegistry] SQL语句执行失败:', statement.substring(0, 80) + '...', err.message);
                failCount++;
              } else {
                successCount++;
              }
            }
          }

          logger.info(`[PluginRegistry] SQL执行完成: ${successCount} 成功, ${failCount} 失败`);
        }
      } else {
        logger.warn('[PluginRegistry] 迁移文件不存在:', migrationPath);
      }

      this.isInitialized = true;
    } catch (error) {
      logger.error('[PluginRegistry] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 注册插件
   * @param {Object} manifest - 插件manifest
   * @param {string} installedPath - 安装路径
   * @returns {Object} 注册的插件信息
   */
  async register(manifest, installedPath) {
    const now = Date.now();

    const stmt = this.database.db.prepare(`
      INSERT INTO plugins (
        id, name, version, author, description, homepage, license,
        path, manifest, enabled, state, category,
        installed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      manifest.id,
      manifest.name,
      manifest.version,
      manifest.author || '',
      manifest.description || '',
      manifest.homepage || '',
      manifest.license || 'MIT',
      installedPath,
      JSON.stringify(manifest),
      1, // enabled
      'installed', // state
      manifest.category || 'custom',
      now,
      now
    );

    stmt.free();

    // 注册权限
    if (manifest.permissions && manifest.permissions.length > 0) {
      await this.registerPermissions(manifest.id, manifest.permissions);
    }

    // 注册依赖
    if (manifest.dependencies) {
      await this.registerDependencies(manifest.id, manifest.dependencies);
    }

    // 记录事件日志
    await this.logEvent(manifest.id, 'installed', {
      version: manifest.version,
      path: installedPath,
    });

    logger.info(`[PluginRegistry] 插件已注册: ${manifest.id}`);

    return this.getPlugin(manifest.id);
  }

  /**
   * 注册插件权限
   */
  async registerPermissions(pluginId, permissions) {
    const stmt = this.database.db.prepare(`
      INSERT OR REPLACE INTO plugin_permissions (plugin_id, permission, granted, granted_at)
      VALUES (?, ?, 0, NULL)
    `);

    for (const permission of permissions) {
      stmt.run(pluginId, permission);
    }

    stmt.free();
  }

  /**
   * 注册插件依赖
   */
  async registerDependencies(pluginId, dependencies) {
    const stmt = this.database.db.prepare(`
      INSERT INTO plugin_dependencies (plugin_id, dependency_id, dependency_type, version_constraint)
      VALUES (?, ?, ?, ?)
    `);

    for (const [depId, versionConstraint] of Object.entries(dependencies)) {
      const depType = depId.startsWith('com.') ? 'plugin' : 'npm';
      stmt.run(pluginId, depId, depType, versionConstraint);
    }

    stmt.free();
  }

  /**
   * 获取插件信息
   * @param {string} pluginId - 插件ID
   * @returns {Object|null} 插件信息
   */
  getPlugin(pluginId) {
    const stmt = this.database.db.prepare('SELECT * FROM plugins WHERE id = ?');
    const row = stmt.get(pluginId);
    stmt.free();

    if (row) {
      return {
        ...row,
        manifest: JSON.parse(row.manifest),
        enabled: row.enabled === 1,
      };
    }

    return null;
  }

  /**
   * 获取所有已安装的插件
   * @param {Object} filters - 过滤条件
   * @returns {Array} 插件列表
   */
  getInstalledPlugins(filters = {}) {
    let sql = 'SELECT * FROM plugins WHERE 1=1';
    const params = [];

    if (filters.enabled !== undefined) {
      sql += ' AND enabled = ?';
      params.push(filters.enabled ? 1 : 0);
    }

    if (filters.category) {
      sql += ' AND category = ?';
      params.push(filters.category);
    }

    if (filters.state) {
      sql += ' AND state = ?';
      params.push(filters.state);
    }

    sql += ' ORDER BY installed_at DESC';

    const stmt = this.database.db.prepare(sql);
    const rows = stmt.all(...params);
    stmt.free();

    return rows.map(row => ({
      ...row,
      manifest: JSON.parse(row.manifest),
      enabled: row.enabled === 1,
    }));
  }

  /**
   * 更新插件状态
   * @param {string} pluginId - 插件ID
   * @param {string} state - 新状态
   */
  async updatePluginState(pluginId, state) {
    const now = Date.now();

    const stmt = this.database.db.prepare(`
      UPDATE plugins
      SET state = ?, updated_at = ?, last_enabled_at = ?
      WHERE id = ?
    `);

    const lastEnabledAt = state === 'enabled' ? now : null;

    stmt.run(state, now, lastEnabledAt, pluginId);
    stmt.free();

    await this.logEvent(pluginId, `state_changed_${state}`, { state });
  }

  /**
   * 更新启用状态
   * @param {string} pluginId - 插件ID
   * @param {boolean} enabled - 是否启用
   */
  async updateEnabled(pluginId, enabled) {
    const now = Date.now();

    const stmt = this.database.db.prepare(`
      UPDATE plugins
      SET enabled = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(enabled ? 1 : 0, now, pluginId);
    stmt.free();

    await this.logEvent(pluginId, enabled ? 'enabled' : 'disabled');
  }

  /**
   * 注销插件
   * @param {string} pluginId - 插件ID
   */
  async unregister(pluginId) {
    // 外键级联删除会自动删除相关权限、依赖等
    const stmt = this.database.db.prepare('DELETE FROM plugins WHERE id = ?');
    stmt.run(pluginId);
    stmt.free();

    await this.logEvent(pluginId, 'uninstalled');

    logger.info(`[PluginRegistry] 插件已注销: ${pluginId}`);
  }

  /**
   * 记录错误
   * @param {string} pluginId - 插件ID
   * @param {Error} error - 错误对象
   */
  async recordError(pluginId, error) {
    const stmt = this.database.db.prepare(`
      UPDATE plugins
      SET last_error = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(error.message, Date.now(), pluginId);
    stmt.free();

    await this.logEvent(pluginId, 'error', {
      message: error.message,
      stack: error.stack,
    }, 'error');
  }

  /**
   * 记录事件日志
   * @param {string} pluginId - 插件ID
   * @param {string} eventType - 事件类型
   * @param {Object} eventData - 事件数据
   * @param {string} level - 日志级别
   */
  async logEvent(pluginId, eventType, eventData = {}, level = 'info') {
    const stmt = this.database.db.prepare(`
      INSERT INTO plugin_event_logs (plugin_id, event_type, event_data, level, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(
      pluginId,
      eventType,
      JSON.stringify(eventData),
      level,
      Date.now()
    );

    stmt.free();
  }

  /**
   * 获取插件的权限
   * @param {string} pluginId - 插件ID
   * @returns {Array} 权限列表
   */
  getPluginPermissions(pluginId) {
    const stmt = this.database.db.prepare(`
      SELECT permission, granted, granted_at
      FROM plugin_permissions
      WHERE plugin_id = ?
    `);

    const rows = stmt.all(pluginId);
    stmt.free();

    return rows.map(row => ({
      permission: row.permission,
      granted: row.granted === 1,
      grantedAt: row.granted_at,
    }));
  }

  /**
   * 更新权限授予状态
   * @param {string} pluginId - 插件ID
   * @param {string} permission - 权限名称
   * @param {boolean} granted - 是否授予
   */
  async updatePermission(pluginId, permission, granted) {
    const stmt = this.database.db.prepare(`
      UPDATE plugin_permissions
      SET granted = ?, granted_at = ?
      WHERE plugin_id = ? AND permission = ?
    `);

    stmt.run(granted ? 1 : 0, granted ? Date.now() : null, pluginId, permission);
    stmt.free();
  }

  /**
   * 获取插件的扩展点
   * @param {string} pluginId - 插件ID
   * @returns {Array} 扩展点列表
   */
  getPluginExtensions(pluginId) {
    const stmt = this.database.db.prepare(`
      SELECT * FROM plugin_extensions
      WHERE plugin_id = ?
    `);

    const rows = stmt.all(pluginId);
    stmt.free();

    return rows.map(row => ({
      ...row,
      config: row.config ? JSON.parse(row.config) : null,
      enabled: row.enabled === 1,
    }));
  }

  /**
   * 注册扩展点
   * @param {string} pluginId - 插件ID
   * @param {string} extensionPoint - 扩展点名称
   * @param {Object} config - 配置
   * @param {number} priority - 优先级
   */
  async registerExtension(pluginId, extensionPoint, config, priority = 100) {
    const id = `${pluginId}:${extensionPoint}:${Date.now()}`;

    const stmt = this.database.db.prepare(`
      INSERT INTO plugin_extensions (id, plugin_id, extension_point, config, priority, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      pluginId,
      extensionPoint,
      JSON.stringify(config),
      priority,
      Date.now()
    );

    stmt.free();

    return id;
  }

  /**
   * 注销扩展点
   * @param {string} pluginId - 插件ID
   */
  async unregisterExtensions(pluginId) {
    const stmt = this.database.db.prepare(`
      DELETE FROM plugin_extensions
      WHERE plugin_id = ?
    `);

    stmt.run(pluginId);
    stmt.free();
  }

  /**
   * 获取指定扩展点的所有扩展
   * @param {string} extensionPoint - 扩展点名称
   * @returns {Array} 扩展列表
   */
  getExtensionsByPoint(extensionPoint) {
    const stmt = this.database.db.prepare(`
      SELECT e.*, p.name as plugin_name, p.enabled as plugin_enabled
      FROM plugin_extensions e
      JOIN plugins p ON e.plugin_id = p.id
      WHERE e.extension_point = ? AND e.enabled = 1 AND p.enabled = 1
      ORDER BY e.priority ASC
    `);

    const rows = stmt.all(extensionPoint);
    stmt.free();

    return rows.map(row => ({
      ...row,
      config: row.config ? JSON.parse(row.config) : null,
    }));
  }

  /**
   * 清理旧的日志（保留最近30天）
   */
  async cleanupLogs() {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const stmt = this.database.db.prepare(`
      DELETE FROM plugin_event_logs
      WHERE created_at < ?
    `);

    const info = stmt.run(thirtyDaysAgo);
    stmt.free();

    logger.info(`[PluginRegistry] 清理了 ${info.changes} 条旧日志`);
  }
}

module.exports = PluginRegistry;
