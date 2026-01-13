-- Permission Audit Log Table
-- Tracks all permission checks, grants, and denials for compliance and security auditing

CREATE TABLE IF NOT EXISTS permission_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  user_did TEXT NOT NULL,
  permission TEXT NOT NULL,
  action TEXT NOT NULL, -- 'check', 'grant', 'revoke', 'role_check', 'ownership_check', 'rate_limit'
  result TEXT NOT NULL, -- 'granted', 'denied', 'exceeded'
  resource_type TEXT, -- 'folder', 'knowledge', 'project', etc.
  resource_id TEXT,
  context TEXT, -- JSON string with additional context
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,

  INDEX idx_audit_org (org_id),
  INDEX idx_audit_user (user_did),
  INDEX idx_audit_permission (permission),
  INDEX idx_audit_action (action),
  INDEX idx_audit_result (result),
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_org_user (org_id, user_did),
  INDEX idx_audit_org_created (org_id, created_at)
);

-- Permission Templates Table
-- Stores reusable permission templates for quick assignment

CREATE TABLE IF NOT EXISTS permission_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  template_type TEXT NOT NULL, -- 'role', 'resource', 'custom'
  permissions TEXT NOT NULL, -- JSON array of permissions
  description TEXT,
  is_system BOOLEAN DEFAULT 0, -- System templates cannot be deleted
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(org_id, template_name),
  INDEX idx_template_org (org_id),
  INDEX idx_template_type (template_type)
);

-- Permission Overrides Table
-- Allows specific permission overrides for individual users on specific resources

CREATE TABLE IF NOT EXISTS permission_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  user_did TEXT NOT NULL,
  resource_type TEXT NOT NULL, -- 'folder', 'knowledge', 'project'
  resource_id TEXT NOT NULL,
  permission TEXT NOT NULL, -- Specific permission being overridden
  granted BOOLEAN NOT NULL, -- true = explicitly granted, false = explicitly denied
  reason TEXT,
  granted_by TEXT,
  expires_at INTEGER, -- NULL = never expires
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(org_id, user_did, resource_type, resource_id, permission),
  INDEX idx_override_org (org_id),
  INDEX idx_override_user (user_did),
  INDEX idx_override_resource (resource_type, resource_id),
  INDEX idx_override_org_user (org_id, user_did)
);

-- Permission Groups Table
-- Groups of permissions that can be assigned together

CREATE TABLE IF NOT EXISTS permission_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  group_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  permissions TEXT NOT NULL, -- JSON array of permissions
  is_system BOOLEAN DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(org_id, group_name),
  INDEX idx_group_org (org_id)
);

-- Role Permission Mappings Table
-- Maps roles to permission groups for easier management

CREATE TABLE IF NOT EXISTS role_permission_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  role_name TEXT NOT NULL,
  permission_group_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,

  UNIQUE(org_id, role_name, permission_group_id),
  FOREIGN KEY (permission_group_id) REFERENCES permission_groups(id) ON DELETE CASCADE,
  INDEX idx_mapping_org_role (org_id, role_name)
);

-- Insert default permission groups
INSERT OR IGNORE INTO permission_groups (org_id, group_name, display_name, description, permissions, is_system, created_at, updated_at)
VALUES
  ('_system', 'org_management', '组织管理', '管理组织设置、成员和基本配置',
   '["org.view", "org.edit", "org.settings", "member.view", "member.add", "member.remove"]',
   1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

  ('_system', 'knowledge_full', '知识库完全访问', '创建、编辑、删除知识库内容',
   '["knowledge.view", "knowledge.create", "knowledge.edit", "knowledge.delete", "knowledge.share", "knowledge.comment"]',
   1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

  ('_system', 'knowledge_edit', '知识库编辑', '查看和编辑知识库内容',
   '["knowledge.view", "knowledge.create", "knowledge.edit", "knowledge.comment"]',
   1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

  ('_system', 'knowledge_view', '知识库只读', '仅查看知识库内容',
   '["knowledge.view"]',
   1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

  ('_system', 'project_management', '项目管理', '管理项目和任务',
   '["project.view", "project.create", "project.edit", "project.delete", "project.manage"]',
   1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

  ('_system', 'project_contributor', '项目贡献者', '参与项目和任务',
   '["project.view", "project.create", "project.edit"]',
   1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

-- Insert default permission templates
INSERT OR IGNORE INTO permission_templates (org_id, template_name, template_type, permissions, description, is_system, created_at, updated_at)
VALUES
  ('_system', 'owner_full_access', 'role',
   '["*"]',
   '组织所有者 - 完全访问权限', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

  ('_system', 'admin_standard', 'role',
   '["org.view", "org.edit", "org.settings", "member.view", "member.add", "member.remove", "member.edit", "knowledge.*", "project.*"]',
   '管理员 - 标准管理权限', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

  ('_system', 'editor_standard', 'role',
   '["org.view", "member.view", "knowledge.view", "knowledge.create", "knowledge.edit", "knowledge.comment", "project.view", "project.create", "project.edit"]',
   '编辑者 - 内容编辑权限', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

  ('_system', 'member_standard', 'role',
   '["org.view", "member.view", "knowledge.view", "knowledge.comment", "project.view"]',
   '成员 - 基本访问权限', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),

  ('_system', 'viewer_readonly', 'role',
   '["org.view", "knowledge.view", "project.view"]',
   '访客 - 只读权限', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
