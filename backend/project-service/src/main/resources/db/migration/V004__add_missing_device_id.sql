-- ChainlessChain 修复缺失的device_id字段
-- 版本: V004
-- 描述: 为project_files表添加缺失的device_id字段（V003遗漏）

-- ===========================================
-- 为 project_files 表添加 device_id 字段
-- ===========================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='project_files' AND column_name='device_id') THEN
        ALTER TABLE project_files ADD COLUMN device_id VARCHAR(100);
        COMMENT ON COLUMN project_files.device_id IS '设备ID（用于多设备同步）';
    END IF;
END $$;

-- ===========================================
-- 添加索引以提高查询性能
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_project_files_device_id ON project_files(device_id);
