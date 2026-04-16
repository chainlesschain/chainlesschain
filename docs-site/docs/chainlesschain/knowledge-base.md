# 知识库管理

> **核心功能 | 状态: ✅ 生产就绪 | RAG 混合搜索 | Markdown/PDF/Evernote 导入 | 静态站点导出**

ChainlessChain的知识库管理功能帮助您构建个人第二大脑，统一管理笔记、文档、网页剪藏和对话历史。

## 核心特性

- 📝 **Markdown 笔记**: 支持富文本编辑、标签分类、全文搜索
- 🔍 **RAG 混合搜索**: BM25 关键词 + 向量语义的双路检索
- 📥 **多格式导入**: Markdown / PDF / Evernote ENEX / Notion 一键导入
- 📤 **知识导出**: 静态 HTML 站点 / Markdown 批量导出
- 🌐 **网页剪藏**: 浏览器扩展一键保存网页内容
- 🤖 **AI 增强**: RAG 问答、自动摘要、智能标签推荐
- 🔐 **加密存储**: SQLCipher AES-256 全库加密
- 📊 **版本控制**: 笔记历史版本、diff 对比、一键回滚

## 系统架构

```
用户操作 (桌面端/CLI)
        │
        ▼
┌───────────────────────────────────────────┐
│              知识库管理层                    │
│  ┌─────────┐ ┌──────────┐ ┌────────────┐ │
│  │ 笔记 CRUD│ │ 导入/导出 │ │ 网页剪藏   │ │
│  └────┬────┘ └────┬─────┘ └─────┬──────┘ │
│       └───────────┼─────────────┘         │
│                   ▼                       │
│  ┌────────────────────────────────────┐   │
│  │          搜索引擎                    │   │
│  │  BM25 关键词  │  Qdrant 向量语义    │   │
│  └────────────────────────────────────┘   │
│                   │                       │
│                   ▼                       │
│  ┌────────────────────────────────────┐   │
│  │   SQLite + SQLCipher (AES-256)      │   │
│  │   notes / tags / embeddings 表      │   │
│  └────────────────────────────────────┘   │
└───────────────────────────────────────────┘
```

## 核心模块

| 模块 | 说明 | 关键文件 |
|------|------|---------|
| 笔记管理 | CRUD、标签、分类、软删除 | `database.js` |
| RAG 搜索 | BM25 + 向量混合检索 | `rag/` |
| 知识导入 | Markdown/PDF/ENEX/Notion | `cli/src/lib/knowledge-importer.js` |
| 知识导出 | Markdown 批量 / 静态站点 | `cli/src/lib/knowledge-exporter.js` |
| 版本控制 | 笔记历史、diff、回滚 | `cli/src/lib/note-versioning.js` |
| 网页剪藏 | 浏览器扩展剪藏 | `browser/` |

## 核心概念

### 什么是知识库？

知识库是您所有知识资产的集合，包括：

- 📝 **笔记**: Markdown格式的个人笔记
- 📄 **文档**: PDF、Word、Excel等文档
- 🔖 **网页剪藏**: 保存的网页内容
- 💬 **对话历史**: 与AI的对话记录
- 📊 **数据表**: 结构化数据
- 🖼️ **多媒体**: 图片、视频、音频

### 知识库的特点

✅ **完全本地化**: 所有数据存储在本地，不上传云端
✅ **加密存储**: 敏感数据AES-256加密
✅ **版本控制**: Git管理，完整历史记录
✅ **全文搜索**: MeiliSearch提供毫秒级搜索
✅ **AI增强**: 智能摘要、问答、关联推荐
✅ **跨设备同步**: Git同步到多台设备

---

## 创建和管理笔记

### 创建新笔记

#### 方式一: 快捷键

```
Ctrl/Cmd + N - 创建新笔记
```

#### 方式二: 菜单

```
文件 → 新建笔记
```

#### 方式三: 命令面板

```
Ctrl/Cmd + P → 输入 "新建笔记"
```

### Markdown编辑器

ChainlessChain使用所见即所得的Markdown编辑器，支持：

#### 基础语法

```markdown
# 一级标题
## 二级标题
### 三级标题

**粗体** *斜体* ~~删除线~~

- 无序列表
- 项目2

1. 有序列表
2. 项目2

[链接](https://www.chainlesschain.com)

![图片](image.jpg)
```

