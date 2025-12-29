-- 音频文件表
CREATE TABLE IF NOT EXISTS audio_files (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  duration REAL,
  format TEXT,
  sample_rate INTEGER,
  channels INTEGER,
  transcription_text TEXT,
  transcription_engine TEXT,
  transcription_confidence REAL,
  language TEXT,
  knowledge_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  user_id TEXT DEFAULT 'local-user'
);

-- 转录历史表
CREATE TABLE IF NOT EXISTS transcription_history (
  id TEXT PRIMARY KEY,
  audio_file_id TEXT,
  engine TEXT NOT NULL,
  text TEXT NOT NULL,
  confidence REAL,
  duration REAL,
  status TEXT DEFAULT 'completed',
  error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (audio_file_id) REFERENCES audio_files(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_audio_files_user ON audio_files(user_id);
CREATE INDEX IF NOT EXISTS idx_audio_files_created ON audio_files(created_at);
CREATE INDEX IF NOT EXISTS idx_transcription_history_audio ON transcription_history(audio_file_id);
CREATE INDEX IF NOT EXISTS idx_transcription_history_created ON transcription_history(created_at);
