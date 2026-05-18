# Git 同步功能文档

## 概述

ChainlessChain 桌面应用集成了完整的Git同步功能，可以将SQLite数据库中的知识库数据自动导出为Markdown文件，并同步到Git仓库进行版本管理和云端备份。

## 功能特性

### ✅ 核心功能

- **Markdown导出**: 自动将知识库项导出为Markdown文件
- **Git版本管理**: 完整的Git提交、推送、拉取功能
- **自动同步**: 可配置的定时自动同步
- **YAML Front Matter**: Markdown文件包含完整的元数据
- **远程仓库支持**: 支持GitHub、GitLab、Gitea等
- **多种认证方式**: 用户名/密码、Personal Access Token
- **事件通知**: 实时同步状态通知
- **提交历史**: 查看完整的Git提交记录

## 架构设计

```
┌─────────────────────────────────────────┐
│        渲染进程 (Vue 组件)              │
│  GitSettings.vue  |  GitStatus.vue     │
│         ↓                    ↓          │
│    electronAPI.git.*                   │
└───────────┬─────────────────────────────┘
            │ IPC通信
┌───────────▼─────────────────────────────┐
│          主进程 (Electron)              │
│                                         │
│  ┌────────────────────────────────┐   │
│  │      GitManager               │   │
│  │  - init                       │   │
│  │  - commit/push/pull          │   │
│  │  - autoSync                   │   │
│  └──────────┬─────────────────────┘   │
│             │                          │
│  ┌──────────▼─────────────────────┐   │
│  │  MarkdownExporter              │   │
│  │  - exportAll()                 │   │
│  │  - sync()                      │   │
│  │  - generateMarkdown()          │   │
│  └──────────┬─────────────────────┘   │
│             │                          │
│  ┌──────────▼─────────────────────┐   │
│  │  DatabaseManager               │   │
│  │  - getKnowledgeItems()         │   │
│  └────────────────────────────────┘   │
└─────────────┬───────────────────────────┘
              │
┌─────────────▼───────────────────────────┐
│      isomorphic-git (纯JS Git实现)      │
│    → 本地Git仓库 → 远程仓库             │
└─────────────────────────────────────────┘
```

## 项目结构

```
desktop-app-vue/
├── src/
│   ├── main/
│   │   ├── git/
│   │   │   ├── git-manager.js        # Git管理器
│   │   │   ├── markdown-exporter.js  # Markdown导出器
│   │   │   └── git-config.js         # 配置管理
│   │   └── index.js                  # 主进程（集成Git）
│   ├── preload/
│   │   └── index.js                  # 暴露Git API
│   └── renderer/
│       └── components/
│           ├── GitSettings.vue       # Git设置组件
│           └── GitStatus.vue         # Git状态组件
└── GIT_SYNC.md                       # 本文档
```

## 安装配置

### 1. 依赖安装

Git同步功能已集成在主依赖中：

```json
{
  "dependencies": {
    "isomorphic-git": "^1.25.4"
  }
}
```

```bash
cd desktop-app-vue
npm install
```

### 2. 初始化配置

首次使用需要配置Git同步：

1. 启动应用
2. 进入设置页面
3. 找到"Git同步设置"
4. 启用Git同步
5. 配置相关参数

## 配置说明

### 配置文件位置

- **Windows**: `%APPDATA%\chainlesschain-desktop-vue\git-config.json`
- **macOS**: `~/Library/Application Support/chainlesschain-desktop-vue/git-config.json`
- **Linux**: `~/.config/chainlesschain-desktop-vue/git-config.json`

### 配置项

```json
{
  "enabled": false,           // 是否启用Git同步
  "repoPath": null,           // 仓库路径（null=自动）
  "remoteUrl": null,          // 远程仓库URL
  "authorName": "ChainlessChain User",
  "authorEmail": "user@chainlesschain.com",
  "auth": null,               // 认证信息
  "autoSync": false,          // 自动同步
  "autoSyncInterval": 300000, // 同步间隔（毫秒）
  "syncStrategy": "auto",     // 同步策略
  "exportPath": "knowledge"   // 导出路径
}
```

### 认证配置

#### 用户名/密码

```json
{
  "auth": {
    "username": "your-username",
    "password": "your-password"
  }
}
```

#### Personal Access Token（推荐）

```json
{
  "auth": {
    "token": "ghp_xxxxxxxxxxxxxxxxxxxx"
  }
}
```

## API 文档

### 主进程 API

#### GitManager

```javascript
const GitManager = require('./git/git-manager');

const manager = new GitManager({
  repoPath: '/path/to/repo',
  remoteUrl: 'https://github.com/user/repo.git',
  authorName: 'Your Name',
  authorEmail: 'you@example.com',
  auth: { token: 'ghp_xxx' }
});

// 初始化
await manager.initialize();

// 获取状态
const status = await manager.getStatus();
// { branch, ahead, behind, modified, untracked, deleted, lastSync }

// 提交
const sha = await manager.commit('Update knowledge base');

// 推送
await manager.push();

// 拉取
await manager.pull();

// 自动同步
const result = await manager.autoSync('Auto sync');
// { synced, sha, filesCount }

// 获取日志
const log = await manager.getLog(10);
```

