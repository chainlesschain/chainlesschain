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

- ✅ 响应式设计，支持桌面、平板、移动端
- ✅ 现代化 UI 设计，使用渐变色和动画效果
- ✅ SEO 优化（meta标签、结构化数据、语义化HTML）
- ✅ 性能优化（关键CSS内联、懒加载图片、DNS预解析）
- ✅ 平滑滚动、导航栏滚动效果
- ✅ 移动端菜单
- ✅ 表单验证
- ✅ 返回顶部按钮

## 版本信息

- **当前版本**: v0.17.0
- **最后更新**: 2025-12-29
- **整体完成度**: 92%

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

1. 直接在浏览器中打开 `index.html` 即可预览
2. 或使用简单的 HTTP 服务器：

```bash
# 使用 Python
cd docs-website
python -m http.server 8000

# 使用 Node.js (http-server)
npm install -g http-server
http-server docs-website -p 8000
```

3. 在浏览器中访问 `http://localhost:8000`

## 部署

### GitHub Pages

1. 将 `docs-website` 目录推送到 GitHub
2. 在仓库设置中启用 GitHub Pages
3. 选择 `docs-website` 目录作为源

### Netlify / Vercel

1. 连接 GitHub 仓库
2. 设置构建目录为 `docs-website`
3. 无需构建命令（纯静态网站）

### 云服务器

1. 上传 `docs-website` 目录到服务器
2. 配置 Nginx 或 Apache 指向该目录
3. 配置 SSL 证书（推荐使用 Let's Encrypt）

## 待办事项

- [ ] 生成 Android 下载二维码
- [ ] 添加产品详情页面
- [ ] 添加演示视频
- [ ] 集成联系表单后端API
- [ ] 添加用户案例和评价
- [ ] 多语言支持（英文版）
- [ ] 添加博客/新闻区域

## 联系方式

- 客服热线：400-1068-687
- 邮箱：zhanglongfa@chainlesschain.com
- GitHub：https://github.com/chainlesschain
- Gitee：https://gitee.com/chainlesschaincn/chainlesschain

## 许可证

MIT License

Copyright (c) 2025 厦门无链之链科技有限公司
