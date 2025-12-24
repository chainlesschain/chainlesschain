# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 20:38:41
- **测试时长**: 285.78秒
- **总测试数**: 29
- **通过**: 28 ✅
- **失败**: 1 ❌
- **错误**: 0 ⚠️
- **跳过**: 0 ⏭️
- **成功率**: 96.55%

## 详细结果


### ✅ PASSED (28)

#### AI服务根路径

- **接口**: `GET /`
- **耗时**: 46.695秒

**响应数据**:
```json
{
  "service": "ChainlessChain AI Service",
  "version": "1.0.0",
  "status": "running"
}
```

---

#### AI服务健康检查

- **接口**: `GET /health`
- **耗时**: 0.015秒

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

#### 意图识别

- **接口**: `POST /api/intent/classify`
- **耗时**: 0.014秒

**请求数据**:
```json
{
  "text": "Create a todo list web application",
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

#### AI创建项目

- **接口**: `POST /api/projects/create`
- **耗时**: 87.525秒

**请求数据**:
```json
{
  "user_prompt": "Create a simple HTML page showing Hello World",
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
        "content": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <meta name=\"description\" content=\"一个仅展示Hello World文本的基础HTML页面，满足用户核心需求\">\n    <title>简单Hello World HTML页面</title>\n    <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n    <header class=\"page-header\">\n        <h2>简单Hello World页面</h2>\n    </header>\n\n    <main class=\"main-content\">\n        <h1>Hello World</h1>\n    </main>\n\n    <footer class=\"page-footer\">\n        <p>&copy; 2024 简单Hello World项目</p>\n    </footer>\n\n    <script src=\"script.js\"></script>\n</body>\n</html>",
        "language": "html"
      },
      {
        "path": "styles.css",
        "content": ":root {\n  --primary: #3498db;\n  --secondary: #2ecc71;\n  --background: #ffffff;\n  --text: #333333;\n  --shadow: rgba(0, 0, 0, 0.1);\n  --transition-speed: 0.3s;\n}\n\n.dark-theme {\n  --background: #1a1a1a;\n  --text: #ffffff;\n  --shadow: rgba(255, 255, 255, 0.1);\n}\n\n* {\n  box-sizing: border-box;\n  margin: 0;\n  padding: 0;\n}\n\nbody {\n  min-height: 100vh;\n  display: flex;\n  justify-content: center;\n  align-items: center;\n  font-family: 'Arial', sans-serif;\n  background-color: var(--background);\n  color: var(--text);\n  transition: background-color var(--transition-speed), color var(--transition-speed);\n}\n\n.container {\n  text-align: center;\n  padding: 2rem 3rem;\n  border-radius: 12px;\n  box-shadow: 0 4px 20px var(--shadow);\n  transition: box-shadow var(--transition-speed);\n}\n\n.container:hover {\n  box-shadow: 0 6px 25px var(--shadow);\n}\n\nh1 {\n  font-size: 3.5rem;\n  font-weight: 700;\n  color: var(--primary);\n  transition: color var(--transition-speed), transform var(--transition-speed);\n  animation: fadeIn 1s ease-in-out;\n}\n\nh1:hover {\n  color: var(--secondary);\n  transform: scale(1.08);\n}\n\n@keyframes fadeIn {\n  from {\n    opacity: 0;\n    transform: translateY(-30px);\n  }\n  to {\n    opacity: 1;\n    transform: translateY(0);\n  }\n}\n\n@media (max-width: 768px) {\n  h1 {\n    font-size: 2rem;\n  }\n  \n  .container {\n    padding: 1.5rem 2rem;\n  }\n}\n\n@media (max-width: 480px) {\n  h1 {\n    font-size: 1.8rem;\n  }\n  \n  .container {\n    padding: 1rem 1.5rem;\n  }\n}",
        "language": "css"
      },
      {
        "path": "script.js",
        "content": "document.addEventListener('DOMContentLoaded', () => {\n  // 1. 平滑滚动实现\n  const initSmoothScroll = () => {\n    document.querySelectorAll('a[href^=\"#\"]').forEach(link => {\n      link.addEventListener('click', (e) => {\n        e.preventDefault();\n        const target = document.querySelector(link.getAttribute('href'));\n        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });\n      });\n    });\n  };\n\n  // 2. 响应式导航菜单\n  const initResponsiveNav = () => {\n    const hamburger = document.querySelector('.hamburger');\n    const navMenu = document.querySelector('.nav-menu');\n    \n    if (!hamburger || !navMenu) return;\n\n    // 汉堡按钮切换菜单\n    hamburger.addEventListener('click', () => {\n      navMenu.classList.toggle('active');\n      hamburger.classList.toggle('active');\n    });\n\n    // 点击菜单链接关闭菜单\n    navMenu.querySelectorAll('a').forEach(link => {\n      link.addEventListener('click', () => {\n        navMenu.classList.remove('active');\n        hamburger.classList.remove('active');\n      });\n    });\n  };\n\n  // 3. 深色模式切换（含本地存储持久化）\n  const initDarkMode = () => {\n    const toggleBtn = document.querySelector('.dark-mode-toggle');\n    if (!toggleBtn) return;\n\n    // 页面加载时恢复深色模式状态\n    const isDark = localStorage.getItem('darkMode') === 'true';\n    document.body.classList.toggle('dark', isDark);\n\n    // 切换逻辑\n    toggleBtn.addEventListener('click', () => {\n      const isActive = document.body.classList.toggle('dark');\n      localStorage.setItem('darkMode', isActive);\n    });\n  };\n\n  // 初始化所有交互功能\n  initSmoothScroll();\n  initResponsiveNav();\n  initDarkMode();\n});",
        "language": "javascript"
      }
    ],
    "metadata": {
      "template": "basic",
      "theme": "light",
      "spec": {
        "title": "简单Hello World HTML页面",
        "description": "一个仅展示Hello World文本的基础HTML页面，满足用户核心需求",
        "sections": [
          "首页"
        ],
        "features": [
          "基础HTML结构",
          "Hello World文本显示"
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

#### AI流式创建项目

- **接口**: `POST /api/projects/create/stream`
- **耗时**: 5.000秒

**请求数据**:
```json
{
  "user_prompt": "Create a simple calculator app",
  "project_type": "web"
}
```

**响应数据**:
```json
{
  "message": "Stream connection established (timed out waiting for data)"
}
```

---

#### RAG知识检索

- **接口**: `POST /api/rag/query`
- **耗时**: 141.910秒

**响应数据**:
```json
{
  "query": "What is machine learning",
  "results": []
}
```

---

#### RAG索引统计

- **接口**: `GET /api/rag/index/stats`
- **耗时**: 3.008秒

**响应数据**:
```json
{
  "message": "Please provide project_id parameter",
  "total_projects": 0
}
```

---

#### RAG增强查询

- **接口**: `POST /api/rag/query/enhanced`
- **耗时**: 0.285秒

**请求数据**:
```json
{
  "query": "How to implement authentication",
  "project_id": "test",
  "top_k": 5
}
```

**响应数据**:
```json
{
  "query": "How to implement authentication",
  "total_docs": 0,
  "sources": {},
  "context": [],
  "summary": null
}
```

---

#### Git初始化仓库

- **接口**: `POST /api/git/init`
- **耗时**: 0.212秒

**请求数据**:
```json
{
  "repo_path": "/app/test_repo",
  "initial_commit": true
}
```

**响应数据**:
```json
{
  "success": true,
  "repo_path": "/app/test_repo",
  "branch": "main",
  "remote_url": null
}
```

---

#### Git状态查询

- **接口**: `GET /api/git/status`
- **耗时**: 0.011秒

**响应数据**:
```json
{
  "detail": "/app"
}
```

---

#### Git提交

- **接口**: `POST /api/git/commit`
- **耗时**: 0.046秒

**请求数据**:
```json
{
  "repo_path": "/app/test_repo",
  "message": "Test commit",
  "files": [
    "test.txt"
  ]
}
```

**响应数据**:
```json
{
  "detail": "[Errno 2] No such file or directory: 'test.txt'"
}
```

- **期望**: 200
- **实际**: 500

---

#### Git推送

- **接口**: `POST /api/git/push`
- **耗时**: 0.079秒

**请求数据**:
```json
{
  "repo_path": "/app/test_repo",
  "remote": "origin",
  "branch": "main"
}
```

**响应数据**:
```json
{
  "detail": "Remote named 'origin' didn't exist"
}
```

- **期望**: 200
- **实际**: 500

---

#### Git拉取

- **接口**: `POST /api/git/pull`
- **耗时**: 0.067秒

**请求数据**:
```json
{
  "repo_path": "/app/test_repo",
  "remote": "origin",
  "branch": "main"
}
```

**响应数据**:
```json
{
  "detail": "Remote named 'origin' didn't exist"
}
```

- **期望**: 200
- **实际**: 500

---

#### Git提交日志

- **接口**: `GET /api/git/log`
- **耗时**: 0.054秒

**响应数据**:
```json
{
  "commits": []
}
```

---

#### Git差异对比

- **接口**: `GET /api/git/diff`
- **耗时**: 0.052秒

**响应数据**:
```json
{
  "diff": "",
  "commit1": null,
  "commit2": null,
  "message": "Empty repository, no commits yet"
}
```

---

#### Git分支列表

- **接口**: `GET /api/git/branches`
- **耗时**: 0.066秒

**响应数据**:
```json
{
  "current": "main",
  "local": [],
  "remote": []
}
```

---

#### Git创建分支

- **接口**: `POST /api/git/branch/create`
- **耗时**: 0.057秒

**请求数据**:
```json
{
  "repo_path": "/app/test_repo",
  "branch_name": "feature/test"
}
```

**响应数据**:
```json
{
  "detail": "Cannot create branch in empty repository. Please make at least one commit first."
}
```

- **期望**: 200
- **实际**: 500

---

#### Git切换分支

- **接口**: `POST /api/git/branch/checkout`
- **耗时**: 0.048秒

**请求数据**:
```json
{
  "repo_path": "/app/test_repo",
  "branch_name": "main"
}
```

**响应数据**:
```json
{
  "detail": "分支不存在: main"
}
```

- **期望**: 200
- **实际**: 500

---

#### Git合并分支

- **接口**: `POST /api/git/merge`
- **耗时**: 0.236秒

**请求数据**:
```json
{
  "repo_path": "/app/test_repo",
  "source_branch": "feature/test",
  "target_branch": "main"
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

#### Git解决冲突

- **接口**: `POST /api/git/resolve-conflicts`
- **耗时**: 0.011秒

**请求数据**:
```json
{
  "repo_path": "/app/test_repo",
  "file_path": "test.txt",
  "resolution": "ours"
}
```

**响应数据**:
```json
{
  "detail": "文件不存在: /app/test_repo/test.txt"
}
```

- **期望**: 200
- **实际**: 500

---

#### Git生成提交消息

- **接口**: `POST /api/git/generate-commit-message`
- **耗时**: 0.294秒

**请求数据**:
```json
{
  "repo_path": "/app/test_repo",
  "changes": [
    "Added new feature",
    "Fixed bug"
  ]
}
```

**响应数据**:
```json
{
  "message": "Update files"
}
```

---

#### 代码生成

- **接口**: `POST /api/code/generate`
- **耗时**: 0.011秒

**请求数据**:
```json
{
  "description": "Create a Python function to calculate Fibonacci sequence",
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

#### 代码审查

- **接口**: `POST /api/code/review`
- **耗时**: 0.010秒

**请求数据**:
```json
{
  "code": "def add(a, b):\n    return a + b",
  "language": "python"
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

#### 代码重构

- **接口**: `POST /api/code/refactor`
- **耗时**: 0.009秒

**请求数据**:
```json
{
  "code": "def calc(x, y, op):\n    if op == '+':\n        return x + y\n    elif op == '-':\n        return x - y",
  "language": "python",
  "goal": "Use dict dispatch instead of if-elif"
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

#### 代码解释

- **接口**: `POST /api/code/explain`
- **耗时**: 0.009秒

**请求数据**:
```json
{
  "code": "def fibonacci(n):\n    if n <= 1:\n        return n\n    return fibonacci(n-1) + fibonacci(n-2)",
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

#### 代码修复Bug

- **接口**: `POST /api/code/fix-bug`
- **耗时**: 0.008秒

**请求数据**:
```json
{
  "code": "def divide(a, b):\n    return a / b",
  "language": "python",
  "error": "ZeroDivisionError"
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

#### 生成测试代码

- **接口**: `POST /api/code/generate-tests`
- **耗时**: 0.009秒

**请求数据**:
```json
{
  "code": "def is_prime(n):\n    if n < 2:\n        return False\n    for i in range(2, int(n**0.5) + 1):\n        if n % i == 0:\n            return False\n    return True",
  "language": "python",
  "framework": "pytest"
}
```

**响应数据**:
```json
{
  "tests": null
}
```

---

#### 代码优化

- **接口**: `POST /api/code/optimize`
- **耗时**: 0.009秒

**请求数据**:
```json
{
  "code": "result = []\nfor i in range(100):\n    result.append(i * 2)",
  "language": "python",
  "focus": "performance"
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


### ❌ FAILED (1)

#### 流式聊天

- **接口**: `POST /api/chat/stream`
- **耗时**: 0.100秒
- **错误信息**: Failed to start stream

**请求数据**:
```json
{
  "message": "Explain what is REST API",
  "context": []
}
```

---