#### 代码块

````markdown
```javascript
function hello() {
  console.log('Hello, World!')
}
```
````

支持100+种语言语法高亮：
- JavaScript, TypeScript, Python, Java, C++, Rust...
- JSON, YAML, TOML, XML...
- Bash, PowerShell, SQL...

#### 数学公式

```markdown
行内公式: $E = mc^2$

块级公式:
$$
\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}
$$
```

使用KaTeX渲染，支持LaTeX语法。

#### 表格

```markdown
| 列1 | 列2 | 列3 |
|-----|-----|-----|
| A   | B   | C   |
| D   | E   | F   |
```

#### 任务列表

```markdown
- [ ] 待完成任务
- [x] 已完成任务
- [ ] 另一个任务
```

#### 引用

```markdown
> 这是一段引用
> 可以多行
```

#### 分隔线

```markdown
---
```

#### 脚注

```markdown
这是一段文字[^1]

[^1]: 这是脚注内容
```

### 富文本功能

#### 插入图片

```markdown
# 方式一: Markdown语法
![描述](./images/photo.jpg)

# 方式二: 拖拽
直接拖拽图片到编辑器

# 方式三: 粘贴
Ctrl/Cmd + V 粘贴剪贴板图片
```

图片自动压缩和优化。

#### 插入附件

```markdown
[下载文件](./attachments/document.pdf)
```

支持的文件类型：
- 文档: PDF, DOCX, XLSX, PPTX
- 压缩包: ZIP, RAR, 7Z
- 代码: 所有文本文件

#### 插入链接

```markdown
# 内部链接
[[另一个笔记的标题]]

# 外部链接
[Google](https://google.com)

# 带标题的链接
[Google](https://google.com "搜索引擎")
```

#### 嵌入网页

```markdown
<iframe src="https://www.chainlesschain.com" width="100%" height="400"></iframe>
```

### 标签和分类

#### 添加标签

```markdown
#技术 #编程 #JavaScript
```

或在笔记元数据中:

```yaml
---
tags: [技术, 编程, JavaScript]
category: 学习笔记
date: 2024-12-02
---
```

#### 标签管理

- 侧边栏显示所有标签
- 点击标签查看相关笔记
- 支持标签嵌套: `#技术/编程/JavaScript`
- 标签自动补全

### 笔记模板

#### 创建模板

```
设置 → 模板 → 新建模板
```

示例模板:

```markdown
---
title: {{title}}
date: {{date}}
tags: []
---

# {{title}}

## 概述

## 详细内容

## 参考资料

---
Created: {{date}}
Updated: {{updated}}
```

#### 使用模板

```
新建笔记 → 选择模板
```

内置模板:
- 📝 日记模板
- 📚 读书笔记
- 💡 想法记录
- 📋 会议记录
- 🎯 项目规划

---

## 搜索和查找

### 全文搜索

#### 基础搜索

```
Ctrl/Cmd + F - 搜索当前笔记
Ctrl/Cmd + Shift + F - 全局搜索
```

搜索框支持:
- 关键词搜索
- 多关键词 AND: `keyword1 keyword2`
- OR搜索: `keyword1 OR keyword2`
- 排除: `keyword1 -keyword2`
- 短语搜索: `"exact phrase"`

#### 高级搜索

**按标签搜索**:
```
tag:技术 tag:编程
```

**按日期搜索**:
```
created:2024-12-01
modified:>2024-12-01
```

**按文件类型**:
```
type:markdown
type:pdf
```

**组合搜索**:
```
编程 tag:技术 created:>2024-11-01
```

### 语义搜索

启用AI语义搜索后，可以用自然语言搜索：

```
"如何使用Git同步笔记"
"关于机器学习的笔记"
"上周的会议记录"
```

AI会理解语义，返回最相关的结果。

### 搜索结果

- 高亮显示匹配词
- 显示上下文
- 按相关度排序
- 支持预览
- 支持批量操作

---

## AI增强功能

### 智能摘要

#### 自动摘要

```
右键 → AI功能 → 生成摘要
```

AI会自动提取文档的核心内容，生成3-5句摘要。

#### 定制摘要长度

```
简短摘要（1-2句）
标准摘要（3-5句）
详细摘要（1段）
```

### 智能问答

#### 基于知识库问答

