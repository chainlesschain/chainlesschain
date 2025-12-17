-- 重新导入测试数据
-- 确保 deleted 字段正确设置

USE community_forum;

-- 1. 清空现有数据（保持表结构）
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE post_tags;
TRUNCATE TABLE posts;
TRUNCATE TABLE categories;
TRUNCATE TABLE tags;
TRUNCATE TABLE users;
SET FOREIGN_KEY_CHECKS = 1;

-- 2. 插入用户数据
INSERT INTO `users` (`id`, `did`, `device_id`, `device_type`, `username`, `nickname`, `avatar`, `email`, `bio`, `role`, `status`, `points`, `reputation`, `posts_count`, `replies_count`)
VALUES
(1, 'did:chainlesschain:UKEY-ADMIN-001', 'UKEY-ADMIN-001', 'UKEY', 'admin', '管理员', 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin', 'admin@chainlesschain.com', '系统管理员', 'ADMIN', 'NORMAL', 1000, 100, 0, 0),
(2, 'did:example:user001', 'UKEY-USER-001', 'UKEY', 'alice', 'Alice', 'https://api.dicebear.com/7.x/avataaars/svg?seed=alice', 'alice@example.com', 'AI爱好者', 'USER', 'NORMAL', 500, 50, 0, 0),
(3, 'did:example:user002', 'SIMKEY-USER-002', 'SIMKEY', 'bob', 'Bob', 'https://api.dicebear.com/7.x/avataaars/svg?seed=bob', 'bob@example.com', '区块链开发者', 'USER', 'NORMAL', 300, 30, 0, 0),
(4, 'did:example:user003', 'UKEY-USER-003', 'UKEY', 'carol', 'Carol', 'https://api.dicebear.com/7.x/avataaars/svg?seed=carol', 'carol@example.com', '去中心化倡导者', 'USER', 'NORMAL', 200, 20, 0, 0);

-- 3. 插入分类（确保 deleted=0）
INSERT INTO `categories` (`id`, `name`, `slug`, `description`, `icon`, `color`, `sort_order`, `posts_count`, `status`, `deleted`)
VALUES
(1, '问答', 'qa', '技术问题、使用疑问等', 'QuestionFilled', '#409eff', 1, 1, 'ACTIVE', 0),
(2, '讨论', 'discussion', '技术讨论、经验分享', 'ChatDotRound', '#67c23a', 2, 2, 'ACTIVE', 0),
(3, '反馈', 'feedback', '产品反馈、建议改进', 'MessageBox', '#e6a23c', 3, 1, 'ACTIVE', 0),
(4, '公告', 'announcement', '官方公告、重要通知', 'BellFilled', '#f56c6c', 4, 1, 'ACTIVE', 0),
(5, '教程', 'tutorial', '使用教程、开发指南', 'Document', '#909399', 5, 1, 'ACTIVE', 0);

-- 4. 插入标签（确保 deleted=0）
INSERT INTO `tags` (`id`, `name`, `slug`, `description`, `posts_count`, `deleted`)
VALUES
(1, 'AI', 'ai', '人工智能相关', 1, 0),
(2, '区块链', 'blockchain', '区块链技术', 1, 0),
(3, 'DID', 'did', '去中心化身份', 2, 0),
(4, '硬件安全', 'hardware-security', 'U盾/SIMKey安全', 2, 0),
(5, 'Web3', 'web3', 'Web3.0技术', 2, 0),
(6, '开发', 'development', '开发相关', 2, 0),
(7, '新手', 'beginner', '新手问题', 1, 0),
(8, '教程', 'tutorial', '教程指南', 2, 0);

-- 5. 插入帖子
INSERT INTO `posts` (`id`, `user_id`, `category_id`, `title`, `content`, `type`, `status`, `is_pinned`, `views_count`, `replies_count`, `likes_count`, `favorites_count`, `published_at`)
VALUES
(1, 1, 4, '欢迎来到ChainlessChain社区！',
'# 欢迎！

感谢您加入ChainlessChain社区！这是一个专注于去中心化AI和区块链技术的交流平台。

## 社区特色

- 🔐 **硬件认证**：基于U盾/SIMKey的安全身份认证
- 🆔 **DID身份**：完全去中心化的数字身份系统
- 💬 **技术交流**：与全球开发者分享经验
- 📚 **知识共享**：丰富的教程和文档资源

## 使用指南

1. 使用U盾或SIMKey登录
2. 完善个人资料
3. 开始发帖和交流

祝您使用愉快！',
'ANNOUNCEMENT', 'PUBLISHED', 1, 100, 0, 10, 5, NOW()),

(2, 2, 1, '如何使用U盾进行身份认证？',
'我是新手，想了解一下如何使用U盾进行身份认证。有没有详细的教程？

具体需要准备什么？安全性如何保证？',
'QUESTION', 'PUBLISHED', 0, 50, 0, 5, 2, NOW()),

(3, 3, 2, 'ChainlessChain的DID系统架构分析',
'# DID系统架构

本文深入分析ChainlessChain的去中心化身份(DID)系统架构。

## 核心组件

1. **身份注册**
2. **凭证管理**
3. **验证机制**

## 技术优势

- 完全去中心化
- 硬件级安全
- 隐私保护

欢迎大家讨论！',
'DISCUSSION', 'PUBLISHED', 0, 80, 0, 8, 4, NOW()),

(4, 4, 3, '建议：增加多语言支持',
'希望社区能够支持多语言界面，方便国际用户使用。

建议支持的语言：
- 英语
- 日语
- 韩语
- 西班牙语

这样可以吸引更多国际开发者。',
'FEEDBACK', 'PUBLISHED', 0, 30, 0, 3, 1, NOW()),

(5, 2, 5, 'U盾开发入门教程',
'# U盾开发入门

本教程介绍如何使用U盾进行应用开发。

## 环境准备

```bash
npm install @chainlesschain/ukey-sdk
```

## 快速开始

```javascript
import { UKey } from "@chainlesschain/ukey-sdk"

const ukey = new UKey()
await ukey.connect()
```

## 常见问题

详见文档...',
'DISCUSSION', 'PUBLISHED', 0, 120, 0, 15, 8, NOW());

-- 6. 插入帖子标签关联
INSERT INTO `post_tags` (`post_id`, `tag_id`)
VALUES
(1, 3), (1, 5),
(2, 4), (2, 7),
(3, 2), (3, 3), (3, 5),
(4, 6),
(5, 4), (5, 6), (5, 8);

-- 7. 验证数据
SELECT '=== Categories ===' AS '';
SELECT id, name, slug, deleted FROM categories;

SELECT '=== Tags ===' AS '';
SELECT id, name, slug, deleted FROM tags;

SELECT '=== Posts ===' AS '';
SELECT id, title, category_id FROM posts;

SELECT '=== Post Tags ===' AS '';
SELECT pt.post_id, t.name
FROM post_tags pt
JOIN tags t ON pt.tag_id = t.id;

SELECT 'Data imported successfully!' AS message;
