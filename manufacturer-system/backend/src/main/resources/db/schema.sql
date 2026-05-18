-- U盾/SIMKey厂家管理系统数据库初始化脚本

-- 创建数据库
CREATE DATABASE IF NOT EXISTS manufacturer_system DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE manufacturer_system;

-- 设备表
CREATE TABLE IF NOT EXISTS devices (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    device_id VARCHAR(64) UNIQUE NOT NULL COMMENT '设备唯一标识',
    device_type VARCHAR(20) NOT NULL COMMENT '设备类型: UKEY, SIMKEY',
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted TINYINT DEFAULT 0 COMMENT '逻辑删除: 0-未删除, 1-已删除',
    INDEX idx_device_id (device_id),
    INDEX idx_serial_number (serial_number),
    INDEX idx_status (status),
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='设备表';

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    username VARCHAR(50) UNIQUE NOT NULL COMMENT '用户名',
    email VARCHAR(100) UNIQUE COMMENT '邮箱',
    phone VARCHAR(20) UNIQUE COMMENT '手机号',
    password_hash VARCHAR(255) NOT NULL COMMENT '密码哈希',
    real_name VARCHAR(50) COMMENT '真实姓名',
    id_card VARCHAR(255) COMMENT '身份证号(加密)',
    role VARCHAR(20) DEFAULT 'USER' COMMENT '角色: ADMIN, DISTRIBUTOR, USER',
    status VARCHAR(20) DEFAULT 'ACTIVE' COMMENT '状态: ACTIVE, LOCKED, DELETED',
    mnemonic_hash VARCHAR(255) COMMENT '助记词哈希(用于验证)',
    security_question TEXT COMMENT 'JSON格式安全问题',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    last_login_at DATETIME COMMENT '最后登录时间',
    deleted TINYINT DEFAULT 0 COMMENT '逻辑删除: 0-未删除, 1-已删除',
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_phone (phone),
    INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- 设备操作日志表
CREATE TABLE IF NOT EXISTS device_logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    device_id VARCHAR(64) NOT NULL COMMENT '设备ID',
    user_id BIGINT COMMENT '操作用户ID',
    operation VARCHAR(50) NOT NULL COMMENT '操作类型: REGISTER, ACTIVATE, LOCK, UNLOCK, DEACTIVATE',
    operation_detail TEXT COMMENT '操作详情(JSON)',
    ip_address VARCHAR(50) COMMENT 'IP地址',
    user_agent VARCHAR(255) COMMENT '用户代理',
    status VARCHAR(20) COMMENT '状态: SUCCESS, FAILED',
    error_message TEXT COMMENT '错误信息',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    INDEX idx_device_id (device_id),
    INDEX idx_user_id (user_id),
    INDEX idx_operation (operation),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='设备操作日志表';

-- 密钥备份表
CREATE TABLE IF NOT EXISTS key_backups (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    device_id VARCHAR(64) NOT NULL COMMENT '设备ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    backup_type VARCHAR(20) COMMENT '备份类型: FULL, INCREMENTAL',
    encrypted_data LONGTEXT NOT NULL COMMENT '加密的备份数据',
    encryption_method VARCHAR(50) COMMENT '加密方式',
    backup_hash VARCHAR(64) COMMENT '备份数据哈希(SHA256)',
    restore_count INT DEFAULT 0 COMMENT '恢复次数',
    last_restored_at DATETIME COMMENT '最后恢复时间',
    expires_at DATETIME COMMENT '备份过期时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    deleted TINYINT DEFAULT 0 COMMENT '逻辑删除: 0-未删除, 1-已删除',
    INDEX idx_device_id (device_id),
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='密钥备份表';

-- 激活码表
CREATE TABLE IF NOT EXISTS activation_codes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code VARCHAR(64) UNIQUE NOT NULL COMMENT '激活码',
    device_id VARCHAR(64) NOT NULL COMMENT '设备ID',
    batch_id VARCHAR(50) COMMENT '批次号',
    status VARCHAR(20) DEFAULT 'UNUSED' COMMENT '状态: UNUSED, USED, EXPIRED',
    max_uses INT DEFAULT 1 COMMENT '最大使用次数',
    used_count INT DEFAULT 0 COMMENT '已使用次数',
    distributor_id BIGINT COMMENT '分配的经销商ID',
    activated_by BIGINT COMMENT '激活用户ID',
    activated_at DATETIME COMMENT '激活时间',
    expires_at DATETIME NOT NULL COMMENT '过期时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    deleted TINYINT DEFAULT 0 COMMENT '逻辑删除: 0-未删除, 1-已删除',
    INDEX idx_code (code),
    INDEX idx_device_id (device_id),
    INDEX idx_status (status),
    INDEX idx_batch_id (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='激活码表';

-- 密码恢复记录表
CREATE TABLE IF NOT EXISTS password_recovery (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    recovery_id VARCHAR(64) UNIQUE NOT NULL COMMENT '恢复请求ID',
    device_id VARCHAR(64) NOT NULL COMMENT '设备ID',
    user_id BIGINT NOT NULL COMMENT '用户ID',
    verification_type VARCHAR(20) NOT NULL COMMENT '验证类型: SMS, EMAIL, SECURITY_QUESTION, MNEMONIC',
    verification_code VARCHAR(10) COMMENT '验证码',
    verification_data TEXT COMMENT '验证数据(JSON)',
    status VARCHAR(20) DEFAULT 'PENDING' COMMENT '状态: PENDING, VERIFIED, COMPLETED, EXPIRED, FAILED',
    ip_address VARCHAR(50) COMMENT 'IP地址',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    verified_at DATETIME COMMENT '验证时间',
    expires_at DATETIME NOT NULL COMMENT '过期时间',
    INDEX idx_recovery_id (recovery_id),
    INDEX idx_device_id (device_id),
    INDEX idx_user_id (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='密码恢复记录表';

-- 插入默认管理员账号 (密码: admin123456)
INSERT INTO users (username, email, password_hash, real_name, role, status) VALUES
('admin', 'admin@chainlesschain.com', '$2a$10$XVQX0Y2yJ9Hn4Z5pBx4FXe5J0K5yZ5xZ5xZ5xZ5xZ5xZ5xZ5xZ5x', '系统管理员', 'ADMIN', 'ACTIVE');

-- 插入测试数据(可选)
INSERT INTO devices (device_id, device_type, serial_number, manufacturer, model, hardware_version, firmware_version, status) VALUES
('uk_test_001', 'UKEY', 'UK20240101001', 'FeiyinChengxin', 'FT-A22', '1.0', '2.1.0', 'INACTIVE'),
('uk_test_002', 'UKEY', 'UK20240101002', 'FeiyinChengxin', 'FT-A22', '1.0', '2.1.0', 'INACTIVE'),
('sk_test_001', 'SIMKEY', 'SK20240101001', 'ChinaMobile', 'CM-SIM-01', '1.0', '1.5.0', 'INACTIVE');
