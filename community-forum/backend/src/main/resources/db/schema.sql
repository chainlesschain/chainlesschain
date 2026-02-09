-- ChainlessChain Community Forum Database Schema

CREATE DATABASE IF NOT EXISTS community_forum DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE community_forum;

-- 用户表
CREATE TABLE `users` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '用户ID',
  `did` VARCHAR(200) UNIQUE NOT NULL COMMENT 'DID身份标识',
  `device_id` VARCHAR(100) COMMENT '设备ID(U盾/SIMKey)',
  `device_type` ENUM('UKEY', 'SIMKEY') COMMENT '设备类型',
  `username` VARCHAR(50) UNIQUE NOT NULL COMMENT '用户名',
  `nickname` VARCHAR(100) COMMENT '昵称',
  `avatar` VARCHAR(500) COMMENT '头像URL',
  `email` VARCHAR(100) COMMENT '邮箱',
  `bio` TEXT COMMENT '个人简介',
  `role` ENUM('USER', 'MODERATOR', 'ADMIN') DEFAULT 'USER' COMMENT '角色',
  `status` ENUM('NORMAL', 'BANNED', 'DELETED') DEFAULT 'NORMAL' COMMENT '状态',
  `points` INT DEFAULT 100 COMMENT '积分',
  `reputation` INT DEFAULT 0 COMMENT '声望',
  `posts_count` INT DEFAULT 0 COMMENT '帖子数',
  `replies_count` INT DEFAULT 0 COMMENT '回复数',
  `followers_count` INT DEFAULT 0 COMMENT '粉丝数',
  `following_count` INT DEFAULT 0 COMMENT '关注数',
  `last_login_at` DATETIME COMMENT '最后登录时间',
  `last_login_ip` VARCHAR(50) COMMENT '最后登录IP',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT DEFAULT 0 COMMENT '是否删除',
  INDEX idx_did (`did`),
  INDEX idx_device_id (`device_id`),
  INDEX idx_username (`username`),
  INDEX idx_points (`points`),
  INDEX idx_reputation (`reputation`),
  INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- 分类表
CREATE TABLE `categories` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '分类ID',
  `name` VARCHAR(50) NOT NULL COMMENT '分类名称',
  `slug` VARCHAR(50) UNIQUE NOT NULL COMMENT '分类标识',
  `description` TEXT COMMENT '分类描述',
  `icon` VARCHAR(100) COMMENT '图标',
  `color` VARCHAR(20) COMMENT '颜色',
  `sort_order` INT DEFAULT 0 COMMENT '排序',
  `posts_count` INT DEFAULT 0 COMMENT '帖子数',
  `status` ENUM('ACTIVE', 'HIDDEN') DEFAULT 'ACTIVE' COMMENT '状态',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT DEFAULT 0 COMMENT '是否删除',
  INDEX idx_slug (`slug`),
  INDEX idx_sort_order (`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='分类表';

-- 标签表
CREATE TABLE `tags` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '标签ID',
  `name` VARCHAR(50) UNIQUE NOT NULL COMMENT '标签名称',
  `slug` VARCHAR(50) UNIQUE NOT NULL COMMENT '标签标识',
  `description` TEXT COMMENT '标签描述',
  `posts_count` INT DEFAULT 0 COMMENT '帖子数',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT DEFAULT 0 COMMENT '是否删除',
  INDEX idx_slug (`slug`),
  INDEX idx_posts_count (`posts_count`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='标签表';

-- 帖子表
CREATE TABLE `posts` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '帖子ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `category_id` BIGINT NOT NULL COMMENT '分类ID',
  `title` VARCHAR(200) NOT NULL COMMENT '标题',
  `content` LONGTEXT NOT NULL COMMENT '内容(Markdown)',
  `content_html` LONGTEXT COMMENT '内容(HTML)',
  `type` ENUM('QUESTION', 'DISCUSSION', 'FEEDBACK', 'ANNOUNCEMENT') DEFAULT 'DISCUSSION' COMMENT '类型',
  `status` ENUM('DRAFT', 'PUBLISHED', 'CLOSED', 'DELETED') DEFAULT 'PUBLISHED' COMMENT '状态',
  `is_pinned` TINYINT DEFAULT 0 COMMENT '是否置顶',
  `is_featured` TINYINT DEFAULT 0 COMMENT '是否精华',
  `is_closed` TINYINT DEFAULT 0 COMMENT '是否关闭',
  `views_count` INT DEFAULT 0 COMMENT '浏览数',
  `replies_count` INT DEFAULT 0 COMMENT '回复数',
  `likes_count` INT DEFAULT 0 COMMENT '点赞数',
  `favorites_count` INT DEFAULT 0 COMMENT '收藏数',
  `shares_count` INT DEFAULT 0 COMMENT '分享数',
  `best_reply_id` BIGINT COMMENT '最佳回复ID',
  `last_reply_user_id` BIGINT COMMENT '最后回复用户ID',
  `last_reply_at` DATETIME COMMENT '最后回复时间',
  `published_at` DATETIME COMMENT '发布时间',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT DEFAULT 0 COMMENT '是否删除',
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE,
  INDEX idx_user_id (`user_id`),
  INDEX idx_category_id (`category_id`),
  INDEX idx_type (`type`),
  INDEX idx_status (`status`),
  INDEX idx_is_pinned (`is_pinned`),
  INDEX idx_is_featured (`is_featured`),
  INDEX idx_views_count (`views_count`),
  INDEX idx_replies_count (`replies_count`),
  INDEX idx_last_reply_at (`last_reply_at`),
  INDEX idx_created_at (`created_at`),
  FULLTEXT INDEX ft_title_content (`title`, `content`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='帖子表';

-- 帖子标签关联表
CREATE TABLE `post_tags` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT 'ID',
  `post_id` BIGINT NOT NULL COMMENT '帖子ID',
  `tag_id` BIGINT NOT NULL COMMENT '标签ID',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE CASCADE,
  UNIQUE KEY uk_post_tag (`post_id`, `tag_id`),
  INDEX idx_post_id (`post_id`),
  INDEX idx_tag_id (`tag_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='帖子标签关联表';

-- 回复表
CREATE TABLE `replies` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '回复ID',
  `post_id` BIGINT NOT NULL COMMENT '帖子ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `parent_id` BIGINT COMMENT '父回复ID',
  `reply_to_user_id` BIGINT COMMENT '回复给用户ID',
  `content` TEXT NOT NULL COMMENT '内容(Markdown)',
  `content_html` TEXT COMMENT '内容(HTML)',
  `is_best_answer` TINYINT DEFAULT 0 COMMENT '是否最佳答案',
  `is_author` TINYINT DEFAULT 0 COMMENT '是否作者',
  `likes_count` INT DEFAULT 0 COMMENT '点赞数',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT DEFAULT 0 COMMENT '是否删除',
  FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`parent_id`) REFERENCES `replies`(`id`) ON DELETE CASCADE,
  INDEX idx_post_id (`post_id`),
  INDEX idx_user_id (`user_id`),
  INDEX idx_parent_id (`parent_id`),
  INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='回复表';

