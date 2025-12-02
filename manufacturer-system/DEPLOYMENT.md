# 部署指南

本文档详细说明如何在不同环境下部署U盾/SIMKey厂家管理系统。

## 目录

- [环境要求](#环境要求)
- [Docker部署(推荐)](#docker部署推荐)
- [手动部署](#手动部署)
- [生产环境部署](#生产环境部署)
- [常见问题](#常见问题)

## 环境要求

### 最低配置
- CPU: 2核
- 内存: 4GB
- 硬盘: 50GB
- 操作系统: Linux/Windows/macOS

### 推荐配置
- CPU: 4核+
- 内存: 8GB+
- 硬盘: 100GB+
- 操作系统: Ubuntu 20.04 LTS / CentOS 8+

### 软件依赖
- Docker 20.10+ & Docker Compose 2.0+ (Docker部署)
- JDK 17+ (手动部署)
- Maven 3.8+ (手动部署)
- Node.js 18+ (手动部署)
- MySQL 8.0+
- Redis 7.0+

## Docker部署(推荐)

### Windows系统

1. **安装Docker Desktop**
   - 下载: https://www.docker.com/products/docker-desktop
   - 安装并启动Docker Desktop
   - 确保Docker运行正常: `docker --version`

2. **克隆项目**
```cmd
git clone <repository-url>
cd manufacturer-system
```

3. **一键启动**
```cmd
start.bat
```

或手动执行:
```cmd
docker-compose up -d
```

4. **访问系统**
- 前端: http://localhost
- API文档: http://localhost:8080/api/swagger-ui.html

### Linux/Mac系统

1. **安装Docker**
```bash
# Ubuntu
sudo apt-get update
sudo apt-get install docker.io docker-compose

# CentOS
sudo yum install docker docker-compose

# Mac (使用Homebrew)
brew install docker docker-compose
```

2. **克隆项目**
```bash
git clone <repository-url>
cd manufacturer-system
```

3. **启动服务**
```bash
chmod +x start.sh
./start.sh
```

或手动执行:
```bash
docker-compose up -d
```

4. **查看日志**
```bash
docker-compose logs -f
```

5. **停止服务**
```bash
docker-compose down
```

### Docker部署说明

#### 容器列表
- `manufacturer-mysql` - MySQL 8.0数据库
- `manufacturer-redis` - Redis 7缓存
- `manufacturer-backend` - Spring Boot后端服务
- `manufacturer-frontend` - Vue.js前端 + Nginx

#### 数据持久化
数据存储在 `./data` 目录:
```
data/
├── mysql/      # 数据库文件
├── redis/      # Redis持久化文件
└── uploads/    # 上传的文件
```

#### 端口映射
- 80 → 前端界面
- 8080 → 后端API
- 3306 → MySQL (仅开发环境暴露)
- 6379 → Redis (仅开发环境暴露)

## 手动部署

### 后端部署

#### 1. 安装JDK 17
```bash
# Ubuntu
sudo apt install openjdk-17-jdk

# 验证安装
java -version
```

#### 2. 安装Maven
```bash
# Ubuntu
sudo apt install maven

# 验证安装
mvn -version
```

#### 3. 安装并配置MySQL

**安装MySQL 8.0**
```bash
# Ubuntu
sudo apt install mysql-server-8.0

# 启动MySQL
sudo systemctl start mysql
sudo systemctl enable mysql
```

**创建数据库和用户**
```sql
CREATE DATABASE manufacturer_system DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'manufacturer'@'localhost' IDENTIFIED BY 'manufacturer123';
GRANT ALL PRIVILEGES ON manufacturer_system.* TO 'manufacturer'@'localhost';
FLUSH PRIVILEGES;
```

**导入数据库表**
```bash
mysql -u manufacturer -p manufacturer_system < backend/src/main/resources/db/schema.sql
mysql -u manufacturer -p manufacturer_system < backend/src/main/resources/db/app_version_schema.sql
```

#### 4. 安装Redis
```bash
# Ubuntu
sudo apt install redis-server

# 启动Redis
sudo systemctl start redis
sudo systemctl enable redis
```

#### 5. 编译后端
```bash
cd backend
mvn clean package -DskipTests
```

#### 6. 启动后端

**开发模式**
```bash
java -jar target/manufacturer-system-1.0.0-SNAPSHOT.jar
```

**生产模式 (使用systemd)**

创建服务文件 `/etc/systemd/system/manufacturer-backend.service`:
```ini
[Unit]
Description=Manufacturer System Backend
After=mysql.service redis.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/manufacturer-system/backend
ExecStart=/usr/bin/java -jar -Xms512m -Xmx1024m -Dspring.profiles.active=prod /opt/manufacturer-system/backend/target/manufacturer-system-1.0.0-SNAPSHOT.jar
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启动服务:
```bash
sudo systemctl daemon-reload
sudo systemctl start manufacturer-backend
sudo systemctl enable manufacturer-backend
```

### 前端部署

#### 1. 安装Node.js
```bash
# 使用NodeSource仓库
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证安装
node -v
npm -v
```

#### 2. 构建前端
```bash
cd frontend
npm install
npm run build
```

#### 3. 部署到Nginx

**安装Nginx**
```bash
sudo apt install nginx
```

**配置Nginx**

创建配置文件 `/etc/nginx/sites-available/manufacturer-system`:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /opt/manufacturer-system/frontend/dist;
    index index.html;

    # Gzip压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # 前端路由
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API代理
    location /api/ {
        proxy_pass http://localhost:8080/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 静态资源缓存
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|woff|woff2|ttf|svg)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

启用站点:
```bash
sudo ln -s /etc/nginx/sites-available/manufacturer-system /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 生产环境部署

### 安全配置

#### 1. 修改默认密码
```yaml
# backend/src/main/resources/application-prod.yml
spring:
  datasource:
    password: <strong-password>

jwt:
  secret: <generate-random-secret>

# 修改数据库中的管理员密码
UPDATE users SET password_hash = <bcrypt-hash> WHERE username = 'admin';
```

#### 2. 启用HTTPS

**使用Let's Encrypt申请免费证书**
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

**Nginx HTTPS配置**
```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 其他配置同上...
}

# HTTP重定向到HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

#### 3. 防火墙配置
```bash
# Ubuntu UFW
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# CentOS firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

#### 4. 数据库安全
```bash
# 运行MySQL安全脚本
sudo mysql_secure_installation

# 配置MySQL只监听本地
# /etc/mysql/mysql.conf.d/mysqld.cnf
bind-address = 127.0.0.1
```

### 性能优化

#### 1. MySQL优化
```ini
# /etc/mysql/mysql.conf.d/mysqld.cnf
[mysqld]
innodb_buffer_pool_size = 2G
innodb_log_file_size = 512M
max_connections = 500
query_cache_size = 64M
```

#### 2. Redis优化
```
# /etc/redis/redis.conf
maxmemory 1gb
maxmemory-policy allkeys-lru
```

#### 3. JVM参数优化
```bash
java -jar \
  -Xms2g -Xmx2g \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \
  -XX:+HeapDumpOnOutOfMemoryError \
  app.jar
```

### 监控和备份

#### 1. 日志管理
```bash
# 配置logrotate
sudo vim /etc/logrotate.d/manufacturer-system

/opt/manufacturer-system/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data www-data
}
```

#### 2. 数据库备份
```bash
# 创建备份脚本
vim /opt/scripts/backup-mysql.sh

#!/bin/bash
BACKUP_DIR="/opt/backups/mysql"
DATE=$(date +%Y%m%d_%H%M%S)
mysqldump -u manufacturer -p'password' manufacturer_system | gzip > $BACKUP_DIR/backup_$DATE.sql.gz
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete

# 添加到crontab
crontab -e
0 2 * * * /opt/scripts/backup-mysql.sh
```

## 常见问题

### 1. 端口被占用
```bash
# 查看端口占用
netstat -tulnp | grep 8080

# 修改端口
# backend/src/main/resources/application.yml
server:
  port: 9090
```

### 2. 内存不足
```bash
# 调整JVM内存
java -jar -Xms256m -Xmx512m app.jar
```

### 3. 数据库连接失败
- 检查MySQL服务是否运行
- 验证用户名密码正确
- 确认数据库已创建
- 检查防火墙规则

### 4. Docker容器无法启动
```bash
# 查看详细日志
docker-compose logs backend

# 重新构建镜像
docker-compose build --no-cache

# 清理旧容器和镜像
docker system prune -a
```

### 5. 前端无法访问后端
- 检查后端服务是否正常
- 验证Nginx配置正确
- 确认代理路径配置
- 查看浏览器控制台错误

## 升级指南

### Docker环境升级
```bash
# 1. 备份数据
docker-compose exec mysql mysqldump -u root -p manufacturer_system > backup.sql

# 2. 停止服务
docker-compose down

# 3. 拉取新代码
git pull

# 4. 重新构建
docker-compose build

# 5. 启动服务
docker-compose up -d

# 6. 执行数据库迁移(如有)
docker-compose exec backend java -jar app.jar --spring.liquibase.enabled=true
```

### 手动环境升级
```bash
# 1. 备份数据库
mysqldump -u manufacturer -p manufacturer_system > backup.sql

# 2. 停止服务
sudo systemctl stop manufacturer-backend

# 3. 更新代码
cd /opt/manufacturer-system
git pull

# 4. 重新编译
cd backend
mvn clean package -DskipTests

# 5. 重新构建前端
cd ../frontend
npm install
npm run build

# 6. 启动服务
sudo systemctl start manufacturer-backend
```

## 技术支持

如遇到问题,请联系:
- 邮箱: zhanglongfa@chainlesschain.com
- 电话: 400-1068-687
- 官网: https://www.chainlesschain.com
