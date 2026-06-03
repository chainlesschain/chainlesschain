-- ChainlessChain 技能和工具管理系统数据库Schema
-- 迁移版本: 003
-- 创建时间: 2025-12-29
-- 描述: 实现技能(Skill)和工具(Tool)两层管理架构，支持AI能力的模块化和可扩展性

-- ============================================
-- 1. 技能表 (Skills)
-- ============================================
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,                    -- 技能ID，如 'skill_code_dev'
  name TEXT NOT NULL,                     -- 技能名称，如 '代码开发'
  display_name TEXT,                      -- 显示名称（支持多语言）
  description TEXT,                       -- 简短描述
  category TEXT NOT NULL,                 -- 分类：code/data/content/web/automation/system/ai/media/network/project/template
  icon TEXT,                              -- 图标路径或名称
  enabled INTEGER DEFAULT 1,              -- 是否启用 (0=禁用, 1=启用)

  -- 来源标识
  is_builtin INTEGER DEFAULT 0,           -- 是否内置 (0=否, 1=是)
  plugin_id TEXT,                         -- 如果来自插件，记录插件ID

  -- 配置和元数据
  config TEXT,                            -- JSON配置，如默认参数、行为选项
  tags TEXT,                              -- JSON数组，如 ["AI", "编程"]
  doc_path TEXT,                          -- Markdown文档相对路径

  -- 统计字段
  usage_count INTEGER DEFAULT 0,          -- 使用次数
  success_count INTEGER DEFAULT 0,        -- 成功次数
  last_used_at INTEGER,                   -- 最后使用时间戳

  -- 时间戳
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- 外键约束
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_enabled ON skills(enabled);
CREATE INDEX IF NOT EXISTS idx_skills_plugin ON skills(plugin_id);
CREATE INDEX IF NOT EXISTS idx_skills_builtin ON skills(is_builtin);

-- ============================================
-- 2. 工具表 (Tools)
-- ============================================
CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,                    -- 工具ID，如 'tool_file_reader'
  name TEXT NOT NULL UNIQUE,              -- 工具名称（FunctionCaller中的key）
  display_name TEXT,                      -- 显示名称
  description TEXT,                       -- 简短描述

  -- 工具类型和分类
  tool_type TEXT DEFAULT 'function',      -- function/api/command/script
  category TEXT,                          -- file/code/data/network/system/ai

  -- 参数schema
  parameters_schema TEXT,                 -- JSON Schema，定义参数结构
  return_schema TEXT,                     -- 返回值schema

  -- 来源和实现
  is_builtin INTEGER DEFAULT 0,           -- 是否内置
  plugin_id TEXT,                         -- 来自哪个插件
  handler_path TEXT,                      -- 处理函数路径（用于动态加载）

  -- 状态
  enabled INTEGER DEFAULT 1,              -- 是否启用
  deprecated INTEGER DEFAULT 0,           -- 是否已废弃

  -- 配置和文档
  config TEXT,                            -- JSON配置
  examples TEXT,                          -- JSON数组，使用示例
  doc_path TEXT,                          -- Markdown文档相对路径

  -- 权限和安全
  required_permissions TEXT,              -- JSON数组，如 ["file:read", "network:http"]
  risk_level INTEGER DEFAULT 1,           -- 风险等级 1-5

  -- 统计
  usage_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  avg_execution_time REAL DEFAULT 0,      -- 平均执行时间(ms)
  last_used_at INTEGER,

  -- 时间戳
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- 外键约束
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_tools_name ON tools(name);
CREATE INDEX IF NOT EXISTS idx_tools_category ON tools(category);
CREATE INDEX IF NOT EXISTS idx_tools_enabled ON tools(enabled);
CREATE INDEX IF NOT EXISTS idx_tools_plugin ON tools(plugin_id);
CREATE INDEX IF NOT EXISTS idx_tools_builtin ON tools(is_builtin);
CREATE INDEX IF NOT EXISTS idx_tools_type ON tools(tool_type);

