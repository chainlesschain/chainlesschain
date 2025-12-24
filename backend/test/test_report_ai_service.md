# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 14:24:43
- **测试时长**: 209.38秒
- **总测试数**: 31
- **通过**: 16 ✅
- **失败**: 9 ❌
- **错误**: 6 ⚠️
- **跳过**: 0 ⏭️
- **成功率**: 51.61%

## 详细结果


### ✅ PASSED (16)

#### [Root] AI服务根路径

- **接口**: `GET /`
- **耗时**: 0.032秒

**响应数据**:
```json
{
  "service": "ChainlessChain AI Service",
  "version": "1.0.0",
  "status": "running"
}
```

---

#### [Health] AI服务健康检查

- **接口**: `GET /health`
- **耗时**: 0.031秒

**响应数据**:
```json
{
  "status": "healthy",
  "engines": {
    "web": true,
    "document": true,
    "data": true,
    "nlu": true,
    "rag": true
  }
}
```

---

#### [Intent] 意图识别 - 创建项目

- **接口**: `POST /api/intent/classify`
- **耗时**: 0.018秒

**请求数据**:
```json
{
  "text": "我想创建一个待办事项网页应用",
  "context": []
}
```

**响应数据**:
```json
{
  "intent": "create_project",
  "project_type": "web",
  "entities": {
    "template": "todo"
  },
  "confidence": 0.95,
  "action": "generate_file",
  "fast_path": true
}
```

---

#### [Intent] 意图识别 - 生成代码

- **接口**: `POST /api/intent/classify`
- **耗时**: 5.554秒

**请求数据**:
```json
{
  "text": "帮我写一个Python函数计算斐波那契数列",
  "context": []
}
```

**响应数据**:
```json
{
  "intent": "create_project",
  "project_type": "app",
  "entities": {
    "language": "Python",
    "task": "calculate Fibonacci sequence"
  },
  "confidence": 0.9,
  "action": "generate_file"
}
```

---

#### [RAG] 更新文件索引

- **接口**: `POST /api/rag/index/update-file`
- **耗时**: 1.164秒

**请求数据**:
```json
{
  "project_id": "test_project_a629337a",
  "file_path": "/test/sample.py",
  "content": "# Sample Python file\nprint('Hello World')"
}
```

**响应数据**:
```json
{
  "success": true,
  "file_path": "/test/sample.py",
  "chunks_added": 1
}
```

---

#### [Git] 生成提交信息

- **接口**: `POST /api/git/generate-commit-message`
- **耗时**: 0.009秒

**请求数据**:
```json
{
  "repo_path": "C:/code/chainlesschain",
  "diff": "diff --git a/test.py b/test.py\n+print('new line')"
}
```

**响应数据**:
```json
{
  "message": "Update files"
}
```

---

#### [Git] 初始化仓库

- **接口**: `POST /api/git/init`
- **耗时**: 0.963秒

**请求数据**:
```json
{
  "repo_path": "C:/temp/test_repo_b689860a"
}
```

**响应数据**:
```json
{
  "success": true,
  "repo_path": "C:/temp/test_repo_b689860a",
  "branch": "main",
  "remote_url": null
}
```

---

#### [Code] 生成Python代码

- **接口**: `POST /api/code/generate`
- **耗时**: 0.025秒

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

**响应数据**:
```json
{
  "error": "'VolcEngineClient' object has no attribute 'generate'",
  "code": null
}
```

---

#### [Code] 生成JavaScript代码

- **接口**: `POST /api/code/generate`
- **耗时**: 0.013秒

**请求数据**:
```json
{
  "description": "创建一个JavaScript函数，实现防抖功能",
  "language": "javascript",
  "style": "modern",
  "include_tests": true,
  "include_comments": true
}
```

**响应数据**:
```json
{
  "error": "'VolcEngineClient' object has no attribute 'generate'",
  "code": null
}
```

---

#### [Code] 解释代码

- **接口**: `POST /api/code/explain`
- **耗时**: 0.021秒

**请求数据**:
```json
{
  "code": "\ndef fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)\n",
  "language": "python"
}
```

**响应数据**:
```json
{
  "explanation": "解释失败: 'VolcEngineClient' object has no attribute 'generate'"
}
```

---

