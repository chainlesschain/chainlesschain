-- 清理Flyway失败的迁移记录
-- 这个脚本用于修复V008迁移失败的问题

-- 删除失败的迁移记录
DELETE FROM flyway_schema_history WHERE version = '008' AND success = false;

-- 查看当前迁移状态
SELECT version, description, type, script, checksum, installed_on, execution_time, success
FROM flyway_schema_history
ORDER BY installed_rank;
