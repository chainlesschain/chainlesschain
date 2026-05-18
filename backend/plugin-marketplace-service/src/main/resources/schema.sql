-- Plugin Marketplace Database Schema
-- PostgreSQL 16+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Table: plugins
-- Description: Plugin metadata and information
-- ============================================================
CREATE TABLE plugins (
    id BIGSERIAL PRIMARY KEY,
    plugin_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    display_name VARCHAR(200),
    version VARCHAR(50) NOT NULL,
    author VARCHAR(100) NOT NULL,
    author_did VARCHAR(200),
    description TEXT,
    long_description TEXT,
    category VARCHAR(50) NOT NULL,
    tags TEXT[],
    icon_url VARCHAR(500),
    homepage VARCHAR(500),
    repository VARCHAR(500),
    license VARCHAR(50),

    -- File information
    file_url VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    file_hash VARCHAR(128) NOT NULL,

    -- Status
    status VARCHAR(20) DEFAULT 'pending',  -- pending, approved, rejected, suspended
    verified BOOLEAN DEFAULT FALSE,
    featured BOOLEAN DEFAULT FALSE,

    -- Statistics
    downloads INTEGER DEFAULT 0,
    rating DECIMAL(3,2) DEFAULT 0.00,
    rating_count INTEGER DEFAULT 0,

    -- Metadata
    min_version VARCHAR(50),
    max_version VARCHAR(50),
    permissions TEXT[],
    dependencies JSONB,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMP,
    deleted BOOLEAN DEFAULT FALSE,

    CONSTRAINT chk_rating CHECK (rating >= 0 AND rating <= 5),
    CONSTRAINT chk_status CHECK (status IN ('pending', 'approved', 'rejected', 'suspended'))
);

CREATE INDEX idx_plugins_plugin_id ON plugins(plugin_id);
CREATE INDEX idx_plugins_category ON plugins(category);
CREATE INDEX idx_plugins_author ON plugins(author);
CREATE INDEX idx_plugins_status ON plugins(status);
CREATE INDEX idx_plugins_verified ON plugins(verified);
CREATE INDEX idx_plugins_featured ON plugins(featured);
CREATE INDEX idx_plugins_downloads ON plugins(downloads DESC);
CREATE INDEX idx_plugins_rating ON plugins(rating DESC);
CREATE INDEX idx_plugins_created_at ON plugins(created_at DESC);

-- ============================================================
-- Table: plugin_versions
-- Description: Plugin version history
-- ============================================================
CREATE TABLE plugin_versions (
    id BIGSERIAL PRIMARY KEY,
    plugin_id BIGINT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    version VARCHAR(50) NOT NULL,
    changelog TEXT,
    file_url VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    file_hash VARCHAR(128) NOT NULL,
    downloads INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',  -- active, deprecated, yanked
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN DEFAULT FALSE,

    UNIQUE(plugin_id, version),
    CONSTRAINT chk_version_status CHECK (status IN ('active', 'deprecated', 'yanked'))
);

CREATE INDEX idx_plugin_versions_plugin_id ON plugin_versions(plugin_id);
CREATE INDEX idx_plugin_versions_version ON plugin_versions(version);
CREATE INDEX idx_plugin_versions_created_at ON plugin_versions(created_at DESC);

-- ============================================================
-- Table: plugin_ratings
-- Description: User ratings and reviews
-- ============================================================
CREATE TABLE plugin_ratings (
    id BIGSERIAL PRIMARY KEY,
    plugin_id BIGINT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    user_did VARCHAR(200) NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT,
    helpful_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN DEFAULT FALSE,

    UNIQUE(plugin_id, user_did),
    CONSTRAINT chk_rating_value CHECK (rating >= 1 AND rating <= 5)
);

CREATE INDEX idx_plugin_ratings_plugin_id ON plugin_ratings(plugin_id);
CREATE INDEX idx_plugin_ratings_user_did ON plugin_ratings(user_did);
CREATE INDEX idx_plugin_ratings_rating ON plugin_ratings(rating);
CREATE INDEX idx_plugin_ratings_created_at ON plugin_ratings(created_at DESC);

-- ============================================================
-- Table: plugin_reports
-- Description: Plugin issue reports
-- ============================================================
CREATE TABLE plugin_reports (
    id BIGSERIAL PRIMARY KEY,
    plugin_id BIGINT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    reporter_did VARCHAR(200) NOT NULL,
    reason VARCHAR(50) NOT NULL,  -- malware, copyright, inappropriate, broken, other
    description TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',  -- pending, investigating, resolved, dismissed
    resolution TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    deleted BOOLEAN DEFAULT FALSE,

    CONSTRAINT chk_report_reason CHECK (reason IN ('malware', 'copyright', 'inappropriate', 'broken', 'other')),
    CONSTRAINT chk_report_status CHECK (status IN ('pending', 'investigating', 'resolved', 'dismissed'))
);

CREATE INDEX idx_plugin_reports_plugin_id ON plugin_reports(plugin_id);
CREATE INDEX idx_plugin_reports_status ON plugin_reports(status);
CREATE INDEX idx_plugin_reports_created_at ON plugin_reports(created_at DESC);