#### [Code] 审查代码

- **接口**: `POST /api/code/review`
- **耗时**: 0.026秒

**请求数据**:
```json
{
  "code": "\nfunction calculateTotal(items) {\n    var total = 0;\n    for (var i = 0; i < items.length; i++) {\n        total += items[i].price * items[i].quantity;\n    }\n    return total;\n}\n",
  "language": "javascript",
  "focus_areas": [
    "performance",
    "best_practices",
    "security"
  ]
}
```

**响应数据**:
```json
{
  "error": "'VolcEngineClient' object has no attribute 'generate'",
  "score": 0,
  "suggestions": []
}
```

---

#### [Code] 重构代码

- **接口**: `POST /api/code/refactor`
- **耗时**: 0.038秒

**请求数据**:
```json
{
  "code": "\ndef calc(a, b, op):\n    if op == '+':\n        return a + b\n    elif op == '-':\n        return a - b\n    elif op == '*':\n        return a * b\n    elif op == '/':\n        return a / b\n",
  "language": "python",
  "refactor_goals": [
    "improve_readability",
    "add_error_handling"
  ]
}
```

**响应数据**:
```json
{
  "error": "'VolcEngineClient' object has no attribute 'generate'",
  "refactored_code": null
}
```

---

#### [Code] 修复Bug

- **接口**: `POST /api/code/fix-bug`
- **耗时**: 0.024秒

**请求数据**:
```json
{
  "code": "\ndef divide(a, b):\n    return a / b\n",
  "bug_description": "没有处理除零错误",
  "language": "python"
}
```

**响应数据**:
```json
{
  "error": "'VolcEngineClient' object has no attribute 'generate'",
  "fixed_code": null
}
```

---

#### [Code] 生成测试代码

- **接口**: `POST /api/code/generate-tests`
- **耗时**: 0.023秒

**请求数据**:
```json
{
  "code": "\ndef add(a, b):\n    return a + b\n\ndef subtract(a, b):\n    return a - b\n",
  "language": "python",
  "test_framework": "pytest"
}
```

**响应数据**:
```json
{
  "tests": null
}
```

---

#### [Code] 优化代码

- **接口**: `POST /api/code/optimize`
- **耗时**: 0.011秒

**请求数据**:
```json
{
  "code": "\ndef find_duplicates(arr):\n    duplicates = []\n    for i in range(len(arr)):\n        for j in range(i+1, len(arr)):\n            if arr[i] == arr[j] and arr[i] not in duplicates:\n                duplicates.append(arr[i])\n    return duplicates\n",
  "language": "python",
  "optimization_focus": "performance"
}
```

**响应数据**:
```json
{
  "error": "'VolcEngineClient' object has no attribute 'generate'",
  "refactored_code": null
}
```

---

#### [RAG] 删除项目索引

- **接口**: `DELETE /api/rag/index/project/test_project_a629337a`
- **耗时**: 0.223秒

**响应数据**:
```json
{
  "success": true,
  "project_id": "test_project_a629337a"
}
```

---


### ❌ FAILED (9)

#### [RAG] 增强知识查询

- **接口**: `POST /api/rag/query/enhanced`
- **耗时**: 20.955秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "query": "ChainlessChain的架构设计",
  "top_k": 5,
  "score_threshold": 0.7
}
```

**响应数据**:
```json
{
  "detail": [
    {
      "type": "missing",
      "loc": [
        "body",
        "project_id"
      ],
      "msg": "Field required",
      "input": {
        "query": "ChainlessChain的架构设计",
        "top_k": 5,
        "score_threshold": 0.7
      }
    }
  ]
}
```

- **期望**: 200
- **实际**: 422

---

#### [RAG] 索引项目文件

- **接口**: `POST /api/rag/index/project`
- **耗时**: 0.037秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "project_id": "test_project_a629337a",
  "project_path": "C:/code/chainlesschain",
  "file_patterns": [
    "*.py",
    "*.js",
    "*.md"
  ]
}
```

**响应数据**:
```json
{
  "detail": [
    {
      "type": "missing",
      "loc": [
        "body",
        "repo_path"
      ],
      "msg": "Field required",
      "input": {
        "project_id": "test_project_a629337a",
        "project_path": "C:/code/chainlesschain",
        "file_patterns": [
          "*.py",
          "*.js",
          "*.md"
        ]
      }
    }
  ]
}
```