```
Ctrl/Cmd + K - 打开AI助手
```

示例问题:
```
Q: 总结一下我关于机器学习的所有笔记
A: 根据您的笔记，您主要学习了...

Q: 我上周写了什么？
A: 上周您创建了5篇笔记，主要内容包括...

Q: 帮我找出所有TODO事项
A: 找到以下未完成任务：
   1. 完成项目文档
   2. 学习Rust编程
   ...
```

#### 引用来源

AI回答会标注来源笔记:

```
根据《机器学习笔记.md》，神经网络是...
参考《深度学习基础.md》第3章...
```

点击可跳转到原笔记。

### AI辅助写作

#### 续写

```
选中文本 → AI功能 → 续写
```

AI会根据上下文继续写作。

#### 改写

```
选中文本 → AI功能 → 改写
```

可选择：
- 更正式
- 更口语
- 更简洁
- 更详细

#### 翻译

```
选中文本 → AI功能 → 翻译
```

支持中英日韩等多语言互译。

#### 生成大纲

```
AI功能 → 生成大纲
```

输入主题，AI生成文章大纲。

### 智能推荐

#### 相关笔记推荐

打开笔记时，右侧显示相关笔记：

```
📄 相关笔记
- JavaScript高级编程 (相似度: 85%)
- Vue 3实战指南 (相似度: 72%)
- TypeScript入门 (相似度: 68%)
```

#### 智能标签推荐

创建笔记时，AI推荐标签：

```
建议标签: #编程 #JavaScript #前端
```

### 知识图谱

#### 可视化关联

```
视图 → 知识图谱
```

显示笔记之间的关联关系:
- 节点: 笔记
- 边: 链接、标签、主题关联
- 颜色: 标签分类
- 大小: 笔记重要程度

#### 图谱导航

- 点击节点打开笔记
- 拖拽调整布局
- 缩放查看细节
- 过滤显示特定类别

---

## 导入和导出

### 导入

#### 导入Markdown

```
文件 → 导入 → Markdown文件

支持格式:
- 单个.md文件
- 文件夹（保留目录结构）
- .zip压缩包
```

#### 导入其他格式

**PDF**:
```
文件 → 导入 → PDF

自动OCR文字识别
保留原始PDF附件
```

**Word文档**:
```
文件 → 导入 → Word文档

转换为Markdown
保留图片和格式
```

**网页**:
```
浏览器插件 → 剪藏到ChainlessChain

保存完整网页
提取正文
去除广告
```

**Notion**:
```
文件 → 导入 → Notion导出

1. 在Notion中: Settings → Export all workspace content
2. 选择Markdown & CSV格式
3. 在ChainlessChain中选择导出的zip文件
```

**Evernote**:
```
文件 → 导入 → Evernote

支持.enex格式
自动转换为Markdown
保留标签和笔记本
```

### 导出

#### 导出单个笔记

```
文件 → 导出当前笔记

格式选项:
- Markdown (.md)
- PDF (.pdf)
- HTML (.html)
- Word (.docx)
```

#### 批量导出

```
文件 → 导出 → 批量导出

选择:
- 全部笔记
- 选定标签
- 选定文件夹
- 日期范围

格式:
- Markdown压缩包
- PDF合集
- HTML网站
```

#### 导出为网站

```
文件 → 导出 → 静态网站

生成静态HTML网站:
- 响应式设计
- 搜索功能
- 标签导航
- 主题切换
```

可部署到:
- GitHub Pages
- Netlify
- Vercel

---

## 网页剪藏

### 浏览器插件

#### 安装插件

支持浏览器:
- Chrome/Edge
- Firefox
- Safari

下载地址: https://www.chainlesschain.comextensions

#### 使用插件

**完整网页**:
```
点击插件图标 → 保存整页
```

**选择区域**:
```
选中内容 → 右键 → 剪藏到ChainlessChain
```

**快捷键**:
```
Ctrl/Cmd + Shift + S - 快速剪藏
```

#### 剪藏选项

- ✂️ **智能提取**: 只保存正文
- 📸 **完整网页**: 保存全部内容
- 📝 **仅文本**: 纯文本无格式
- 🔖 **书签**: 只保存链接
- 📷 **截图**: 保存网页截图

### 网页管理

所有剪藏的网页保存在:
```
知识库 → 网页剪藏
```

