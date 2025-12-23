/**
 * Web开发引擎
 * 负责HTML/CSS/JavaScript的生成
 * 支持5种模板: 博客、作品集、企业站、产品页、单页应用
 */

const fs = require('fs').promises;
const path = require('path');
const PreviewServer = require('./preview-server');

class WebEngine {
  constructor() {
    // 预览服务器
    this.previewServer = new PreviewServer();

    // 模板定义
    this.templates = {
      blog: {
        name: '博客',
        description: '适合个人博客、文章发布',
        files: ['index.html', 'css/style.css', 'js/script.js'],
      },
      portfolio: {
        name: '作品集',
        description: '展示个人作品和项目',
        files: ['index.html', 'css/style.css', 'js/script.js'],
      },
      corporate: {
        name: '企业站',
        description: '企业官网、公司介绍',
        files: ['index.html', 'css/style.css', 'js/script.js'],
      },
      product: {
        name: '产品页',
        description: '产品介绍、功能展示',
        files: ['index.html', 'css/style.css', 'js/script.js'],
      },
      spa: {
        name: '单页应用',
        description: '单页面应用程序',
        files: ['index.html', 'css/style.css', 'js/app.js'],
      },
    };
  }

  /**
   * 生成Web项目
   * @param {Object} options - 配置选项
   * @returns {Promise<Object>} 生成结果
   */
  async generateProject(options = {}) {
    const {
      template = 'product',
      title = '我的网站',
      description = '欢迎访问我的网站',
      primaryColor = '#667eea',
      secondaryColor = '#764ba2',
      projectPath,
      content = {},
    } = options;

    if (!projectPath) {
      throw new Error('未指定项目路径');
    }

    console.log(`[Web Engine] 生成${this.templates[template]?.name || template}项目...`);

    try {
      // 创建项目目录结构
      await this.createProjectStructure(projectPath);

      // 生成HTML文件
      const html = this.generateHTML(template, {
        title,
        description,
        content,
      });

      await fs.writeFile(
        path.join(projectPath, 'index.html'),
        html,
        'utf-8'
      );

      // 生成CSS文件
      const css = this.generateCSS(template, {
        primaryColor,
        secondaryColor,
      });

      await fs.writeFile(
        path.join(projectPath, 'css', 'style.css'),
        css,
        'utf-8'
      );

      // 生成JavaScript文件
      const js = this.generateJavaScript(template);

      await fs.writeFile(
        path.join(projectPath, 'js', 'script.js'),
        js,
        'utf-8'
      );

      // 生成README
      const readme = this.generateReadme(title, description, template);

      await fs.writeFile(
        path.join(projectPath, 'README.md'),
        readme,
        'utf-8'
      );

      console.log(`[Web Engine] 项目生成成功: ${projectPath}`);

      return {
        success: true,
        projectPath,
        template,
        files: [
          'index.html',
          'css/style.css',
          'js/script.js',
          'README.md',
        ],
      };
    } catch (error) {
      console.error('[Web Engine] 生成项目失败:', error);
      throw new Error(`生成Web项目失败: ${error.message}`);
    }
  }

