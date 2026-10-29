# ChainlessChain 文档网站

## 当前文档（2026-10-29，CLI .131）

公开配对为 CLI **0.166.131** / Kernel **0.1.11** / Open VSX **0.37.169** / JetBrains **0.4.186**，生产来源 `c9d0bab231`，公开制品、签名及官方候选比对已通过。PC / 移动端保持独立 **v5.0.3.143**，Microsoft Marketplace 暂缓。真实任务累计 **34/45**，新计划尚未派发；完整 Memory SLO、语义质量与付费/native准入仍单独核对。

- [本版升级步骤](docs/chainlesschain/cli-ide-update-2026-10-29-131.md)
- [公开发行回执](../docs/research/cli/evidence/release131-public/publication.json)
- [设计权威源](../docs/design/release-runtime-update-2026-10-29-131.md)

下方带日期的内容保留历史范围。

## 历史文档（2026-10-27）

2026-10-27 当前公开：CLI **0.166.127**、Open VSX **0.37.165**、JetBrains **0.4.182**，两个 IDE 推荐 `.127`；移动与 PC 产品 **v5.0.3.142** 已公开，22 个资产通过回读。自进化改为可选开启，新安装与旧自动本地部署默认关闭。跨版本累计 **32/45**、**13** 项未完成，本轮未新增模型任务验收；**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。

- [升级指南](docs/chainlesschain/cli-ide-update-2026-10-27.md)
- [自进化开关](docs/chainlesschain/self-evolution-configuration.md)
- [权威设计源](../docs/design/release-runtime-update-2026-10-27.md)

构建运行 `npm run build`，包含设计同步和用户文档结构检查。部署使用 [三站快照流程](../scripts/deploy-docs-snapshot.ps1)，先提交并构建同一源码快照。

## 历史文档（2026-10-26）

公开版本为 CLI **0.166.121**、Open VSX **0.37.161**、JetBrains **0.4.178**，两个 IDE 均推荐 CLI `.121`，公共包与下载已核验。本轮更新 v6 普通文本投影、敏感表达式边界、历史证据兼容与升级恢复说明。原生产品 **v5.0.3.141** 已独立正式公开，源码为 `a024f3c672`，不属于 CLI `.121` 的发行树，也不增加本轮验收。

- [当前升级指南](docs/chainlesschain/cli-ide-update-2026-10-26.md)
- [输入、图片预算和会话恢复](docs/chainlesschain/agent-input-and-recovery.md)
- [权威设计源](../docs/design/release-runtime-update-2026-10-26.md)
- [官网与三站部署说明](../docs-website-v2/README.md)

设计文件只编辑仓库根 `docs/design/`；本项目 `docs/design/` 是构建时生成的副本。本轮未新增真实模型任务验收，跨版本累计 **32/45**、**13** 项未完成，**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。下方日期记录为历史快照。

## 历史文档快照

> 2026-10-18 实时核对：npm CLI **0.166.106**、Open VSX **0.37.151** 已公开，Open VSX 推荐 CLI `.106`，发行提交 `dca47fd91a`。JetBrains 当前已核验公开 **0.4.167**，仍推荐 CLI `.105`；`.168` 的公开上架与下载待核验。公开 `.105/.150/.167` 任务补测已收齐生成与独立验收各 **20/20**，新增 **6** 项候选及全流程通过；跨版本累计候选合格交付 **31/45**（普通 **26/36**、首次 **5/9**），剩余 **14** 项。`.106/.151/.168` 新轮模型补测尚未运行，累计覆盖不等于新版单轮成功率。Microsoft Marketplace 未发布。

> 2026-10-16：公开 CLI **0.166.103**、Open VSX **0.37.148** 与 JetBrains **0.4.165**，两个 IDE 均推荐 CLI `.103`。CLI 发行提交 `b235ac8068`，VS Code `c8a64caa92`，JetBrains `fa64840216`；主线核对至 `920f263e3f`。Session Core **0.3.19**、Kernel **0.1.10**、PDH **0.4.65**；原生产品 **v5.0.3.140** 独立发行。正式预算保持 **NOT_PAID_READY**，36+9 **NOT_RUN（0/36、0/9）**、native **NOT_ADMITTED**、自动晋升 **HOLD**。 参见[本轮升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-10-16.html)。较早日期的记录保留历史范围。

这是ChainlessChain项目的官方文档网站，使用VitePress构建。

> 历史文档快照（2026-10-15）：公开 CLI `0.166.101@6752b49e1e`、Context/Memory Kernel `0.1.10`、Open VSX `0.37.145`；JetBrains Marketplace API 列出 `0.4.162`，源码候选 `.163` 待公开核验。产品当时为独立 `v5.0.3.140`。详见[当时升级指南](docs/chainlesschain/cli-ide-update-2026-10-15.md)。

> 历史文档快照（2026-09-09）：产品版本 `v5.0.3.135`，当时生产推荐 CLI 与 npm `latest` 均为 `0.166.38@de8ec4e5c8`；该 SHA 的三平台 CLI CI、Strict Sandbox、IDE 与 npm 发布/公共回读均已完成。TypeScript Agent SDK 为 `0.2.9`、Python Agent SDK 为 `0.2.8`、Agent Protocol 为 `0.1.9`、Context Memory Kernel 为 `0.1.1`、Session Core 为 `0.3.12`、PDH 为 `0.4.60`；Open VSX 为 `0.37.92`，JetBrains Marketplace 为 `0.4.119`。

> 2026-09-09 历史功能边界：`0.166.38` 已公开 CLI/Hub 受治理模型入口、provider stream 完整性检查、模型身份固定、Evolution witness 分段存储，以及 IDE 模型配置原子保存与推理模型连接测试修复。本地 `main@a238e6c245` 又接通 Desktop Personal Data Hub resolver/Skill IPC 与内嵌 Web Shell，确认后台/Coding Agent 入口重入 canonical loader，并使 Legacy ImageGen 内容入口在缓存、provider 选择和 fallback 前失败闭合；当时已核对的 GitHub `main@1895749692` 与 Gitee `main@3806866d80` 尚未包含这些 post-release 增量。可信 Workbench 部署和 Desktop native 安装包仍需各自验收。详见[CLI Runtime](docs/chainlesschain/cli-runtime-current.md)、[模块 113 设计](../docs/design/modules/113-governed-desktop-model-ingress-design.md)和[发布边界](docs/chainlesschain/agent-platform-release.md)。

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
