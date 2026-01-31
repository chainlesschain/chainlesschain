# ChainlessChain 官网文档

这是 ChainlessChain 项目的官方网站文档目录。

## 目录结构

```
docs-website/
├── index.html          # 主页面
├── logo.png            # Logo (PNG格式)
├── logo.svg            # Logo (SVG格式，备用)
├── css/
│   └── style.css       # 样式文件
├── js/
│   └── main.js         # 交互脚本
├── images/
│   ├── og-image.svg    # Open Graph 图片
│   └── qr/
│       └── android-download.png  # Android下载二维码（需要生成）
└── README.md           # 本文件
```

## 功能特性

### 网站功能
- ✅ 响应式设计，支持桌面、平板、移动端
- ✅ 现代化 UI 设计，使用渐变色和动画效果
- ✅ SEO 优化（meta标签、结构化数据、语义化HTML）
- ✅ 性能优化（关键CSS内联、懒加载图片、DNS预解析）
- ✅ 平滑滚动、导航栏滚动效果
- ✅ 移动端菜单
- ✅ 表单验证
- ✅ 返回顶部按钮
- ✅ 显著位置展示联系方式（400电话、企业微信）

### v0.21.0 最新功能
- 🔌 **MCP集成** (POC v0.1.0) - Model Context Protocol标准化工具集成
- 📊 **LLM性能仪表板** - Token使用监控、成本分析、ECharts可视化
- 💬 **智能会话管理** (v0.22.0) - 自动压缩节省30-40% Token
- 🩺 **AI错误诊断** - 本地Ollama LLM智能诊断，完全免费
- ⚙️ **Manus优化** (v0.24.0) - Context工程、工具屏蔽、任务跟踪
- 👥 **Cowork多Agent协作** (v1.0.0) - Claude Cowork风格多Agent系统
- 🚀 **GitHub发布自动化** - 全自动化CI/CD，多平台构建
- 📱 **Android Phase 5** - P2P网络、DID身份系统

## 版本信息

- **当前版本**: v0.21.0
- **最后更新**: 2026-01-28
- **整体完成度**: 98%

## 最新更新

### v0.21.0-fix2 (2026-01-28)
- ✅ 实现固定头部：滚动时导航栏和联系栏保持固定
- ✅ 优化页面布局，避免内容被固定头部遮挡
- ✅ 移动端响应式优化

## 实际实现功能统计

- **165个Vue组件** - 完整的前端组件体系
- **140,000+行代码** - 涵盖知识库、社交、交易三大模块
- **149个API端点** - 后端微服务架构
- **19个AI专用引擎** - 代码、文档、表格、PPT、PDF、图像、视频处理

## 产品完成度

1. **知识库管理**: 95% ✅ 生产就绪
   - SQLCipher AES-256加密
   - RAG增强检索
   - 多格式导入（MD/PDF/Word/OCR）
   - Git版本控制

2. **去中心化社交**: 85% ✅
   - W3C DID标准身份
   - Signal Protocol E2E加密
   - libp2p P2P网络
   - 社区论坛（63个API）

3. **去中心化交易**: 85% ✅
   - 8大核心模块
   - 6个智能合约（ERC20/721、托管、订阅、悬赏）
   - 信用评分系统
   - HD钱包 + MetaMask + WalletConnect

## 技术栈

### 前端
- Electron 39.2.6
- Vue 3.4 + TypeScript
- Ant Design Vue 4.1
- Pinia 2.1.7

### 后端
- Node.js
- Spring Boot 3.1.11
- FastAPI
- PostgreSQL 16
- Redis 7

### 区块链
- Hardhat
- Solidity
- Ethers.js
- MetaMask / WalletConnect

### 安全
- SQLCipher
- U盾 / SIMKey
- SM2国密 / RSA 2048 / AES-256
- Signal Protocol

## 缺失的资源文件

以下文件需要手动生成或添加：

1. **Android下载二维码**: `images/qr/android-download.png`
   - 建议尺寸：300x300px
   - 内容：指向 Android APK 的下载链接