  /**
   * 创建项目目录结构
   * @private
   */
  async createProjectStructure(projectPath) {
    const directories = [
      'css',
      'js',
      'assets',
      'assets/images',
    ];

    for (const dir of directories) {
      const dirPath = path.join(projectPath, dir);
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * 生成HTML内容
   * @private
   */
  generateHTML(template, options) {
    const { title, description, content } = options;

    switch (template) {
      case 'blog':
        return this.generateBlogHTML(title, description, content);
      case 'portfolio':
        return this.generatePortfolioHTML(title, description, content);
      case 'corporate':
        return this.generateCorporateHTML(title, description, content);
      case 'product':
        return this.generateProductHTML(title, description, content);
      case 'spa':
        return this.generateSPAHTML(title, description, content);
      default:
        return this.generateBasicHTML(title, description);
    }
  }

  /**
   * 生成博客HTML
   * @private
   */
  generateBlogHTML(title, description, content) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${description}">
  <title>${title}</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="blog-header">
    <div class="container">
      <h1>${title}</h1>
      <p class="tagline">${description}</p>
    </div>
  </header>

  <nav class="main-nav">
    <div class="container">
      <ul>
        <li><a href="#home">首页</a></li>
        <li><a href="#articles">文章</a></li>
        <li><a href="#about">关于</a></li>
        <li><a href="#contact">联系</a></li>
      </ul>
    </div>
  </nav>

  <main class="container">
    <section class="articles">
      <article class="post">
        <h2>欢迎来到我的博客</h2>
        <p class="post-meta">发布于 2024年12月23日</p>
        <div class="post-content">
          <p>${content.firstPost || '这是我的第一篇博客文章。'}</p>
        </div>
      </article>
    </section>

    <aside class="sidebar">
      <div class="widget">
        <h3>最新文章</h3>
        <ul>
          <li><a href="#">文章标题1</a></li>
          <li><a href="#">文章标题2</a></li>
          <li><a href="#">文章标题3</a></li>
        </ul>
      </div>
    </aside>
  </main>

  <footer class="blog-footer">
    <div class="container">
      <p>&copy; 2024 ${title}. 保留所有权利。</p>
    </div>
  </footer>

  <script src="js/script.js"></script>
</body>
</html>`;
  }

  /**
   * 生成作品集HTML
   * @private
   */
  generatePortfolioHTML(title, description, content) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${description}">
  <title>${title}</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="portfolio-header">
    <div class="container">
      <h1>${title}</h1>
      <p class="subtitle">${description}</p>
    </div>
  </header>

  <section class="hero">
    <div class="container">
      <h2>我的作品集</h2>
      <p>展示我的创意和技能</p>
    </div>
  </section>

  <main class="container">
    <section class="projects">
      <div class="project-grid">
        <div class="project-card">
          <div class="project-image">
            <img src="assets/images/placeholder.jpg" alt="项目1">
          </div>
          <h3>项目标题1</h3>
          <p>项目描述...</p>
        </div>

        <div class="project-card">
          <div class="project-image">
            <img src="assets/images/placeholder.jpg" alt="项目2">
          </div>
          <h3>项目标题2</h3>
          <p>项目描述...</p>
        </div>

        <div class="project-card">
          <div class="project-image">
            <img src="assets/images/placeholder.jpg" alt="项目3">
          </div>
          <h3>项目标题3</h3>
          <p>项目描述...</p>
        </div>
      </div>
    </section>
  </main>

  <footer>
    <div class="container">
      <p>&copy; 2024 ${title}. All rights reserved.</p>
    </div>
  </footer>

  <script src="js/script.js"></script>
</body>
</html>`;
  }

  /**
   * 生成企业站HTML
   * @private
   */
  generateCorporateHTML(title, description, content) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${description}">
  <title>${title}</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <nav class="navbar">
    <div class="container">
      <div class="brand">${title}</div>
      <ul class="nav-links">
        <li><a href="#home">首页</a></li>
        <li><a href="#services">服务</a></li>
        <li><a href="#about">关于我们</a></li>
        <li><a href="#contact">联系我们</a></li>
      </ul>
    </div>
  </nav>

  <section class="hero-section">
    <div class="container">
      <h1>${title}</h1>
      <p>${description}</p>
      <button class="cta-button">了解更多</button>
    </div>
  </section>

  <section class="services">
    <div class="container">
      <h2>我们的服务</h2>
      <div class="service-grid">
        <div class="service-item">
          <h3>服务1</h3>
          <p>服务描述...</p>
        </div>
        <div class="service-item">
          <h3>服务2</h3>
          <p>服务描述...</p>
        </div>
        <div class="service-item">
          <h3>服务3</h3>
          <p>服务描述...</p>
        </div>
      </div>
    </div>
  </section>

  <footer class="corporate-footer">
    <div class="container">
      <p>&copy; 2024 ${title}. 保留所有权利。</p>
    </div>
  </footer>

  <script src="js/script.js"></script>
</body>
</html>`;
  }

  /**
   * 生成产品页HTML
   * @private
   */
  generateProductHTML(title, description, content) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${description}">
  <title>${title}</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="product-header">
    <nav class="navbar">
      <div class="container">
        <div class="logo">${title}</div>
        <button class="buy-button">立即购买</button>
      </div>
    </nav>
  </header>

  <section class="hero">
    <div class="container">
      <div class="hero-content">
        <h1>${title}</h1>
        <p class="hero-description">${description}</p>
        <button class="cta-button">了解详情</button>
      </div>
      <div class="hero-image">
        <img src="assets/images/product.jpg" alt="${title}">
      </div>
    </div>
  </section>

  <section class="features">
    <div class="container">
      <h2>产品特性</h2>
      <div class="feature-grid">
        <div class="feature-item">
          <h3>特性1</h3>
          <p>特性描述...</p>
        </div>
        <div class="feature-item">
          <h3>特性2</h3>
          <p>特性描述...</p>
        </div>
        <div class="feature-item">
          <h3>特性3</h3>
          <p>特性描述...</p>
        </div>
      </div>
    </div>
  </section>

  <section class="pricing">
    <div class="container">
      <h2>价格方案</h2>
      <div class="pricing-cards">
        <div class="pricing-card">
          <h3>基础版</h3>
          <p class="price">¥99/月</p>
          <ul>
            <li>功能1</li>
            <li>功能2</li>
            <li>功能3</li>
          </ul>
          <button>选择计划</button>
        </div>

        <div class="pricing-card featured">
          <h3>专业版</h3>
          <p class="price">¥199/月</p>
          <ul>
            <li>所有基础版功能</li>
            <li>功能4</li>
            <li>功能5</li>
          </ul>
          <button>选择计划</button>
        </div>

        <div class="pricing-card">
          <h3>企业版</h3>
          <p class="price">¥499/月</p>
          <ul>
            <li>所有专业版功能</li>
            <li>功能6</li>
            <li>专属支持</li>
          </ul>
          <button>选择计划</button>
        </div>
      </div>
    </div>
  </section>

  <footer>
    <div class="container">
      <p>&copy; 2024 ${title}. All rights reserved.</p>
    </div>
  </footer>

  <script src="js/script.js"></script>
</body>
</html>`;
  }