-- ============================================================
-- Table: plugin_downloads
-- Description: Download history and statistics
-- ============================================================
CREATE TABLE plugin_downloads (
    id BIGSERIAL PRIMARY KEY,
    plugin_id BIGINT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    version VARCHAR(50),
    user_did VARCHAR(200),
    ip_address VARCHAR(45),
    user_agent TEXT,
    downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_plugin_downloads_plugin_id ON plugin_downloads(plugin_id);
CREATE INDEX idx_plugin_downloads_downloaded_at ON plugin_downloads(downloaded_at DESC);

-- ============================================================
-- Table: categories
-- Description: Plugin categories
-- ============================================================
CREATE TABLE categories (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(50),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN DEFAULT FALSE
);

-- Insert default categories
INSERT INTO categories (code, name, description, icon, sort_order) VALUES
('ai', 'AI增强', 'AI和机器学习相关插件', 'robot', 1),
('productivity', '效率工具', '提升工作效率的工具', 'thunderbolt', 2),
('data', '数据处理', '数据导入、导出和处理工具', 'database', 3),
('integration', '第三方集成', '与第三方服务的集成', 'api', 4),
('ui', '界面扩展', 'UI组件和主题', 'layout', 5),
('development', '开发工具', '开发辅助工具', 'code', 6),
('custom', '自定义', '其他类型插件', 'appstore', 99);

-- ============================================================
-- Table: users
-- Description: User accounts (for plugin developers)
-- ============================================================
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    did VARCHAR(200) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(200) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(200),
    avatar_url VARCHAR(500),
    bio TEXT,
    website VARCHAR(500),
    role VARCHAR(20) DEFAULT 'developer',  -- developer, admin, moderator
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    deleted BOOLEAN DEFAULT FALSE,

    CONSTRAINT chk_user_role CHECK (role IN ('developer', 'admin', 'moderator'))
);

CREATE INDEX idx_users_did ON users(did);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- Functions and Triggers
-- ============================================================

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_plugins_updated_at BEFORE UPDATE ON plugins
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plugin_ratings_updated_at BEFORE UPDATE ON plugin_ratings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function: Update plugin rating statistics
CREATE OR REPLACE FUNCTION update_plugin_rating_stats()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE plugins
    SET rating = (
        SELECT COALESCE(AVG(rating), 0)
        FROM plugin_ratings
        WHERE plugin_id = NEW.plugin_id AND deleted = FALSE
    ),
    rating_count = (
        SELECT COUNT(*)
        FROM plugin_ratings
        WHERE plugin_id = NEW.plugin_id AND deleted = FALSE
    )
    WHERE id = NEW.plugin_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for rating statistics
CREATE TRIGGER update_plugin_rating_stats_trigger
AFTER INSERT OR UPDATE OR DELETE ON plugin_ratings
FOR EACH ROW EXECUTE FUNCTION update_plugin_rating_stats();

-- ============================================================
-- Views
-- ============================================================

-- View: Popular plugins
CREATE VIEW popular_plugins AS
SELECT p.*, c.name as category_name
FROM plugins p
LEFT JOIN categories c ON p.category = c.code
WHERE p.status = 'approved' AND p.deleted = FALSE
ORDER BY p.downloads DESC, p.rating DESC
LIMIT 50;

-- View: Featured plugins
CREATE VIEW featured_plugins AS
SELECT p.*, c.name as category_name
FROM plugins p
LEFT JOIN categories c ON p.category = c.code
WHERE p.status = 'approved' AND p.featured = TRUE AND p.deleted = FALSE
ORDER BY p.rating DESC, p.downloads DESC;

-- View: Recent plugins
CREATE VIEW recent_plugins AS
SELECT p.*, c.name as category_name
FROM plugins p
LEFT JOIN categories c ON p.category = c.code
WHERE p.status = 'approved' AND p.deleted = FALSE
ORDER BY p.published_at DESC
LIMIT 50;

-- ============================================================
-- Sample Data (for testing)
-- ============================================================

-- Insert sample user
INSERT INTO users (did, username, email, password_hash, display_name, role, verified)
VALUES ('did:example:developer1', 'developer1', 'dev@chainlesschain.com',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',  -- password: password123
        'ChainlessChain Developer', 'developer', TRUE);

-- Insert sample plugins
INSERT INTO plugins (plugin_id, name, version, author, author_did, description, category, tags,
                     file_url, file_size, file_hash, status, verified, featured, downloads, rating, rating_count)
VALUES
('translator', '多语言翻译器', '1.0.0', 'ChainlessChain Team', 'did:example:developer1',
 '支持多种语言的智能翻译插件，集成主流翻译API', 'ai', ARRAY['翻译', 'AI', '多语言'],
 'https://plugins.chainlesschain.com/files/translator-1.0.0.zip', 1024000, 'abc123hash',
 'approved', TRUE, TRUE, 15234, 4.8, 120),

('code-formatter', '代码格式化插件', '1.0.0', 'ChainlessChain Team', 'did:example:developer1',
 '智能代码格式化工具，支持多种编程语言', 'development', ARRAY['代码', '格式化', '开发'],
 'https://plugins.chainlesschain.com/files/code-formatter-1.0.0.zip', 512000, 'def456hash',
 'approved', TRUE, FALSE, 8521, 4.6, 85);

COMMIT;
