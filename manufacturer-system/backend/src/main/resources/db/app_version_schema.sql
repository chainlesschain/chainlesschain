-- APP版本管理相关表

USE manufacturer_system;

-- APP版本表
CREATE TABLE IF NOT EXISTS app_versions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    version_id VARCHAR(64) UNIQUE NOT NULL COMMENT '版本唯一标识',
    app_type VARCHAR(20) NOT NULL COMMENT 'APP类型: PC_WINDOWS, PC_MAC, PC_LINUX, MOBILE_ANDROID, MOBILE_IOS',
    version_name VARCHAR(50) NOT NULL COMMENT '版本名称: 如 1.0.0',
    version_code INT NOT NULL COMMENT '版本号: 递增的整数',
    app_name VARCHAR(100) COMMENT 'APP名称',
    package_name VARCHAR(100) COMMENT '包名',
    file_name VARCHAR(255) NOT NULL COMMENT '安装包文件名',
    file_size BIGINT COMMENT '文件大小(字节)',
    file_url VARCHAR(500) COMMENT '下载地址',
    file_hash VARCHAR(64) COMMENT '文件SHA256哈希值',
    status VARCHAR(20) DEFAULT 'DRAFT' COMMENT '状态: DRAFT-草稿, TESTING-测试, PUBLISHED-已发布, DEPRECATED-已废弃',
    is_force_update TINYINT DEFAULT 0 COMMENT '是否强制更新: 0-否, 1-是',
    min_supported_version VARCHAR(50) COMMENT '最低支持版本',
    changelog TEXT COMMENT '更新日志(Markdown格式)',
    release_notes TEXT COMMENT '发布说明',
    download_count INT DEFAULT 0 COMMENT '下载次数',
    publisher_id BIGINT COMMENT '发布人ID',
    published_at DATETIME COMMENT '发布时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted TINYINT DEFAULT 0 COMMENT '逻辑删除: 0-未删除, 1-已删除',
    INDEX idx_version_id (version_id),
    INDEX idx_app_type (app_type),
    INDEX idx_version_code (version_code),
    INDEX idx_status (status),
    INDEX idx_published_at (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='APP版本表';

-- APP下载记录表
CREATE TABLE IF NOT EXISTS app_downloads (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    version_id VARCHAR(64) NOT NULL COMMENT '版本ID',
    user_id BIGINT COMMENT '用户ID(可为空,匿名下载)',
    device_id VARCHAR(64) COMMENT '设备ID',
    ip_address VARCHAR(50) COMMENT 'IP地址',
    user_agent VARCHAR(500) COMMENT '用户代理',
    download_source VARCHAR(50) COMMENT '下载来源: WEB, APP, API',
    status VARCHAR(20) COMMENT '状态: SUCCESS, FAILED',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    INDEX idx_version_id (version_id),
    INDEX idx_user_id (user_id),
    INDEX idx_device_id (device_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='APP下载记录表';

-- APP更新检查记录表
CREATE TABLE IF NOT EXISTS app_update_checks (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    device_id VARCHAR(64) NOT NULL COMMENT '设备ID',
    current_version VARCHAR(50) NOT NULL COMMENT '当前版本',
    app_type VARCHAR(20) NOT NULL COMMENT 'APP类型',
    latest_version VARCHAR(50) COMMENT '最新版本',
    has_update TINYINT COMMENT '是否有更新: 0-否, 1-是',
    is_force_update TINYINT COMMENT '是否强制更新',
    ip_address VARCHAR(50) COMMENT 'IP地址',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    INDEX idx_device_id (device_id),
    INDEX idx_app_type (app_type),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='APP更新检查记录表';

-- APP反馈表
CREATE TABLE IF NOT EXISTS app_feedback (
    id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    feedback_id VARCHAR(64) UNIQUE NOT NULL COMMENT '反馈唯一标识',
    user_id BIGINT COMMENT '用户ID',
    device_id VARCHAR(64) COMMENT '设备ID',
    app_version VARCHAR(50) COMMENT 'APP版本',
    app_type VARCHAR(20) COMMENT 'APP类型',
    feedback_type VARCHAR(20) NOT NULL COMMENT '反馈类型: BUG, FEATURE, SUGGESTION, COMPLAINT',
    title VARCHAR(200) NOT NULL COMMENT '标题',
    content TEXT NOT NULL COMMENT '反馈内容',
    screenshots TEXT COMMENT '截图URL列表(JSON)',
    contact_email VARCHAR(100) COMMENT '联系邮箱',
    contact_phone VARCHAR(20) COMMENT '联系电话',
    status VARCHAR(20) DEFAULT 'PENDING' COMMENT '状态: PENDING-待处理, PROCESSING-处理中, RESOLVED-已解决, CLOSED-已关闭',
    admin_reply TEXT COMMENT '管理员回复',
    replied_at DATETIME COMMENT '回复时间',
    replied_by BIGINT COMMENT '回复人ID',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    INDEX idx_feedback_id (feedback_id),
    INDEX idx_user_id (user_id),
    INDEX idx_device_id (device_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='APP反馈表';

-- 插入测试数据
INSERT INTO app_versions (version_id, app_type, version_name, version_code, app_name, package_name, file_name, file_size, file_hash, status, changelog) VALUES
('v1_win_001', 'PC_WINDOWS', '1.0.0', 1, 'ChainlessChain桌面版', 'com.chainlesschain.desktop', 'ChainlessChain-Setup-1.0.0.exe', 85000000, 'abc123...', 'PUBLISHED', '## v1.0.0\n- 初始版本\n- 支持U盾管理\n- 知识库功能'),
('v1_android_001', 'MOBILE_ANDROID', '1.0.0', 1, 'ChainlessChain移动版', 'com.chainlesschain.mobile', 'ChainlessChain-1.0.0.apk', 45000000, 'def456...', 'PUBLISHED', '## v1.0.0\n- 初始版本\n- 支持SIMKey管理\n- 移动端同步');
