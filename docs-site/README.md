# ChainlessChain 文档网站

这是ChainlessChain项目的官方文档网站，使用VitePress构建。

> 当前文档快照（2026-08-31）：产品版本 `v5.0.3.135`，完整门禁的生产推荐 CLI 与 npm `latest` 均为 `0.166.14@ee88125256`；其三平台 CLI CI、Strict Sandbox、不可变制品、Trusted Publishing、provenance 与独立公网回读均已闭环。TypeScript/Python Agent SDK 为 `0.2.7`、Agent Protocol 为 `0.1.7`、Session Core 为 `0.3.8`、PDH 为 `0.4.59`；Open VSX 为 `0.37.76`，JetBrains Marketplace 为 `0.4.106`。本版公开 Context/Memory 与 Hooks v2 收敛、P0 执行安全关闭和 Windows Docker-optional 启动；`main@0761d4d297` 的 formal Graph quality hardening 与 producer digest 刷新仍按源码边界说明。

## 📚 文档内容

### 已完成的文档

#### 指南

- ✅ 简介 (`/guide/introduction`)
- ✅ 快速开始 (`/guide/getting-started`)
- ⏳ 系统架构 (待完成)
- ⏳ 技术栈 (待完成)

#### U盾/SIMKey厂家管理系统

- ✅ 系统概述 (`/manufacturer/overview`)
- ✅ 快速开始 (`/manufacturer/quick-start`)
- ✅ 安装部署 (`/manufacturer/installation`)
- ⏳ 设备注册 (待完成)
- ⏳ 设备激活 (待完成)
- ⏳ 设备管理 (待完成)
- ⏳ APP版本上传 (待完成)
- ⏳ APP版本发布 (待完成)
- ⏳ 数据备份 (待完成)
- ⏳ 数据恢复 (待完成)
- ⏳ 用户管理 (待完成)
- ⏳ 操作日志 (待完成)

#### API参考

- ✅ API简介 (`/api/introduction`)
- ✅ 设备管理API (`/api/manufacturer/devices`)
- ⏳ APP版本管理API (待完成)
- ⏳ 数据备份API (待完成)
- ⏳ 用户管理API (待完成)
- ⏳ 操作日志API (待完成)

#### ChainlessChain个人AI系统

- ⏳ 系统概述 (待完成)
- ⏳ 安装部署 (待完成)
- ⏳ 知识库管理 (待完成)
- ⏳ 去中心化社交 (待完成)
- ⏳ 交易辅助 (待完成)
- ⏳ U盾集成 (待完成)
- ⏳ SIMKey集成 (待完成)
- ⏳ AI模型配置 (待完成)

## 🚀 本地开发

### 前置要求

- Node.js 22.12.0+
- npm 或 yarn

### 安装依赖

```bash
cd docs-site
npm install
```

### 启动开发服务器

```bash
npm run dev
```

访问: http://localhost:5173

### 构建生产版本

```bash
npm run build
```

构建输出在 `docs/.vitepress/dist` 目录

### 预览生产版本

```bash
npm run preview
```

## 📁 项目结构

```
docs-site/
├── docs/                           # 文档源文件
│   ├── .vitepress/                 # VitePress配置
│   │   └── config.js               # 站点配置
│   ├── index.md                    # 首页
│   ├── guide/                      # 指南文档
│   │   ├── introduction.md
│   │   ├── getting-started.md
│   │   ├── architecture.md         (待创建)
│   │   └── tech-stack.md           (待创建)
│   ├── chainlesschain/             # ChainlessChain系统文档
│   │   ├── overview.md             (待创建)
│   │   ├── installation.md         (待创建)
│   │   ├── configuration.md        (待创建)
│   │   ├── knowledge-base.md       (待创建)
│   │   ├── social.md               (待创建)
│   │   ├── trading.md              (待创建)
│   │   ├── ukey.md                 (待创建)
│   │   ├── simkey.md               (待创建)
│   │   ├── ai-models.md            (待创建)
│   │   ├── git-sync.md             (待创建)
│   │   └── encryption.md           (待创建)
│   ├── manufacturer/               # 厂家管理系统文档
│   │   ├── overview.md             ✅
│   │   ├── quick-start.md          ✅
│   │   ├── installation.md         ✅
│   │   ├── device-register.md      (待创建)
│   │   ├── device-activate.md      (待创建)
│   │   ├── device-manage.md        (待创建)
│   │   ├── app-upload.md           (待创建)
│   │   ├── app-publish.md          (待创建)
│   │   ├── app-update.md           (待创建)
│   │   ├── data-backup.md          (待创建)
│   │   ├── data-restore.md         (待创建)
│   │   ├── password-recovery.md    (待创建)
│   │   ├── user-management.md      (待创建)
│   │   ├── operation-logs.md       (待创建)
│   │   └── permissions.md          (待创建)
│   └── api/                        # API文档
│       ├── introduction.md         ✅
│       ├── authentication.md       (待创建)
│       ├── manufacturer/
│       │   ├── devices.md          ✅
│       │   ├── app-versions.md     (待创建)
│       │   ├── backups.md          (待创建)
│       │   ├── users.md            (待创建)
│       │   └── logs.md             (待创建)
│       └── chainlesschain/
│           ├── knowledge.md        (待创建)
│           ├── social.md           (待创建)
│           └── trading.md          (待创建)
├── package.json                    # 项目配置
└── README.md                       # 本文件
```

## 🌐 部署到生产环境

### 部署到 docs.chainlesschain.com

#### 方式一: Vercel部署（推荐）