- **期望**: 200
- **实际**: 422

---

#### [RAG] 获取索引统计

- **接口**: `GET /api/rag/index/stats`
- **耗时**: 0.052秒
- **错误信息**: 状态码不匹配

**响应数据**:
```json
{
  "detail": [
    {
      "type": "missing",
      "loc": [
        "query",
        "project_id"
      ],
      "msg": "Field required",
      "input": null
    }
  ]
}
```

- **期望**: 200
- **实际**: 422

---

#### [Git] 查询Git状态

- **接口**: `GET /api/git/status`
- **耗时**: 0.015秒
- **错误信息**: 状态码不匹配

**响应数据**:
```json
{
  "detail": "/app/C:/code/chainlesschain"
}
```

- **期望**: 200
- **实际**: 500

---

#### [Git] 查询Git日志

- **接口**: `GET /api/git/log`
- **耗时**: 0.013秒
- **错误信息**: 状态码不匹配

**响应数据**:
```json
{
  "detail": "/app/C:/code/chainlesschain"
}
```

- **期望**: 200
- **实际**: 500

---

#### [Git] 查询Git差异

- **接口**: `GET /api/git/diff`
- **耗时**: 0.012秒
- **错误信息**: 状态码不匹配

**响应数据**:
```json
{
  "detail": "/app/C:/code/chainlesschain"
}
```

- **期望**: 200
- **实际**: 500

---

#### [Git] 获取分支列表

- **接口**: `GET /api/git/branches`
- **耗时**: 0.009秒
- **错误信息**: 状态码不匹配

**响应数据**:
```json
{
  "detail": "/app/C:/code/chainlesschain"
}
```

- **期望**: 200
- **实际**: 500

---

#### [Git] 创建分支

- **接口**: `POST /api/git/branch/create`
- **耗时**: 0.016秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "repo_path": "C:/code/chainlesschain",
  "branch_name": "test-branch-e9301a80"
}
```

**响应数据**:
```json
{
  "detail": "/app/C:/code/chainlesschain"
}
```

- **期望**: 200
- **实际**: 500

---

#### [Git] 切换分支

- **接口**: `POST /api/git/branch/checkout`
- **耗时**: 0.018秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "repo_path": "C:/code/chainlesschain",
  "branch_name": "main"
}
```

**响应数据**:
```json
{
  "detail": "/app/C:/code/chainlesschain"
}
```

- **期望**: 200
- **实际**: 500

---


### ⚠️ ERROR (6)

#### [Project] 创建Web项目

- **接口**: `POST /api/projects/create`
- **耗时**: 30.006秒
- **错误信息**: 请求超时 (>30s)

**请求数据**:
```json
{
  "user_prompt": "创建一个简单的HTML页面，显示Hello World",
  "project_type": "web"
}
```

---

#### [Project] 创建数据分析项目

- **接口**: `POST /api/projects/create`
- **耗时**: 30.008秒
- **错误信息**: 请求超时 (>30s)

**请求数据**:
```json
{
  "user_prompt": "创建一个数据分析项目，分析销售数据",
  "project_type": "data"
}
```

---

#### [Project] 创建文档项目

- **接口**: `POST /api/projects/create`
- **耗时**: 30.017秒
- **错误信息**: 请求超时 (>30s)

**请求数据**:
```json
{
  "user_prompt": "帮我写一份技术文档",
  "project_type": "document"
}
```

---

#### [Task] 执行任务 - 添加功能

- **接口**: `POST /api/tasks/execute`
- **耗时**: 30.015秒
- **错误信息**: 请求超时 (>30s)

**请求数据**:
```json
{
  "project_id": "test_project_a629337a",
  "user_prompt": "在项目中添加一个新功能：用户登录",
  "context": []
}
```

---

#### [RAG] 简单知识查询

- **接口**: `POST /api/rag/query`
- **耗时**: 30.008秒
- **错误信息**: 请求超时 (>30s)

---

#### [RAG] 技术知识查询

- **接口**: `POST /api/rag/query`
- **耗时**: 30.017秒
- **错误信息**: 请求超时 (>30s)

---

