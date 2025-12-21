-- Align project service schema with MyBatis entity fields

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS user_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS project_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS root_path VARCHAR(500),
    ADD COLUMN IF NOT EXISTS git_repo_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS current_commit VARCHAR(64),
    ADD COLUMN IF NOT EXISTS file_count BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_size BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS template_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS cover_image_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS tags TEXT,
    ADD COLUMN IF NOT EXISTS metadata TEXT,
    ADD COLUMN IF NOT EXISTS deleted INTEGER NOT NULL DEFAULT 0;

UPDATE projects
SET project_type = COALESCE(project_type, type),
    root_path = COALESCE(root_path, folder_path),
    git_repo_url = COALESCE(git_repo_url, git_repo_path),
    metadata = COALESCE(metadata, metadata_json),
    file_count = COALESCE(file_count, 0),
    total_size = COALESCE(total_size, 0)
WHERE project_type IS NULL
   OR root_path IS NULL
   OR git_repo_url IS NULL
   OR metadata IS NULL
   OR file_count IS NULL
   OR total_size IS NULL;

ALTER TABLE project_files
    ADD COLUMN IF NOT EXISTS file_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS language VARCHAR(50),
    ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS content TEXT,
    ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS commit_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS generated_by VARCHAR(100),
    ADD COLUMN IF NOT EXISTS deleted INTEGER NOT NULL DEFAULT 0;

UPDATE project_files
SET file_size = COALESCE(file_size, size_bytes),
    commit_hash = COALESCE(commit_hash, git_commit_hash)
WHERE file_size IS NULL
   OR commit_hash IS NULL;

ALTER TABLE project_tasks
    ADD COLUMN IF NOT EXISTS task_type VARCHAR(100),
    ADD COLUMN IF NOT EXISTS user_prompt TEXT,
    ADD COLUMN IF NOT EXISTS intent TEXT,
    ADD COLUMN IF NOT EXISTS result TEXT,
    ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS deleted INTEGER NOT NULL DEFAULT 0;

UPDATE project_tasks
SET user_prompt = COALESCE(user_prompt, description)
WHERE user_prompt IS NULL
  AND description IS NOT NULL;

ALTER TABLE project_conversations
    ADD COLUMN IF NOT EXISTS context TEXT,
    ADD COLUMN IF NOT EXISTS task_id VARCHAR(36),
    ADD COLUMN IF NOT EXISTS deleted INTEGER NOT NULL DEFAULT 0;

ALTER TABLE project_templates
    ADD COLUMN IF NOT EXISTS project_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS preview_image_url VARCHAR(500),
    ADD COLUMN IF NOT EXISTS file_structure TEXT,
    ADD COLUMN IF NOT EXISTS author_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS deleted INTEGER NOT NULL DEFAULT 0;

UPDATE project_templates
SET project_type = COALESCE(project_type, type)
WHERE project_type IS NULL
  AND type IS NOT NULL;
