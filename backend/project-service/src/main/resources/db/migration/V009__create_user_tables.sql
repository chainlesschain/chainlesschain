-- V009: 创建用户和角色表
-- 用户管理系统

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(100),
    phone VARCHAR(20),
    nickname VARCHAR(50),
    avatar VARCHAR(255),
    status VARCHAR(20) DEFAULT 'active',
    roles VARCHAR(255),
    did VARCHAR(255),
    device_id VARCHAR(100),
    last_login_at TIMESTAMP,
    last_login_ip VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted INTEGER DEFAULT 0
);

-- 创建索引
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_deleted ON users(deleted);

-- 角色表
CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    permissions TEXT,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted INTEGER DEFAULT 0
);

-- 创建索引
CREATE INDEX idx_roles_code ON roles(code);
CREATE INDEX idx_roles_status ON roles(status);
CREATE INDEX idx_roles_deleted ON roles(deleted);

-- 用户角色关联表
CREATE TABLE IF NOT EXISTS user_roles (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    role_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);

-- 插入默认角色
INSERT INTO roles (id, name, code, description, permissions, status) VALUES
('role-admin', '管理员', 'ROLE_ADMIN', '系统管理员，拥有所有权限', 'ALL', 'active'),
('role-user', '普通用户', 'ROLE_USER', '普通用户，基本权限', 'READ,WRITE', 'active'),
('role-guest', '访客', 'ROLE_GUEST', '访客用户，只读权限', 'READ', 'active');

-- 插入默认管理员用户（密码：admin123，需要在应用中加密）
INSERT INTO users (id, username, password, email, nickname, status, roles) VALUES
('user-admin', 'admin', '$2a$10$N.zmdr9k7uOCQb376NoUnuTJ8iAt6Z5EHsM8lE9lBOsl7iAt6Z5EH', 'admin@chainlesschain.com', '系统管理员', 'active', 'ROLE_ADMIN');

-- 关联管理员用户和角色
INSERT INTO user_roles (id, user_id, role_id) VALUES
('ur-admin', 'user-admin', 'role-admin');
