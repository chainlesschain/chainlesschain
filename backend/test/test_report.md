# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 17:28:03
- **测试时长**: 82.78秒
- **总测试数**: 8
- **通过**: 8 ✅
- **失败**: 0 ❌
- **错误**: 0 ⚠️
- **跳过**: 0 ⏭️
- **成功率**: 100.00%

## 详细结果


### ✅ PASSED (8)

#### AI服务根路径

- **接口**: `GET /`
- **耗时**: 0.039秒

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
- **耗时**: 0.008秒

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
- **耗时**: 0.010秒

**请求数据**:
```json
{
  "text": "创建一个待办事项网页应用",
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
- **耗时**: 82.327秒

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
        "content": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>Hello World 简单页面</title>\n    <meta name=\"description\" content=\"一个极简HTML页面，核心功能为显示Hello World文本，结构清晰简洁\">\n    <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n    <header class=\"site-header\">\n        <h1>Hello World 简单页面</h1>\n    </header>\n\n    <main class=\"site-main\">\n        <section id=\"home\" class=\"section-home\">\n            <h2>首页</h2>\n            <div class=\"hello-container\">\n                <p class=\"hello-text\">Hello World!</p>\n            </div>\n            <h3>核心特性</h3>\n            <ul class=\"features\">\n                <li>基础HTML文本显示</li>\n                <li>简洁页面结构</li>\n            </ul>\n        </section>\n    </main>\n\n    <footer class=\"site-footer\">\n        <p>© 2024 Hello World 简单页面</p>\n    </footer>\n\n    <script src=\"script.js\"></script>\n</body>\n</html>",
        "language": "html"
      },
      {
        "path": "styles.css",
        "content": ":root {\n  --primary: #2c3e50;\n  --secondary: #ecf0f1;\n  --text: #333;\n  --bg: #fff;\n  --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);\n}\n\nbody.dark {\n  --primary: #34495e;\n  --secondary: #2c3e50;\n  --text: #ecf0f1;\n  --bg: #1a1a1a;\n}\n\n* {\n  margin: 0;\n  padding: 0;\n  box-sizing: border-box;\n}\n\nbody {\n  min-height: 100vh;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  background-color: var(--bg);\n  color: var(--text);\n  font-family: Arial, sans-serif;\n  transition: var(--transition);\n  padding: 1rem;\n}\n\n.hero-container {\n  position: relative;\n  text-align: center;\n}\n\n.hero {\n  display: inline-block;\n  padding: 2.5rem 5rem;\n  border-radius: 16px;\n  background-color: var(--secondary);\n  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.08);\n  transition: var(--transition);\n}\n\n.hero:hover {\n  transform: translateY(-6px);\n  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);\n}\n\nh1 {\n  font-size: clamp(2.5rem, 10vw, 6rem);\n  color: var(--primary);\n  line-height: 1.2;\n  transition: var(--transition);\n}\n\n.theme-toggle {\n  position: absolute;\n  top: -3rem;\n  right: 0;\n  background: none;\n  border: none;\n  color: var(--text);\n  font-size: 1.5rem;\n  cursor: pointer;\n  padding: 0.5rem;\n  border-radius: 50%;\n  transition: var(--transition);\n}\n\n.theme-toggle:hover {\n  background-color: var(--secondary);\n  transform: scale(1.1);\n}\n\n@media (max-width: 768px) {\n  .hero {\n    padding: 1.5rem 3rem;\n  }\n\n  h1 {\n    font-size: clamp(1.8rem, 8vw, 4rem);\n  }\n\n  .theme-toggle {\n    top: -2rem;\n    font-size: 1.2rem;\n  }\n}\n\n@media (prefers-color-scheme: dark) {\n  body:not(.light) {\n    --primary: #34495e;\n    --secondary: #2c3e50;\n    --text: #ecf0f1;\n    --bg: #1a1a1a;\n  }\n}",
        "language": "css"
      },
      {
        "path": "script.js",
        "content": "document.addEventListener('DOMContentLoaded', () => {\n  // 平滑滚动\n  const initSmoothScroll = () => {\n    document.querySelectorAll('a[href^=\"#\"]').forEach(link => {\n      link.addEventListener('click', (e) => {\n        e.preventDefault();\n        const target = document.querySelector(link.getAttribute('href'));\n        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });\n      });\n    });\n  };\n\n  // 响应式导航\n  const initResponsiveNav = () => {\n    const hamburger = document.querySelector('.hamburger');\n    const navLinks = document.querySelector('.nav-links');\n    \n    if (!hamburger || !navLinks) return;\n\n    hamburger.addEventListener('click', () => {\n      navLinks.classList.toggle('active');\n      hamburger.classList.toggle('active');\n    });\n\n    navLinks.querySelectorAll('a').forEach(item => {\n      item.addEventListener('click', () => {\n        navLinks.classList.remove('active');\n        hamburger.classList.remove('active');\n      });\n    });\n  };\n\n  // 深色模式切换\n  const initDarkMode = () => {\n    const toggleBtn = document.querySelector('.dark-mode-toggle');\n    if (!toggleBtn) return;\n\n    // 恢复用户偏好\n    if (localStorage.getItem('darkMode') === 'true') {\n      document.body.classList.add('dark');\n      toggleBtn.textContent = '☀️ 浅色模式';\n    }\n\n    toggleBtn.addEventListener('click', () => {\n      const isDark = document.body.classList.toggle('dark');\n      localStorage.setItem('darkMode', isDark);\n      toggleBtn.textContent = isDark ? '☀️ 浅色模式' : '🌙 深色模式';\n    });\n  };\n\n  // 初始化所有功能\n  initSmoothScroll();\n  initResponsiveNav();\n  initDarkMode();\n});",
        "language": "javascript"
      }
    ],
    "metadata": {
      "template": "basic",
      "theme": "light",
      "spec": {
        "title": "Hello World 简单页面",
        "description": "一个极简HTML页面，核心功能为显示Hello World文本，结构清晰简洁",
        "sections": [
          "首页"
        ],
        "features": [
          "基础HTML文本显示",
          "简洁页面结构"
        ],
        "color_scheme": {
          "primary": "#2c3e50",
          "secondary": "#ecf0f1"
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

#### RAG知识检索

- **接口**: `POST /api/rag/query`
- **耗时**: 0.324秒

**响应数据**:
```json
{
  "query": "什么是机器学习",
  "results": []
}
```

---

#### Git状态查询

- **接口**: `GET /api/git/status`
- **耗时**: 0.014秒

**响应数据**:
```json
{
  "detail": "/app"
}
```

---

#### 代码生成

- **接口**: `POST /api/code/generate`
- **耗时**: 0.037秒

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

#### 代码解释

- **接口**: `POST /api/code/explain`
- **耗时**: 0.017秒

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

