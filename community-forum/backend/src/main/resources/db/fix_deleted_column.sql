-- 修复数据库表缺失的 deleted 字段
-- 执行时间: 2025-12-17

USE community_forum;

-- 1. 给 categories 表添加 deleted 字段
ALTER TABLE `categories`
ADD COLUMN `deleted` TINYINT DEFAULT 0 COMMENT '是否删除' AFTER `updated_at`;

-- 2. 给 tags 表添加 deleted 字段
ALTER TABLE `tags`
ADD COLUMN `deleted` TINYINT DEFAULT 0 COMMENT '是否删除' AFTER `updated_at`;

-- 3. 验证修改
SHOW COLUMNS FROM `categories` LIKE 'deleted';
SHOW COLUMNS FROM `tags` LIKE 'deleted';

-- 4. 显示结果
SELECT 'Categories table updated successfully' AS message;
SELECT 'Tags table updated successfully' AS message;