  /**
   * 生成单页应用HTML
   * @private
   */
  generateSPAHTML(title, description, content) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${description}">
  <title>${title}</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <div id="app">
    <div class="loading">加载中...</div>
  </div>

  <script src="js/app.js"></script>
</body>
</html>`;
  }

  /**
   * 生成基础HTML
   * @private
   */
  generateBasicHTML(title, description) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${description}">
  <title>${title}</title>
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header>
    <h1>${title}</h1>
  </header>

  <main>
    <p>${description}</p>
  </main>

  <footer>
    <p>&copy; 2024 ${title}. All rights reserved.</p>
  </footer>

  <script src="js/script.js"></script>
</body>
</html>`;
  }

  /**
   * 生成CSS内容
   * @private
   */
  generateCSS(template, options) {
    const { primaryColor, secondaryColor } = options;

    return `/* ${template} 样式 */

/* 重置和基础样式 */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  font-size: 16px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Helvetica Neue', sans-serif;
  line-height: 1.6;
  color: #333;
  background: #f8f9fa;
}

.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 20px;
}

/* 导航栏 */
.navbar {
  background: white;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  padding: 1rem 0;
}

.navbar .container {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.brand, .logo {
  font-size: 1.5rem;
  font-weight: 700;
  color: ${primaryColor};
}

.nav-links {
  display: flex;
  list-style: none;
  gap: 2rem;
}

.nav-links a {
  text-decoration: none;
  color: #333;
  font-weight: 500;
  transition: color 0.3s;
}

.nav-links a:hover {
  color: ${primaryColor};
}

/* Hero区域 */
.hero, .hero-section {
  background: linear-gradient(135deg, ${primaryColor}, ${secondaryColor});
  color: white;
  padding: 4rem 0;
  text-align: center;
}

.hero h1, .hero-section h1 {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.hero p, .hero-section p {
  font-size: 1.25rem;
  margin-bottom: 2rem;
}

/* 按钮 */
button, .cta-button, .buy-button {
  background: white;
  color: ${primaryColor};
  border: none;
  padding: 12px 30px;
  font-size: 1rem;
  font-weight: 600;
  border-radius: 50px;
  cursor: pointer;
  transition: all 0.3s;
}

button:hover, .cta-button:hover, .buy-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

/* 卡片网格 */
.project-grid, .service-grid, .feature-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 2rem;
  margin-top: 2rem;
}

.project-card, .service-item, .feature-item {
  background: white;
  padding: 2rem;
  border-radius: 10px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s;
}

.project-card:hover, .service-item:hover, .feature-item:hover {
  transform: translateY(-5px);
}

/* 价格卡片 */
.pricing-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 2rem;
  margin-top: 2rem;
}

.pricing-card {
  background: white;
  padding: 2rem;
  border-radius: 10px;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
  text-align: center;
}

.pricing-card.featured {
  border: 3px solid ${primaryColor};
  transform: scale(1.05);
}

.price {
  font-size: 2rem;
  font-weight: 700;
  color: ${primaryColor};
  margin: 1rem 0;
}

/* 页脚 */
footer, .blog-footer, .corporate-footer {
  background: #333;
  color: white;
  text-align: center;
  padding: 2rem 0;
  margin-top: 4rem;
}

/* 响应式 */
@media (max-width: 768px) {
  .hero h1, .hero-section h1 {
    font-size: 2rem;
  }

  .nav-links {
    flex-direction: column;
    gap: 1rem;
  }
}`;
  }

  /**
   * 生成JavaScript内容
   * @private
   */
  generateJavaScript(template) {
    return `// ${template} 脚本

// 页面加载完成事件
document.addEventListener('DOMContentLoaded', function() {
  console.log('页面加载完成');

  // 初始化功能
  initializeApp();
});

// 初始化应用
function initializeApp() {
  // 平滑滚动
  setupSmoothScroll();

  // 添加动画效果
  addScrollAnimations();

  console.log('应用初始化完成');
}

// 平滑滚动
function setupSmoothScroll() {
  const links = document.querySelectorAll('a[href^="#"]');

  links.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();

      const targetId = this.getAttribute('href').slice(1);
      const targetElement = document.getElementById(targetId);

      if (targetElement) {
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
}

// 滚动动画
function addScrollAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  // 观察所有卡片元素
  const cards = document.querySelectorAll('.project-card, .service-item, .feature-item, .pricing-card');

  cards.forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    observer.observe(card);
  });
}`;
  }

  /**
   * 生成README
   * @private
   */
  generateReadme(title, description, template) {
    return `# ${title}

${description}

## 项目信息

- **模板类型**: ${this.templates[template]?.name || template}
- **创建时间**: ${new Date().toLocaleString('zh-CN')}
- **生成工具**: ChainlessChain Web Engine

## 项目结构

\`\`\`
├── index.html          # 主页面
├── css/
│   └── style.css      # 样式文件
├── js/
│   └── script.js      # 脚本文件
├── assets/
│   └── images/        # 图片资源
└── README.md          # 项目说明
\`\`\`

## 本地预览

直接用浏览器打开 \`index.html\` 文件即可预览。

或者使用本地服务器：

\`\`\`bash
# 使用Python
python -m http.server 3000

# 使用Node.js
npx http-server -p 3000
\`\`\`

然后访问 http://localhost:3000

## 自定义修改

- 修改 \`index.html\` 更新页面内容
- 修改 \`css/style.css\` 调整样式
- 修改 \`js/script.js\` 添加交互功能

## 许可证

MIT License
`;
  }

  /**
   * 获取所有模板
   * @returns {Object} 模板列表
   */
  getTemplates() {
    return this.templates;
  }

  /**
   * 启动预览服务器
   * @param {string} projectPath - 项目路径
   * @param {number} port - 端口号
   * @returns {Promise<Object>}
   */
  async startPreview(projectPath, port = 3000) {
    return await this.previewServer.start(projectPath, port);
  }

  /**
   * 停止预览服务器
   * @returns {Promise<Object>}
   */
  async stopPreview() {
    return await this.previewServer.stop();
  }

  /**
   * 重启预览服务器
   * @param {string} projectPath - 项目路径(可选)
   * @returns {Promise<Object>}
   */
  async restartPreview(projectPath = null) {
    return await this.previewServer.restart(projectPath);
  }

  /**
   * 获取预览服务器状态
   * @returns {Object}
   */
  getPreviewStatus() {
    return this.previewServer.getStatus();
  }

  /**
   * 更改预览端口
   * @param {number} newPort - 新端口号
   * @returns {Promise<Object>}
   */
  async changePreviewPort(newPort) {
    return await this.previewServer.changePort(newPort);
  }
}

module.exports = WebEngine;
