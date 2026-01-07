/**
 * 测试数据库初始化脚本
 *
 * 创建notes、folders、projects等表并插入测试数据
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// 数据库路径
const dbPath = path.join(
  process.env.HOME,
  'Library/Application Support/chainlesschain-desktop-vue/data/chainlesschain.db'
);

console.log('📦 初始化测试数据库');
console.log('数据库路径:', dbPath);

// 确保目录存在
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log('✅ 创建数据库目录:', dbDir);
}

// 连接数据库
const db = new Database(dbPath);
console.log('✅ 连接数据库成功');

// 创建表
console.log('\n📋 创建数据库表...');

// 1. 创建folders表
db.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
  )
`);
console.log('✅ folders表创建成功');

// 2. 创建notes表
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT,
    folder_id TEXT,
    tags TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
  )
`);
console.log('✅ notes表创建成功');

// 3. 创建全文搜索表
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    id UNINDEXED,
    title,
    content,
    tags
  )
`);
console.log('✅ notes_fts全文搜索表创建成功');

// 4. 创建projects表（带local_path列）
// 检查表是否存在
const tableExists = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table' AND name='projects'
`).get();

if (!tableExists) {
  db.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default-user',
      name TEXT NOT NULL,
      description TEXT,
      local_path TEXT,
      git_url TEXT,
      project_type TEXT DEFAULT 'code',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_commit_hash TEXT,
      last_commit_message TEXT
    )
  `);
  console.log('✅ projects表创建成功');
} else {
  console.log('⚠️  projects表已存在，检查列...');

  // 尝试添加缺失的列
  const columnsToAdd = [
    'local_path TEXT',
    'git_url TEXT',
    'last_commit_hash TEXT',
    'last_commit_message TEXT'
  ];

  columnsToAdd.forEach(column => {
    try {
      db.exec(`ALTER TABLE projects ADD COLUMN ${column}`);
      console.log(`  ✅ 添加列: ${column.split(' ')[0]}`);
    } catch (alterError) {
      // 列可能已存在，忽略错误
      console.log(`  - 列已存在: ${column.split(' ')[0]}`);
    }
  });
  console.log('✅ projects表更新完成');
}

// 5. 创建settings表
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER NOT NULL
  )
`);
console.log('✅ settings表创建成功');

// 插入测试数据
console.log('\n📝 插入测试数据...');

const now = Date.now();

// 插入文件夹
const folders = [
  { id: uuidv4(), name: '工作笔记', parent_id: null },
  { id: uuidv4(), name: '学习资料', parent_id: null },
  { id: uuidv4(), name: 'P2P通讯', parent_id: null }
];

const insertFolder = db.prepare(`
  INSERT INTO folders (id, name, parent_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?)
`);

folders.forEach(folder => {
  insertFolder.run(folder.id, folder.name, folder.parent_id, now, now);
});
console.log(`✅ 插入 ${folders.length} 个文件夹`);

// 插入笔记
const notes = [
  {
    id: uuidv4(),
    title: 'P2P通讯架构设计',
    content: `# P2P通讯架构设计

## 核心组件
1. WebSocket信令服务器
2. MobileBridge桥接层
3. 消息路由系统
4. Handler处理器

## 技术栈
- WebRTC (移动端)
- libp2p (PC端)
- Signal Protocol (加密)`,
    folder_id: folders[2].id,
    tags: JSON.stringify(['P2P', 'WebRTC', 'libp2p'])
  },
  {
    id: uuidv4(),
    title: '移动端数据同步实现',
    content: `# 移动端数据同步

## 已实现功能
- 知识库同步
- 项目文件同步
- PC状态监控

## 测试结果
平均延迟: 4ms
成功率: 100%`,
    folder_id: folders[2].id,
    tags: JSON.stringify(['移动端', '数据同步', '测试'])
  },
  {
    id: uuidv4(),
    title: 'JavaScript学习笔记',
    content: `# JavaScript核心概念

## 闭包
闭包是指函数可以访问其词法作用域外的变量。

## 异步编程
- Promise
- async/await
- 事件循环`,
    folder_id: folders[1].id,
    tags: JSON.stringify(['JavaScript', '学习', '前端'])
  },
  {
    id: uuidv4(),
    title: '每日工作总结',
    content: `# 2026-01-07 工作总结

## 完成事项
1. ✅ 完成P2P通讯集成
2. ✅ 修复所有Handler错误
3. ✅ 测试验证成功

## 明天计划
- 移动端UI开发
- 设备配对界面`,
    folder_id: folders[0].id,
    tags: JSON.stringify(['工作', '总结', '计划'])
  },
  {
    id: uuidv4(),
    title: 'Vue3响应式原理',
    content: `# Vue3响应式系统

## Proxy vs Object.defineProperty
Vue3使用Proxy实现响应式，性能更好。

## Composition API
- ref
- reactive
- computed
- watch`,
    folder_id: folders[1].id,
    tags: JSON.stringify(['Vue3', '学习', '响应式'])
  },
  // ========== Markdown渲染测试笔记 ==========
  {
    id: uuidv4(),
    title: 'Markdown语法完整测试',
    content: `# Markdown语法测试

这是一篇用于测试移动端Markdown渲染的笔记。

## 文本样式测试

这是**粗体文本**，这是*斜体文本*，这是***粗斜体***。

这是~~删除线文本~~。

这是\`行内代码\`示例。

## 标题测试

### 三级标题
这是三级标题下的内容。

## 列表测试

**有序列表**：
1. 第一项
2. 第二项
3. 第三项

**无序列表**：
- 项目A
- 项目B
- 项目C

**嵌套列表**：
1. 主要任务
   - 子任务1
   - 子任务2
2. 次要任务
   - 子任务A

## 引用块测试

> 这是一段引用文字。
> 可以有多行。
>
> 引用块很适合展示重要信息。

## 链接测试

这是一个[ChainlessChain项目主页](https://www.chainlesschain.com)的链接。

这是[GitHub仓库](https://github.com/chainlesschain/chainlesschain)的链接。

## 图片测试

![示例图片](https://via.placeholder.com/150)

## 代码块测试

JavaScript代码示例：

\`\`\`javascript
function greet(name) {
  console.log(\`Hello, \${name}!\`)
  return true
}

const result = greet('World')
\`\`\`

Python代码示例：

\`\`\`python
def calculate_sum(a, b):
    """计算两个数的和"""
    return a + b

result = calculate_sum(10, 20)
print(f"结果: {result}")
\`\`\`

## 分割线测试

上面的内容

---

下面的内容

## 表格测试

| 功能模块 | 状态 | 进度 |
|---------|------|------|
| 设备配对 | ✅ 完成 | 100% |
| 知识库同步 | ✅ 完成 | 100% |
| PC监控 | ✅ 完成 | 100% |

## 混合格式测试

你可以在**粗体中使用\`代码\`**，或者在*斜体中添加[链接](https://example.com)*。

> **重要提示**：这是一个包含*多种*格式的引用块，还有\`代码\`。

---

测试完成！✨`,
    folder_id: folders[1].id,
    tags: JSON.stringify(['Markdown', '测试', '渲染'])
  },
  {
    id: uuidv4(),
    title: '代码示例集合',
    content: `# 编程语言代码示例

## JavaScript ES6+

\`\`\`javascript
// 箭头函数
const sum = (a, b) => a + b

// Promise异步处理
async function fetchData() {
  try {
    const response = await fetch('/api/data')
    const data = await response.json()
    return data
  } catch (error) {
    console.error('Error:', error)
  }
}

// 解构赋值
const { name, age } = user
const [first, ...rest] = array
\`\`\`

## Python数据处理

\`\`\`python
import pandas as pd
import numpy as np

# 数据分析
def analyze_data(df):
    """分析DataFrame数据"""
    return {
        'mean': df.mean(),
        'std': df.std(),
        'count': len(df)
    }

# 列表推导式
squares = [x**2 for x in range(10)]
\`\`\`

## Shell脚本

\`\`\`bash
#!/bin/bash

# 批量处理文件
for file in *.txt; do
    echo "Processing $file"
    cat "$file" | grep "pattern" > "output_$file"
done

# 条件判断
if [ -f "config.json" ]; then
    echo "配置文件存在"
fi
\`\`\`

## SQL查询

\`\`\`sql
-- 复杂查询示例
SELECT
    u.name,
    COUNT(n.id) as note_count,
    MAX(n.updated_at) as last_update
FROM users u
LEFT JOIN notes n ON u.id = n.user_id
WHERE u.active = 1
GROUP BY u.id
HAVING note_count > 10
ORDER BY last_update DESC
LIMIT 20;
\`\`\`

## JSON配置

\`\`\`json
{
  "name": "chainlesschain",
  "version": "0.16.0",
  "features": {
    "p2p": true,
    "knowledge": true,
    "mobile": true
  },
  "config": {
    "timeout": 30000,
    "retries": 3
  }
}
\`\`\`

---

**提示**：以上代码示例覆盖了常用编程语言的语法高亮测试。`,
    folder_id: folders[1].id,
    tags: JSON.stringify(['代码', '编程', '示例'])
  },
  {
    id: uuidv4(),
    title: 'API文档示例',
    content: `# Knowledge API 文档

## 概述

Knowledge API提供了完整的笔记管理功能。

### 基础信息

- **Base URL**: \`http://localhost:9090/api\`
- **认证方式**: Bearer Token
- **响应格式**: JSON

---

## 端点列表

### 1. 获取笔记列表

**请求**：
\`\`\`
GET /notes?limit=20&offset=0
\`\`\`

**响应**：
\`\`\`json
{
  "total": 50,
  "notes": [
    {
      "id": "note-123",
      "title": "示例笔记",
      "content": "笔记内容",
      "created_at": 1704614400000
    }
  ]
}
\`\`\`

### 2. 创建笔记

**请求**：
\`\`\`
POST /notes
Content-Type: application/json

{
  "title": "新笔记",
  "content": "笔记内容",
  "tags": ["标签1", "标签2"]
}
\`\`\`

**响应**：
\`\`\`json
{
  "id": "note-456",
  "message": "创建成功"
}
\`\`\`

### 3. 搜索笔记

**请求**：
\`\`\`
GET /notes/search?q=关键词&limit=20
\`\`\`

**参数**：
- \`q\`: 搜索关键词（必填）
- \`limit\`: 返回数量限制（可选，默认20）
- \`offset\`: 偏移量（可选，默认0）

---

## 错误处理

所有错误响应遵循以下格式：

\`\`\`json
{
  "error": "错误类型",
  "message": "错误描述",
  "code": 400
}
\`\`\`

### 常见错误码

| 错误码 | 说明 |
|-------|------|
| 400 | 请求参数错误 |
| 401 | 未授权 |
| 404 | 资源不存在 |
| 500 | 服务器错误 |

---

## 使用示例

**JavaScript**：
\`\`\`javascript
// 获取笔记列表
const response = await fetch('/api/notes?limit=10', {
  headers: {
    'Authorization': 'Bearer your-token'
  }
})
const data = await response.json()
\`\`\`

**Python**：
\`\`\`python
import requests

# 创建笔记
response = requests.post(
    'http://localhost:9090/api/notes',
    json={'title': '测试', 'content': '内容'},
    headers={'Authorization': 'Bearer your-token'}
)
\`\`\`

---

> **注意**：所有API请求都需要有效的认证token。`,
    folder_id: folders[0].id,
    tags: JSON.stringify(['API', '文档', '开发'])
  },
  {
    id: uuidv4(),
    title: '项目技术栈清单',
    content: `# ChainlessChain 技术栈

这是项目使用的完整技术栈清单。

## 前端技术

### 桌面端 (Electron)
- **框架**: Electron 39.2.6 + Vue 3.4
- **UI库**: Ant Design Vue 4.1
- **状态管理**: Pinia 2.1.7
- **编辑器**: Milkdown 7.17.3 (Markdown)
- **工具**:
  - Vite 5.x (构建工具)
  - TypeScript 5.x

### 移动端 (uni-app)
- **框架**: uni-app
- **P2P**: WebRTC
- **组件**: mp-html (HTML渲染)

## 后端技术

### Java服务
\`\`\`
Spring Boot: 3.1.11
Java: 17
MyBatis Plus: 3.5.9+
PostgreSQL: 16
Redis: 7
\`\`\`

### Python服务
\`\`\`
FastAPI
Ollama (LLM)
Qdrant (向量数据库)
\`\`\`

## P2P网络

- **PC端**: libp2p 3.1.2
- **移动端**: WebRTC
- **加密**: Signal Protocol
- **信令**: WebSocket

## 数据存储

| 类型 | 技术 |
|-----|------|
| 本地数据库 | SQLite + SQLCipher |
| 向量数据库 | ChromaDB 3.1.8 |
| 关系数据库 | PostgreSQL 16 |
| 缓存 | Redis 7 |

## 安全技术

1. **硬件加密**: U-Key/SIMKey
2. **数据加密**: AES-256 (SQLCipher)
3. **通讯加密**: Signal Protocol (E2E)
4. **身份**: W3C DID标准

## AI集成

### 本地模型
- Ollama
- Qwen2:7b

### 云端API（14+提供商）
- 阿里云: 通义千问
- 智谱AI: GLM-4
- 百度: 文心一言
- 火山引擎: 豆包
- *更多...*

## 开发工具

\`\`\`bash
# 包管理
npm, yarn

# 版本控制
Git (isomorphic-git)

# 测试
Vitest, Jest

# 代码规范
ESLint, Prettier
\`\`\`

---

**版本**: v0.16.0
**更新日期**: 2026-01-07

> 💡 **提示**：所有技术选型都经过生产环境验证。`,
    folder_id: folders[0].id,
    tags: JSON.stringify(['技术栈', '架构', '文档'])
  },
  {
    id: uuidv4(),
    title: '复杂格式混合测试',
    content: `# 🎨 复杂Markdown格式测试

## 📋 任务清单

完成以下开发任务：

1. **移动端开发** ✅
   - [x] 设备配对页面
   - [x] PC状态监控
   - [x] 知识库同步
   - [ ] 项目文件同步UI

2. **测试验证** ⏰
   - [x] 后端P2P测试
   - [ ] 移动端E2E测试
   - [ ] 真机测试

---

## 💻 代码与说明混排

在\`p2p-manager.js\`中实现了**请求-响应模式**：

\`\`\`javascript
// 发送请求并等待响应
async sendRequest(peerId, type, params) {
  return new Promise((resolve, reject) => {
    const requestId = \`req_\${Date.now()}\`

    // 保存回调
    this.pendingRequests.set(requestId, {
      resolve, reject, type
    })

    // 发送消息
    this.p2pManager.sendMessage(peerId, {
      type, requestId, params
    })

    // 30秒超时
    setTimeout(() => {
      if (this.pendingRequests.has(requestId)) {
        this.pendingRequests.delete(requestId)
        reject(new Error('超时'))
      }
    }, 30000)
  })
}
\`\`\`

> ⚠️ **重要**：请求ID必须唯一，建议使用\`时间戳 + 随机数\`生成。

这样可以确保：
- ✅ 支持并发请求
- ✅ 自动超时处理
- ✅ 错误处理完善

---

## 📊 性能测试数据

根据\`P2P_DATA_SYNC_TEST_REPORT.md\`的测试结果：

| 功能 | 平均延迟 | 成功率 | 评价 |
|-----|---------|--------|------|
| 笔记列表 | **4ms** | 100% ✅ | 优秀 ⭐⭐⭐⭐⭐ |
| 全文搜索 | **4ms** | 100% ✅ | 优秀 ⭐⭐⭐⭐⭐ |
| 系统信息 | **3ms** | 100% ✅ | 优秀 ⭐⭐⭐⭐⭐ |
| 实时监控 | **13ms** | 100% ✅ | 良好 ⭐⭐⭐⭐ |

**结论**：
> 延迟极低，用户体验优秀！所有功能测试通过率**100%**。🎉

---

## 🔗 嵌套格式测试

**外层粗体包含：**
- *斜体列表项1*
- 包含\`代码\`的列表项2
- 包含[链接](https://example.com)的列表项3

*外层斜体包含：*
1. **粗体有序项1**
2. 包含\`代码\`的有序项2
3. ~~删除线~~有序项3

---

## 📸 图片与说明

下面是系统架构图：

![架构图](https://via.placeholder.com/300x200?text=System+Architecture)

**图示说明**：
- 移动端通过WebRTC连接
- PC端使用libp2p协议
- 信令服务器负责NAT穿透

---

## 🎯 特殊字符测试

支持的特殊字符：

- Emoji: 😀 🎉 ⚡ 🚀 💡 ⭐ ✅ ❌ ⚠️
- 符号: © ® ™ § ¶ † ‡ • ◦ ‣
- 数学: ± × ÷ ≠ ≈ ≤ ≥ ∞
- 箭头: → ← ↑ ↓ ⇒ ⇐ ⇔

---

## 📝 总结

这篇笔记包含了：

\`\`\`
✅ 标题 (H1-H3)
✅ 文本样式 (粗体/斜体/删除线)
✅ 代码 (行内/代码块)
✅ 列表 (有序/无序/嵌套)
✅ 引用块
✅ 链接和图片
✅ 表格
✅ Emoji和特殊字符
✅ 混合嵌套格式
\`\`\`

> 🎊 **完美**：所有Markdown语法都已覆盖！`,
    folder_id: folders[1].id,
    tags: JSON.stringify(['Markdown', '测试', '完整'])
  }
];

const insertNote = db.prepare(`
  INSERT INTO notes (id, title, content, folder_id, tags, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertNoteFts = db.prepare(`
  INSERT INTO notes_fts (id, title, content, tags)
  VALUES (?, ?, ?, ?)
`);

notes.forEach(note => {
  insertNote.run(
    note.id,
    note.title,
    note.content,
    note.folder_id,
    note.tags,
    now,
    now
  );

  insertNoteFts.run(
    note.id,
    note.title,
    note.content,
    note.tags
  );
});
console.log(`✅ 插入 ${notes.length} 条笔记`);

// 插入项目
const projects = [
  {
    id: uuidv4(),
    name: 'ChainlessChain',
    description: '去中心化个人AI管理系统',
    local_path: '/Users/mac/Documents/code2/chainlesschain',
    git_url: 'https://github.com/user/chainlesschain.git',
    project_type: 'code',
    last_commit_hash: 'abc123',
    last_commit_message: 'feat: 完成移动端P2P通讯'
  },
  {
    id: uuidv4(),
    name: 'Test Project',
    description: '测试项目',
    local_path: '/Users/mac/test-project',
    git_url: null,
    project_type: 'code',
    last_commit_hash: null,
    last_commit_message: null
  }
];

const insertProject = db.prepare(`
  INSERT INTO projects (
    id, user_id, name, description, local_path, git_url, project_type,
    created_at, updated_at, last_commit_hash, last_commit_message
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

projects.forEach(project => {
  insertProject.run(
    project.id,
    'default-user',
    project.name,
    project.description,
    project.local_path,
    project.git_url,
    project.project_type,
    now,
    now,
    project.last_commit_hash,
    project.last_commit_message
  );
});
console.log(`✅ 插入 ${projects.length} 个项目`);

// 插入设置
const insertSetting = db.prepare(`
  INSERT OR REPLACE INTO settings (key, value, updated_at)
  VALUES (?, ?, ?)
`);

insertSetting.run('llm.provider', 'volcengine', now);
console.log('✅ 插入LLM配置');

// 验证数据
console.log('\n✅ 验证数据...');
const noteCount = db.prepare('SELECT COUNT(*) as count FROM notes').get();
const folderCount = db.prepare('SELECT COUNT(*) as count FROM folders').get();
const projectCount = db.prepare('SELECT COUNT(*) as count FROM projects').get();

console.log(`  - 笔记: ${noteCount.count} 条`);
console.log(`  - 文件夹: ${folderCount.count} 个`);
console.log(`  - 项目: ${projectCount.count} 个`);

db.close();
console.log('\n🎉 测试数据库初始化完成！');