2. **Logo PNG版本**: `logo.png` (可选)
   - 当前使用 SVG 版本，如需要 PNG 可以使用在线工具转换

## 本地开发

### 方法1：快速启动（推荐）⭐

**Windows:**
```bash
cd docs-website
quick-start.bat
```

**Linux/macOS:**
```bash
cd docs-website
chmod +x quick-start.sh
./quick-start.sh
```

自动启动服务器并打开浏览器访问：
- 主页：http://localhost:8000
- 二维码生成器：http://localhost:8000/generate-qr-code.html
- 预览页面：http://localhost:8000/PREVIEW_v0.21.0.html

### 方法2：手动启动

**使用 Python:**
```bash
cd docs-website
python -m http.server 8000
# 或 python3 -m http.server 8000
```

**使用 Node.js:**
```bash
cd docs-website
npx http-server -p 8000
```

**直接打开文件:**
```bash
# 直接在浏览器中打开（功能可能受限）
open index.html  # macOS
start index.html # Windows
xdg-open index.html # Linux
```

## 部署

### 🚀 快速部署（推荐）

**方式1：一键部署工具**
```bash
# Windows
pack-and-deploy.bat

# Linux/Mac
chmod +x pack-and-deploy.sh
./pack-and-deploy.sh
```

**方式2：命令行部署**
```bash
# 1. 构建打包
node build.js

# 2a. 部署到服务器
./deploy-to-server.sh

# 2b. 部署到 GitHub Pages
./deploy-to-github.sh

# 2c. 创建压缩包
zip -r website.zip dist/
```

**方式3：拖拽部署（最简单）**
1. 运行 `node build.js`
2. 访问 https://app.netlify.com/drop
3. 拖拽 `dist/` 目录到页面
4. 等待部署完成

### 📖 详细文档

- **完整指南：** `DEPLOYMENT_READY.md` - 包含所有部署方式和配置说明
- **详细文档：** `DEPLOY_GUIDE.md` - 服务器配置、Nginx/Apache设置
- **快速参考：** `QUICK_DEPLOY.txt` - 快速查阅表

### GitHub Pages

1. 运行 `./deploy-to-github.sh`
2. 在仓库设置中启用 GitHub Pages
3. 选择 `gh-pages` 分支

### 云服务器

1. 修改 `deploy-to-server.sh` 中的服务器配置
2. 运行 `./deploy-to-server.sh`
3. 配置 Nginx/Apache（见 `DEPLOY_GUIDE.md`）
4. 配置 SSL 证书（推荐使用 Let's Encrypt）

### Netlify / Vercel

**Netlify Drop（最快）：**
- 访问 https://app.netlify.com/drop
- 拖拽 `dist/` 目录

**CLI部署：**
```bash
npm install -g netlify-cli vercel
netlify deploy --prod --dir=dist
# 或
vercel --prod dist
```

## 待办事项

- [ ] 生成 Android 下载二维码
- [ ] 添加产品详情页面
- [ ] 添加演示视频
- [ ] 集成联系表单后端API
- [ ] 添加用户案例和评价
- [ ] 多语言支持（英文版）
- [ ] 添加博客/新闻区域

## 联系方式

### 显著位置展示（顶部联系栏）
- **客服热线**：400-1068-687（一键拨打）
- **企业微信**：扫码添加（悬停显示二维码）
- **商务合作**：zhanglongfa@chainlesschain.com

### 其他渠道
- GitHub：https://github.com/chainlesschain
- Gitee：https://gitee.com/chainlesschaincn/chainlesschain

### 企业微信二维码
- ✅ 已集成在线API自动生成二维码
- ✅ 链接：https://work.weixin.qq.com/ca/cawcde653996f7ecb2
- 🛠️ 使用工具：打开 `generate-qr-code.html` 可下载不同尺寸二维码
- 📱 功能：悬停显示二维码 + 点击跳转企业微信

## 许可证

MIT License

Copyright (c) 2025 厦门无链之链科技有限公司
