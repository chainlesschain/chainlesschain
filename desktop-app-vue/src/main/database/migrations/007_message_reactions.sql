-- ============================
-- Message Reactions System (v0.21.1)
-- ============================

-- 消息表情回应表
CREATE TABLE IF NOT EXISTS message_reactions (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  user_did TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(message_id, user_did, emoji),
  FOREIGN KEY (message_id) REFERENCES p2p_chat_messages(id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_user ON message_reactions(user_did);
CREATE INDEX IF NOT EXISTS idx_message_reactions_created ON message_reactions(created_at DESC);
