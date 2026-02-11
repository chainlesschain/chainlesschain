# ChainlessChain 官网部署指南 v0.33.0

## 📋 目录

1. [快速开始](#快速开�?
2. [构建打包](#构建打包)
3. [部署方式](#部署方式)
   - [方式1: 服务器部署](#方式1-服务器部�?
   - [方式2: GitHub Pages](#方式2-github-pages)
   - [方式3: Netlify](#方式3-netlify)
   - [方式4: Vercel](#方式4-vercel)
   - [方式5: 云存储OSS](#方式5-云存储oss)
4. [服务器配置](#服务器配�?
5. [常见问题](#常见问题)

---

## 🚀 快速开�?

### 前置要求

- Node.js 14+ (用于构建脚本)
- Git (用于版本控制和部�?

### 一键构�?

```bash
# 进入网站目录
cd docs-website

# 构建打包
node build.js
```

## 构建完成后，所有文件将输出�?`dist/` 目录�?

## 📦 构建打包

### 使用构建脚本

**Windows:**

```bash
node build.js
```

**Linux/Mac:**

```bash
node build.js
# �?npm run build
```

### 构建输出

```
dist/
├── index.html                  # 主页
├── generate-qr-code.html       # 二维码生成器
├── css/                        # 样式文件
�?  └── style.css
├── js/                         # JavaScript
�?  └── main.js
├── images/                     # 图片资源
�?  ├── qr/
�?  └── ...
├── products/                   # 产品页面
├── technology/                 # 技术文�?├── logo.png
├── logo.svg
├── favicon.ico
├── style-enhancements.css
└── DEPLOY.txt                  # 部署说明

总文件数: ~50
总大�? ~2-3 MB
```

---

## 🌐 部署方式

### 方式1: 服务器部�?

#### 1.1 自动部署（推荐）

**配置服务器信息：**

编辑 `deploy-to-server.sh`（Linux/Mac）或 `deploy-to-server.bat`（Windows）：

````bash
# 修改这些变量
SERVER_USER="root"              # 服务器用户名
SERVER_HOST="your-server.com"   # 服务器地址
SERVER_PATH="/var/www/chainlesschain.com"  # 服务器路�?```

**执行部署�?*

**Windows:**
```bash
# 1. 先构�?node build.js

# 2. 部署
deploy-to-server.bat
````

**Linux/Mac:**

```bash
# 1. 添加执行权限
chmod +x deploy-to-server.sh

# 2. 构建并部�?npm run build
npm run deploy:server
```

#### 1.2 手动部署

**使用 SCP:**

```bash
scp -r dist/* user@server:/var/www/chainlesschain.com/
```

**使用 Rsync:**

```bash
rsync -avz --delete dist/ user@server:/var/www/chainlesschain.com/
```

**使用 FTP/SFTP:**

- 使用 FileZilla、WinSCP 等工�?- 连接服务�?- 上传 `dist/` 目录内容

#### 1.3 服务器配�?

\*_Nginx 配置示例�?_

创建配置文件 `/etc/nginx/sites-available/chainlesschain.com`�?

```nginx
# HTTP -> HTTPS 重定�?server {
    listen 80;
    listen [::]:80;
    server_name www.chainlesschain.com chainlesschain.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS 主配�?server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.chainlesschain.com chainlesschain.com;

    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/chainlesschain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chainlesschain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 网站根目�?    root /var/www/chainlesschain.com;
    index index.html;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript
               application/x-javascript application/xml+rss
               application/json application/javascript;

    # 静态文件缓�?    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # HTML 文件不缓�?    location ~* \.html$ {
        expires -1;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # 主页路由
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 安全�?    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
}
```

\*_启用配置�?_

```bash
# 创建软链�?sudo ln -s /etc/nginx/sites-available/chainlesschain.com /etc/nginx/sites-enabled/

# 测试配置
sudo nginx -t

# 重启 Nginx
sudo systemctl restart nginx
```

\*_Apache 配置示例�?_

创建 `/etc/apache2/sites-available/chainlesschain.com.conf`�?

```apache
<VirtualHost *:80>
    ServerName chainlesschain.com
    ServerAlias www.chainlesschain.com
    Redirect permanent / https://chainlesschain.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName chainlesschain.com
    ServerAlias www.chainlesschain.com

    DocumentRoot /var/www/chainlesschain.com

    # SSL 配置
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/chainlesschain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/chainlesschain.com/privkey.pem

    # Gzip 压缩
    <IfModule mod_deflate.c>
        AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript application/javascript
    </IfModule>

    # 缓存控制
    <Directory /var/www/chainlesschain.com>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted

        <FilesMatch "\.(jpg|jpeg|png|gif|ico|css|js|svg)$">
            Header set Cache-Control "max-age=2592000, public"
        </FilesMatch>

        <FilesMatch "\.html$">
            Header set Cache-Control "no-cache, no-store, must-revalidate"
        </FilesMatch>
    </Directory>
</VirtualHost>
```

\*_启用配置�?_

```bash
# 启用站点
sudo a2ensite chainlesschain.com

# 启用必要模块
sudo a2enmod ssl
sudo a2enmod rewrite
sudo a2enmod headers

# 重启 Apache
sudo systemctl restart apache2
```

**配置 SSL 证书（Let's Encrypt）：**

```bash
# 安装 Certbot
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx

# 获取证书（Nginx�?sudo certbot --nginx -d chainlesschain.com -d www.chainlesschain.com

# 或者（Apache�?sudo certbot --apache -d chainlesschain.com -d www.chainlesschain.com

# 自动续期
sudo certbot renew --dry-run
```

---

### 方式2: GitHub Pages

#### 2.1 自动部署

```bash
# 1. 构建
npm run build

# 2. 部署�?GitHub Pages
chmod +x deploy-to-github.sh
npm run deploy:github
```

#### 2.2 手动部署

```bash
# 1. 构建
node build.js

# 2. 进入 dist 目录
cd dist

# 3. 初始�?Git
git init
git checkout -b gh-pages

# 4. 提交
git add -A
git commit -m "Deploy to GitHub Pages"

# 5. 添加远程仓库
git remote add origin https://github.com/yourusername/chainlesschain.git

# 6. 推�?git push -f origin gh-pages

# 7. 返回主目�?cd ..
```

#### 2.3 配置 GitHub Pages

1. 访问仓库设置：`Settings` �?`Pages`
2. Source 选择 `gh-pages` 分支
3. 点击 `Save`
4. 等待部署完成�?-2分钟�?5. 访问：`https://yourusername.github.io/chainlesschain`

#### 2.4 自定义域�?

�?`dist/` 目录添加 `CNAME` 文件�?

```
www.chainlesschain.com
```

然后在域名提供商配置 DNS�?

```
类型    名称    �?CNAME   www     yourusername.github.io
A       @       185.199.108.153
A       @       185.199.109.153
A       @       185.199.110.153
A       @       185.199.111.153
```

---

### 方式3: Netlify

#### 3.1 拖拽部署（最简单）

1. 访问 https://app.netlify.com/drop
2. 拖拽 `dist/` 目录到页�?3. 等待部署完成
3. 获得临时域名：`random-name.netlify.app`

#### 3.2 命令行部�?

```bash
# 1. 安装 Netlify CLI
npm install -g netlify-cli

# 2. 登录
netlify login

# 3. 构建
npm run build

# 4. 部署
netlify deploy --prod --dir=dist
```

#### 3.3 Git 集成部署

1. 登录 Netlify
2. 点击 "New site from Git"
3. 选择仓库
4. 配置构建设置�? - Build command: `node build.js`
   - Publish directory: `dist`
5. 点击 "Deploy site"

#### 3.4 自定义域�?

1. 进入 Site settings �?Domain management
2. 点击 "Add custom domain"
3. 输入域名：`www.chainlesschain.com`
4. 配置 DNS（Netlify 会提供说明）

---

### 方式4: Vercel

#### 4.1 命令行部�?

```bash
# 1. 安装 Vercel CLI
npm install -g vercel

# 2. 登录
vercel login

# 3. 构建
npm run build

# 4. 部署
vercel --prod dist
```

#### 4.2 Git 集成部署

1. 访问 https://vercel.com/new
2. 导入 Git 仓库
3. 配置�? - Framework Preset: Other
   - Build Command: `node build.js`
   - Output Directory: `dist`
4. 点击 "Deploy"

---

### 方式5: 云存储（OSS�?

#### 5.1 阿里�?OSS

```bash
# 1. 安装 ossutil
wget http://gosspublic.alicdn.com/ossutil/1.7.14/ossutil64
chmod 755 ossutil64

# 2. 配置
./ossutil64 config

# 3. 上传
./ossutil64 cp -r dist/ oss://your-bucket/
```

�?OSS 控制台：

1. 开启静态网站托�?2. 设置默认首页：`index.html`
2. 绑定自定义域�?

#### 5.2 腾讯�?COS

```bash
# 1. 安装 COSCMD
pip install coscmd

# 2. 配置
coscmd config -a <SecretId> -s <SecretKey> -b <BucketName> -r <Region>

# 3. 上传
coscmd upload -r dist/ /
```

#### 5.3 AWS S3

```bash
# 1. 安装 AWS CLI
pip install awscli

# 2. 配置
aws configure

# 3. 上传
aws s3 sync dist/ s3://your-bucket/ --delete
```

启用静态网站托管：

```bash
aws s3 website s3://your-bucket/ --index-document index.html
```

---

## ⚙️ 服务器配�?

### 文件权限

```bash
# 设置目录权限
sudo chown -R www-data:www-data /var/www/chainlesschain.com
sudo chmod -R 755 /var/www/chainlesschain.com
```

### 防火墙配�?

```bash
# UFW (Ubuntu)
sudo ufw allow 'Nginx Full'
sudo ufw allow 22/tcp
sudo ufw enable

# Firewalld (CentOS)
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 性能优化

**开�?HTTP/2:**

```nginx
listen 443 ssl http2;
```

**开�?Brotli 压缩:**

```nginx
brotli on;
brotli_types text/plain text/css application/json application/javascript;
```

**CDN 加�?**

- 推荐使用 Cloudflare、阿里云 CDN、腾讯云 CDN
- 配置 CNAME 指向 CDN 地址
- 开�?HTTPS、Gzip、缓�?

---

## �?常见问题

### Q1: 构建失败

\*_错误�?_ `node: command not found`

\*_解决�?_

```bash
# 安装 Node.js
# Ubuntu
sudo apt-get install nodejs npm

# CentOS
sudo yum install nodejs npm

# macOS
brew install node
```

### Q2: 部署失败

\*_错误�?_ `Permission denied`

\*_解决�?_

```bash
# 检�?SSH 密钥
ssh-keygen -t rsa -b 4096
ssh-copy-id user@server

# 或者使用密码登�?scp -o PreferredAuthentications=password -r dist/* user@server:/path/
```

### Q3: 网站无法访问

**检查清单：**

1. DNS 是否正确解析
2. 防火墙是否开�?80/443 端口
3. Web 服务器是否正常运�?4. 文件权限是否正确
4. SSL 证书是否有效

\*_调试命令�?_

```bash
# 检�?DNS
nslookup chainlesschain.com

# 检查端�?telnet chainlesschain.com 80
telnet chainlesschain.com 443

# 检�?Nginx
sudo nginx -t
sudo systemctl status nginx

# 查看日志
sudo tail -f /var/log/nginx/error.log
```

### Q4: 企业微信二维码不显示

\*_原因�?_ 在线 API 无法访问

\*_解决方案1�?_ 使用本地图片

```bash
# 使用二维码生成工�?open generate-qr-code.html
# 下载二维码图片到 images/qr/wechat-enterprise.png
```

\*_解决方案2�?_ 修改 API 地址

```html
<!-- 使用国内镜像 -->
<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=..." />
```

### Q5: 页面更新不生�?

**原因�?\* 浏览器缓�?
**解决�?\*

1. 强制刷新：Ctrl + Shift + R（Windows�? Cmd + Shift + R（Mac�?2. 清除浏览器缓�?3. 使用隐私/无痕模式测试

---

## 📞 技术支�?

如遇到部署问题，请联系：

- 📞 客服热线�?00-1068-687
- 💬 企业微信：https://work.weixin.qq.com/ca/cawcde653996f7ecb2
- 📧 技术支持：zhanglongfa@chainlesschain.com
- 🐛 GitHub Issues：https://github.com/chainlesschain/chainlesschain/issues

---

**更新时间�?\* 2026-01-28
**版本�?\* v0.33.0
**ChainlessChain - 让数据主权回归个人，AI效率触手可及**