支持:
- 全文搜索
- 标签分类
- 离线阅读
- 高亮笔记
- 导出PDF

---

## 数据组织

### 文件夹结构

推荐的目录结构:

```
知识库/
├── 01-收件箱/          # 临时笔记
├── 02-项目/            # 项目相关
│   ├── 项目A/
│   └── 项目B/
├── 03-领域/            # 按领域分类
│   ├── 技术/
│   ├── 读书/
│   └── 生活/
├── 04-归档/            # 已完成项目
└── 05-模板/            # 笔记模板
```

### 命名规范

推荐命名方式:

```
# 日期+标题
2024-12-02 机器学习入门.md

# 编号+标题
001 项目计划.md
002 需求分析.md

# 分类+标题
[技术] JavaScript高级编程.md
[读书] 代码整洁之道.md
```

### 标签体系

建议的标签层级:

```
#领域/技术/编程/JavaScript
#领域/技术/编程/Python
#领域/技术/设计/UI
#项目/项目A/需求
#项目/项目A/开发
#状态/TODO
#状态/进行中
#状态/已完成
```

---

## 协作和分享

### 分享笔记

#### 导出链接

```
右键笔记 → 分享 → 生成链接

选项:
- 有效期: 1天/7天/30天/永久
- 密码保护: 可选
- 允许下载: 是/否
```

#### 导出二维码

```
右键笔记 → 分享 → 生成二维码

手机扫码即可查看
```

### 协作编辑

#### 共享笔记本

```
右键文件夹 → 共享

输入协作者DID
设置权限:
- 只读
- 编辑
- 管理
```

#### 实时协作

多人可同时编辑:
- 实时同步
- 冲突自动合并
- 显示编辑者光标
- 版本历史保留

---

## 最佳实践

### 笔记方法

#### Zettelkasten（卡片盒笔记法）

```
每篇笔记:
1. 一个想法
2. 原子化内容
3. 链接相关笔记
4. 用自己的话重写
```

#### PARA方法

```
Projects（项目）- 短期目标
Areas（领域）- 长期责任
Resources（资源）- 兴趣主题
Archives（归档）- 已完成项目
```

#### Cornell笔记法

```
---
title: 笔记标题
date: 2024-12-02
---

## 要点提示
- 关键词1
- 关键词2

## 笔记内容
详细内容...

## 总结
一句话总结...
```

### 高效技巧

#### 1. 每日笔记

```
设置 → 启用每日笔记

自动创建当天笔记
模板: 日记模板
快捷键: Ctrl/Cmd + T
```

#### 2. 快速捕获

```
全局快捷键: Ctrl/Cmd + Shift + N

快速弹出窗口
输入想法
自动保存到收件箱
```

#### 3. 定期整理

建议流程:
```
1. 每周回顾收件箱
2. 整理到对应文件夹
3. 添加标签
4. 建立笔记链接
5. 归档已完成项目
```

#### 4. 利用AI

- 每周让AI总结笔记
- 让AI提取待办事项
- 让AI生成知识图谱
- 让AI推荐阅读顺序

---

## 高级功能

### 自定义脚本

支持JavaScript脚本自动化:

```javascript
// 自动添加创建时间
plugin.registerHook('onCreate', (note) => {
  note.metadata.created = new Date().toISOString()
})

// 自动生成摘要
plugin.registerHook('onSave', async (note) => {
  if (note.content.length > 500) {
    note.metadata.summary = await ai.summarize(note.content)
  }
})
```

### 自定义主题

CSS自定义样式:

```css
/* 自定义编辑器样式 */
.editor {
  font-family: 'Monaco', monospace;
  font-size: 16px;
  line-height: 1.8;
}

/* 自定义代码块 */
.code-block {
  background: #282c34;
  border-radius: 8px;
}
```

### 插件系统

安装社区插件:

```
设置 → 插件 → 浏览插件

热门插件:
- 思维导图
- 甘特图
- 日历视图
- Vim模式
- 番茄时钟
```

---

## 下一步

- [AI模型配置](/chainlesschain/ai-models) - 配置本地AI增强知识库
- [Git同步](/chainlesschain/git-sync) - 设置跨设备同步
- [去中心化社交](/chainlesschain/social) - 分享知识给好友

---

**构建您的第二大脑，永久保存您的知识！** 🧠

## 关键文件