#### MarkdownExporter

```javascript
const MarkdownExporter = require('./git/markdown-exporter');

const exporter = new MarkdownExporter(database, exportPath);

// 导出所有
const files = await exporter.exportAll();

// 导出单个
await exporter.exportById(itemId);

// 同步
const result = await exporter.sync();
// { exported, deleted }
```

### IPC API

#### 渲染进程调用

```javascript
// 获取状态
const status = await window.electronAPI.git.status();

// 同步
const result = await window.electronAPI.git.sync();

// 推送
await window.electronAPI.git.push();

// 拉取
await window.electronAPI.git.pull();

// 获取日志
const commits = await window.electronAPI.git.getLog(20);

// 获取配置
const config = await window.electronAPI.git.getConfig();

// 设置配置
await window.electronAPI.git.setConfig({
  enabled: true,
  remoteUrl: 'https://github.com/user/repo.git'
});

// 设置远程仓库
await window.electronAPI.git.setRemote('https://github.com/user/repo.git');

// 设置认证
await window.electronAPI.git.setAuth({
  token: 'ghp_xxx'
});

// 导出Markdown
const files = await window.electronAPI.git.exportMarkdown();
```

#### 事件监听

```javascript
// 监听提交事件
window.electronAPI.git.on('git:committed', (data) => {
  console.log('提交完成:', data.sha);
});

// 监听推送事件
window.electronAPI.git.on('git:pushed', () => {
  console.log('推送完成');
});

// 监听拉取事件
window.electronAPI.git.on('git:pulled', () => {
  console.log('拉取完成');
});

// 监听自动同步
window.electronAPI.git.on('git:auto-synced', (data) => {
  console.log('自动同步:', data.filesCount, '个文件');
});

// 监听进度
window.electronAPI.git.on('git:push-progress', (progress) => {
  console.log('推送进度:', progress);
});
```

## Markdown 导出格式

### 文件命名

```
{id}-{title}.md
```

例如：`abc123-我的笔记.md`

### 文件内容

```markdown
---
id: abc123
title: 我的笔记
type: note
tags: [学习, JavaScript]
created_at: 2024-01-15T10:30:00.000Z
updated_at: 2024-01-15T14:20:00.000Z
source_url: https://example.com
---

# 我的笔记

这是笔记的正文内容...

---

## 元数据

- **类型**: note
- **创建时间**: 2024-01-15T10:30:00.000Z
- **更新时间**: 2024-01-15T14:20:00.000Z
- **标签**: 学习, JavaScript
- **来源**: [https://example.com](https://example.com)
```

### YAML Front Matter

每个Markdown文件都包含YAML元数据：

- `id`: 唯一标识符
- `title`: 标题
- `type`: 类型（note/link/code等）
- `tags`: 标签列表
- `created_at`: 创建时间
- `updated_at`: 更新时间
- `source_url`: 来源URL（可选）

## 使用指南

### 基础使用

#### 1. 启用Git同步

1. 打开设置页面
2. 找到"Git同步设置"
3. 打开"启用Git同步"开关
4. 填写基本信息：
   - 作者名称
   - 作者邮箱
5. 保存设置

#### 2. 配置远程仓库

1. 在GitHub/GitLab创建一个新仓库
2. 复制仓库URL
3. 在设置中填写"远程仓库"
4. 配置认证信息
5. 测试连接

#### 3. 手动同步

1. 打开Git状态面板
2. 查看未提交的更改
3. 点击"同步到Git"按钮
4. 等待同步完成

#### 4. 启用自动同步

1. 在设置中打开"自动同步"
2. 设置同步间隔（分钟）
3. 保存设置
4. 应用将定时自动同步

### 高级使用

#### 创建GitHub仓库

```bash
# 1. 在GitHub上创建仓库
# https://github.com/new

# 2. 生成Personal Access Token
# https://github.com/settings/tokens
# 权限：repo (所有)

# 3. 在应用中配置
# 远程仓库: https://github.com/username/repo.git
# 认证方式: Personal Access Token
# Token: ghp_xxxxxxxxxxxxxxxxxxxx
```

#### 配置多个远程仓库

```javascript
// 通过主进程API
await gitManager.setRemote('https://github.com/user/repo.git', 'github');
await gitManager.setRemote('https://gitlab.com/user/repo.git', 'gitlab');
```

#### 查看提交历史

```javascript
const commits = await window.electronAPI.git.getLog(50);

commits.forEach(commit => {
  console.log(`${commit.sha.substring(0, 7)} - ${commit.message}`);
  console.log(`作者: ${commit.author.name} <${commit.author.email}>`);
  console.log(`时间: ${commit.timestamp}`);
});
```

