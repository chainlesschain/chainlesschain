# U盾/SIMKey厂家服务端系统架构设计

## 一、系统概述

### 1.1 系统定位
本系统是U盾和SIMKey设备的厂家管理平台,提供设备全生命周期管理功能:
- 设备注册和下发
- 设备激活和绑定
- 密码找回和重置
- 数据备份和恢复
- 设备状态监控

### 1.2 技术架构

```
┌─────────────────────────────────────────────────────┐
│              Vue.js PC管理前端                        │
│  - 设备管理  - 用户管理  - 统计报表  - 系统配置     │
└─────────────────────────────────────────────────────┘
                        ↕ HTTPS/REST API
┌─────────────────────────────────────────────────────┐
│            Spring Boot 后端服务                       │
│  ┌──────────┬──────────┬──────────┬──────────┐    │
│  │ 设备管理 │ 用户管理 │ 安全认证 │ 审计日志 │    │
│  └──────────┴──────────┴──────────┴──────────┘    │
│  ┌──────────┬──────────┬──────────┬──────────┐    │
│  │ 密钥服务 │ 备份恢复 │ 监控告警 │ 报表统计 │    │
│  └──────────┴──────────┴──────────┴──────────┘    │
└─────────────────────────────────────────────────────┘
                        ↕
┌─────────────────────────────────────────────────────┐
│                 MySQL 数据库                          │
│  - 设备表  - 用户表  - 操作日志  - 备份记录         │
└─────────────────────────────────────────────────────┘
```

## 二、核心功能模块

### 2.1 设备管理模块

#### 2.1.1 设备注册
- 批量导入设备信息
- 生成设备唯一标识
- 分配设备序列号
- 设置设备初始状态

#### 2.1.2 设备下发
- 设备分配给经销商/用户
- 生成激活码
- 设置有效期
- 记录下发历史

#### 2.1.3 设备激活
- 验证激活码
- 绑定用户信息
- 初始化设备密钥
- 更新设备状态

#### 2.1.4 设备管理
- 查询设备状态
- 锁定/解锁设备
- 设备注销
- 设备更换

### 2.2 密钥管理模块

#### 2.2.1 主密钥生成
- HSM硬件密钥生成
- 密钥分片存储
- 密钥备份机制

#### 2.2.2 设备密钥派生
- 基于主密钥派生设备密钥
- KDF密钥派生函数
- 密钥版本管理

#### 2.2.3 密钥恢复
- 验证用户身份
- 解密备份密钥
- 重新下发到设备

### 2.3 用户管理模块

#### 2.3.1 用户注册
- 用户基本信息
- 实名认证(可选)
- 设备绑定

#### 2.3.2 密码管理
- 密码重置
- 安全问题验证
- 手机/邮箱验证
- 助记词恢复

#### 2.3.3 数据恢复
- 备份数据查询
- 恢复申请审核
- 数据解密下发

### 2.4 监控与审计

#### 2.4.1 操作日志
- 所有API调用记录
- 敏感操作审计
- 异常行为告警

#### 2.4.2 设备监控
- 设备在线状态
- 激活率统计
- 故障设备追踪

#### 2.4.3 报表统计
- 设备分布统计
- 激活趋势分析
- 用户增长报表

## 三、数据库设计

### 3.1 设备表 (devices)
```sql
CREATE TABLE devices (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    device_id VARCHAR(64) UNIQUE NOT NULL COMMENT '设备唯一标识',
    device_type VARCHAR(20) NOT NULL COMMENT 'UKEY或SIMKEY',
    serial_number VARCHAR(64) UNIQUE NOT NULL COMMENT '设备序列号',
    manufacturer VARCHAR(50) COMMENT '制造商',
    model VARCHAR(50) COMMENT '型号',
    hardware_version VARCHAR(20) COMMENT '硬件版本',
    firmware_version VARCHAR(20) COMMENT '固件版本',
    status VARCHAR(20) DEFAULT 'INACTIVE' COMMENT '设备状态: INACTIVE, ACTIVE, LOCKED, DEACTIVATED',
    activation_code VARCHAR(64) COMMENT '激活码',
    activation_expires_at DATETIME COMMENT '激活码过期时间',
    activated_at DATETIME COMMENT '激活时间',
    user_id BIGINT COMMENT '绑定用户ID',
    distributor_id BIGINT COMMENT '经销商ID',
    master_key_encrypted TEXT COMMENT '加密的主密钥',
    backup_data_encrypted TEXT COMMENT '加密的备份数据',
    last_seen_at DATETIME COMMENT '最后在线时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_device_id (device_id),
    INDEX idx_serial_number (serial_number),
    INDEX idx_status (status),
    INDEX idx_user_id (user_id)
);
```

### 3.2 用户表 (users)
```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    real_name VARCHAR(50),
    id_card VARCHAR(18) COMMENT '身份证号(加密)',
    role VARCHAR(20) DEFAULT 'USER' COMMENT 'ADMIN, DISTRIBUTOR, USER',
    status VARCHAR(20) DEFAULT 'ACTIVE' COMMENT 'ACTIVE, LOCKED, DELETED',
    mnemonic_hash VARCHAR(255) COMMENT '助记词哈希(用于验证)',
    security_question TEXT COMMENT 'JSON格式安全问题',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at DATETIME,
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_phone (phone)
);
```

### 3.3 设备操作日志 (device_logs)
```sql
CREATE TABLE device_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    device_id VARCHAR(64) NOT NULL,
    user_id BIGINT,
    operation VARCHAR(50) NOT NULL COMMENT '操作类型',
    operation_detail TEXT COMMENT '操作详情(JSON)',
    ip_address VARCHAR(50),
    user_agent VARCHAR(255),
    status VARCHAR(20) COMMENT 'SUCCESS, FAILED',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_device_id (device_id),
    INDEX idx_user_id (user_id),
    INDEX idx_operation (operation),
    INDEX idx_created_at (created_at)
);
```