- `desktop-app-vue/src/main/database.js` — 笔记数据库 Schema
- `desktop-app-vue/src/main/rag/` — RAG 混合搜索引擎
- `desktop-app-vue/src/renderer/pages/knowledge/` — 知识库前端页面
- `packages/cli/src/commands/note.js` — CLI 笔记命令
- `packages/cli/src/lib/bm25-search.js` — BM25 搜索引擎

## 使用示例

### CLI 快速操作

```bash
# 添加笔记
chainlesschain note add "学习笔记" -c "今天学习了RAG混合搜索" -t "学习,AI"

# 搜索笔记
chainlesschain note search "RAG搜索"

# 混合搜索（BM25 + 向量语义）
chainlesschain search "如何优化向量检索"

# 导入 Markdown 文件夹
chainlesschain import markdown ./docs --recursive

# 导入 PDF 文档
chainlesschain import pdf ./paper.pdf

# 导出为静态站点
chainlesschain export site -o ./my-site
```

### 桌面端常用操作

```
1. Ctrl/Cmd + N          → 新建笔记
2. Ctrl/Cmd + Shift + F  → 全局搜索
3. Ctrl/Cmd + K          → 打开 AI 助手，基于知识库问答
4. 右键笔记 → AI 功能    → 生成摘要 / 续写 / 翻译
5. 视图 → 知识图谱       → 查看笔记关联关系
```

---

## 故障排查

### 搜索结果不准确

- **检查索引状态**: 确认 Qdrant 向量数据库服务运行正常（默认端口 `6333`）
- **重建索引**: 设置 → 知识库 → 重建搜索索引
- **调整搜索权重**: BM25 适合精确关键词，向量搜索适合语义模糊查询

### 导入文件失败

- **PDF 导入**: 确认 PDF 未被密码保护，OCR 功能需要 Tesseract.js 支持
- **Evernote 导入**: 仅支持 `.enex` 格式，确认从 Evernote 正确导出
- **编码问题**: 确保文件为 UTF-8 编码，Windows 下注意 BOM 头

### 数据库加密错误

- **密钥不匹配**: SQLCipher 密钥变更后需要重新解锁数据库
- **数据库损坏**: 使用 `chainlesschain db info` 检查数据库状态
- **迁移失败**: 运行 `chainlesschain db init` 重新初始化表结构

### 知识导出空白

- **检查筛选条件**: 导出时确认选择了正确的标签或日期范围
- **权限问题**: 确认导出目录有写入权限
- **大文件超时**: 大量笔记导出建议分批操作

---

## 配置参考

### BM25 / TF-IDF 搜索配置

```javascript
// packages/cli/src/lib/bm25-search.js
const bm25Config = {
  // BM25 调参
  k1: 1.5,          // 词频饱和度（默认 1.5，越大越强调高频词）
  b: 0.75,          // 字段长度归一化系数（0–1，0 = 不归一化）
  delta: 0.5,       // BM25+ 下限修正（防止 TF=0 时得分为 0）

  // TF-IDF fallback
  tfidf: {
    enabled: true,
    minTermFreq: 1,       // 最低词频阈值
    maxDocFreqRatio: 0.9, // 文档频率超过 90% 视为停用词
  },

  // 字段权重
  fieldWeights: {
    title:   3.0,   // 标题权重最高
    tags:    2.0,
    content: 1.0,
    summary: 1.5,
  },

  // 索引存储
  indexPath: '.chainlesschain/bm25-index.json',
  rebuildOnStart: false,
};
```

### Qdrant 向量存储配置

```javascript
// desktop-app-vue/src/main/rag/vector-store.js
const qdrantConfig = {
  host: process.env.QDRANT_HOST || 'http://localhost:6333',
  collectionName: 'chainlesschain_notes',

  // 向量参数
  vectorParams: {
    size: 768,              // nomic-embed-text 嵌入维度
    distance: 'Cosine',     // 距离度量: Cosine | Euclid | Dot
  },

  // HNSW 索引参数（影响召回率 vs 速度）
  hnsw: {
    m: 16,                  // 每层最大邻居数（越大越准，越慢）
    efConstruct: 128,       // 构建时搜索范围（越大越准）
  },

  // 查询参数
  searchParams: {
    ef: 64,                 // 查询时搜索范围
    limit: 20,              // 候选结果数（re-rank 前）
    scoreThreshold: 0.5,    // 相似度阈值（低于此值不返回）
  },
};
```

