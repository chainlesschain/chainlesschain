# 知识库API

知识库API提供笔记管理、搜索和知识导入导出功能，是ChainlessChain个人第二大脑系统的核心接口。

## 接口列表

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| [创建笔记](#创建笔记) | POST | `/api/notes` | 创建新笔记 |
| [获取笔记列表](#获取笔记列表) | GET | `/api/notes` | 分页查询笔记 |
| [获取笔记详情](#获取笔记详情) | GET | `/api/notes/{id}` | 获取单条笔记 |
| [更新笔记](#更新笔记) | PUT | `/api/notes/{id}` | 更新笔记内容 |
| [删除笔记](#删除笔记) | DELETE | `/api/notes/{id}` | 删除笔记 |
| [搜索笔记](#搜索笔记) | GET | `/api/notes/search` | 混合搜索（BM25 + 向量） |
| [导入内容](#导入内容) | POST | `/api/import/{format}` | 导入Markdown/PDF/Evernote |
| [导出内容](#导出内容) | POST | `/api/export/{format}` | 导出为静态站点/Markdown |

---

## 创建笔记

创建一条新的笔记记录。

### 请求

```http
POST /api/notes
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "title": "学习笔记：Rust所有权机制",
  "content": "Rust的所有权系统是其内存安全的核心...",
  "tags": ["rust", "编程", "学习"],
  "category": "技术笔记"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 是 | 笔记标题 |
| content | string | 是 | 笔记内容（支持Markdown） |
| tags | string[] | 否 | 标签列表 |
| category | string | 否 | 分类名称 |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "笔记创建成功",
  "data": {
    "id": "note-1701589200123",
    "title": "学习笔记：Rust所有权机制",
    "content": "Rust的所有权系统是其内存安全的核心...",
    "tags": ["rust", "编程", "学习"],
    "category": "技术笔记",
    "createdAt": "2024-12-02T10:30:00Z",
    "updatedAt": "2024-12-02T10:30:00Z"
  }
}
```

---

## 获取笔记列表

分页查询笔记列表，支持按标签和分类过滤。

### 请求

```http
GET /api/notes?page=1&pageSize=20&tag=rust&category=技术笔记
Authorization: Bearer <token>
```

**查询参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认1 |
| pageSize | number | 否 | 每页条数，默认20，最大100 |
| tag | string | 否 | 按标签过滤 |
| category | string | 否 | 按分类过滤 |
| sortBy | string | 否 | 排序字段：createdAt/updatedAt，默认updatedAt |
| order | string | 否 | 排序方向：asc/desc，默认desc |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "id": "note-1701589200123",
        "title": "学习笔记：Rust所有权机制",
        "tags": ["rust", "编程", "学习"],
        "category": "技术笔记",
        "createdAt": "2024-12-02T10:30:00Z",
        "updatedAt": "2024-12-02T10:30:00Z"
      }
    ],
    "total": 42,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 获取笔记详情

获取单条笔记的完整内容。

### 请求

```http
GET /api/notes/{id}
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "note-1701589200123",
    "title": "学习笔记：Rust所有权机制",
    "content": "Rust的所有权系统是其内存安全的核心...",
    "tags": ["rust", "编程", "学习"],
    "category": "技术笔记",
    "createdAt": "2024-12-02T10:30:00Z",
    "updatedAt": "2024-12-02T10:30:00Z"
  }
}
```

**错误响应** (404):

```json
{
  "code": 4004,
  "message": "笔记不存在",
  "data": null
}
```

---

## 更新笔记

更新指定笔记的内容，支持部分更新。

### 请求

```http
PUT /api/notes/{id}
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "title": "学习笔记：Rust所有权机制（更新版）",
  "content": "更新后的内容...",
  "tags": ["rust", "编程", "学习", "内存安全"]
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "笔记更新成功",
  "data": {
    "id": "note-1701589200123",
    "title": "学习笔记：Rust所有权机制（更新版）",
    "updatedAt": "2024-12-02T11:00:00Z"
  }
}
```

---

## 删除笔记

删除指定笔记。

### 请求

```http
DELETE /api/notes/{id}
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "笔记删除成功",
  "data": null
}
```

---

## 搜索笔记

使用BM25和向量混合搜索查找笔记。

### 请求

```http
GET /api/notes/search?q=Rust内存安全&limit=10
Authorization: Bearer <token>
```

**查询参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| q | string | 是 | 搜索关键词 |
| limit | number | 否 | 返回条数，默认10，最大50 |
| mode | string | 否 | 搜索模式：hybrid（默认）/bm25/vector |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "id": "note-1701589200123",
        "title": "学习笔记：Rust所有权机制",
        "snippet": "...Rust的所有权系统是其**内存安全**的核心...",
        "score": 0.92,
        "tags": ["rust", "编程"]
      }
    ],
    "total": 3,
    "mode": "hybrid"
  }
}
```

---

## 导入内容

从外部格式导入内容到知识库。

### 请求

```http
POST /api/import/{format}
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**路径参数**:

| 参数 | 说明 | 支持值 |
|------|------|--------|
| format | 导入格式 | markdown, pdf, evernote |

**表单参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | file | 是 | 待导入的文件 |
| category | string | 否 | 导入后的默认分类 |
| tags | string | 否 | 默认标签（逗号分隔） |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "导入成功",
  "data": {
    "imported": 15,
    "skipped": 2,
    "errors": 0,
    "details": [
      { "file": "chapter1.md", "status": "success", "noteId": "note-001" },
      { "file": "duplicate.md", "status": "skipped", "reason": "已存在同名笔记" }
    ]
  }
}
```

---

## 导出内容

将知识库内容导出为指定格式。

### 请求

```http
POST /api/export/{format}
Authorization: Bearer <token>
Content-Type: application/json
```

**路径参数**:

| 参数 | 说明 | 支持值 |
|------|------|--------|
| format | 导出格式 | site, markdown |

**请求体**:

```json
{
  "noteIds": ["note-001", "note-002"],
  "includeAll": false,
  "outputDir": "./export"
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "导出成功",
  "data": {
    "exported": 10,
    "format": "site",
    "outputPath": "./export/site",
    "totalSize": "2.5MB"
  }
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 4001 | 笔记标题不能为空 |
| 4002 | 笔记内容超过最大长度限制 |
| 4003 | 标签数量超过限制（最多20个） |
| 4004 | 笔记不存在 |
| 4005 | 搜索关键词不能为空 |
| 4006 | 不支持的导入格式 |
| 4007 | 导入文件过大（最大50MB） |

## CLI对应命令

```bash
# 笔记管理
chainlesschain note add "标题" -c "内容" -t "tag1,tag2"
chainlesschain note list
chainlesschain note search "关键词"

# 搜索
chainlesschain search "关键词"

# 导入导出
chainlesschain import markdown ./docs
chainlesschain import pdf document.pdf
chainlesschain import evernote backup.enex
chainlesschain export site -o ./site
```

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

见正文「接口列表」。知识库 API 提供笔记 CRUD、混合搜索（BM25 + 向量）与导入导出，是 ChainlessChain 个人第二大脑系统的核心接口。

### 2. 核心特性

- 笔记 CRUD（标题 / 内容 / 标签，≤20 标签）
- 混合搜索（BM25/TF-IDF + 向量）
- 导入 Markdown / PDF / Evernote（≤50MB）
- 导出静态站点 / Markdown

### 3. 系统架构

```
客户端 / CLI ──Bearer JWT──► REST /api/notes|search|import|export
                                （ChainlessChain 系统 http://localhost:3000/api）
                                   ▼
                  本地加密存储（SQLCipher）+ 向量检索（Qdrant）
```

### 4. 系统定位

ChainlessChain **个人知识库（RAG 增强）的 API 侧**，对应 CLI `chainlesschain note/search/import/export`（见正文「CLI对应命令」）。

### 5. 核心功能

见正文「接口列表」：`POST/GET /api/notes`、`GET/PUT/DELETE /api/notes/{id}`、`GET /api/notes/search`（BM25+向量）、`POST /api/import/{format}`、`POST /api/export/{format}`。

### 6. 技术架构

REST + JWT；检索 BM25/TF-IDF（natural）+ 向量（Qdrant）；本地存储 SQLite/SQLCipher（AES-256）；统一响应 `{code, message, data}`。

### 7. 系统特点

- 混合搜索兼顾关键词与语义
- 本地优先 + 加密存储
- 多格式导入导出，便于迁移

### 8. 应用场景

个人笔记自动化、RAG 问答检索、从 Evernote/Markdown 迁移、导出静态知识站点。

### 9. 竞品对比

| 维度 | 本 API | 云笔记 SaaS |
|---|---|---|
| 本地加密 | ✅ SQLCipher | ❌ |
| 混合搜索 | ✅ BM25+向量 | ⚠️ |
| 多格式导入导出 | ✅ | ⚠️ |

### 10. 配置参考

Base URL：`http://localhost:3000/api`（ChainlessChain 系统）；`Authorization: Bearer <token>`；导入文件 ≤50MB；标签 ≤20 个。

### 11. 性能指标

混合搜索 BM25 + 向量召回；列表分页；导入文件上限 50MB；本地检索无网络往返。

### 12. 测试覆盖

端点契约 + CLI 对应命令（`chainlesschain note/search/import/export`）；搜索 / 导入格式 / 标签限制由后端测试覆盖。

### 13. 安全考虑

- 接口需 JWT
- 笔记本地 SQLCipher 加密存储
- 导出内容含个人数据——注意外发安全
- 错误码 4001–4007

### 14. 故障排除

| 现象 | 错误码 | 处理 |
|---|---|---|
| 标题为空 | 4001 | 填写标题 |
| 内容 / 标签超限 | 4002 / 4003 | 缩减内容 / ≤20 标签 |
| 笔记不存在 | 4004 | 核对笔记 ID |
| 搜索词为空 | 4005 | 提供关键词 |
| 导入格式 / 大小 | 4006 / 4007 | 用支持格式 / ≤50MB |

### 15. 关键文件

| 资源 | 说明 |
|---|---|
| `/api/notes*` `/api/import` `/api/export` | 知识库 REST API |
| CLI `chainlesschain note/search` | 对应命令 |
| 本地 SQLCipher + Qdrant | 存储 / 向量检索 |

### 16. 使用示例

见正文各端点请求示例与「CLI对应命令」（`chainlesschain note add` / `search` / `import` / `export`）。

### 17. 相关文档

- [社交 API](/api/chainlesschain/social)
- [交易 API](/api/chainlesschain/trading)
- [API 简介](/api/introduction)
