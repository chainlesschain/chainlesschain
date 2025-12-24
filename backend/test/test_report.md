# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 13:39:14
- **测试时长**: 0.05秒
- **总测试数**: 8
- **通过**: 0 ✅
- **失败**: 0 ❌
- **错误**: 8 ⚠️
- **跳过**: 0 ⏭️
- **成功率**: 0.00%

## 详细结果


### ⚠️ ERROR (8)

#### AI服务根路径

- **接口**: `GET /`
- **耗时**: 0.009秒
- **错误信息**: 无法连接到服务器

---

#### AI服务健康检查

- **接口**: `GET /health`
- **耗时**: 0.005秒
- **错误信息**: 无法连接到服务器

---

#### 意图识别

- **接口**: `POST /api/intent/classify`
- **耗时**: 0.005秒
- **错误信息**: 无法连接到服务器

**请求数据**:
```json
{
  "text": "创建一个待办事项网页应用",
  "context": []
}
```

---

#### AI创建项目

- **接口**: `POST /api/projects/create`
- **耗时**: 0.006秒
- **错误信息**: 无法连接到服务器

**请求数据**:
```json
{
  "user_prompt": "创建一个简单的HTML页面，显示Hello World",
  "project_type": "web"
}
```

---

#### RAG知识检索

- **接口**: `POST /api/rag/query`
- **耗时**: 0.008秒
- **错误信息**: 无法连接到服务器

---

#### Git状态查询

- **接口**: `GET /api/git/status`
- **耗时**: 0.006秒
- **错误信息**: 无法连接到服务器

---

#### 代码生成

- **接口**: `POST /api/code/generate`
- **耗时**: 0.005秒
- **错误信息**: 无法连接到服务器

**请求数据**:
```json
{
  "description": "创建一个Python函数，计算斐波那契数列",
  "language": "python",
  "style": "modern",
  "include_tests": false,
  "include_comments": true
}
```

---

#### 代码解释

- **接口**: `POST /api/code/explain`
- **耗时**: 0.005秒
- **错误信息**: 无法连接到服务器

**请求数据**:
```json
{
  "code": "def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)",
  "language": "python"
}
```

---

