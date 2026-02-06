-- Email Drafts Table Migration
-- v0.29.0: 添加邮件草稿支持

-- 邮件草稿表
CREATE TABLE IF NOT EXISTS email_drafts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    to_address TEXT DEFAULT '[]',
    cc_address TEXT DEFAULT '[]',
    bcc_address TEXT DEFAULT '[]',
    subject TEXT DEFAULT '',
    text_content TEXT DEFAULT '',
    html_content TEXT DEFAULT '',
    attachments TEXT DEFAULT '[]',
    reply_to_id TEXT,
    forward_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES email_accounts(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_email_drafts_account ON email_drafts(account_id);
CREATE INDEX IF NOT EXISTS idx_email_drafts_updated ON email_drafts(updated_at DESC);