### 混合搜索融合配置

```javascript
// desktop-app-vue/src/main/rag/hybrid-search.js
const hybridSearchConfig = {
  // RRF (Reciprocal Rank Fusion) 融合
  fusion: 'rrf',
  rrfK: 60,               // RRF 平滑系数（默认 60）

  // BM25 / 向量 权重比
  weights: {
    bm25:   0.4,
    vector: 0.6,
  },

  // 文本分块（Chunking）
  chunking: {
    chunkSize: 512,         // 单块最大 token 数
    chunkOverlap: 64,       // 相邻块重叠 token 数
    splitOn: 'sentence',    // 分割策略: sentence | paragraph | fixed
  },

  // Embedding 模型
  embedding: {
    model: 'nomic-embed-text',
    provider: 'ollama',
    batchSize: 32,          // 批量嵌入大小
    cacheEmbeddings: true,  // 缓存已计算的嵌入向量
  },

  // 最终返回条数
  topK: 10,
};
```

### 数据库 Schema 配置

```javascript
// desktop-app-vue/src/main/database.js
const dbConfig = {
  // SQLite / SQLCipher 选项
  pragma: {
    journalMode:  'WAL',      // 写前日志，支持并发读
    busyTimeout:  30000,      // 30s 等待超时
    synchronous:  'NORMAL',   // 性能 / 安全平衡
    cacheSize:    -64000,     // 64 MB 页缓存
    foreignKeys:  true,
  },

  // 全文搜索虚拟表 (FTS5)
  fts5: {
    tokenizer: 'unicode61',   // 支持 CJK 分词
    content:   'notes',       // 来源表
    columns:   ['title', 'content', 'tags'],
  },
};
```

---

## 性能指标

### 搜索延迟

| 操作 | 目标 | 实际 (P50) | 实际 (P95) | 状态 |
|------|------|-----------|-----------|------|
| BM25 关键词搜索 (FTS5) | < 50 ms | 12 ms | 38 ms | ✅ 达标 |
| Qdrant 向量语义搜索 | < 100 ms | 45 ms | 89 ms | ✅ 达标 |
| 混合搜索 (BM25 + 向量 RRF) | < 200 ms | 78 ms | 156 ms | ✅ 达标 |
| 全文搜索 (SQLite FTS5) | < 30 ms | 8 ms | 22 ms | ✅ 达标 |
| AI 问答 (RAG + Ollama) | < 5 s | 2.1 s | 4.3 s | ✅ 达标 |

### 索引构建

| 操作 | 数据集规模 | 目标 | 实际 | 状态 |
|------|-----------|------|------|------|
| BM25 增量索引更新 | 单篇笔记 | < 10 ms | 3 ms | ✅ 达标 |
| Qdrant 嵌入向量写入 | 单篇笔记 | < 200 ms | 85 ms | ✅ 达标 |
| 全量索引重建 | 1000 篇笔记 | < 60 s | 38 s | ✅ 达标 |
| 全量索引重建 | 10000 篇笔记 | < 10 min | 7.2 min | ✅ 达标 |
| Evernote 导入 (ENEX) | 500 条记录 | < 120 s | 74 s | ✅ 达标 |
| PDF 导入 + OCR | 单个文件 50 页 | < 30 s | 18 s | ✅ 达标 |

### 存储占用

| 项目 | 规模 | 磁盘占用 | 状态 |
|------|------|---------|------|
| SQLite 数据库 (含 FTS5 索引) | 1000 篇笔记 | ~45 MB | ✅ |
| Qdrant 向量存储 | 1000 篇笔记 (768 维) | ~12 MB | ✅ |
| BM25 JSON 索引 | 1000 篇笔记 | ~8 MB | ✅ |
| 嵌入向量缓存 | 1000 篇笔记 | ~6 MB | ✅ |

### 并发与内存

| 指标 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 并发搜索请求 | ≥ 10 req/s | 18 req/s | ✅ 达标 |
| 主进程内存基线 (Electron) | < 150 MB | 112 MB | ✅ 达标 |
| BM25 索引内存占用 (1k 笔记) | < 30 MB | 21 MB | ✅ 达标 |
| SQLite WAL 模式下写并发 | 无锁等待 < 30 s | < 1 s | ✅ 达标 |

