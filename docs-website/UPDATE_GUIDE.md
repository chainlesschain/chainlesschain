# 官网更新指南 v0.33.0

## 更新内容总结

### 1. 顶部联系栏（显著位置�?

在导航栏下方添加了醒目的联系栏，包含�?- **400电话**�?00-1068-687（支持一键拨打）

- **企业微信**：悬停显示二维码弹窗
- **商务邮箱**：zhanglongfa@chainlesschain.com

#### 位置

- 文件：`index.html`
- 行数：约 381-415 �?- CSS：`style-enhancements.css` �?747-908 �?

#### 企业微信二维码已集成 �?

\*_企业微信链接�?_ `https://work.weixin.qq.com/ca/cawcde653996f7ecb2`

\*_当前实现方式�?_

1. 使用在线API自动生成二维码（无需手动上传图片�?2. API地址：`https://api.qrserver.com/v1/create-qr-code/`
2. 包含备用SVG占位图（网络异常时显示）
3. 点击可直接跳转企业微信添加页�?
   **如何使用二维码生成工具：**

打开文件：`generate-qr-code.html`（在浏览器中打开�?
功能�?- 实时预览不同尺寸二维码（150/200/300/400px�?- 一键下载PNG格式二维码图�?- 测试链接跳转功能

- 查看集成状�?
  **可选方案：使用本地图片**

如果需要使用本地图片文件：

```html
<!-- �?index.html �?397 行替�?-->
<img src="images/qr/wechat-enterprise.png" alt="企业微信二维�? width="200" height="200">
```

推荐规格�?00x200px PNG格式

### 2. 最新功能板�?

添加了独立的"最新功�?板块，展�?v0.33.0 �?大新功能�?

1. **MCP集成** (POC v0.1.0) - Model Context Protocol
2. **LLM性能仪表�?\* - Token监控与成本分�?3. **智能会话管理\*\* (v0.22.0) - 自动压缩节省30-40% Token
3. **AI错误诊断** - 本地Ollama LLM诊断
4. **Manus优化** (v0.24.0) - Context工程、任务跟�?6. **Cowork多Agent协作** (v1.0.0) - 多Agent系统
5. \*_GitHub发布自动�?_ - CI/CD流程
6. **Android Phase 5** - P2P网络、DID身份

#### 位置

- 文件：`index.html`
- 行数：约 1543-1672 �?- CSS：`style-enhancements.css` �?910-1056 �?

### 3. 版本更新

- \*_版本�?_：v0.17.0 �?v0.33.0
- \**完成�?*�?2% �?98%
- **更新日期**�?025-12-29 �?2026-01-19

更新位置�?- `index.html` - 多处版本号引�?- `README.md` - 版本信息板块

- Schema.org结构化数�?

### 4. 统计数据更新

Hero区统计数据更新：

- Vue组件�?45 �?165
- 技能工�?�?API端点�?15 �?149
- 整体完成度保持：98%

## 文件清单

### 修改的文�?1. `index.html` - 主页面（添加联系栏、新功能板块、更新版本）

2. `style-enhancements.css` - 样式文件（新增两个大板块样式�?3. `README.md` - 文档更新（版本、功能、联系方式）

### 新增的文�?1. `UPDATE_GUIDE.md` - 本文�?

### 需要准备的资源

1. 企业微信二维码图片：`images/qr/wechat-enterprise.png`�?00x200px PNG�?

## 测试检查清�?

- [ ] 顶部联系栏在桌面端正常显�?- [ ] 400电话链接可点击拨�?- [ ] 企业微信悬停显示二维码弹�?- [ ] 商务邮箱链接正常工作
- [ ] 移动端联系栏响应式布局正常
- [ ] 最新功能板�?个卡片全部显�?- [ ] 新功能卡片悬停效果正�?- [ ] 高亮卡片（MCP、Cowork）样式正�?- [ ] 版本号全部更新为 v0.33.0
- [ ] 统计数据正确显示
- [ ] 所有链接跳转正�?- [ ] 移动端所有板块显示正�?

## 部署说明

### 本地测试

```bash
cd docs-website
python -m http.server 8000
# �?npx http-server -p 8000
```

访问：http://localhost:8000

### 部署到GitHub Pages

```bash
git add .
git commit -m "feat(website): add contact bar and v0.33.0 new features"
git push origin main
```

### 部署到服务器

```bash
# 上传到服务器
scp -r docs-website/* user@server:/var/www/chainlesschain.com/

# 或使用rsync
rsync -avz --delete docs-website/ user@server:/var/www/chainlesschain.com/
```

## 后续优化建议

1. \*_替换企业微信二维�?_：尽快替换占位图为实际二维码
2. \*_添加企业微信�?_：在悬停弹窗中添加企业微信号文字
3. **添加客服工作时间**：在联系栏中标注工作时间（如�?:00-18:00�?4. **添加在线客服**：考虑集成在线客服系统
4. **A/B测试**：测试联系栏的不同位置和样式，优化转化率
5. **数据统计**：集成Google Analytics追踪联系方式点击�?7. \*_移动端优�?_：考虑在移动端添加快速联系悬浮按�?

## 常见问题

### Q: 企业微信二维码不显示�?A: 检查图片路径是否正确，确保图片文件存在�?`images/qr/` 目录

### Q: 联系栏在移动端显示异常？

A: 检查浏览器控制台，确认CSS文件正确加载

### Q: 新功能板块样式不正确�?A: 清除浏览器缓存，强制刷新页面（Ctrl+Shift+R�?

### Q: 版本号更新不完全�?A: 搜索 "0.17.0" 确认所有引用都已更�?

## 联系方式

如有问题，请联系�?- 技术支持：400-1068-687

- 邮箱：zhanglongfa@chainlesschain.com
- GitHub Issues：https://github.com/chainlesschain/chainlesschain/issues

---

更新时间�?026-01-28
更新人员：Claude Code AI Assistant
版本：v0.21.0
