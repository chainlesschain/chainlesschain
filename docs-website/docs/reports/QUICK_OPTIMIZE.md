# 快速优化指南

30 秒完成所有性能优化！

## 🚀 一键优化

```bash
cd docs-website

# 1. 安装依赖（首次运行）
npm install

# 2. 执行优化
npm run optimize
```

就这么简单！脚本会自动：

- ✅ 优化图片（生成 WebP、多尺寸 PNG）
- ✅ 生成二维码
- ✅ 合并压缩 CSS

## 📦 生成的文件

### 图片优化

```
logo-32.png   (0.71 KB)  - 导航栏
logo-64.png   (1.37 KB)  - 加载器
logo-128.png  (2.36 KB)  - 高清备用
logo.webp     (29.56 KB) - 现代浏览器
```

### CSS 构建

```
dist/main.min.css (52 KB) - 合并压缩的 CSS
```

### 二维码

```
images/qr/wework-contact.png (1.81 KB)
```

## 🌐 部署

### 本地测试

```bash
npm run serve
# 访问 http://localhost:8000
```

### 部署到服务器

**方法 1：自动部署**

```bash
npm run deploy:server
```

**方法 2：手动上传**

```bash
# 上传以下文件到服务器
- index.html
- dist/
- logo-*.png, logo.webp, logo.svg
- images/
- js/
- .htaccess (Apache) 或 nginx.conf (Nginx)
```

### 服务器配置

**Apache**

```bash
# .htaccess 已包含所有配置，只需确保启用模块
sudo a2enmod deflate headers expires rewrite
sudo systemctl restart apache2
```

**Nginx**

```bash
# 复制配置文件
sudo cp nginx.conf /etc/nginx/sites-available/chainlesschain
sudo ln -s /etc/nginx/sites-available/chainlesschain /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## ✅ 验证优化效果

### 1. 本地测试

```bash
# 测试压缩
curl -H "Accept-Encoding: gzip" -I http://localhost:8000/

# 查看文件大小
ls -lh dist/main.min.css
ls -lh logo-*.png logo.webp
```

### 2. 在线测试

访问以下工具测试性能：

- **PageSpeed Insights**: https://pagespeed.web.dev/
- **GTmetrix**: https://gtmetrix.com/

目标分数：

- 移动端 > 85 ✅
- 桌面端 > 90 ✅

## 📊 预期效果

| 指标     | 优化前 | 优化后 | 提升      |
| -------- | ------ | ------ | --------- |
| 首屏加载 | ~3.5s  | ~1.2s  | **↓ 66%** |
| 总大小   | ~450KB | ~150KB | **↓ 67%** |
| 请求数   | 12     | 7      | **↓ 42%** |

## 🛠️ 可用命令

```bash
npm run optimize          # 执行所有优化
npm run optimize:images   # 仅优化图片
npm run optimize:qr       # 仅生成二维码
npm run optimize:css      # 仅构建 CSS
npm run serve             # 本地预览
npm run deploy:server     # 部署到服务器
npm run clean             # 清理 dist 目录
```

## 📞 遇到问题？

查看完整文档：

- **性能优化报告**: MOBILE_OPTIMIZATION_REPORT.md
- **服务器配置**: SERVER_OPTIMIZATION_GUIDE.md

技术支持：

- 邮箱: zhanglongfa@chainlesschain.com
- 电话: 400-1068-687