#### 解决冲突

如果拉取时出现冲突：

1. 备份本地更改
2. 手动解决冲突的文件
3. 重新提交
4. 推送到远程

## 故障排除

### 问题 1: 认证失败

**错误**:
```
push failed: authentication required
```

**解决**:
1. 检查认证信息是否正确
2. 如果使用Token，确认权限足够
3. Token是否过期
4. URL是否正确（HTTPS vs SSH）

### 问题 2: 推送被拒绝

**错误**:
```
push rejected: non-fast-forward
```

**解决**:
```javascript
// 先拉取远程更新
await window.electronAPI.git.pull();

// 再推送
await window.electronAPI.git.push();
```

### 问题 3: 仓库未初始化

**错误**:
```
Git同步未启用
```

**解决**:
1. 检查配置中 `enabled` 是否为 `true`
2. 重启应用
3. 查看主进程日志

### 问题 4: 导出失败

**错误**:
```
Markdown导出器未初始化
```

**解决**:
1. 确保数据库已初始化
2. 检查导出路径是否可写
3. 查看错误日志

### 问题 5: 自动同步不工作

**解决**:
1. 检查配置中 `autoSync` 是否为 `true`
2. 检查 `autoSyncInterval` 是否合理
3. 查看主进程日志
4. 重启应用

## 最佳实践

### 1. 仓库组织

建议的仓库结构：

```
my-knowledge-base/
├── knowledge/          # Markdown文件目录
│   ├── abc123-note1.md
│   ├── def456-note2.md
│   └── ...
├── .gitignore
└── README.md
```

### 2. 提交消息规范

- 手动同步：描述性消息
- 自动同步：`Auto sync from ChainlessChain`
- 导出更新：`Update {count} knowledge items`

### 3. 同步频率

- **开发/测试**: 1-5分钟
- **日常使用**: 5-15分钟
- **低频使用**: 30-60分钟

### 4. 认证安全

- ✅ 使用Personal Access Token
- ❌ 避免在代码中硬编码密码
- ✅ 定期更新Token
- ✅ 使用最小权限原则

### 5. 备份策略

- 启用自动同步
- 定期检查远程仓库
- 保留多个远程备份
- 定期手动备份数据库

## 性能优化

### 1. 减少导出文件数量

```javascript
// 只导出最近更新的项
const recentItems = items.filter(item => {
  const updated = new Date(item.updated_at);
  const now = new Date();
  return (now - updated) < 7 * 24 * 60 * 60 * 1000; // 7天内
});
```

### 2. 批量操作

```javascript
// 批量添加文件
const files = ['file1.md', 'file2.md', 'file3.md'];
await gitManager.add(files);
```

### 3. 压缩仓库

```javascript
// 定期压缩Git仓库
// 通过命令行工具
git gc --aggressive
```

## 常见问题（FAQ）

### Q: 支持哪些Git服务？

A: 支持所有标准的Git服务：
- GitHub
- GitLab
- Gitea
- Gogs
- Bitbucket
- 自建Git服务器

### Q: 可以使用SSH认证吗？

A: 当前版本仅支持HTTPS认证（用户名/密码或Token）。SSH支持计划在未来版本中添加。

### Q: 数据会被覆盖吗？

A: 不会。Git同步使用版本控制，所有历史记录都被保留。如果需要恢复，可以通过Git历史回滚。

### Q: 自动同步会影响性能吗？

A: 影响很小。同步在后台进行，不会阻塞UI。可以根据需要调整同步间隔。

### Q: 可以选择性导出吗？

A: 当前版本导出所有知识库项。选择性导出功能计划在未来版本中添加。

## 安全建议

### 1. Token管理

- 使用只读Token进行只读操作
- 定期轮换Token
- 不要在公共场合分享Token
- Token过期后及时更新

### 2. 私有仓库

- 使用私有仓库存储个人知识
- 不要在公开仓库存储敏感信息
- 定期审查仓库权限

### 3. 敏感信息

- 导出前检查敏感信息
- 使用.gitignore排除敏感文件
- 考虑使用U盾加密敏感笔记

### 4. 网络安全

- 使用HTTPS连接
- 避免在不安全网络同步
- 启用双因素认证（2FA）

## 更新日志

### v1.0.0 (2024-12-02)

**新功能**:
- ✅ Git仓库管理
- ✅ Markdown导出
- ✅ 自动同步
- ✅ 远程仓库支持
- ✅ 多种认证方式
- ✅ 事件通知
- ✅ UI组件

**已知限制**:
- 仅支持HTTPS认证
- 不支持SSH
- 不支持选择性导出

## 许可证

MIT License

---

**最后更新**: 2024-12-02
**版本**: 1.0.0
**状态**: ✅ 已完成