1. Fork或上传项目到GitHub
2. 访问 [Vercel](https://vercel.com)
3. Import项目
4. 设置构建配置：
   - Build Command: `npm run build`
   - Output Directory: `docs/.vitepress/dist`
   - Install Command: `npm install`
   - Root Directory: `docs-site`
5. 添加自定义域名 `docs.chainlesschain.com`
6. 配置DNS CNAME记录指向Vercel

#### 方式二: Netlify部署

1. 访问 [Netlify](https://www.netlify.com)
2. New site from Git
3. 选择仓库
4. 构建设置：
   - Build command: `npm run build`
   - Publish directory: `docs/.vitepress/dist`
   - Base directory: `docs-site`
5. Deploy site
6. 添加自定义域名

#### 方式三: 自建服务器部署

1. 在服务器上构建项目：

```bash
cd docs-site
npm install
npm run build
```

2. 将 `docs/.vitepress/dist` 目录复制到Web服务器：

```bash
scp -r docs/.vitepress/dist/* user@server:/var/www/docs.chainlesschain.com/
```

3. 配置Nginx：

```nginx
server {
    listen 80;
    server_name docs.chainlesschain.com;

    root /var/www/docs.chainlesschain.com;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Gzip压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # 缓存静态资源
    location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

4. 配置SSL证书：

```bash
sudo certbot --nginx -d docs.chainlesschain.com
```

#### 方式四: GitHub Pages

1. 在项目根目录创建 `.github/workflows/deploy.yml`:

```yaml
name: Deploy Docs

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: 22.12.0

      - name: Install dependencies
        working-directory: docs-site
        run: npm install

      - name: Build
        working-directory: docs-site
        run: npm run build

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: docs-site/docs/.vitepress/dist
          cname: docs.chainlesschain.com
```

2. 在GitHub仓库设置中启用GitHub Pages
3. 配置自定义域名

### 环境变量

如果需要配置环境变量（如API地址），在 `.vitepress/config.js` 中配置：

```javascript
export default defineConfig({
  // ...
  define: {
    __API_URL__: JSON.stringify(
      process.env.API_URL || "http://localhost:8080/api",
    ),
  },
});
```

## 📝 贡献指南

### 添加新文档

1. 在对应目录下创建Markdown文件
2. 在 `docs/.vitepress/config.js` 的 `sidebar` 中添加导航链接
3. 运行 `npm run dev` 预览
4. 提交更改

### Markdown语法

VitePress支持标准Markdown和扩展语法：

#### 代码块

```javascript
// 支持语法高亮
const hello = "world";
```

#### 提示框

```markdown
::: tip 提示
这是一个提示
:::

::: warning 警告
这是一个警告
:::

::: danger 危险
这是一个危险提示
:::
```

#### 自定义容器

```markdown
::: details 点击展开
这是折叠内容
:::
```

#### 表格

```markdown
| 列1 | 列2 | 列3 |
| --- | --- | --- |
| A   | B   | C   |
```

#### 链接

```markdown
[内部链接](/guide/introduction)
[外部链接](https://www.chainlesschain.com)
```

### 文档规范

1. **文件命名**: 使用小写字母和短横线 (kebab-case)
   - ✅ `getting-started.md`
   - ❌ `GettingStarted.md`

2. **标题层级**: 一个文档只有一个H1标题

   ```markdown
   # 一级标题（H1）- 只有一个

   ## 二级标题（H2）

   ### 三级标题（H3）
   ```

3. **代码示例**: 提供多语言示例

   ```markdown
   #### JavaScript

   \`\`\`javascript
   // 代码
   \`\`\`

   #### Python

   \`\`\`python

   # 代码

   \`\`\`
   ```

4. **链接检查**: 确保内部链接有效
   - 使用相对路径
   - 不包含 `.md` 后缀
   - 示例: `/guide/getting-started` 而非 `/guide/getting-started.md`

## 🔍 搜索功能

VitePress内置本地搜索功能，已在配置中启用：

```javascript
search: {
  provider: "local";
}
```

搜索索引会在构建时自动生成。

## 🌍 国际化（i18n）

如需添加英文版本，可以配置多语言：

```javascript
export default defineConfig({
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
    },
  },
});
```

## 📊 统计分析

添加Google Analytics或其他统计工具：

```javascript
export default defineConfig({
  head: [
    // ...
    [
      "script",
      {
        async: "",
        src: "https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX",
      },
    ],
    [
      "script",
      {},
      "window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', 'G-XXXXXXXXXX');",
    ],
  ],
});
```

## 🐛 故障排查

### 构建失败

```bash
# 清除缓存
rm -rf node_modules package-lock.json
npm install

# 清除VitePress缓存
rm -rf docs/.vitepress/cache docs/.vitepress/dist
```

### 样式问题

检查 `docs/.vitepress/theme/custom.css` 自定义样式。

### 死链接警告

可以在配置中忽略：

```javascript
ignoreDeadLinks: true;
// 或只忽略特定链接
ignoreDeadLinks: [/^https?:\/\/localhost/, /some-pattern/];
```

## 📞 技术支持

- **官网**: https://www.chainlesschain.com
- **GitHub**: https://github.com/chainlesschain
- **邮箱**: zhanglongfa@chainlesschain.com
- **电话**: 400-1068-687

## 📄 许可证

MIT License

---

**文档网站构建完成！** 🎉

下一步可以：

1. 继续完善待创建的文档页面
2. 添加更多API参考文档
3. 添加截图和视频教程
4. 配置自动化部署流程
