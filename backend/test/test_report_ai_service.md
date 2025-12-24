# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 16:57:05
- **测试时长**: 442.63秒
- **总测试数**: 31
- **通过**: 23 ✅
- **失败**: 6 ❌
- **错误**: 2 ⚠️
- **跳过**: 0 ⏭️
- **成功率**: 74.19%

## 详细结果


### ✅ PASSED (23)

#### [Root] AI服务根路径

- **接口**: `GET /`
- **耗时**: 0.009秒

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
- **耗时**: 0.003秒

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
- **耗时**: 0.007秒

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
- **耗时**: 8.607秒

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
  "project_type": "unknown",
  "entities": {
    "language": "Python",
    "task": "calculate Fibonacci sequence"
  },
  "confidence": 0.9,
  "action": "generate_file"
}
```

---

#### [Project] 创建Web项目

- **接口**: `POST /api/projects/create`
- **耗时**: 97.235秒

**请求数据**:
```json
{
  "user_prompt": "创建一个简单的HTML页面，显示Hello World",
  "project_type": "web"
}
```

**响应数据**:
```json
{
  "success": true,
  "project_type": "web",
  "intent": {
    "intent": "create_project",
    "project_type": "web",
    "entities": {},
    "confidence": 0.95,
    "action": "generate_file",
    "fast_path": true
  },
  "result": {
    "files": [
      {
        "path": "index.html",
        "content": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>Hello World 页面</title>\n    <meta name=\"description\" content=\"一个简单的HTML页面，用于显示Hello World文本\">\n    <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n    <header class=\"site-header\">\n        <h1 class=\"header-title\">Hello World 页面</h1>\n    </header>\n\n    <main class=\"site-main\">\n        <section id=\"home\" class=\"section-home\">\n            <h2 class=\"section-title\">首页</h2>\n            <p class=\"hello-text\">Hello World!</p>\n        </section>\n    </main>\n\n    <footer class=\"site-footer\">\n        <p class=\"footer-text\">&copy; 2024 Hello World 页面</p>\n    </footer>\n\n    <script src=\"script.js\"></script>\n</body>\n</html>",
        "language": "html"
      },
      {
        "path": "styles.css",
        "content": ":root {\n  --primary: #3498db;\n  --secondary: #2ecc71;\n  --bg-color: #ffffff;\n  --container-bg: #f8f9fa;\n  --text-color: #333333;\n  --shadow: 0 2px 15px rgba(0, 0, 0, 0.1);\n  --transition: all 0.3s ease;\n}\n\n.dark {\n  --bg-color: #121212;\n  --container-bg: #1e1e1e;\n  --text-color: #ffffff;\n  --shadow: 0 2px 15px rgba(255, 255, 255, 0.1);\n}\n\n* {\n  margin: 0;\n  padding: 0;\n  box-sizing: border-box;\n  font-family: Arial, sans-serif;\n}\n\nbody {\n  background-color: var(--bg-color);\n  color: var(--text-color);\n  min-height: 100vh;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  transition: var(--transition);\n  padding: 1rem;\n}\n\n.container {\n  text-align: center;\n  padding: 3rem 2rem;\n  border-radius: 12px;\n  box-shadow: var(--shadow);\n  background-color: var(--container-bg);\n  transition: var(--transition);\n  animation: fadeIn 0.5s ease forwards;\n  opacity: 0;\n  animation-delay: 0.2s;\n}\n\nh1 {\n  font-size: 2.8rem;\n  margin-bottom: 1rem;\n  color: var(--primary);\n  transition: var(--transition);\n}\n\np {\n  font-size: 1.2rem;\n  color: var(--text-color);\n  opacity: 0.9;\n  transition: var(--transition);\n}\n\n.theme-toggle {\n  position: fixed;\n  top: 1.5rem;\n  right: 1.5rem;\n  padding: 0.7rem 1.2rem;\n  border: none;\n  border-radius: 8px;\n  background-color: var(--primary);\n  color: white;\n  font-size: 1rem;\n  cursor: pointer;\n  transition: var(--transition);\n  box-shadow: 0 2px 8px rgba(52, 152, 219, 0.3);\n}\n\n.theme-toggle:hover {\n  background-color: #2980b9;\n  transform: translateY(-2px);\n  box-shadow: 0 4px 12px rgba(52, 152, 219, 0.4);\n}\n\n.dark .theme-toggle {\n  background-color: #2980b9;\n  box-shadow: 0 2px 8px rgba(41, 128, 185, 0.3);\n}\n\n.dark .theme-toggle:hover {\n  background-color: #3498db;\n  transform: translateY(-2px);\n  box-shadow: 0 4px 12px rgba(52, 152, 219, 0.4);\n}\n\n@keyframes fadeIn {\n  from {\n    opacity: 0;\n    transform: translateY(20px);\n  }\n  to {\n    opacity: 1;\n    transform: translateY(0);\n  }\n}\n\n@media (max-width: 768px) {\n  h1 {\n    font-size: 2rem;\n  }\n\n  p {\n    font-size: 1rem;\n  }\n\n  .container {\n    padding: 2rem 1.5rem;\n  }\n\n  .theme-toggle {\n    top: 1rem;\n    right: 1rem;\n    padding: 0.5rem 1rem;\n    font-size: 0.9rem;\n  }\n}",
        "language": "css"
      },
      {
        "path": "script.js",
        "content": "// 页面加载完成后执行\ndocument.addEventListener('DOMContentLoaded', () => {\n  // DOM元素选择\n  const hamburger = document.querySelector('.hamburger');\n  const navMenu = document.querySelector('.nav-menu');\n  const navLinks = document.querySelectorAll('.nav-link');\n  const darkModeToggle = document.querySelector('.dark-mode-toggle');\n  const helloText = document.querySelector('.hello-text');\n  const body = document.body;\n\n  // 1. 平滑滚动功能\n  navLinks.forEach(link => {\n    link.addEventListener('click', (e) => {\n      e.preventDefault();\n      const targetId = link.dataset.target;\n      const target = document.getElementById(targetId);\n      \n      if (target) {\n        target.scrollIntoView({ behavior: 'smooth' });\n        // 移动端点击后关闭菜单\n        if (window.innerWidth < 768) navMenu.classList.remove('active');\n      }\n    });\n  });\n\n  // 2. 响应式导航切换\n  hamburger.addEventListener('click', () => {\n    navMenu.classList.toggle('active');\n    const isExpanded = hamburger.ariaExpanded === 'true';\n    hamburger.ariaExpanded = !isExpanded;\n  });\n\n  // 窗口大小变化时重置导航状态\n  window.addEventListener('resize', () => {\n    if (window.innerWidth >= 768) {\n      navMenu.classList.remove('active');\n      hamburger.ariaExpanded = 'false';\n    }\n  });\n\n  // 3. 深色模式切换\n  const initDarkMode = () => {\n    const savedMode = localStorage.getItem('darkMode') === 'true';\n    if (savedMode) {\n      body.classList.add('dark');\n      darkModeToggle.ariaLabel = '切换到浅色模式';\n    }\n  };\n\n  darkModeToggle.addEventListener('click', () => {\n    const isDark = body.classList.toggle('dark');\n    localStorage.setItem('darkMode', isDark);\n    darkModeToggle.ariaLabel = isDark ? '切换到浅色模式' : '切换到深色模式';\n  });\n\n  // 4. Hello World 点击交互\n  helloText.addEventListener('click', () => {\n    helloText.classList.add('pulse');\n    setTimeout(() => helloText.classList.remove('pulse'), 500);\n  });\n\n  // 初始化\n  initDarkMode();\n});",
        "language": "javascript"
      }
    ],
    "metadata": {
      "template": "basic",
      "theme": "light",
      "spec": {
        "title": "Hello World 页面",
        "description": "一个简单的HTML页面，用于显示Hello World文本",
        "sections": [
          "首页"
        ],
        "features": [
          "基础文本展示",
          "简洁布局"
        ],
        "color_scheme": {
          "primary": "#3498db",
          "secondary": "#2ecc71"
        },
        "fonts": [
          "Arial",
          "sans-serif"
        ],
        "layout": "single-page"
      },
      "source": "llm_generated"
    }
  }
}
```

---

#### [Task] 执行任务 - 添加功能

- **接口**: `POST /api/tasks/execute`
- **耗时**: 94.361秒

**请求数据**:
```json
{
  "project_id": "test_project_bc63c1ac",
  "user_prompt": "在项目中添加一个新功能：用户登录",
  "context": []
}
```

**响应数据**:
```json
{
  "task_id": "task_unknown",
  "status": "completed",
  "intent": {
    "intent": "modify_project",
    "project_type": "unknown",
    "entities": {
      "feature": "user_login"
    },
    "confidence": 0.88,
    "action": "update_file"
  },
  "message": "任务 'update_file' 执行完成"
}
```

---

#### [RAG] 简单知识查询

- **接口**: `POST /api/rag/query`
- **耗时**: 1.479秒

**响应数据**:
```json
{
  "query": "什么是机器学习",
  "results": []
}
```

---

#### [RAG] 技术知识查询

- **接口**: `POST /api/rag/query`
- **耗时**: 0.089秒

**响应数据**:
```json
{
  "query": "如何使用React Hooks",
  "results": []
}
```

---

#### [RAG] 索引项目文件

- **接口**: `POST /api/rag/index/project`
- **耗时**: 0.010秒

**请求数据**:
```json
{
  "project_id": "test_project_bc63c1ac",
  "repo_path": "/tmp/test_git_repo_ff6e717b",
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
  "success": true,
  "project_id": "test_project_bc63c1ac",
  "indexed_files": 0,
  "skipped_files": 0,
  "error_files": 0,
  "total_chunks": 0,
  "total_files": 0
}
```

---

#### [RAG] 更新文件索引

- **接口**: `POST /api/rag/index/update-file`
- **耗时**: 0.395秒

**请求数据**:
```json
{
  "project_id": "test_project_bc63c1ac",
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

#### [Git] 初始化仓库

- **接口**: `POST /api/git/init`
- **耗时**: 0.093秒

**请求数据**:
```json
{
  "repo_path": "/tmp/test_git_repo_ff6e717b"
}
```

**响应数据**:
```json
{
  "success": true,
  "repo_path": "/tmp/test_git_repo_ff6e717b",
  "branch": "main",
  "remote_url": null
}
```

---

#### [Git] 查询Git状态

- **接口**: `GET /api/git/status`
- **耗时**: 0.045秒

**响应数据**:
```json
{
  "branch": "main",
  "modified": [],
  "staged": [],
  "untracked": [],
  "remotes": {},
  "is_dirty": false
}
```

---

#### [Git] 获取分支列表

- **接口**: `GET /api/git/branches`
- **耗时**: 0.010秒

**响应数据**:
```json
{
  "current": "main",
  "local": [],
  "remote": []
}
```

---

#### [Git] 生成提交信息

- **接口**: `POST /api/git/generate-commit-message`
- **耗时**: 0.083秒

**请求数据**:
```json
{
  "repo_path": "/tmp/test_git_repo_ff6e717b",
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

#### [Code] 生成Python代码

- **接口**: `POST /api/code/generate`
- **耗时**: 0.005秒

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
- **耗时**: 0.003秒

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
- **耗时**: 0.004秒

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
- **耗时**: 0.006秒

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
- **耗时**: 0.007秒

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
- **耗时**: 0.007秒

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
- **耗时**: 0.006秒

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
- **耗时**: 0.006秒

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

- **接口**: `DELETE /api/rag/index/project/test_project_bc63c1ac`
- **耗时**: 0.060秒

**响应数据**:
```json
{
  "success": true,
  "project_id": "test_project_bc63c1ac"
}
```

---


### ❌ FAILED (6)

#### [RAG] 增强知识查询

- **接口**: `POST /api/rag/query/enhanced`
- **耗时**: 0.015秒
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

#### [RAG] 获取索引统计

- **接口**: `GET /api/rag/index/stats`
- **耗时**: 0.012秒
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

#### [Git] 查询Git日志

- **接口**: `GET /api/git/log`
- **耗时**: 0.010秒
- **错误信息**: 状态码不匹配

**响应数据**:
```json
{
  "detail": "Reference at 'refs/heads/main' does not exist"
}
```

- **期望**: 200
- **实际**: 500

---

#### [Git] 查询Git差异

- **接口**: `GET /api/git/diff`
- **耗时**: 0.013秒
- **错误信息**: 状态码不匹配

**响应数据**:
```json
{
  "detail": "Cmd('git') failed due to: exit code(128)\n  cmdline: git diff HEAD\n  stderr: 'fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.\nUse '--' to separate paths from revisions, like this:\n'git <command> [<revision>...] -- [<file>...]''"
}
```

- **期望**: 200
- **实际**: 500

---

#### [Git] 创建分支

- **接口**: `POST /api/git/branch/create`
- **耗时**: 0.008秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "repo_path": "/tmp/test_git_repo_ff6e717b",
  "branch_name": "test-branch-856b65fd"
}
```

**响应数据**:
```json
{
  "detail": "Ref 'HEAD' did not resolve to an object"
}
```

- **期望**: 200
- **实际**: 500

---

#### [Git] 切换分支

- **接口**: `POST /api/git/branch/checkout`
- **耗时**: 0.013秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "repo_path": "/tmp/test_git_repo_ff6e717b",
  "branch_name": "main"
}
```

**响应数据**:
```json
{
  "detail": "Cmd('git') failed due to: exit code(1)\n  cmdline: git checkout main\n  stderr: 'error: pathspec 'main' did not match any file(s) known to git'"
}
```

- **期望**: 200
- **实际**: 500

---


### ⚠️ ERROR (2)

#### [Project] 创建数据分析项目

- **接口**: `POST /api/projects/create`
- **耗时**: 120.012秒
- **错误信息**: 请求超时 (>120s)

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
- **耗时**: 120.006秒
- **错误信息**: 请求超时 (>120s)

**请求数据**:
```json
{
  "user_prompt": "帮我写一份技术文档",
  "project_type": "document"
}
```

---

