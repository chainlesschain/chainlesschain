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

## ���取笔记详情

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
