# 官网快速使用指南

## ✅ 已完成更新

所有信息都已更新为原网站的内容：

### 📌 Logo
- 支持图片logo（需下载logo.png）
- 备用文字logo："无链之链" 🔗

### 📌 公司信息
- 公司：厦门无链之链科技有限公司
- 备案：闽ICP备2025105973号-1

### 📌 联系方式
- 邮箱：zhanglongfa@chainlesschain.com
- 电话：400-1068-687（工作日 9:00-18:00）
- 地址：厦门国际航运中心C栋4层431单元H

## 🚀 三步启动网站

### 第1步：获取Logo（可选）

访问原网站并下载logo：
```
https://www.chainlesschain.com/logo.png
```

保存到：`website/logo.png`

**注意**：如果暂时没有logo，网站会自动显示文字logo"无链之链"

### 第2步：本地预览

**方法A - 直接打开**（简单）
```bash
# Windows
start website\index.html

# macOS
open website/index.html
```

**方法B - 使用服务器**（推荐）
```bash
cd website
python -m http.server 8000
# 访问 http://localhost:8000
```

### 第3步：部署上线

**Netlify（推荐，免费）**
1. 访问 https://app.netlify.com/
2. 拖拽 `website` 文件夹
3. 完成！自动获得 HTTPS 域名

**传统服务器**
```bash
# 上传所有文件
scp -r website/* user@server:/var/www/html/
```

## 📱 查看效果

打开网站后，您会看到：

### 首页
```
🔗 无链之链
让数据主权回归个人，AI效率触手可及

[开始使用] [了解更多]

4+专利 | 99.9%安全 | 全平台覆盖
```

### 产品展示
- 📚 个人移动AI知识库
- 💬 去中心化AI社交（热门）
- 🤝 AI辅助交易

### 联系我们
- 📧 zhanglongfa@chainlesschain.com
- 📞 400-1068-687
- 📍 厦门国际航运中心

### 页脚
```
© 2025 厦门无链之链科技有限公司 版权所有
闽ICP备2025105973号-1
```

## ✨ 特色功能

- ✅ 完全响应式（手机/平板/电脑完美适配）
- ✅ 平滑滚动动画
- ✅ 现代化设计
- ✅ 快速加载
- ✅ SEO优化

## 🔧 常见问题

### Q: Logo不显示？
A:
1. 检查文件名是否为 `logo.png`
2. 检查文件是否在 `website/` 目录
3. 如果没有logo，会自动显示文字"无链之链"

### Q: 如何修改内容？
A: 直接编辑 `index.html` 文件

### Q: 如何修改颜色？
A: 编辑 `css/style.css` 中的 `:root` 变量

### Q: 如何添加图片？
A:
1. 创建 `website/images/` 目录
2. 放入图片
3. 在HTML中引用：`<img src="images/xxx.png">`

### Q: 部署后备案号不显示？
A: 已经添加，如果不显示，检查网络连接

## 📊 网站文件

```
website/
├── index.html              # 主页面（已更新）
├── css/style.css          # 样式（已更新）
├── js/main.js             # 交互（已完成）
├── logo.png               # Logo图片（需添加）
├── README.md              # 详细文档
├── LOGO_SETUP.md         # Logo设置说明
└── QUICK_GUIDE.md        # 本文件
```

## 🎯 下一步建议

1. **下载Logo** - 从原网站获取logo.png
2. **本地测试** - 确认所有信息显示正确
3. **部署上线** - 使用Netlify或服务器
4. **绑定域名** - 配置 www.chainlesschain.com
5. **SSL证书** - 启用HTTPS（Netlify自动配置）

## 💡 Pro Tips

- 使用Chrome DevTools（F12）调试
- 测试移动端显示（DevTools切换设备）
- 压缩图片减小文件大小
- 定期更新内容
- 添加Google Analytics追踪访问

## 📞 需要帮助？

如有问题，请查看：
- `README.md` - 完整文档
- `LOGO_SETUP.md` - Logo设置详解
- `WEBSITE_UPDATES.md` - 更新说明

---

**状态**: ✅ 随时可用

**版本**: v1.0.0

**最后更新**: 2025-12-01
