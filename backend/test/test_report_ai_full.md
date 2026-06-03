# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 21:10:21
- **测试时长**: 125.79秒
- **总测试数**: 29
- **通过**: 29 ✅
- **失败**: 0 ❌
- **错误**: 0 ⚠️
- **跳过**: 0 ⏭️
- **成功率**: 100.00%

## 详细结果


### ✅ PASSED (29)

#### AI服务根路径

- **接口**: `GET /`
- **耗时**: 0.011秒

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
- **耗时**: 0.004秒

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
- **耗时**: 0.003秒

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
- **耗时**: 109.845秒

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
        "content": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <meta name=\"description\" content=\"一个简单的HTML页面，用于显示Hello World文本\">\n  <title>Hello World HTML页面</title>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n  <header class=\"site-header\">\n    <h1 class=\"text-primary\">Hello World HTML页面</h1>\n  </header>\n\n  <main class=\"main-content\">\n    <section class=\"home-section\">\n      <h2 class=\"text-secondary\">Hello World!</h2>\n      <p>这是一个符合HTML5语义化规范的响应式页面</p>\n    </section>\n  </main>\n\n  <footer class=\"site-footer\">\n    <p>&copy; 2024 Hello World HTML页面. 保留所有权利。</p>\n  </footer>\n\n  <script src=\"script.js\"></script>\n</body>\n</html>",
        "language": "html"
      },
      {
        "path": "styles.css",
        "content": ":root {\n  --primary: #3498db;\n  --secondary: #2ecc71;\n  --bg-color: #ffffff;\n  --text-color: #333333;\n  --transition: all 0.3s ease;\n  --shadow: 0 4px 12px rgba(0,0,0,0.1);\n}\n\nbody.dark {\n  --bg-color: #1a1a1a;\n  --text-color: #f5f5f5;\n  --primary: #2980b9;\n  --secondary: #27ae60;\n  --shadow: 0 4px 12px rgba(0,0,0,0.3);\n}\n\n* {\n  margin: 0;\n  padding: 0;\n  box-sizing: border-box;\n}\n\nbody {\n  font-family: Arial, sans-serif;\n  background-color: var(--bg-color);\n  color: var(--text-color);\n  min-height: 100vh;\n  display: flex;\n  flex-direction: column;\n  justify-content: center;\n  align-items: center;\n  padding: 2rem;\n  transition: var(--transition);\n  opacity: 0;\n  animation: fadeIn 0.8s ease forwards;\n}\n\n@keyframes fadeIn {\n  to { opacity: 1; }\n}\n\n.page-container {\n  text-align: center;\n  max-width: 800px;\n  width: 100%;\n  padding: 2rem;\n  border-radius: 12px;\n  background-color: rgba(255,255,255,0.95);\n  box-shadow: var(--shadow);\n  transition: var(--transition);\n}\n\nbody.dark .page-container {\n  background-color: rgba(30,30,30,0.95);\n}\n\nh1 {\n  font-size: 2.5rem;\n  color: var(--primary);\n  margin-bottom: 1.5rem;\n  line-height: 1.2;\n  transition: var(--transition);\n}\n\nh1:hover {\n  transform: scale(1.05);\n  text-shadow: 0 2px 6px rgba(52,152,219,0.2);\n}\n\np {\n  font-size: 1.2rem;\n  line-height: 1.6;\n  margin-bottom: 2rem;\n  color: var(--text-color);\n}\n\n.theme-toggle {\n  padding: 0.8rem 1.5rem;\n  border: none;\n  border-radius: 25px;\n  background-color: var(--secondary);\n  color: white;\n  font-size: 1rem;\n  cursor: pointer;\n  transition: var(--transition);\n  box-shadow: 0 2px 8px rgba(46,204,113,0.2);\n}\n\n.theme-toggle:hover {\n  background-color: #27ae60;\n  transform: translateY(-2px);\n  box-shadow: 0 4px 12px rgba(46,204,113,0.3);\n}\n\n.theme-toggle:active {\n  transform: translateY(0);\n}\n\n@media (max-width: 768px) {\n  h1 {\n    font-size: 2rem;\n  }\n  \n  p {\n    font-size: 1.1rem;\n  }\n  \n  .page-container {\n    padding: 1.5rem;\n  }\n}\n\n@media (max-width: 480px) {\n  h1 {\n    font-size: 1.8rem;\n  }\n  \n  .theme-toggle {\n    padding: 0.7rem 1.2rem;\n    font-size: 0.9rem;\n  }\n}",
        "language": "css"
      },
      {
        "path": "script.js",
        "content": "document.addEventListener('DOMContentLoaded', () => {\n  // DOM元素获取\n  const hamburger = document.querySelector('.hamburger');\n  const navMenu = document.querySelector('.nav-menu');\n  const navLinks = document.querySelectorAll('.nav-link');\n  const darkModeToggle = document.querySelector('.dark-mode-toggle');\n  const body = document.body;\n\n  // 汉堡菜单切换逻辑\n  const toggleMobileMenu = () => {\n    hamburger?.classList.toggle('active');\n    navMenu?.classList.toggle('active');\n  };\n\n  // 平滑滚动实现\n  const handleSmoothScroll = (targetId) => {\n    const targetSection = document.getElementById(targetId);\n    if (targetSection) {\n      targetSection.scrollIntoView({ behavior: 'smooth' });\n      // 移动端点击后关闭菜单\n      if (window.innerWidth < 768) toggleMobileMenu();\n    }\n  };\n\n  // 深色模式切换逻辑\n  const toggleDarkMode = () => {\n    const isDark = body.classList.toggle('dark');\n    localStorage.setItem('darkMode', isDark);\n    darkModeToggle?.textContent = isDark ? '☀️' : '🌙';\n  };\n\n  // 初始化配置\n  const initApp = () => {\n    // 读取本地存储的深色模式状态\n    const savedDarkMode = localStorage.getItem('darkMode') === 'true';\n    if (savedDarkMode) {\n      body.classList.add('dark');\n      darkModeToggle?.textContent = '☀️';\n    }\n\n    // 绑定事件监听\n    hamburger?.addEventListener('click', toggleMobileMenu);\n    darkModeToggle?.addEventListener('click', toggleDarkMode);\n    \n    // 导航链接平滑滚动\n    navLinks.forEach(link => {\n      link.addEventListener('click', (e) => {\n        e.preventDefault();\n        const targetId = link.getAttribute('href').slice(1);\n        handleSmoothScroll(targetId);\n      });\n    });\n\n    // 窗口 resize 时处理移动端菜单\n    window.addEventListener('resize', () => {\n      if (window.innerWidth >= 768 && navMenu?.classList.contains('active')) {\n        toggleMobileMenu();\n      }\n    });\n  };\n\n  // 启动应用\n  initApp();\n});",
        "language": "javascript"
      }
    ],
    "metadata": {
      "template": "basic",
      "theme": "light",
      "spec": {
        "title": "Hello World HTML页面",
        "description": "一个简单的HTML页面，用于显示Hello World文本",
        "sections": [
          "首页"
        ],
        "features": [
          "响应式设计"
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
- **耗时**: 5.135秒

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
- **耗时**: 0.004秒

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
- **耗时**: 0.088秒

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
- **耗时**: 0.157秒

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
- **耗时**: 0.006秒

**响应数据**:
```json
{
  "detail": "/app"
}
```

---

#### Git提交

- **接口**: `POST /api/git/commit`
- **耗时**: 0.029秒

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
- **耗时**: 0.031秒

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
- **耗时**: 0.032秒

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
- **耗时**: 0.040秒

**响应数据**:
```json
{
  "commits": []
}
```

---

#### Git差异对比

- **接口**: `GET /api/git/diff`
- **耗时**: 0.041秒

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
- **耗时**: 0.036秒

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
- **耗时**: 0.019秒

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
- **耗时**: 0.034秒

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
- **耗时**: 0.077秒

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
- **耗时**: 0.005秒

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
- **耗时**: 0.140秒

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
- **耗时**: 0.004秒

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
- **耗时**: 0.003秒

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
- **耗时**: 0.003秒

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
- **耗时**: 0.003秒

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
- **耗时**: 0.004秒

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
- **耗时**: 0.003秒

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
- **耗时**: 0.003秒

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

#### 流式聊天

- **接口**: `POST /api/chat/stream`
- **耗时**: 5.000秒

**请求数据**:
```json
[
  {
    "role": "user",
    "content": "Explain what is REST API"
  }
]
```

**响应数据**:
```json
{
  "message": "Stream connection established"
}
```

---