-- ============================================
-- 3. 技能-工具关联表 (Skill-Tool Mapping)
-- ============================================
CREATE TABLE IF NOT EXISTS skill_tools (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  tool_id TEXT NOT NULL,

  -- 工具在技能中的角色
  role TEXT DEFAULT 'primary',            -- primary/secondary/optional
  priority INTEGER DEFAULT 0,             -- 优先级，数字越大越优先

  -- 工具在技能中的配置覆盖
  config_override TEXT,                   -- JSON，覆盖工具的默认配置

  created_at INTEGER NOT NULL,

  -- 约束
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE,
  UNIQUE (skill_id, tool_id)
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_skill_tools_skill ON skill_tools(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_tools_tool ON skill_tools(tool_id);
CREATE INDEX IF NOT EXISTS idx_skill_tools_role ON skill_tools(role);

-- ============================================
-- 4. 技能使用统计表 (Skill Statistics)
-- ============================================
CREATE TABLE IF NOT EXISTS skill_stats (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,

  -- 统计时间范围
  stat_date TEXT NOT NULL,                -- 日期，格式: YYYY-MM-DD

  -- 统计指标
  invoke_count INTEGER DEFAULT 0,         -- 调用次数
  success_count INTEGER DEFAULT 0,        -- 成功次数
  failure_count INTEGER DEFAULT 0,        -- 失败次数
  avg_duration REAL DEFAULT 0,            -- 平均执行时长(秒)
  total_duration REAL DEFAULT 0,          -- 总执行时长(秒)

  -- 用户反馈
  positive_feedback INTEGER DEFAULT 0,    -- 正面反馈次数
  negative_feedback INTEGER DEFAULT 0,    -- 负面反馈次数

  -- 时间戳
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- 约束
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE (skill_id, stat_date)
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_skill_stats_skill ON skill_stats(skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_stats_date ON skill_stats(stat_date);

-- ============================================
-- 5. 工具使用统计表 (Tool Statistics)
-- ============================================
CREATE TABLE IF NOT EXISTS tool_stats (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,

  -- 统计时间范围
  stat_date TEXT NOT NULL,                -- 日期，格式: YYYY-MM-DD

  -- 统计指标
  invoke_count INTEGER DEFAULT 0,         -- 调用次数
  success_count INTEGER DEFAULT 0,        -- 成功次数
  failure_count INTEGER DEFAULT 0,        -- 失败次数
  avg_duration REAL DEFAULT 0,            -- 平均执行时长(ms)
  total_duration REAL DEFAULT 0,          -- 总执行时长(ms)

  -- 错误统计
  error_types TEXT,                       -- JSON对象，记录各类错误次数 {"TypeError": 3, "NetworkError": 1}

  -- 时间戳
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  -- 约束
  FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE,
  UNIQUE (tool_id, stat_date)
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_tool_stats_tool ON tool_stats(tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_stats_date ON tool_stats(stat_date);

-- ============================================
-- 6. 技能/工具使用记录表 (Usage Logs)
-- ============================================
-- 用于详细审计和调试，可选创建
CREATE TABLE IF NOT EXISTS skill_tool_usage_logs (
  id TEXT PRIMARY KEY,
  skill_id TEXT,
  tool_id TEXT,

  -- 执行信息
  session_id TEXT,                        -- 会话ID，关联对话会话
  input_params TEXT,                      -- JSON，输入参数
  output_result TEXT,                     -- JSON，输出结果
  status TEXT,                            -- success/failure/timeout/cancelled
  error_message TEXT,                     -- 错误消息
  execution_time REAL,                    -- 执行时长(ms)

  -- 上下文信息
  project_id TEXT,                        -- 关联的项目ID
  user_input TEXT,                        -- 用户原始输入

  -- 时间戳
  created_at INTEGER NOT NULL,

  -- 约束（使用SET NULL避免级联删除日志）
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE SET NULL,
  FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE SET NULL
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_usage_logs_skill ON skill_tool_usage_logs(skill_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_tool ON skill_tool_usage_logs(tool_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_session ON skill_tool_usage_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_status ON skill_tool_usage_logs(status);
CREATE INDEX IF NOT EXISTS idx_usage_logs_date ON skill_tool_usage_logs(created_at);

-- ============================================
-- 迁移完成标记
-- ============================================
-- 插入迁移记录（如果系统有迁移管理表的话）
-- INSERT INTO schema_migrations (version, applied_at) VALUES ('003', strftime('%s', 'now'));