---

## 测试覆盖率

### 单元测试

| 测试文件 | 覆盖范围 | 用例数 |
|---------|---------|--------|
| ✅ `packages/cli/__tests__/unit/bm25-search.test.js` | BM25 评分、FTS5 增量索引、字段权重 | 34 |
| ✅ `packages/cli/__tests__/unit/knowledge-importer.test.js` | Markdown / PDF / ENEX / Notion 导入 | 28 |
| ✅ `packages/cli/__tests__/unit/knowledge-exporter.test.js` | Markdown 批量导出、静态站点生成 | 21 |
| ✅ `packages/cli/__tests__/unit/note-versioning.test.js` | 历史版本、diff、回滚逻辑 | 19 |
| ✅ `desktop-app-vue/tests/unit/rag/hybrid-search.test.js` | RRF 融合、权重计算、topK 过滤 | 31 |
| ✅ `desktop-app-vue/tests/unit/rag/vector-store.test.js` | Qdrant CRUD、批量 upsert、相似度查询 | 26 |
| ✅ `desktop-app-vue/tests/unit/rag/chunking.test.js` | 分块策略、overlap 边界、CJK 句子切割 | 22 |
| ✅ `desktop-app-vue/tests/unit/rag/embedding-cache.test.js` | 嵌入缓存命中率、TTL 淘汰、批量预计算 | 18 |
| ✅ `desktop-app-vue/tests/unit/database.test.js` | Schema 初始化、FTS5 虚拟表、WAL 模式 | 24 |

### 集成测试

| 测试文件 | 覆盖范围 | 用例数 |
|---------|---------|--------|
| ✅ `packages/cli/__tests__/integration/note-search.test.js` | CLI `note search` 端到端 BM25 + 向量 | 16 |
| ✅ `packages/cli/__tests__/integration/import-export.test.js` | 导入 → 索引 → 搜索 → 导出全链路 | 14 |
| ✅ `desktop-app-vue/tests/integration/rag-pipeline.test.js` | RAG 问答链路：检索 → Prompt → Ollama | 12 |
| ✅ `desktop-app-vue/tests/integration/knowledge-sync.test.js` | 笔记写入 → BM25 + Qdrant 双路索引同步 | 10 |

### CLI 命令测试

| 测试文件 | 覆盖命令 | 用例数 |
|---------|---------|--------|
| ✅ `packages/cli/__tests__/commands/note.test.js` | `note add / list / search / delete` | 32 |
| ✅ `packages/cli/__tests__/commands/search.test.js` | `search` 混合搜索命令 | 18 |
| ✅ `packages/cli/__tests__/commands/import.test.js` | `import markdown / pdf / evernote` | 24 |
| ✅ `packages/cli/__tests__/commands/export.test.js` | `export site / markdown` | 14 |

**总计: 363 个测试用例，覆盖率 ≥ 87%**

---

## 安全考虑

### 数据存储安全

- 所有笔记数据使用 **SQLCipher AES-256** 全库加密，密钥由 U 盾硬件保护
- 文件附件使用 **AES-256-GCM** 独立加密存储
- 数据库密钥通过 HKDF 从主密钥派生，永不明文存储

### 搜索隐私保护

- 向量搜索完全在本地运行，查询内容不会上传到任何云端服务
- BM25 索引存储在本地 SQLite 中，不依赖外部搜索引擎
- AI 增强功能（摘要、问答）使用本地 Ollama 模型，保证数据不外泄

### 导入导出安全

- 导入文件自动进行恶意内容检测（脚本注入、XSS 攻击等）
- 导出的静态站点默认不包含加密密钥和敏感配置
- 分享链接支持密码保护和有效期设置，过期自动失效

### 协作安全

- 共享笔记本使用 Signal 协议端到端加密，中继节点无法读取内容
- 协作编辑基于 CRDT 协议，操作日志签名验证防篡改
- 权限变更记录在审计日志中，支持 90 天回溯查询

---

## 相关文档

- [笔记/知识库管理 (CLI)](./cli-note) — CLI 笔记命令
- [混合搜索 (CLI)](./cli-search) — BM25 搜索命令
- [数据加密](./encryption) — 数据库加密保护
- [Git 同步](./git-sync) — 知识库跨设备同步