### 3.4 密钥备份表 (key_backups)
```sql
CREATE TABLE key_backups (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    device_id VARCHAR(64) NOT NULL,
    user_id BIGINT NOT NULL,
    backup_type VARCHAR(20) COMMENT 'FULL, INCREMENTAL',
    encrypted_data LONGTEXT NOT NULL COMMENT '加密的备份数据',
    encryption_method VARCHAR(50) COMMENT '加密方式',
    backup_hash VARCHAR(64) COMMENT '备份数据哈希',
    restore_count INT DEFAULT 0 COMMENT '恢复次数',
    last_restored_at DATETIME,
    expires_at DATETIME COMMENT '备份过期时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_device_id (device_id),
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
);
```

### 3.5 激活码表 (activation_codes)
```sql
CREATE TABLE activation_codes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    code VARCHAR(64) UNIQUE NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    batch_id VARCHAR(50) COMMENT '批次号',
    status VARCHAR(20) DEFAULT 'UNUSED' COMMENT 'UNUSED, USED, EXPIRED',
    max_uses INT DEFAULT 1,
    used_count INT DEFAULT 0,
    distributor_id BIGINT COMMENT '分配的经销商',
    activated_by BIGINT COMMENT '激活用户ID',
    activated_at DATETIME,
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_device_id (device_id),
    INDEX idx_status (status)
);
```

## 四、API接口设计

### 4.1 设备管理API

#### POST /api/devices/register
批量注册设备
```json
Request:
{
  "devices": [
    {
      "deviceType": "UKEY",
      "serialNumber": "UK20240101001",
      "manufacturer": "FeiyinChengxin",
      "model": "FT-A22"
    }
  ]
}

Response:
{
  "success": true,
  "data": {
    "registered": 100,
    "failed": 0
  }
}
```

#### POST /api/devices/activate
激活设备
```json
Request:
{
  "activationCode": "XXXX-XXXX-XXXX-XXXX",
  "deviceId": "uk_xxx",
  "userId": 12345
}

Response:
{
  "success": true,
  "data": {
    "deviceId": "uk_xxx",
    "status": "ACTIVE",
    "activatedAt": "2024-01-01T10:00:00Z"
  }
}
```

#### POST /api/devices/lock
锁定设备
```json
Request:
{
  "deviceId": "uk_xxx",
  "reason": "Lost device"
}
```

#### POST /api/devices/unlock
解锁设备
```json
Request:
{
  "deviceId": "uk_xxx",
  "verificationCode": "123456"
}
```

### 4.2 密码恢复API

#### POST /api/recovery/initiate
发起密码恢复
```json
Request:
{
  "deviceId": "uk_xxx",
  "userId": 12345,
  "verificationType": "SMS" // SMS, EMAIL, SECURITY_QUESTION, MNEMONIC
}

Response:
{
  "success": true,
  "data": {
    "recoveryId": "rec_xxx",
    "expiresIn": 1800 // 30分钟
  }
}
```

#### POST /api/recovery/verify
验证恢复信息
```json
Request:
{
  "recoveryId": "rec_xxx",
  "verificationCode": "123456"
}
```

#### POST /api/recovery/reset-password
重置密码
```json
Request:
{
  "recoveryId": "rec_xxx",
  "newPassword": "newSecurePassword123"
}
```

### 4.3 数据备份恢复API

#### POST /api/backup/create
创建备份
```json
Request:
{
  "deviceId": "uk_xxx",
  "backupType": "FULL",
  "encryptedData": "base64_encrypted_data..."
}
```

#### GET /api/backup/list
查询备份列表
```
GET /api/backup/list?deviceId=uk_xxx&userId=12345
```

#### POST /api/backup/restore
恢复数据
```json
Request:
{
  "backupId": 123,
  "deviceId": "uk_new_xxx"
}

Response:
{
  "success": true,
  "data": {
    "encryptedData": "base64_encrypted_data...",
    "restoreKey": "..."
  }
}
```

### 4.4 统计报表API

#### GET /api/statistics/devices
设备统计
```
GET /api/statistics/devices?startDate=2024-01-01&endDate=2024-12-31
```

#### GET /api/statistics/activation
激活率统计
```
GET /api/statistics/activation?period=MONTHLY
```

## 五、安全机制

### 5.1 认证授权
- JWT Token认证
- 角色权限控制(RBAC)
- API密钥管理

### 5.2 数据加密
- 传输层: TLS 1.3
- 存储层: AES-256-GCM
- 密钥管理: HSM或KMS

### 5.3 审计日志
- 所有敏感操作记录
- IP地址追踪
- 异常告警

### 5.4 访问控制
- IP白名单
- 请求频率限制
- 设备指纹识别

## 六、部署架构

### 6.1 开发环境
```
docker-compose.yml
├── Spring Boot应用
├── MySQL 8.0
├── Redis缓存
└── Nginx反向代理
```

### 6.2 生产环境
```
Kubernetes集群
├── Spring Boot Pod (多副本)
├── MySQL主从复制
├── Redis集群
├── Elasticsearch日志
└── Prometheus监控
```

## 七、技术栈

### 后端 (Spring Boot)
- Spring Boot 3.2
- Spring Security + JWT
- MyBatis Plus
- MySQL 8.0
- Redis 7.0
- Swagger/OpenAPI 3.0

### 前端 (Vue.js)
- Vue 3 + Composition API
- Element Plus UI
- Axios
- Vue Router
- Pinia状态管理
- ECharts图表

### 开发工具
- Maven 3.8+
- Node.js 18+
- Docker & Docker Compose
- Git
