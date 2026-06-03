-- ChainlessChain 插件系统数据库Schema
-- 迁移版本: 001
-- 创建时间: 2025-12-28

-- ============================================
-- 1. 插件注册表
-- ============================================
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,                    -- 插件ID (如 com.example.myplugin)
  name TEXT NOT NULL,                     -- 插件名称
  version TEXT NOT NULL,                  -- 版本号 (semver)
  author TEXT,                            -- 作者
  description TEXT,                       -- 描述
  homepage TEXT,                          -- 主页URL
  license TEXT,                           -- 许可证
  path TEXT NOT NULL,                     -- 安装路径（绝对路径）
  manifest TEXT NOT NULL,                 -- manifest JSON（完整配置）
  enabled INTEGER DEFAULT 1,              -- 是否启用 (0=禁用, 1=启用)
  state TEXT DEFAULT 'installed',         -- 状态: installed, loaded, enabled, disabled, error
  category TEXT DEFAULT 'custom',         -- 分类: official, community, custom, productivity, ai, data, ui
  installed_at INTEGER NOT NULL,          -- 安装时间戳
  updated_at INTEGER NOT NULL,            -- 更新时间戳
  last_enabled_at INTEGER,                -- 最后启用时间戳
  last_error TEXT,                        -- 最后错误信息

  UNIQUE(id)
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_plugins_enabled ON plugins(enabled);
CREATE INDEX IF NOT EXISTS idx_plugins_state ON plugins(state);
CREATE INDEX IF NOT EXISTS idx_plugins_category ON plugins(category);

-- ============================================
-- 2. 插件权限表
-- ============================================
CREATE TABLE IF NOT EXISTS plugin_permissions (
  plugin_id TEXT NOT NULL,
  permission TEXT NOT NULL,               -- 权限名称 (如 database.read, llm.query)
  granted INTEGER DEFAULT 0,              -- 是否已授权 (0=拒绝, 1=授权)
  granted_at INTEGER,                     -- 授权时间戳
  granted_by TEXT,                        -- 授权人（预留字段）

  PRIMARY KEY (plugin_id, permission),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_plugin_permissions_granted ON plugin_permissions(granted);

-- ============================================
-- 3. 插件依赖表
-- ============================================
CREATE TABLE IF NOT EXISTS plugin_dependencies (
  plugin_id TEXT NOT NULL,
  dependency_id TEXT NOT NULL,            -- 依赖的插件ID或NPM包名
  dependency_type TEXT DEFAULT 'plugin',  -- 类型: plugin（ChainlessChain插件）, npm（NPM包）
  version_constraint TEXT,                -- 版本约束 (如 ^1.0.0, >=2.0.0)
  required INTEGER DEFAULT 1,             -- 是否必需 (0=可选, 1=必需)
  resolved_version TEXT,                  -- 已解析的版本
  resolved_at INTEGER,                    -- 解析时间戳

  PRIMARY KEY (plugin_id, dependency_id),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

-- ============================================
-- 4. 扩展点注册表
-- ============================================
CREATE TABLE IF NOT EXISTS plugin_extensions (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  extension_point TEXT NOT NULL,          -- 扩展点名称 (如 ui.page, ai.function, data.importer)
  config TEXT,                            -- 扩展配置 JSON
  priority INTEGER DEFAULT 100,           -- 优先级 (数字越小优先级越高)
  enabled INTEGER DEFAULT 1,              -- 是否启用
  created_at INTEGER NOT NULL,

  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_plugin_extensions_point ON plugin_extensions(extension_point);
CREATE INDEX IF NOT EXISTS idx_plugin_extensions_plugin ON plugin_extensions(plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_extensions_enabled ON plugin_extensions(enabled);

-- ============================================
-- 5. 插件设置表
-- ============================================
CREATE TABLE IF NOT EXISTS plugin_settings (
  plugin_id TEXT NOT NULL,
  setting_key TEXT NOT NULL,              -- 设置键名
  setting_value TEXT,                     -- 设置值 (JSON序列化)
  setting_type TEXT,                      -- 数据类型: string, number, boolean, json
  is_secret INTEGER DEFAULT 0,            -- 是否为敏感信息 (如API密钥)
  updated_at INTEGER NOT NULL,

  PRIMARY KEY (plugin_id, setting_key),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

-- ============================================
-- 6. 插件事件日志表
-- ============================================
CREATE TABLE IF NOT EXISTS plugin_event_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT NOT NULL,
  event_type TEXT NOT NULL,               -- 事件类型: installed, enabled, disabled, error, api_call
  event_data TEXT,                        -- 事件数据 JSON
  level TEXT DEFAULT 'info',              -- 日志级别: debug, info, warn, error
  created_at INTEGER NOT NULL,

  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_plugin_logs_plugin ON plugin_event_logs(plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_logs_type ON plugin_event_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_plugin_logs_created ON plugin_event_logs(created_at);

-- ============================================
-- 7. 插件API调用统计表 (可选，用于监控和限流)
-- ============================================
CREATE TABLE IF NOT EXISTS plugin_api_stats (
  plugin_id TEXT NOT NULL,
  api_method TEXT NOT NULL,               -- API方法名 (如 database.query, llm.query)
  call_count INTEGER DEFAULT 0,           -- 调用次数
  last_called_at INTEGER,                 -- 最后调用时间
  total_duration_ms INTEGER DEFAULT 0,    -- 总耗时（毫秒）
  error_count INTEGER DEFAULT 0,          -- 错误次数

  PRIMARY KEY (plugin_id, api_method),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

-- ============================================
-- 插入系统元数据
-- ============================================
INSERT OR IGNORE INTO system_settings (key, value, type, updated_at) VALUES
  ('plugin_system.version', '1', 'string', strftime('%s', 'now') * 1000),
  ('plugin_system.enabled', 'true', 'boolean', strftime('%s', 'now') * 1000),
  ('plugin_system.migrations_applied', '["001_plugin_system"]', 'json', strftime('%s', 'now') * 1000);
