-- ================================================
-- Phase 2: 文件共享与版本控制系统 (v0.18.0)
-- 创建日期: 2025-12-31
-- ================================================

-- ==================== 文件版本历史表 ====================

CREATE TABLE IF NOT EXISTS file_versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  checksum TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  change_description TEXT,
  UNIQUE(file_id, version_number)
);

-- 索引：文件ID查询
CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON file_versions(file_id);

-- 索引：创建时间排序
CREATE INDEX IF NOT EXISTS idx_file_versions_created_at ON file_versions(created_at DESC);

-- ==================== 文件权限表 ====================

CREATE TABLE IF NOT EXISTS file_permissions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  member_did TEXT,
  role TEXT,
  permission TEXT NOT NULL CHECK(permission IN ('view', 'edit', 'manage')),
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL
);

-- 索引：文件权限查询
CREATE INDEX IF NOT EXISTS idx_file_permissions_file ON file_permissions(file_id);

-- 索引：成员权限查询
CREATE INDEX IF NOT EXISTS idx_file_permissions_member ON file_permissions(member_did);

-- 索引：复合索引（文件+成员）
CREATE INDEX IF NOT EXISTS idx_file_permissions_file_member ON file_permissions(file_id, member_did);

-- ==================== 文件共享配置表 ====================

CREATE TABLE IF NOT EXISTS file_shares (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  share_type TEXT NOT NULL CHECK(share_type IN ('workspace', 'user', 'role', 'public')),
  target_id TEXT,
  permission TEXT NOT NULL CHECK(permission IN ('view', 'edit')),
  expires_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(file_id, share_type, target_id)
);

-- 索引：文件共享查询
CREATE INDEX IF NOT EXISTS idx_file_shares_file ON file_shares(file_id);

-- 索引：目标查询
CREATE INDEX IF NOT EXISTS idx_file_shares_target ON file_shares(target_id);

-- ==================== 文件锁定记录表 ====================

CREATE TABLE IF NOT EXISTS file_locks (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL UNIQUE,
  locked_by TEXT NOT NULL,
  locked_at INTEGER NOT NULL,
  expires_at INTEGER,
  lock_type TEXT DEFAULT 'exclusive' CHECK(lock_type IN ('exclusive', 'shared'))
);

-- 索引：文件锁定查询
CREATE INDEX IF NOT EXISTS idx_file_locks_file ON file_locks(file_id);

-- 索引：锁定者查询
CREATE INDEX IF NOT EXISTS idx_file_locks_user ON file_locks(locked_by);

-- ==================== 文件访问日志表 ====================

CREATE TABLE IF NOT EXISTS file_access_logs (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  user_did TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('view', 'download', 'edit', 'delete', 'share', 'lock', 'unlock')),
  ip_address TEXT,
  user_agent TEXT,
  accessed_at INTEGER NOT NULL
);

-- 索引：文件访问查询
CREATE INDEX IF NOT EXISTS idx_file_access_file ON file_access_logs(file_id, accessed_at DESC);

-- 索引：用户访问查询
CREATE INDEX IF NOT EXISTS idx_file_access_user ON file_access_logs(user_did, accessed_at DESC);

-- ==================== 文件标签表 ====================

CREATE TABLE IF NOT EXISTS file_tags (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(file_id, tag)
);

-- 索引：文件标签查询
CREATE INDEX IF NOT EXISTS idx_file_tags_file ON file_tags(file_id);

-- 索引：标签查询
CREATE INDEX IF NOT EXISTS idx_file_tags_tag ON file_tags(tag);

-- ==================== 完成标记 ====================
-- 所有表创建完成
