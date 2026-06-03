# 安装部署

本指南提供U盾/SIMKey厂家管理系统的详细安装和部署说明。

## 部署方式选择

### Docker部署（推荐）

✅ **优点**:
- 一键启动，无需配置环境
- 所有依赖已打包
- 版本管理简单
- 适合快速体验和生产环境

❌ **限制**:
- 需要安装Docker
- 占用一定磁盘空间

### 手动部署

✅ **优点**:
- 完全控制
- 可自定义配置
- 适合开发调试

❌ **限制**:
- 需要手动安装JDK、Node.js等
- 配置复杂
- 需要一定技术基础

## 方式一: Docker部署

### 环境要求

- **Docker**: 20.10+
- **Docker Compose**: 2.0+
- **磁盘空间**: 至少5GB
- **内存**: 至少4GB

### 安装Docker

#### Windows

1. 下载 [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
2. 运行安装程序
3. 启动Docker Desktop
4. 确认安装成功：
```cmd
docker --version
docker-compose --version
```

#### Mac

1. 下载 [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop)
2. 安装.dmg文件
3. 启动Docker Desktop
4. 确认安装成功：
```bash
docker --version
docker-compose --version
```

#### Linux (Ubuntu/Debian)

```bash
# 更新包索引
sudo apt-get update

# 安装依赖
sudo apt-get install ca-certificates curl gnupg lsb-release

# 添加Docker GPG密钥
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# 设置Docker仓库
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装Docker Engine
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 启动Docker服务
sudo systemctl start docker
sudo systemctl enable docker

# 确认安装成功
docker --version
docker compose version
```

### 快速部署

#### 1. 克隆项目

```bash
git clone https://github.com/chainlesschain/manufacturer-system.git
cd manufacturer-system
```

#### 2. 一键启动

**Windows**:
```cmd
start.bat
```

**Linux/Mac**:
```bash
chmod +x start.sh
./start.sh
```

启动脚本会自动完成以下任务：
1. 检查Docker环境
2. 拉取所有Docker镜像
3. 启动MySQL、Redis、后端、前端服务
4. 初始化数据库
5. 创建默认管理员账号

#### 3. 访问系统

等待约30秒后，访问：

- **前端**: http://localhost
- **API文档**: http://localhost:8080/api/swagger-ui.html
- **账号**: admin / admin123456

### 自定义配置

如果需要自定义端口或其他配置，编辑 `docker-compose.yml`:

```yaml
version: '3.8'

services:
  # MySQL数据库
  mysql:
    image: mysql:8.0
    container_name: manufacturer-mysql
    environment:
      MYSQL_ROOT_PASSWORD: root123456  # 修改数据库密码
      MYSQL_DATABASE: manufacturer_system
    ports:
      - "3306:3306"  # 修改映射端口
    volumes:
      - mysql-data:/var/lib/mysql
      - ./backend/src/main/resources/db:/docker-entrypoint-initdb.d
    command: --default-authentication-plugin=mysql_native_password

  # Redis缓存
  redis:
    image: redis:7.0-alpine
    container_name: manufacturer-redis
    ports:
      - "6379:6379"  # 修改映射端口
    volumes:
      - redis-data:/data

  # Spring Boot后端
  backend:
    build: ./backend
    container_name: manufacturer-backend
    environment:
      SPRING_DATASOURCE_URL: jdbc:mysql://mysql:3306/manufacturer_system
      SPRING_DATASOURCE_USERNAME: root
      SPRING_DATASOURCE_PASSWORD: root123456  # 与MySQL密码一致
      SPRING_REDIS_HOST: redis
      JWT_SECRET: your-custom-secret-key-change-this-in-production  # 修改JWT密钥
    ports:
      - "8080:8080"  # 修改映射端口
    depends_on:
      - mysql
      - redis
    volumes:
      - ./data/uploads:/app/uploads

  # Vue.js前端
  frontend:
    build: ./frontend
    container_name: manufacturer-frontend
    ports:
      - "80:80"  # 修改映射端口（如改为8888:80）
    depends_on:
      - backend

volumes:
  mysql-data:
  redis-data:
```

修改后重新启动：

```bash
docker-compose down
docker-compose up -d
```

### Docker常用命令

```bash
# 查看所有容器状态
docker-compose ps

# 启动所有服务
docker-compose up -d

# 停止所有服务
docker-compose down

# 重启某个服务
docker-compose restart backend

# 查看日志
docker-compose logs -f
docker-compose logs -f backend  # 只看后端日志

# 进入容器
docker-compose exec backend bash
docker-compose exec mysql bash

# 查看资源使用
docker stats

# 清理所有（包括数据）
docker-compose down -v
```

## 方式二: 手动部署

### 环境要求

#### 后端要求

- **JDK**: 17+
- **Maven**: 3.8+
- **MySQL**: 8.0+
- **Redis**: 7.0+

#### 前端要求

- **Node.js**: 18+
- **npm**: 9+ 或 yarn 1.22+

### 后端部署

#### 1. 安装JDK

**Windows**:
1. 下载 [OpenJDK 17](https://adoptium.net/)
2. 安装并配置环境变量JAVA_HOME

**Linux**:
```bash
sudo apt-get update
sudo apt-get install openjdk-17-jdk
java -version
```

**Mac**:
```bash
brew install openjdk@17
java -version
```

#### 2. 安装Maven

**Windows**:
1. 下载 [Maven](https://maven.apache.org/download.cgi)
2. 解压并配置环境变量

**Linux**:
```bash
sudo apt-get install maven
mvn -version
```

**Mac**:
```bash
brew install maven
mvn -version
```

#### 3. 安装MySQL

**Windows**:
1. 下载 [MySQL Installer](https://dev.mysql.com/downloads/installer/)
2. 安装MySQL Server 8.0

**Linux**:
```bash
sudo apt-get update
sudo apt-get install mysql-server
sudo systemctl start mysql
sudo systemctl enable mysql
```

**Mac**:
```bash
brew install mysql@8.0
brew services start mysql
```

#### 4. 创建数据库

```bash
# 登录MySQL
mysql -u root -p

# 创建数据库
CREATE DATABASE manufacturer_system DEFAULT CHARACTER SET utf8mb4;

# 退出
exit
```

#### 5. 导入数据库表

```bash
cd manufacturer-system/backend

# 导入表结构和数据
mysql -u root -p manufacturer_system < src/main/resources/db/schema.sql
mysql -u root -p manufacturer_system < src/main/resources/db/app_version_schema.sql
```

#### 6. 安装Redis

**Windows**:
- 下载 [Redis for Windows](https://github.com/microsoftarchive/redis/releases)
- 解压并运行`redis-server.exe`

**Linux**:
```bash
sudo apt-get install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

**Mac**:
```bash
brew install redis
brew services start redis
```

#### 7. 配置后端

编辑 `backend/src/main/resources/application.yml`:

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/manufacturer_system?useSSL=false&serverTimezone=Asia/Shanghai
    username: root
    password: your_mysql_password  # 修改为你的MySQL密码
    driver-class-name: com.mysql.cj.jdbc.Driver

  redis:
    host: localhost
    port: 6379
    password:  # 如果Redis设置了密码，填写这里

  servlet:
    multipart:
      max-file-size: 2GB
      max-request-size: 2GB

jwt:
  secret: your-secret-key-at-least-256-bits-change-this-in-production  # 修改JWT密钥
  expiration: 86400000  # 24小时

system:
  upload-path: ./uploads
  activation-code-validity-days: 365
  recovery-code-validity-seconds: 1800
  backup-retention-days: 730

server:
  port: 8080
```

#### 8. 编译和启动后端

```bash
cd backend

# 编译
mvn clean package -DskipTests

# 启动
java -jar target/manufacturer-system-1.0.0-SNAPSHOT.jar
```

或使用Maven直接运行：

```bash
mvn spring-boot:run
```

后端启动成功后，访问：http://localhost:8080/api/swagger-ui.html

### 前端部署

#### 1. 安装Node.js

**Windows**:
1. 下载 [Node.js LTS](https://nodejs.org/)
2. 运行安装程序

**Linux**:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Mac**:
```bash
brew install node@18
```

确认安装：
```bash
node -v
npm -v
```

#### 2. 安装依赖

```bash
cd frontend
npm install
```

如果npm速度慢，可以使用国内镜像：

```bash
npm config set registry https://registry.npmmirror.com
npm install
```

#### 3. 配置前端

编辑 `frontend/vite.config.js`:

```javascript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  server: {
    port: 3000,  // 修改前端端口
    proxy: {
      '/api': {
        target: 'http://localhost:8080',  # 后端地址
        changeOrigin: true
      }
    }
  }
})
```

#### 4. 启动前端开发服务器

```bash
npm run dev
```

访问：http://localhost:3000

#### 5. 构建生产版本

```bash
npm run build
```

构建完成后，`dist`目录包含所有静态文件。

### 生产环境部署（Nginx）

#### 1. 安装Nginx

**Linux**:
```bash
sudo apt-get install nginx
```

**Mac**:
```bash
brew install nginx
```

#### 2. 配置Nginx

创建配置文件 `/etc/nginx/sites-available/manufacturer`:

```nginx
server {
    listen 80;
    server_name your-domain.com;  # 修改为你的域名

    # 前端静态文件
    location / {
        root /var/www/manufacturer/frontend;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # 代理后端API
    location /api/ {
        proxy_pass http://localhost:8080/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 上传文件大小限制
    client_max_body_size 2G;

    # Gzip压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

#### 3. 部署文件

```bash
# 复制前端构建文件
sudo mkdir -p /var/www/manufacturer
sudo cp -r dist/* /var/www/manufacturer/frontend/

# 复制后端jar包
sudo mkdir -p /opt/manufacturer
sudo cp backend/target/*.jar /opt/manufacturer/
```

#### 4. 配置后端服务（systemd）

创建服务文件 `/etc/systemd/system/manufacturer-backend.service`:

```ini
[Unit]
Description=Manufacturer System Backend
After=network.target mysql.service redis.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/manufacturer
ExecStart=/usr/bin/java -jar /opt/manufacturer/manufacturer-system-1.0.0-SNAPSHOT.jar
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

#### 5. 启动服务

```bash
# 启用Nginx配置
sudo ln -s /etc/nginx/sites-available/manufacturer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# 启动后端服务
sudo systemctl daemon-reload
sudo systemctl start manufacturer-backend
sudo systemctl enable manufacturer-backend

# 查看服务状态
sudo systemctl status manufacturer-backend
```

## SSL证书配置

### 使用Let's Encrypt

```bash
# 安装certbot
sudo apt-get install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

### 手动配置SSL

编辑Nginx配置：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/your/cert.pem;
    ssl_certificate_key /path/to/your/key.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # ... 其他配置
}

# HTTP重定向到HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

## 安全配置

### 1. 修改默认密码

首次登录后立即修改默认管理员密码。

### 2. 配置防火墙

```bash
# 只开放必要端口
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable
```

### 3. 数据库安全

```bash
# 运行MySQL安全脚本
sudo mysql_secure_installation
```

### 4. JWT密钥

修改 `application.yml` 中的JWT密钥为随机生成的强密钥：

```bash
# 生成随机密钥
openssl rand -base64 64
```

### 5. 定期备份

设置定时任务备份数据库：

```bash
# 编辑crontab
crontab -e

# 添加每天凌晨2点备份
0 2 * * * /usr/bin/mysqldump -u root -p'password' manufacturer_system > /backup/db_$(date +\%Y\%m\%d).sql
```

## 性能优化

### 1. MySQL优化

编辑 `/etc/mysql/my.cnf`:

```ini
[mysqld]
# 连接池
max_connections = 1000

# 缓存
innodb_buffer_pool_size = 2G
query_cache_size = 64M

# 日志
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 2
```

### 2. Redis优化

编辑 `/etc/redis/redis.conf`:

```conf
# 最大内存
maxmemory 1gb
maxmemory-policy allkeys-lru

# 持久化
save 900 1
save 300 10
save 60 10000
```

### 3. JVM优化

修改启动命令：

```bash
java -Xms2g -Xmx4g -XX:+UseG1GC -jar manufacturer-system.jar
```

### 4. Nginx缓存

```nginx
# 静态文件缓存
location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
    expires 7d;
    add_header Cache-Control "public, immutable";
}
```

## 监控和日志

### 1. 应用日志

后端日志位置：`/opt/manufacturer/logs/`

配置日志级别（`application.yml`）：

```yaml
logging:
  level:
    root: INFO
    com.chainlesschain.manufacturer: DEBUG
  file:
    name: /opt/manufacturer/logs/application.log
    max-size: 100MB
    max-history: 30
```

### 2. 系统监控

```bash
# 查看系统资源
htop

# 查看磁盘使用
df -h

# 查看数据库连接
mysql -u root -p -e "SHOW PROCESSLIST"

# 查看Redis状态
redis-cli INFO
```

## 故障排查

### 后端启动失败

```bash
# 查看后端日志
tail -f /opt/manufacturer/logs/application.log

# 检查端口占用
sudo netstat -tlnp | grep 8080

# 检查数据库连接
mysql -u root -p -h localhost manufacturer_system
```

### 前端访问失败

```bash
# 查看Nginx错误日志
tail -f /var/log/nginx/error.log

# 检查Nginx配置
sudo nginx -t

# 重启Nginx
sudo systemctl restart nginx
```

## 下一步

- [快速开始](/manufacturer/quick-start) - 学习使用系统
- [设备管理](/manufacturer/device-manage) - 了解设备管理功能
- [API文档](/api/manufacturer/devices) - 集成开发

---

如有部署问题，请联系技术支持：zhanglongfa@chainlesschain.com
