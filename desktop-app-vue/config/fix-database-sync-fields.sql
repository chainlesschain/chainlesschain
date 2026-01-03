-- 手动添加同步字段到现有数据库
-- 运行此脚本修复 "no such column: sync_status" 错误

-- 为 project_files 表添加同步字段
ALTER TABLE project_files ADD COLUMN sync_status TEXT DEFAULT 'pending';
ALTER TABLE project_files ADD COLUMN synced_at INTEGER;
-- deleted 列可能已经存在，如果报错可以忽略

-- 为 knowledge_items 表添加同步字段
ALTER TABLE knowledge_items ADD COLUMN sync_status TEXT DEFAULT 'pending';
ALTER TABLE knowledge_items ADD COLUMN synced_at INTEGER;
ALTER TABLE knowledge_items ADD COLUMN deleted INTEGER DEFAULT 0;

-- 验证列是否添加成功
-- PRAGMA table_info(project_files);
-- PRAGMA table_info(knowledge_items);
