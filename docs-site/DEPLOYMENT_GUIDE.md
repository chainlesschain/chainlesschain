# 文档网站部署指南

**版本**: v0.27.0
**更新日期**: 2026-11-05

当前三个正式站点使用同一已提交源码的快照流程：用户文档 `docs-site`、设计文档 `docs-site-design`、官网 `docs-website-v2`。
先同步设计权威源、核对公开版本与候选状态并提交，再运行 `docs-snapshot-build.yml` 生成三个锁定依赖构建，校验归档 SHA-256 和完整页面数量。
下载并核对该提交的三个归档后，从仓库根执行 `powershell -NoProfile -File scripts/deploy-docs-snapshot.ps1`，使用已配置的 SSH 身份部署到现有站点。
部署包含服务器互斥锁、独立暂存目录、旧站备份和失败回滚；完成后检查三站新页面及 `/deployment-source.json`。以下其他托管选项保留作通用参考。

---

## 📋 目录

- [快速开始](#快速开始)
- [本地开发](#本地开发)
- [生产构建](#生产构建)
- [部署选项](#部署选项)
  - [1. GitHub Pages](#1-github-pages)
  - [2. Vercel](#2-vercel)
  - [3. Netlify](#3-netlify)
  - [4. 自建服务器](#4-自建服务器)
- [域名配置](#域名配置)
- [故障排查](#故障排查)

---

## 🚀 快速开始

### 前置要求

- Node.js 22.12.0+
- npm 或 yarn
- Git

### 验证环境

```bash
node --version    # 应该 >= 22.12.0
npm --version     # 应该 >= 10.0.0
```

---

## 💻 本地开发

### 1. 安装依赖

```bash
cd docs-site
npm install
```

### 2. 启动开发服务器

```bash
npm run dev
```

访问: http://localhost:5173

**开发服务器特性**:

- ✅ 热重载 (修改文件自动刷新)
- ✅ 快速启动 (Vite 驱动)
- ✅ 实时预览

### 3. 验证更新

运行验证脚本:

```bash
# Windows
quick-verify.bat

# Linux/macOS
chmod +x quick-verify.sh
./quick-verify.sh
```

---

## 🏗️ 生产构建

### 1. 构建静态文件

```bash
npm run build
```

**输出**:

- 目录: `docs/.vitepress/dist/`
- 内容: 静态 HTML/CSS/JS 文件
- 大小: 约 5-10MB

### 2. 预览构建结果

```bash
npm run preview
```

访问: http://localhost:4173

### 3. 验证构建产物

检查关键文件:

```bash
# Windows
dir docs\.vitepress\dist

# Linux/macOS
ls -lh docs/.vitepress/dist
```

应该包含:

```
dist/
├── assets/          # CSS/JS 资源
├── chainlesschain/  # 文档页面
├── guide/
├── api/
├── index.html       # 首页
└── ...
```

---

## 🌐 部署选项

### 1. GitHub Pages

**优势**: 免费、简单、与 Git 集成

#### 方法 A: 手动部署

```bash
# 1. 构建
npm run build

# 2. 进入构建目录
cd docs/.vitepress/dist

# 3. 初始化 Git（如果是新目录）
git init
git add -A
git commit -m 'deploy'

# 4. 推送到 gh-pages 分支
git push -f git@github.com:chainlesschain/chainlesschain.git main:gh-pages

cd -
```

#### 方法 B: 自动部署 (GitHub Actions)

创建 `.github/workflows/deploy-docs.yml`:

```yaml
name: Deploy Docs

on:
  push:
    branches:
      - main
    paths:
      - "docs-site/**"

permissions:
  contents: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: npm
          cache-dependency-path: docs-site/package-lock.json

      - name: Install dependencies
        run: |
          cd docs-site
          npm ci

      - name: Build
        run: |
          cd docs-site
          npm run build

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: docs-site/docs/.vitepress/dist
          cname: docs.chainlesschain.com # 可选：自定义域名
```

#### 配置 GitHub Pages

1. 进入仓库 **Settings** → **Pages**
2. **Source**: 选择 `gh-pages` 分支
3. **Folder**: `/root`
4. 保存

访问: https://chainlesschain.github.io/chainlesschain/

---

### 2. Vercel

**优势**: 零配置、自动部署、CDN 加速、免费 SSL

#### 部署步骤

1. **登录 Vercel**
   - 访问 https://vercel.com
   - 使用 GitHub 账号登录

2. **导入项目**
   - 点击 "New Project"
   - 选择 `chainlesschain` 仓库
   - 点击 "Import"

3. **配置构建**

   ```bash
   # Framework Preset
   Other

   # Root Directory
   docs-site

   # Build Command
   npm run build

   # Output Directory
   docs/.vitepress/dist
   ```

4. **部署**
   - 点击 "Deploy"
   - 等待构建完成

访问: https://chainlesschain.vercel.app

#### 自定义域名

1. 进入项目 **Settings** → **Domains**
2. 添加域名: `docs.chainlesschain.com`
3. 配置 DNS (见下文)

---

### 3. Netlify

**优势**: 免费、CI/CD 集成、预览部署

#### 部署步骤

1. **登录 Netlify**
   - 访问 https://netlify.com
   - 使用 GitHub 账号登录

2. **创建新站点**
   - 点击 "Add new site" → "Import an existing project"
   - 选择 GitHub
   - 选择 `chainlesschain` 仓库

3. **配置构建**

   ```bash
   # Base directory
   docs-site

   # Build command
   npm run build

   # Publish directory
   docs-site/docs/.vitepress/dist
   ```

4. **部署**
   - 点击 "Deploy site"

访问: https://chainlesschain.netlify.app

#### 配置文件

创建 `docs-site/netlify.toml`:

```toml
[build]
  base = "docs-site"
  command = "npm run build"
  publish = "docs/.vitepress/dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

### 4. 自建服务器

**适用场景**: 私有部署、完全控制

#### 方法 A: Nginx

**1. 构建文件**

```bash
npm run build
```

**2. 复制到服务器**

```bash
# 压缩
cd docs/.vitepress
tar -czf dist.tar.gz dist/

# 上传
scp dist.tar.gz user@your-server:/var/www/
```

**3. 配置 Nginx**

```nginx
# /etc/nginx/sites-available/docs.chainlesschain.com

server {
    listen 80;
    server_name docs.chainlesschain.com;

    root /var/www/dist;
    index index.html;

    # 处理 SPA 路由
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 缓存静态资源
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

**4. 启用站点**

```bash
# 解压文件
cd /var/www
tar -xzf dist.tar.gz

# 软链接
sudo ln -s /etc/nginx/sites-available/docs.chainlesschain.com /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

**5. 配置 SSL (Let's Encrypt)**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d docs.chainlesschain.com
```

#### 方法 B: Docker

**创建 Dockerfile**:

```dockerfile
# docs-site/Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/docs/.vitepress/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**创建 nginx.conf**:

```nginx
# docs-site/nginx.conf
server {
    listen 80;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
}
```

**构建和运行**:

```bash
# 构建镜像
cd docs-site
docker build -t chainlesschain-docs:v0.27.0 .

# 运行容器
docker run -d -p 8080:80 --name docs chainlesschain-docs:v0.27.0

# 访问
# http://localhost:8080
```

**Docker Compose**:

```yaml
# docs-site/docker-compose.yml
version: "3.8"

services:
  docs:
    build: .
    ports:
      - "8080:80"
    restart: unless-stopped
    environment:
      - NODE_ENV=production
```

运行:

```bash
docker-compose up -d
```

---

## 🌍 域名配置

### DNS 设置

#### GitHub Pages

```dns
# A 记录
docs.chainlesschain.com   A   185.199.108.153
docs.chainlesschain.com   A   185.199.109.153
docs.chainlesschain.com   A   185.199.110.153
docs.chainlesschain.com   A   185.199.111.153

# 或 CNAME
docs.chainlesschain.com   CNAME   chainlesschain.github.io
```

#### Vercel

```dns
docs.chainlesschain.com   CNAME   cname.vercel-dns.com
```

#### Netlify

```dns
docs.chainlesschain.com   CNAME   chainlesschain.netlify.app
```

#### 自建服务器

```dns
docs.chainlesschain.com   A   你的服务器IP
```

### VitePress 配置

更新 `docs/.vitepress/config.js`:

```javascript
export default defineConfig({
  title: "ChainlessChain 文档",
  base: "/", // 根路径部署
  // base: '/chainlesschain/',  // 子路径部署（GitHub Pages）
});
```

---

## 🔍 故障排查

### 问题 1: 页面 404

**原因**: SPA 路由配置问题

**解决**:

- GitHub Pages: 创建 `docs/.vitepress/dist/404.html` 复制 `index.html`
- Nginx: 配置 `try_files $uri $uri/ /index.html`
- Vercel/Netlify: 会自动处理

### 问题 2: 资源加载失败

**原因**: `base` 路径配置错误

**解决**:

```javascript
// 根路径部署
base: "/";

// 子路径部署
base: "/docs/";
```

### 问题 3: 构建失败

**检查**:

```bash
# 清除缓存
rm -rf node_modules package-lock.json
npm install

# 清除构建缓存
rm -rf docs/.vitepress/cache docs/.vitepress/dist
npm run build
```

### 问题 4: 样式丢失

**原因**: CSS 路径问题

**解决**:

```bash
# 检查构建输出
npm run build
ls -lh docs/.vitepress/dist/assets/

# 确保包含 .css 文件
```

### 问题 5: 搜索功能不工作

**原因**: 本地搜索索引未生成

**解决**:

```javascript
// config.js
export default defineConfig({
  themeConfig: {
    search: {
      provider: "local",
    },
  },
});
```

---

## 📊 性能优化

### 1. 构建优化

```javascript
// config.js
export default defineConfig({
  vite: {
    build: {
      minify: "terser",
      terserOptions: {
        compress: {
          drop_console: true,
        },
      },
    },
  },
});
```

### 2. 图片优化

```bash
# 压缩图片
npm install -D imagemin imagemin-pngquant imagemin-mozjpeg

# 使用 WebP 格式
```

### 3. CDN 加速

在 Nginx 中配置:

```nginx
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}
```

---

## ✅ 部署检查清单

部署前检查:

- [ ] 所有链接正常工作
- [ ] 图片资源加载正常
- [ ] 搜索功能可用
- [ ] 移动端响应式正常
- [ ] 页面加载速度 < 3s
- [ ] SEO 元标签完整
- [ ] 无控制台错误
- [ ] HTTPS 配置正确
- [ ] 域名解析正常
- [ ] 404 页面配置

---

## 📞 支持

遇到问题？

- 📧 **邮箱**: zhanglongfa@chainlesschain.com
- 🐛 **GitHub Issues**: https://github.com/chainlesschain/docs-site/issues
- 📚 **VitePress 文档**: https://vitepress.dev/

---

## 🎉 推荐部署方案

| 场景     | 推荐方案     | 理由                       |
| -------- | ------------ | -------------------------- |
| 开源项目 | GitHub Pages | 免费、简单、与代码同仓库   |
| 快速上线 | Vercel       | 零配置、自动部署、CDN 加速 |
| 企业内部 | 自建服务器   | 数据安全、完全控制         |
| 高流量   | Vercel + CDN | 全球加速、高可用           |

---

**更新日期**: 2026-01-28
**文档版本**: v0.27.0
**维护者**: ChainlessChain Team
