-- ==================== Phase 1: 工作区与任务管理系统 (v0.17.0) ====================
-- 迁移版本: v17
-- 创建日期: 2025-12-31
-- 功能: 企业协作 - 工作区与任务管理

-- ==================== 工作区表 ====================

-- 工作区表
CREATE TABLE IF NOT EXISTS organization_workspaces (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT CHECK(type IN ('default', 'development', 'testing', 'production')) DEFAULT 'default',
  color TEXT,
  icon TEXT,
  is_default INTEGER DEFAULT 0,
  visibility TEXT DEFAULT 'members' CHECK(visibility IN ('members', 'admins', 'specific_roles')),
  allowed_roles TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived INTEGER DEFAULT 0,
  UNIQUE(org_id, name)
);

-- 工作区成员表
CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  member_did TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin', 'member', 'viewer')) DEFAULT 'member',
  joined_at INTEGER NOT NULL,
  UNIQUE(workspace_id, member_did)
);

-- 工作区资源表
CREATE TABLE IF NOT EXISTS workspace_resources (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('knowledge', 'project', 'conversation')),
  resource_id TEXT NOT NULL,
  added_by TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  UNIQUE(workspace_id, resource_type, resource_id)
);

-- ==================== 任务相关表 ====================

-- 任务评论表
CREATE TABLE IF NOT EXISTS task_comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  author_did TEXT NOT NULL,
  content TEXT NOT NULL,
  mentions TEXT,
  attachments TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_deleted INTEGER DEFAULT 0
);

-- 任务变更历史表
CREATE TABLE IF NOT EXISTS task_changes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  change_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at INTEGER NOT NULL
);

-- 任务看板配置表
CREATE TABLE IF NOT EXISTS task_boards (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  workspace_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  columns TEXT NOT NULL,
  filters TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(org_id, name)
);

-- ==================== 索引 ====================

-- 工作区索引
CREATE INDEX IF NOT EXISTS idx_workspaces_org ON organization_workspaces(org_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_archived ON organization_workspaces(org_id, archived);
CREATE INDEX IF NOT EXISTS idx_workspace_members ON workspace_members(workspace_id, member_did);
CREATE INDEX IF NOT EXISTS idx_workspace_resources ON workspace_resources(workspace_id, resource_type);

-- 任务索引
CREATE INDEX IF NOT EXISTS idx_task_comments ON task_comments(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_comments_author ON task_comments(author_did);
CREATE INDEX IF NOT EXISTS idx_task_changes ON task_changes(task_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_boards_org ON task_boards(org_id, workspace_id);

-- ==================== 默认数据 ====================

-- 为现有组织创建默认工作区（如果需要的话，在应用层实现）