-- 点赞表
CREATE TABLE `likes` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '点赞ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `target_type` ENUM('POST', 'REPLY') NOT NULL COMMENT '目标类型',
  `target_id` BIGINT NOT NULL COMMENT '目标ID',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  UNIQUE KEY uk_user_target (`user_id`, `target_type`, `target_id`),
  INDEX idx_target (`target_type`, `target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='点赞表';

-- 收藏表
CREATE TABLE `favorites` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '收藏ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `post_id` BIGINT NOT NULL COMMENT '帖子ID',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON DELETE CASCADE,
  UNIQUE KEY uk_user_post (`user_id`, `post_id`),
  INDEX idx_user_id (`user_id`),
  INDEX idx_post_id (`post_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收藏表';

-- 关注表
CREATE TABLE `follows` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '关注ID',
  `follower_id` BIGINT NOT NULL COMMENT '关注者ID',
  `following_id` BIGINT NOT NULL COMMENT '被关注者ID',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  FOREIGN KEY (`follower_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`following_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  UNIQUE KEY uk_follower_following (`follower_id`, `following_id`),
  INDEX idx_follower_id (`follower_id`),
  INDEX idx_following_id (`following_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='关注表';

-- 通知表
CREATE TABLE `notifications` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '通知ID',
  `user_id` BIGINT NOT NULL COMMENT '用户ID',
  `sender_id` BIGINT COMMENT '发送者ID',
  `type` ENUM('REPLY', 'LIKE', 'FAVORITE', 'FOLLOW', 'MENTION', 'SYSTEM') NOT NULL COMMENT '通知类型',
  `title` VARCHAR(200) COMMENT '标题',
  `content` TEXT COMMENT '内容',
  `link` VARCHAR(500) COMMENT '链接',
  `is_read` TINYINT DEFAULT 0 COMMENT '是否已读',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX idx_user_id (`user_id`),
  INDEX idx_is_read (`is_read`),
  INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='通知表';

-- 私信表
CREATE TABLE `messages` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '消息ID',
  `sender_id` BIGINT NOT NULL COMMENT '发送者ID',
  `receiver_id` BIGINT NOT NULL COMMENT '接收者ID',
  `content` TEXT NOT NULL COMMENT '内容',
  `is_read` TINYINT DEFAULT 0 COMMENT '是否已读',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `deleted` TINYINT DEFAULT 0 COMMENT '是否删除',
  FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX idx_sender_id (`sender_id`),
  INDEX idx_receiver_id (`receiver_id`),
  INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='私信表';

-- 报告表
CREATE TABLE `reports` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '报告ID',
  `user_id` BIGINT NOT NULL COMMENT '举报用户ID',
  `target_type` ENUM('POST', 'REPLY', 'USER') NOT NULL COMMENT '目标类型',
  `target_id` BIGINT NOT NULL COMMENT '目标ID',
  `reason` ENUM('SPAM', 'ABUSE', 'INAPPROPRIATE', 'COPYRIGHT', 'OTHER') NOT NULL COMMENT '举报原因',
  `description` TEXT COMMENT '详细描述',
  `status` ENUM('PENDING', 'PROCESSING', 'RESOLVED', 'REJECTED') DEFAULT 'PENDING' COMMENT '状态',
  `handler_id` BIGINT COMMENT '处理人ID',
  `result` TEXT COMMENT '处理结果',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  INDEX idx_status (`status`),
  INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='举报表';

-- 操作日志表
CREATE TABLE `operation_logs` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '日志ID',
  `user_id` BIGINT COMMENT '用户ID',
  `action` VARCHAR(100) NOT NULL COMMENT '操作',
  `target_type` VARCHAR(50) COMMENT '目标类型',
  `target_id` BIGINT COMMENT '目标ID',
  `ip_address` VARCHAR(50) COMMENT 'IP地址',
  `user_agent` VARCHAR(500) COMMENT 'User Agent',
  `details` TEXT COMMENT '详情',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX idx_user_id (`user_id`),
  INDEX idx_action (`action`),
  INDEX idx_created_at (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作日志表';

-- 插入初始数据

-- 插入分类
INSERT INTO `categories` (`name`, `slug`, `description`, `icon`, `color`, `sort_order`) VALUES
('问答', 'qa', '提问和回答技术问题', 'el-icon-question', '#409EFF', 1),
('讨论', 'discussion', '技术讨论和经验分享', 'el-icon-chat-dot-round', '#67C23A', 2),
('反馈', 'feedback', 'Bug反馈和功能建议', 'el-icon-message-box', '#E6A23C', 3),
('公告', 'announcement', '官方公告和更新通知', 'el-icon-bell', '#F56C6C', 4);

-- 插入标签
INSERT INTO `tags` (`name`, `slug`, `description`) VALUES
('U盾', 'ukey', 'U盾相关问题'),
('SIMKey', 'simkey', 'SIMKey相关问题'),
('安装', 'installation', '安装部署相关'),
('使用教程', 'tutorial', '使用教程'),
('Bug', 'bug', 'Bug反馈'),
('功能请求', 'feature-request', '功能请求'),
('知识库', 'knowledge-base', '知识库管理'),
('AI', 'ai', 'AI功能'),
('同步', 'sync', 'Git同步'),
('社交', 'social', '去中心化社交');

-- 插入管理员账号 (需要实际的DID和设备ID)
INSERT INTO `users` (`did`, `username`, `nickname`, `avatar`, `email`, `bio`, `role`, `points`, `reputation`) VALUES
('did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH', 'admin', '管理员', '/avatars/admin.png', 'admin@chainlesschain.com', 'ChainlessChain社区管理员', 'ADMIN', 10000, 1000);

-- 插入示例帖子
INSERT INTO `posts` (`user_id`, `category_id`, `title`, `content`, `type`, `status`, `is_pinned`, `published_at`) VALUES
(1, 4, '欢迎来到ChainlessChain社区！', '# 欢迎\n\n欢迎来到ChainlessChain社区！这里是U盾和SIMKey用户交流的平台。\n\n## 社区规则\n\n1. 尊重他人\n2. 理性讨论\n3. 不发广告\n\n让我们一起构建一个友好的技术社区！', 'ANNOUNCEMENT', 'PUBLISHED', 1, NOW());

-- 更新分类帖子数
UPDATE `categories` SET `posts_count` = 1 WHERE `id` = 4;

-- 设备公钥表（用于生产模式U盾/SIMKey验证）
CREATE TABLE `device_keys` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  `device_id` VARCHAR(200) UNIQUE NOT NULL COMMENT '设备ID',
  `device_type` ENUM('UKEY', 'SIMKEY') NOT NULL COMMENT '设备类型',
  `public_key` TEXT NOT NULL COMMENT '公钥(Base64编码)',
  `status` ENUM('active', 'revoked', 'expired') DEFAULT 'active' COMMENT '设备状态',
  `user_id` BIGINT COMMENT '关联用户ID',
  `alias` VARCHAR(100) COMMENT '设备别名',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT DEFAULT 0 COMMENT '是否删除',
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
  INDEX idx_device_id (`device_id`),
  INDEX idx_user_id (`user_id`),
  INDEX idx_status (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='设备公钥表';
