# 服务器优化部署指南

本文档提供 ChainlessChain 官网的服务器端优化配置指南。

## 📋 目录

- [Apache 配置](#apache-配置)
- [Nginx 配置](#nginx-配置)
- [CDN 配置](#cdn-配置)
- [性能测试](#性能测试)

---

## 🔧 Apache 配置

### 1. 启用必需模块

```bash
# 启用压缩模块
sudo a2enmod deflate
sudo a2enmod headers
sudo a2enmod expires
sudo a2enmod rewrite

# 启用 Brotli（可选，需先安装）
sudo a2enmod brotli

# 重启 Apache
sudo systemctl restart apache2
```

### 2. 应用 .htaccess

将 `.htaccess` 文件放在网站根目录：

```bash
cp .htaccess /var/www/chainlesschain/
```

### 3. 验证配置

```bash
# 检查语法
sudo apachectl configtest

# 查看已启用的模块
apache2ctl -M | grep -E 'deflate|headers|expires|rewrite'
```

---

## 🚀 Nginx 配置

### 1. 应用配置文件

```bash
# 复制配置
sudo cp nginx.conf /etc/nginx/sites-available/chainlesschain

# 创建符号链接
sudo ln -s /etc/nginx/sites-available/chainlesschain /etc/nginx/sites-enabled/

# 删除默认配置（可选）
sudo rm /etc/nginx/sites-enabled/default
```

### 2. 测试配置

```bash
# 检查语法
sudo nginx -t

# 重载配置
sudo systemctl reload nginx

# 或重启
sudo systemctl restart nginx
```

### 3. 安装 Brotli 模块（可选）

```bash
# Ubuntu/Debian
sudo apt install nginx-module-brotli

# 在 nginx.conf 顶部添加
load_module modules/ngx_http_brotli_filter_module.so;
load_module modules/ngx_http_brotli_static_module.so;
```

---

## 🌐 CDN 配置

### 推荐 CDN 服务商

| 服务商     | 国内访问   | 价格 | 推荐指数   |
| ---------- | ---------- | ---- | ---------- |
| 阿里云 CDN | ⭐⭐⭐⭐⭐ | 💰💰 | ⭐⭐⭐⭐⭐ |
| 腾讯云 CDN | ⭐⭐⭐⭐⭐ | 💰💰 | ⭐⭐⭐⭐⭐ |
| 七牛云 CDN | ⭐⭐⭐⭐   | 💰   | ⭐⭐⭐⭐   |
| Cloudflare | ⭐⭐⭐     | 免费 | ⭐⭐⭐     |

### CDN 缓存规则

```
# 静态资源 - 1年
/dist/*.css         Cache-Control: max-age=31536000
/dist/*.js          Cache-Control: max-age=31536000
/images/**/*        Cache-Control: max-age=31536000
*.png, *.jpg, *.svg Cache-Control: max-age=31536000

# HTML - 不缓存
/*.html             Cache-Control: no-cache
/                   Cache-Control: no-cache
```

### 回源配置

```
回源 Host: www.chainlesschain.com
回源协议: HTTPS（推荐）
Range 回源: 开启
```

---

## 📊 性能测试

### 1. 本地测试

```bash
# 测试 Gzip
curl -H "Accept-Encoding: gzip" -I https://www.chainlesschain.com/

# 查看响应头
curl -I https://www.chainlesschain.com/

# 测试压缩率
curl -H "Accept-Encoding: gzip" https://www.chainlesschain.com/ | wc -c
curl https://www.chainlesschain.com/ | wc -c
```

### 2. 在线工具

- **GTmetrix**: https://gtmetrix.com/
- **PageSpeed Insights**: https://pagespeed.web.dev/
- **WebPageTest**: https://www.webpagetest.org/

### 3. 性能指标

| 指标               | 目标值 | 当前值（优化前） | 优化后    |
| ------------------ | ------ | ---------------- | --------- |
| FCP (首次内容绘制) | <1.8s  | ~3.5s            | ~1.2s ✅  |
| LCP (最大内容绘制) | <2.5s  | ~5.0s            | ~2.0s ✅  |
| TBT (总阻塞时间)   | <200ms | ~600ms           | ~150ms ✅ |
| CLS (累积布局偏移) | <0.1   | ~0.05            | ~0.02 ✅  |
| Speed Index        | <3.4s  | ~5.8s            | ~2.8s ✅  |

---

## ✅ 部署检查清单

### 构建步骤

```bash
# 1. 安装依赖
npm install sharp qrcode --save-dev

# 2. 优化图片
node optimize-images-sharp.js

# 3. 生成二维码
node generate-qr.js

# 4. 构建 CSS
node build-css.js

# 5. 验证文件
ls -lh dist/
ls -lh logo-*.png logo.webp
ls -lh images/qr/wework-contact.png
```

### 服务器配置

- [ ] 启用 Gzip/Brotli 压缩
- [ ] 配置浏览器缓存
- [ ] 添加安全头
- [ ] 启用 HTTPS
- [ ] 配置 CDN
- [ ] 设置错误页面

### 性能验证

- [ ] GTmetrix 评分 > A (90+)
- [ ] PageSpeed Insights 移动端 > 85
- [ ] PageSpeed Insights 桌面端 > 90
- [ ] 首屏加载时间 < 2s

---

## 🚨 故障排查

### 1. Gzip 未生效

```bash
# 检查模块
apache2ctl -M | grep deflate

# 检查配置
grep -r "mod_deflate" /etc/apache2/

# 测试
curl -H "Accept-Encoding: gzip" -I https://your-site.com/
```

### 2. 缓存未生效

```bash
# 查看响应头
curl -I https://your-site.com/dist/main.min.css

# 应该包含
# Cache-Control: public, max-age=31536000, immutable
```

### 3. CSS 未加载

检查 `index.html` 中的 CSS 异步加载脚本：

```html
<link
  rel="preload"
  href="dist/main.min.css?v=11.0"
  as="style"
  onload="this.onload=null;this.rel='stylesheet'"
/>
```

---

## 📚 参考资料

- [Apache mod_deflate 文档](https://httpd.apache.org/docs/2.4/mod/mod_deflate.html)
- [Nginx Gzip 配置](http://nginx.org/en/docs/http/ngx_http_gzip_module.html)
- [Web.dev 性能优化](https://web.dev/fast/)
- [MDN HTTP 缓存](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Caching)

---

## 📞 支持

如有问题，请联系：

- 邮箱: zhanglongfa@chainlesschain.com
- 电话: 400-1068-687
