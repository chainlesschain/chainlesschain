# 官网更新日志

## [2025-12-14] 官网重构 v1.1.0

### ✨ 新增功能

#### 1. 软件下载区域
- 新增独立的下载页面（#download）
- 支持全平台下载：Windows、macOS、Linux、Android、iOS
- 提供源码编译选项，同时链接GitHub和Gitee
- 显示版本信息和系统要求
- 添加下载提示，引导用户查看文档或联系客服

#### 2. 导航栏优化
- 添加"下载"导航链接
- 添加"文档"链接（https://docs.chainlesschain.com）
- 添加"论坛"链接（https://forum.chainlesschain.com）
- 在导航栏右侧添加Gitee按钮（原有GitHub保留）
- 将"立即体验"改为"立即下载"并链接到下载区域

#### 3. Hero区域增强
- 更新CTA按钮为三个：
  - 立即下载
  - 查看文档
  - 加入社区
- 所有按钮添加实际跳转链接

#### 4. 页脚重构
- 新增"联系方式"模块
  - 400客服热线：400-1068-687
  - 邮箱链接
  - 工作时间说明
- 更新"资源"模块
  - 链接到官方文档
  - 链接到社区论坛
  - 添加软件下载链接
- 更新"关于"模块
  - 添加GitHub链接
  - 添加Gitee链接
- 页脚布局从4列扩展为5列

#### 5. SEO优化
- 添加Open Graph标签，优化社交媒体分享
- 在meta标签中添加400电话
- 添加作者信息和联系方式meta标签
- 关键词中添加U盾、SIMKey等核心概念

### 🔗 新增链接

- **官方文档**: https://docs.chainlesschain.com
- **社区论坛**: https://forum.chainlesschain.com
- **GitHub**: https://github.com/chainlesschain
- **Gitee**: https://gitee.com/chainlesschaincn/chainlesschain
- **软件下载**: GitHub Releases
- **客服热线**: 400-1068-687

### 🎨 样式更新

- 新增下载区域完整样式
- 下载卡片支持hover动画效果
- 源码编译卡片采用featured样式
- 下载提示区域采用左侧强调色边框
- 优化移动端响应式布局
- 导航栏按钮在小屏幕下调整间距和字体大小

### 📱 响应式优化

- 下载区域在移动端自适应为单列布局
- Hero区域按钮在移动端垂直排列
- 源码链接在移动端垂直排列
- 页脚在移动端改为单列布局

### 📝 文档更新

- 更新README.md添加最新更新说明
- 新增CHANGELOG.md记录版本变更
- 添加所有官方链接到文档中

### 🐛 修复

- 修复导航栏过多链接导致的布局问题
- 优化移动端导航菜单显示

---

## 使用说明

### 本地预览

直接在浏览器中打开 `index.html` 文件即可预览。

推荐使用本地服务器预览：

```bash
# 使用Node.js
cd website
npx http-server -p 8080

# 使用PHP
php -S localhost:8080

# 使用Python 3
python -m http.server 8080
```

然后访问：http://localhost:8080

### 部署

1. **传统服务器部署**
   - 上传整个website文件夹到服务器
   - 配置nginx或apache指向该目录

2. **GitHub Pages**
   - 推送到GitHub仓库
   - 在Settings中启用GitHub Pages
   - 选择website目录

3. **Netlify/Vercel**
   - 连接GitHub仓库
   - 设置构建目录为website
   - 自动部署

### 自定义配置

如需修改链接地址，请编辑以下位置：

1. **导航栏**: index.html line 26-34
2. **下载链接**: index.html line 99, 106, 113, 120, 127, 134-141
3. **页脚链接**: index.html line 496-521
4. **Hero按钮**: index.html line 64-66

---

**版本**: v1.1.0
**更新日期**: 2025-12-14
**维护者**: 厦门无链之链科技有限公司
