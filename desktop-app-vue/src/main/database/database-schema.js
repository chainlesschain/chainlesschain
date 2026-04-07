/**
 * Database schema creation — extracted from database.js as part of H3 split.
 *
 * Pure function form: takes the DatabaseManager instance and uses its
 * .db connection plus a few callback methods. Behavior is byte-identical
 * to the original DatabaseManager.createTables() method.
 *
 * Extracted on 2026-04-07.
 */

function createTables(dbManager, logger) {
  logger.info("[Database] 开始创建数据库表...");

  try {
    // 暂时禁用外键约束以避免表创建顺序问题
    logger.info("[Database] 禁用外键约束...");
    dbManager.db.run("PRAGMA foreign_keys = OFF");

    // 使用exec()一次性执行所有SQL语句
    // 这样可以避免多次调用导致的statement关闭问题
    dbManager.db.exec(`
      -- 知识库项表
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('note', 'document', 'conversation', 'web_clip')),
        content TEXT,
        content_path TEXT,
        embedding_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        git_commit_hash TEXT,
        device_id TEXT,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict'))
      );

      -- 标签表
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      -- 知识库项-标签关联表
      CREATE TABLE IF NOT EXISTS knowledge_tags (
        knowledge_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (knowledge_id, tag_id),
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      );

      -- 知识关系表（图谱）
      CREATE TABLE IF NOT EXISTS knowledge_relations (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL CHECK(relation_type IN ('link', 'tag', 'semantic', 'temporal')),
        weight REAL DEFAULT 1.0,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (source_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        UNIQUE(source_id, target_id, relation_type)
      );

      -- 对话表
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        knowledge_id TEXT,
        project_id TEXT,
        context_type TEXT DEFAULT 'global',
        context_data TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE SET NULL
      );

      -- 消息表
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tokens INTEGER,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      -- 搜索索引表
      CREATE TABLE IF NOT EXISTS knowledge_search (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        FOREIGN KEY (id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      );

      -- 截图表
      CREATE TABLE IF NOT EXISTS screenshots (
        id TEXT PRIMARY KEY,
        knowledge_item_id TEXT,
        image_path TEXT NOT NULL,
        annotations TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_item_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      );

      -- 知识库版本历史表
      CREATE TABLE IF NOT EXISTS knowledge_version_history (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT,
        content_snapshot TEXT,
        created_by TEXT,
        updated_by TEXT,
        git_commit_hash TEXT,
        cid TEXT,
        parent_version_id TEXT,
        change_summary TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_version_id) REFERENCES knowledge_version_history(id) ON DELETE SET NULL,
        UNIQUE(knowledge_id, version)
      );

      -- 项目分类表
      CREATE TABLE IF NOT EXISTS project_categories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_id TEXT,
        icon TEXT,
        color TEXT,
        sort_order INTEGER DEFAULT 0,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted INTEGER DEFAULT 0,
        FOREIGN KEY (parent_id) REFERENCES project_categories(id) ON DELETE CASCADE
      );

      -- 项目表
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        project_type TEXT NOT NULL CHECK(project_type IN ('web', 'document', 'data', 'app', 'presentation', 'spreadsheet', 'design', 'code')),
        status TEXT DEFAULT 'active' CHECK(status IN ('draft', 'active', 'completed', 'archived')),
        root_path TEXT,
        file_count INTEGER DEFAULT 0,
        total_size INTEGER DEFAULT 0,
        template_id TEXT,
        cover_image_url TEXT,
        tags TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        category_id TEXT,
        delivered_at TEXT
      );

      -- 项目文件表
      CREATE TABLE IF NOT EXISTS project_files (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_type TEXT,
        file_size INTEGER DEFAULT 0,
        content TEXT,
        content_hash TEXT,
        version INTEGER DEFAULT 1,
        fs_path TEXT,
        is_folder INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 文件同步状态表
      CREATE TABLE IF NOT EXISTS file_sync_state (
        file_id TEXT PRIMARY KEY,
        fs_hash TEXT,
        db_hash TEXT,
        last_synced_at INTEGER,
        sync_direction TEXT DEFAULT 'bidirectional',
        conflict_detected INTEGER DEFAULT 0,
        FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE
      );

      -- 项目任务表
      CREATE TABLE IF NOT EXISTS project_tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_type TEXT NOT NULL CHECK(task_type IN ('create_file', 'edit_file', 'query_info', 'analyze_data', 'export_file', 'deploy_project')),
        description TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
        result_path TEXT,
        result_data TEXT,
        error_message TEXT,
        execution_time INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目对话历史表
      CREATE TABLE IF NOT EXISTS project_conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        tool_calls TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目任务计划表
      CREATE TABLE IF NOT EXISTS project_task_plans (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_title TEXT NOT NULL,
        task_type TEXT DEFAULT 'create' CHECK(task_type IN ('create', 'modify', 'analyze', 'export')),
        user_request TEXT NOT NULL,
        estimated_duration TEXT,
        subtasks TEXT NOT NULL,
        final_output TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
        current_step INTEGER DEFAULT 0,
        total_steps INTEGER DEFAULT 0,
        progress_percentage INTEGER DEFAULT 0,
        error_message TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目协作者表
      CREATE TABLE IF NOT EXISTS project_collaborators (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        collaborator_did TEXT,
        did TEXT,
        role TEXT DEFAULT 'viewer' CHECK(role IN ('owner', 'editor', 'viewer')),
        permissions TEXT,
        invited_by TEXT,
        invited_at INTEGER NOT NULL,
        accepted_at INTEGER,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined', 'removed')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, user_id)
      );

      -- 系统配置表
      CREATE TABLE IF NOT EXISTS system_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        type TEXT DEFAULT 'string' CHECK(type IN ('string', 'number', 'boolean', 'json')),
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 项目评论表
      CREATE TABLE IF NOT EXISTS project_comments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_id TEXT,
        file_path TEXT,
        parent_id TEXT,
        parent_comment_id TEXT,
        user_id TEXT NOT NULL,
        author_did TEXT,
        did TEXT,
        content TEXT NOT NULL,
        line_number INTEGER,
        resolved INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('synced', 'pending', 'conflict', 'error')),
        synced_at INTEGER,
        device_id TEXT,
        deleted INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES project_comments(id) ON DELETE CASCADE
      );

      -- 项目市场清单表
      CREATE TABLE IF NOT EXISTS project_marketplace_listings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        price REAL DEFAULT 0,
        currency TEXT DEFAULT 'CNY',
        preview_images TEXT,
        demo_url TEXT,
        downloads INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        tags TEXT,
        category TEXT,
        license TEXT DEFAULT 'MIT',
        status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'unlisted', 'removed')),
        published_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id)
      );

      -- 项目知识链接表
      CREATE TABLE IF NOT EXISTS project_knowledge_links (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        knowledge_id TEXT NOT NULL,
        link_type TEXT DEFAULT 'reference' CHECK(link_type IN ('reference', 'source', 'related')),
        relevance_score REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        UNIQUE(project_id, knowledge_id)
      );

      -- 项目自动化规则表
      CREATE TABLE IF NOT EXISTS project_automation_rules (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        rule_name TEXT NOT NULL,
        trigger_type TEXT NOT NULL CHECK(trigger_type IN ('file_change', 'git_commit', 'schedule', 'manual')),
        trigger_config TEXT,
        action_type TEXT NOT NULL CHECK(action_type IN ('run_tests', 'build', 'deploy', 'notify', 'custom')),
        action_config TEXT,
        enabled INTEGER DEFAULT 1,
        last_run_at INTEGER,
        run_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目统计表
      CREATE TABLE IF NOT EXISTS project_stats (
        project_id TEXT PRIMARY KEY,
        file_count INTEGER DEFAULT 0,
        total_size_kb REAL DEFAULT 0,
        code_lines INTEGER DEFAULT 0,
        comment_lines INTEGER DEFAULT 0,
        blank_lines INTEGER DEFAULT 0,
        commit_count INTEGER DEFAULT 0,
        contributor_count INTEGER DEFAULT 0,
        last_commit_at INTEGER,
        last_updated_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目日志表
      CREATE TABLE IF NOT EXISTS project_logs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        log_level TEXT NOT NULL CHECK(log_level IN ('debug', 'info', 'warn', 'error')),
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT,
        user_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目分享表
      CREATE TABLE IF NOT EXISTS project_shares (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        share_token TEXT NOT NULL UNIQUE,
        share_mode TEXT NOT NULL CHECK(share_mode IN ('private', 'public')),
        share_link TEXT,
        access_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 项目模板表
      CREATE TABLE IF NOT EXISTS project_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        icon TEXT,
        cover_image TEXT,
        category TEXT NOT NULL CHECK(category IN ('medical', 'legal', 'education', 'research', 'writing', 'ppt', 'excel', 'web', 'design', 'podcast', 'resume', 'marketing', 'lifestyle', 'travel', 'video', 'social-media', 'creative-writing', 'code-project', 'data-science', 'tech-docs', 'ecommerce', 'marketing-pro', 'learning', 'health', 'time-management', 'productivity', 'finance', 'photography', 'music', 'gaming', 'cooking', 'career', 'business', 'hr', 'project')),
        subcategory TEXT,
        tags TEXT,
        project_type TEXT NOT NULL CHECK(project_type IN ('web', 'document', 'data', 'app', 'presentation', 'spreadsheet', 'design', 'code')),
        prompt_template TEXT,
        variables_schema TEXT,
        file_structure TEXT,
        default_files TEXT,
        is_builtin INTEGER DEFAULT 0,
        author TEXT,
        version TEXT DEFAULT '1.0.0',
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        rating_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        sync_status TEXT DEFAULT 'synced' CHECK(sync_status IN ('synced', 'pending', 'conflict')),
        deleted INTEGER DEFAULT 0
      );

      -- 模板使用记录表
      CREATE TABLE IF NOT EXISTS template_usage_history (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        project_id TEXT,
        variables_used TEXT,
        used_at INTEGER NOT NULL,
        FOREIGN KEY (template_id) REFERENCES project_templates(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      );

      -- 模板评价表
      CREATE TABLE IF NOT EXISTS template_ratings (
        id TEXT PRIMARY KEY,
        template_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
        review TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (template_id) REFERENCES project_templates(id) ON DELETE CASCADE,
        UNIQUE(template_id, user_id)
      );

      -- 项目RAG索引表 (用于增量索引追踪)
      CREATE TABLE IF NOT EXISTS project_rag_index (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        indexed_at INTEGER NOT NULL,
        chunk_count INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (file_id) REFERENCES project_files(id) ON DELETE CASCADE,
        UNIQUE(project_id, file_id)
      );

      -- 创建所有索引
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_created_at ON knowledge_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_updated_at ON knowledge_items(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_type ON knowledge_items(type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_sync_status ON knowledge_items(sync_status);
      CREATE INDEX IF NOT EXISTS idx_kr_source ON knowledge_relations(source_id);
      CREATE INDEX IF NOT EXISTS idx_kr_target ON knowledge_relations(target_id);
      CREATE INDEX IF NOT EXISTS idx_kr_type ON knowledge_relations(relation_type);
      CREATE INDEX IF NOT EXISTS idx_kr_weight ON knowledge_relations(weight DESC);
      -- 复合索引优化图谱查询性能
      CREATE INDEX IF NOT EXISTS idx_kr_source_type_weight ON knowledge_relations(source_id, relation_type, weight DESC);
      CREATE INDEX IF NOT EXISTS idx_kr_target_type_weight ON knowledge_relations(target_id, relation_type, weight DESC);
      CREATE INDEX IF NOT EXISTS idx_kr_type_weight_source ON knowledge_relations(relation_type, weight DESC, source_id);
      CREATE INDEX IF NOT EXISTS idx_kr_type_weight_target ON knowledge_relations(relation_type, weight DESC, target_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
      -- 复合索引优化消息分页查询
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_timestamp ON messages(conversation_id, timestamp ASC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_items_type_updated ON knowledge_items(type, updated_at DESC);

      CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
      CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
      CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(project_type);
      CREATE INDEX IF NOT EXISTS idx_projects_sync_status ON projects(sync_status);
      CREATE INDEX IF NOT EXISTS idx_projects_category_id ON projects(category_id);

      CREATE INDEX IF NOT EXISTS idx_project_categories_user_id ON project_categories(user_id);
      CREATE INDEX IF NOT EXISTS idx_project_categories_parent_id ON project_categories(parent_id);
      CREATE INDEX IF NOT EXISTS idx_project_categories_sort_order ON project_categories(sort_order);

      CREATE INDEX IF NOT EXISTS idx_project_files_project_id ON project_files(project_id);
      CREATE INDEX IF NOT EXISTS idx_file_sync_state_file_id ON file_sync_state(file_id);

      CREATE INDEX IF NOT EXISTS idx_project_tasks_project_id ON project_tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_tasks_status ON project_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_project_conversations_project_id ON project_conversations(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_conversations_created_at ON project_conversations(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_project_collaborators_project_id ON project_collaborators(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_collaborators_user_id ON project_collaborators(user_id);
      CREATE INDEX IF NOT EXISTS idx_project_comments_project_id ON project_comments(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_comments_file_id ON project_comments(file_id);
      CREATE INDEX IF NOT EXISTS idx_project_marketplace_project_id ON project_marketplace_listings(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_marketplace_status ON project_marketplace_listings(status);
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_links_project_id ON project_knowledge_links(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_knowledge_links_knowledge_id ON project_knowledge_links(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_project_automation_project_id ON project_automation_rules(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_automation_enabled ON project_automation_rules(enabled);
      CREATE INDEX IF NOT EXISTS idx_project_logs_project_id ON project_logs(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_logs_level ON project_logs(log_level);
      CREATE INDEX IF NOT EXISTS idx_project_logs_created_at ON project_logs(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_project_shares_project_id ON project_shares(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_shares_token ON project_shares(share_token);
      CREATE INDEX IF NOT EXISTS idx_project_shares_mode ON project_shares(share_mode);

      CREATE INDEX IF NOT EXISTS idx_project_rag_index_project_id ON project_rag_index(project_id);
      CREATE INDEX IF NOT EXISTS idx_project_rag_index_file_id ON project_rag_index(file_id);
      CREATE INDEX IF NOT EXISTS idx_project_rag_index_content_hash ON project_rag_index(content_hash);

      CREATE INDEX IF NOT EXISTS idx_templates_category ON project_templates(category);
      CREATE INDEX IF NOT EXISTS idx_templates_subcategory ON project_templates(subcategory);
      CREATE INDEX IF NOT EXISTS idx_templates_type ON project_templates(project_type);
      CREATE INDEX IF NOT EXISTS idx_templates_usage ON project_templates(usage_count DESC);
      CREATE INDEX IF NOT EXISTS idx_templates_rating ON project_templates(rating DESC);
      CREATE INDEX IF NOT EXISTS idx_templates_builtin ON project_templates(is_builtin);
      CREATE INDEX IF NOT EXISTS idx_templates_deleted ON project_templates(deleted);
      CREATE INDEX IF NOT EXISTS idx_template_usage_template_id ON template_usage_history(template_id);
      CREATE INDEX IF NOT EXISTS idx_template_usage_user_id ON template_usage_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_template_usage_used_at ON template_usage_history(used_at DESC);
      CREATE INDEX IF NOT EXISTS idx_template_ratings_template_id ON template_ratings(template_id);
      CREATE INDEX IF NOT EXISTS idx_template_ratings_user_id ON template_ratings(user_id);

      CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON conversations(project_id);

      -- 社交模块：聊天会话表
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        participant_did TEXT NOT NULL,
        friend_nickname TEXT,
        last_message TEXT,
        last_message_time INTEGER,
        unread_count INTEGER DEFAULT 0,
        is_pinned INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 社交模块：P2P消息持久化表
      CREATE TABLE IF NOT EXISTS p2p_chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sender_did TEXT NOT NULL,
        receiver_did TEXT NOT NULL,
        content TEXT NOT NULL,
        message_type TEXT DEFAULT 'text' CHECK(message_type IN ('text', 'image', 'file', 'voice', 'video')),
        file_path TEXT,
        file_size INTEGER,
        encrypted INTEGER DEFAULT 1,
        status TEXT DEFAULT 'sent' CHECK(status IN ('sent', 'delivered', 'read', 'failed')),
        device_id TEXT,
        timestamp INTEGER NOT NULL,
        forwarded_from_id TEXT,
        forward_count INTEGER DEFAULT 0,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (forwarded_from_id) REFERENCES p2p_chat_messages(id) ON DELETE SET NULL
      );

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

      -- 群聊表
      CREATE TABLE IF NOT EXISTS group_chats (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        avatar TEXT,
        creator_did TEXT NOT NULL,
        group_type TEXT DEFAULT 'normal' CHECK(group_type IN ('normal', 'encrypted')),
        max_members INTEGER DEFAULT 500,
        member_count INTEGER DEFAULT 0,
        encryption_key TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 群成员表
      CREATE TABLE IF NOT EXISTS group_members (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        member_did TEXT NOT NULL,
        nickname TEXT,
        role TEXT DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member')),
        muted INTEGER DEFAULT 0,
        joined_at INTEGER NOT NULL,
        UNIQUE(group_id, member_did),
        FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE
      );

      -- 群消息表
      CREATE TABLE IF NOT EXISTS group_messages (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        sender_did TEXT NOT NULL,
        content TEXT NOT NULL,
        message_type TEXT DEFAULT 'text' CHECK(message_type IN ('text', 'image', 'file', 'voice', 'video', 'system')),
        file_path TEXT,
        encrypted INTEGER DEFAULT 1,
        encryption_key_id TEXT,
        reply_to_id TEXT,
        mentions TEXT,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE,
        FOREIGN KEY (reply_to_id) REFERENCES group_messages(id) ON DELETE SET NULL
      );

      -- 群消息已读状态表
      CREATE TABLE IF NOT EXISTS group_message_reads (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        member_did TEXT NOT NULL,
        read_at INTEGER NOT NULL,
        UNIQUE(message_id, member_did),
        FOREIGN KEY (message_id) REFERENCES group_messages(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE
      );

      -- 群加密密钥表（用于Signal Protocol Sender Keys）
      CREATE TABLE IF NOT EXISTS group_encryption_keys (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        key_id TEXT NOT NULL,
        sender_did TEXT NOT NULL,
        chain_key TEXT NOT NULL,
        signature_key TEXT NOT NULL,
        iteration INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        UNIQUE(group_id, key_id),
        FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE
      );

      -- 群邀请表
      CREATE TABLE IF NOT EXISTS group_invitations (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        inviter_did TEXT NOT NULL,
        invitee_did TEXT NOT NULL,
        message TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'expired')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        UNIQUE(group_id, invitee_did),
        FOREIGN KEY (group_id) REFERENCES group_chats(id) ON DELETE CASCADE
      );

      -- 通知表
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('friend_request', 'message', 'like', 'comment', 'system')),
        title TEXT NOT NULL,
        content TEXT,
        data TEXT,
        is_read INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- ============================
      -- 社交网络相关表
      -- ============================

      -- 联系人表
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        did TEXT UNIQUE NOT NULL,
        nickname TEXT,
        avatar TEXT,
        public_key_sign TEXT NOT NULL,
        public_key_encrypt TEXT NOT NULL,
        relationship TEXT DEFAULT 'contact',
        notes TEXT,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 好友表
      CREATE TABLE IF NOT EXISTS friends (
        id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        friend_did TEXT NOT NULL,
        nickname TEXT,
        avatar TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'blocked')),
        notes TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_did, friend_did)
      );

      -- 好友请求表
      CREATE TABLE IF NOT EXISTS friend_requests (
        id TEXT PRIMARY KEY,
        from_did TEXT NOT NULL,
        to_did TEXT NOT NULL,
        message TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(from_did, to_did)
      );

      -- 社交帖子表
      CREATE TABLE IF NOT EXISTS social_posts (
        id TEXT PRIMARY KEY,
        author_did TEXT NOT NULL,
        content TEXT NOT NULL,
        media TEXT,
        visibility TEXT DEFAULT 'public' CHECK(visibility IN ('public', 'friends', 'private')),
        likes_count INTEGER DEFAULT 0,
        comments_count INTEGER DEFAULT 0,
        shares_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 帖子评论表
      CREATE TABLE IF NOT EXISTS post_comments (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        author_did TEXT NOT NULL,
        content TEXT NOT NULL,
        parent_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE
      );

      -- 帖子点赞表
      CREATE TABLE IF NOT EXISTS post_likes (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        user_did TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(post_id, user_did),
        FOREIGN KEY (post_id) REFERENCES social_posts(id) ON DELETE CASCADE
      );

      -- P2P聊天会话表
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        peer_did TEXT NOT NULL,
        last_message TEXT,
        last_message_time INTEGER,
        unread_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- P2P聊天消息表
      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sender_did TEXT NOT NULL,
        receiver_did TEXT NOT NULL,
        content TEXT NOT NULL,
        message_type TEXT DEFAULT 'text' CHECK(message_type IN ('text', 'image', 'file', 'voice', 'video')),
        is_encrypted INTEGER DEFAULT 1,
        is_read INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );

      -- ============================
      -- 远程控制 - 文件传输表
      -- ============================

      -- 文件传输记录表
      CREATE TABLE IF NOT EXISTS file_transfers (
        id TEXT PRIMARY KEY,
        device_did TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('upload', 'download')),
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        total_chunks INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('in_progress', 'completed', 'failed', 'cancelled', 'expired')),
        progress REAL DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        metadata TEXT
      );

      -- ============================
      -- 远程控制 - 远程桌面表
      -- ============================

      -- 远程桌面会话表
      CREATE TABLE IF NOT EXISTS remote_desktop_sessions (
        id TEXT PRIMARY KEY,
        device_did TEXT NOT NULL,
        display_id INTEGER,
        quality INTEGER NOT NULL DEFAULT 80,
        max_fps INTEGER NOT NULL DEFAULT 30,
        status TEXT NOT NULL CHECK(status IN ('active', 'stopped', 'expired')),
        started_at INTEGER NOT NULL,
        stopped_at INTEGER,
        duration INTEGER,
        frame_count INTEGER DEFAULT 0,
        bytes_sent INTEGER DEFAULT 0
      );

      -- ============================
      -- 区块链相关表
      -- ============================

      -- 区块链钱包表
      CREATE TABLE IF NOT EXISTS blockchain_wallets (
        id TEXT PRIMARY KEY,
        address TEXT UNIQUE NOT NULL,
        wallet_type TEXT NOT NULL CHECK(wallet_type IN ('internal', 'external')),
        provider TEXT CHECK(provider IN ('builtin', 'metamask', 'walletconnect')),
        encrypted_private_key TEXT,
        mnemonic_encrypted TEXT,
        derivation_path TEXT,
        chain_id INTEGER,
        is_default INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- 链上资产表
      CREATE TABLE IF NOT EXISTS blockchain_assets (
        id TEXT PRIMARY KEY,
        local_asset_id TEXT,
        contract_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        token_type TEXT CHECK(token_type IN ('ERC20', 'ERC721', 'ERC1155')),
        token_id TEXT,
        deployment_tx TEXT,
        deployed_at INTEGER,
        UNIQUE(contract_address, chain_id, token_id),
        FOREIGN KEY (local_asset_id) REFERENCES assets(id) ON DELETE SET NULL
      );

      -- 区块链交易表
      CREATE TABLE IF NOT EXISTS blockchain_transactions (
        id TEXT PRIMARY KEY,
        tx_hash TEXT UNIQUE NOT NULL,
        chain_id INTEGER NOT NULL,
        from_address TEXT NOT NULL,
        to_address TEXT,
        value TEXT,
        gas_used TEXT,
        gas_price TEXT,
        status TEXT CHECK(status IN ('pending', 'confirmed', 'failed')),
        block_number INTEGER,
        tx_type TEXT,
        local_ref_id TEXT,
        created_at INTEGER NOT NULL,
        confirmed_at INTEGER
      );

      -- 智能合约部署记录
      CREATE TABLE IF NOT EXISTS deployed_contracts (
        id TEXT PRIMARY KEY,
        contract_name TEXT NOT NULL,
        contract_type TEXT,
        contract_address TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        deployment_tx TEXT,
        deployer_address TEXT,
        abi_json TEXT,
        local_contract_id TEXT,
        deployed_at INTEGER NOT NULL,
        UNIQUE(contract_address, chain_id),
        FOREIGN KEY (local_contract_id) REFERENCES contracts(id) ON DELETE SET NULL
      );

      -- 跨链桥记录
      CREATE TABLE IF NOT EXISTS bridge_transfers (
        id TEXT PRIMARY KEY,
        from_chain_id INTEGER NOT NULL,
        to_chain_id INTEGER NOT NULL,
        from_tx_hash TEXT,
        to_tx_hash TEXT,
        asset_id TEXT,
        amount TEXT,
        status TEXT CHECK(status IN ('pending', 'completed', 'failed')),
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      -- 区块链索引
      CREATE INDEX IF NOT EXISTS idx_blockchain_wallets_address ON blockchain_wallets(address);
      CREATE INDEX IF NOT EXISTS idx_blockchain_wallets_chain ON blockchain_wallets(chain_id);
      CREATE INDEX IF NOT EXISTS idx_blockchain_assets_contract ON blockchain_assets(contract_address, chain_id);
      CREATE INDEX IF NOT EXISTS idx_blockchain_assets_local ON blockchain_assets(local_asset_id);
      CREATE INDEX IF NOT EXISTS idx_blockchain_txs_hash ON blockchain_transactions(tx_hash);
      CREATE INDEX IF NOT EXISTS idx_blockchain_txs_from ON blockchain_transactions(from_address);
      CREATE INDEX IF NOT EXISTS idx_blockchain_txs_to ON blockchain_transactions(to_address);
      CREATE INDEX IF NOT EXISTS idx_blockchain_txs_status ON blockchain_transactions(status);
      CREATE INDEX IF NOT EXISTS idx_blockchain_txs_created ON blockchain_transactions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deployed_contracts_address ON deployed_contracts(contract_address, chain_id);
      CREATE INDEX IF NOT EXISTS idx_bridge_transfers_status ON bridge_transfers(status);
      CREATE INDEX IF NOT EXISTS idx_bridge_transfers_from_tx ON bridge_transfers(from_tx_hash);
      CREATE INDEX IF NOT EXISTS idx_bridge_transfers_to_tx ON bridge_transfers(to_tx_hash);

      -- 聊天和通知索引
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_participant ON chat_sessions(participant_did);
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_unread ON chat_sessions(unread_count DESC);
      CREATE INDEX IF NOT EXISTS idx_p2p_messages_session ON p2p_chat_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_p2p_messages_timestamp ON p2p_chat_messages(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_p2p_messages_sender ON p2p_chat_messages(sender_did);
      CREATE INDEX IF NOT EXISTS idx_p2p_messages_receiver ON p2p_chat_messages(receiver_did);
      CREATE INDEX IF NOT EXISTS idx_p2p_messages_status ON p2p_chat_messages(status);
      CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
      CREATE INDEX IF NOT EXISTS idx_message_reactions_user ON message_reactions(user_did);
      CREATE INDEX IF NOT EXISTS idx_message_reactions_created ON message_reactions(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_did);
      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

      -- 文件传输索引
      CREATE INDEX IF NOT EXISTS idx_file_transfers_device ON file_transfers(device_did);
      CREATE INDEX IF NOT EXISTS idx_file_transfers_status ON file_transfers(status);
      CREATE INDEX IF NOT EXISTS idx_file_transfers_created ON file_transfers(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_file_transfers_direction ON file_transfers(direction);

      -- 远程桌面索引
      CREATE INDEX IF NOT EXISTS idx_remote_desktop_device ON remote_desktop_sessions(device_did);
      CREATE INDEX IF NOT EXISTS idx_remote_desktop_status ON remote_desktop_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_remote_desktop_started ON remote_desktop_sessions(started_at DESC);

      -- ============================
      -- 企业版（去中心化组织）表结构
      -- ============================

      -- 身份上下文表（用户级别，加密）
      CREATE TABLE IF NOT EXISTS identity_contexts (
        context_id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        context_type TEXT NOT NULL CHECK(context_type IN ('personal', 'organization')),
        org_id TEXT,
        org_name TEXT,
        org_avatar TEXT,
        role TEXT,
        display_name TEXT,
        db_path TEXT NOT NULL,
        is_active INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER
      );

      -- 组织成员关系表（缓存）
      CREATE TABLE IF NOT EXISTS organization_memberships (
        id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        org_id TEXT NOT NULL,
        org_did TEXT NOT NULL,
        role TEXT NOT NULL,
        joined_at INTEGER NOT NULL,
        UNIQUE(user_did, org_id)
      );

      -- 组织元数据表
      CREATE TABLE IF NOT EXISTS organization_info (
        org_id TEXT PRIMARY KEY,
        org_did TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT CHECK(type IN ('startup', 'company', 'community', 'opensource', 'education')),
        avatar TEXT,
        owner_did TEXT NOT NULL,
        settings_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 组织成员表
      CREATE TABLE IF NOT EXISTS organization_members (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        member_did TEXT NOT NULL,
        display_name TEXT,
        avatar TEXT,
        role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member', 'viewer')),
        permissions TEXT,
        joined_at INTEGER NOT NULL,
        last_active_at INTEGER,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'removed')),
        UNIQUE(org_id, member_did)
      );

      -- 组织角色表
      CREATE TABLE IF NOT EXISTS organization_roles (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        permissions TEXT,
        is_builtin INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        UNIQUE(org_id, name)
      );

      -- 组织邀请表
      CREATE TABLE IF NOT EXISTS organization_invitations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        invite_code TEXT UNIQUE,
        invited_by TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        max_uses INTEGER DEFAULT 1,
        used_count INTEGER DEFAULT 0,
        expire_at INTEGER,
        created_at INTEGER NOT NULL
      );

      -- 组织DID邀请表（点对点邀请）
      CREATE TABLE IF NOT EXISTS organization_did_invitations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        org_name TEXT NOT NULL,
        invited_by_did TEXT NOT NULL,
        invited_by_name TEXT,
        invited_did TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'expired')),
        message TEXT,
        expire_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(org_id, invited_did)
      );

      -- 组织项目表
      CREATE TABLE IF NOT EXISTS organization_projects (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        owner_did TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 组织活动日志表
      CREATE TABLE IF NOT EXISTS organization_activities (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        actor_did TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        metadata TEXT,
        timestamp INTEGER NOT NULL
      );

      -- 权限审计日志表
      CREATE TABLE IF NOT EXISTS permission_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id TEXT NOT NULL,
        user_did TEXT NOT NULL,
        permission TEXT NOT NULL,
        action TEXT NOT NULL,
        result TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        context TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL
      );

      -- P2P同步状态表
      CREATE TABLE IF NOT EXISTS p2p_sync_state (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        local_version INTEGER DEFAULT 1,
        remote_version INTEGER DEFAULT 1,
        vector_clock TEXT, -- JSON: {did: version}
        cid TEXT,
        sync_status TEXT DEFAULT 'synced' CHECK(sync_status IN ('synced', 'pending', 'conflict')),
        last_synced_at INTEGER,
        UNIQUE(org_id, resource_type, resource_id)
      );

      -- 离线同步队列表
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        data TEXT, -- JSON
        version INTEGER NOT NULL,
        vector_clock TEXT, -- JSON
        created_at INTEGER NOT NULL,
        retry_count INTEGER DEFAULT 0,
        last_retry_at INTEGER,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'failed', 'completed'))
      );

      -- 冲突记录表
      CREATE TABLE IF NOT EXISTS sync_conflicts (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        local_version INTEGER NOT NULL,
        remote_version INTEGER NOT NULL,
        local_data TEXT, -- JSON
        remote_data TEXT, -- JSON
        local_vector_clock TEXT, -- JSON
        remote_vector_clock TEXT, -- JSON
        resolution_strategy TEXT, -- 'lww', 'merge', 'manual', 'local_wins', 'remote_wins'
        resolved INTEGER DEFAULT 0,
        resolved_at INTEGER,
        resolved_by_did TEXT,
        created_at INTEGER NOT NULL
      );

      -- 企业版索引
      CREATE UNIQUE INDEX IF NOT EXISTS idx_active_context ON identity_contexts(is_active) WHERE is_active = 1;
      CREATE INDEX IF NOT EXISTS idx_org_members_org_did ON organization_members(org_id, member_did);
      CREATE INDEX IF NOT EXISTS idx_org_members_role ON organization_members(org_id, role);
      CREATE INDEX IF NOT EXISTS idx_knowledge_org_id ON knowledge_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_activities_org_timestamp ON organization_activities(org_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_activities_actor ON organization_activities(actor_did);
      CREATE INDEX IF NOT EXISTS idx_audit_org ON permission_audit_log(org_id);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON permission_audit_log(user_did);
      CREATE INDEX IF NOT EXISTS idx_audit_permission ON permission_audit_log(permission);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON permission_audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_result ON permission_audit_log(result);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON permission_audit_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_org_user ON permission_audit_log(org_id, user_did);
      CREATE INDEX IF NOT EXISTS idx_audit_org_created ON permission_audit_log(org_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_version_history_knowledge ON knowledge_version_history(knowledge_id, version DESC);
      CREATE INDEX IF NOT EXISTS idx_version_history_created ON knowledge_version_history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sync_state_status ON p2p_sync_state(org_id, sync_status);
      CREATE INDEX IF NOT EXISTS idx_sync_state_version ON p2p_sync_state(org_id, resource_type, remote_version);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(org_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_sync_queue_resource ON sync_queue(org_id, resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_sync_conflicts_unresolved ON sync_conflicts(org_id, resolved, created_at);

      -- ============================
      -- 视频处理系统表结构
      -- ============================

      -- 视频文件主表
      CREATE TABLE IF NOT EXISTS video_files (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        duration REAL,
        width INTEGER,
        height INTEGER,
        fps REAL,
        format TEXT,
        video_codec TEXT,
        audio_codec TEXT,
        bitrate INTEGER,
        has_audio INTEGER DEFAULT 1,
        thumbnail_path TEXT,
        knowledge_id TEXT,
        analysis_status TEXT DEFAULT 'pending',
        analysis_progress INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      );

      -- 视频分析结果表
      CREATE TABLE IF NOT EXISTS video_analysis (
        id TEXT PRIMARY KEY,
        video_file_id TEXT NOT NULL,
        audio_path TEXT,
        transcription_text TEXT,
        transcription_confidence REAL,
        summary TEXT,
        tags TEXT,
        key_topics TEXT,
        sentiment TEXT,
        ocr_text TEXT,
        ocr_confidence REAL,
        analysis_engine TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_file_id) REFERENCES video_files(id) ON DELETE CASCADE
      );

      -- 视频关键帧表
      CREATE TABLE IF NOT EXISTS video_keyframes (
        id TEXT PRIMARY KEY,
        video_file_id TEXT NOT NULL,
        frame_path TEXT NOT NULL,
        timestamp REAL NOT NULL,
        scene_change_score REAL,
        ocr_text TEXT,
        ocr_confidence REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_file_id) REFERENCES video_files(id) ON DELETE CASCADE
      );

      -- 视频字幕表
      CREATE TABLE IF NOT EXISTS video_subtitles (
        id TEXT PRIMARY KEY,
        video_file_id TEXT NOT NULL,
        subtitle_type TEXT NOT NULL,
        language TEXT NOT NULL,
        format TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content TEXT,
        source TEXT,
        is_default INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_file_id) REFERENCES video_files(id) ON DELETE CASCADE
      );

      -- 视频编辑历史表
      CREATE TABLE IF NOT EXISTS video_edit_history (
        id TEXT PRIMARY KEY,
        original_video_id TEXT NOT NULL,
        output_video_id TEXT,
        output_path TEXT,
        operation_type TEXT NOT NULL,
        operation_params TEXT,
        status TEXT DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        duration REAL,
        error_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        FOREIGN KEY (original_video_id) REFERENCES video_files(id) ON DELETE CASCADE
      );

      -- 视频场景表
      CREATE TABLE IF NOT EXISTS video_scenes (
        id TEXT PRIMARY KEY,
        video_file_id TEXT NOT NULL,
        scene_index INTEGER NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        duration REAL,
        keyframe_path TEXT,
        description TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (video_file_id) REFERENCES video_files(id) ON DELETE CASCADE
      );

      -- 视频系统索引
      CREATE INDEX IF NOT EXISTS idx_video_files_knowledge ON video_files(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_video_files_created ON video_files(created_at);
      CREATE INDEX IF NOT EXISTS idx_video_files_status ON video_files(analysis_status);
      CREATE INDEX IF NOT EXISTS idx_video_analysis_video ON video_analysis(video_file_id);
      CREATE INDEX IF NOT EXISTS idx_keyframes_video ON video_keyframes(video_file_id);
      CREATE INDEX IF NOT EXISTS idx_keyframes_timestamp ON video_keyframes(timestamp);
      CREATE INDEX IF NOT EXISTS idx_subtitles_video ON video_subtitles(video_file_id);
      CREATE INDEX IF NOT EXISTS idx_edit_history_original ON video_edit_history(original_video_id);
      CREATE INDEX IF NOT EXISTS idx_scenes_video ON video_scenes(video_file_id);

      -- ============================
      -- 设计工具模块表（UI/UX Design Tool System）
      -- ============================

      -- 设计画板表
      CREATE TABLE IF NOT EXISTS design_artboards (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT DEFAULT 'Untitled Artboard',
        width INTEGER DEFAULT 1920,
        height INTEGER DEFAULT 1080,
        background_color TEXT DEFAULT '#FFFFFF',
        position_x REAL DEFAULT 0,
        position_y REAL DEFAULT 0,
        order_index INTEGER DEFAULT 0,
        is_template BOOLEAN DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 设计元素表（核心）
      CREATE TABLE IF NOT EXISTS design_objects (
        id TEXT PRIMARY KEY,
        artboard_id TEXT NOT NULL,
        object_type TEXT NOT NULL CHECK(object_type IN ('rect', 'circle', 'path', 'text', 'image', 'group', 'component')),
        name TEXT DEFAULT 'Layer',
        fabric_json TEXT NOT NULL,
        parent_id TEXT,
        order_index INTEGER DEFAULT 0,
        is_locked BOOLEAN DEFAULT 0,
        is_visible BOOLEAN DEFAULT 1,
        constraints TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (artboard_id) REFERENCES design_artboards(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES design_objects(id) ON DELETE CASCADE
      );

      -- UI 组件库表
      CREATE TABLE IF NOT EXISTS design_components (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'General',
        description TEXT,
        thumbnail_path TEXT,
        fabric_template TEXT NOT NULL,
        props_schema TEXT,
        default_props TEXT,
        tags TEXT,
        usage_count INTEGER DEFAULT 0,
        is_system BOOLEAN DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      -- 设计系统表（Design Tokens）
      CREATE TABLE IF NOT EXISTS design_tokens (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        token_type TEXT NOT NULL CHECK(token_type IN ('color', 'typography', 'spacing', 'shadow', 'border-radius')),
        token_name TEXT NOT NULL,
        token_value TEXT NOT NULL,
        description TEXT,
        category TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE(project_id, token_type, token_name)
      );

      -- 设计评论表
      CREATE TABLE IF NOT EXISTS design_comments (
        id TEXT PRIMARY KEY,
        artboard_id TEXT NOT NULL,
        object_id TEXT,
        user_id TEXT NOT NULL,
        position_x REAL,
        position_y REAL,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'archived')),
        thread_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (artboard_id) REFERENCES design_artboards(id) ON DELETE CASCADE,
        FOREIGN KEY (object_id) REFERENCES design_objects(id) ON DELETE CASCADE,
        FOREIGN KEY (thread_id) REFERENCES design_comments(id) ON DELETE CASCADE
      );

      -- 设计版本历史表
      CREATE TABLE IF NOT EXISTS design_versions (
        id TEXT PRIMARY KEY,
        artboard_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        snapshot_data TEXT NOT NULL,
        change_summary TEXT,
        author_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (artboard_id) REFERENCES design_artboards(id) ON DELETE CASCADE,
        UNIQUE(artboard_id, version_number)
      );

      -- 设计模块索引
      CREATE INDEX IF NOT EXISTS idx_artboards_project ON design_artboards(project_id);
      CREATE INDEX IF NOT EXISTS idx_artboards_order ON design_artboards(project_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_objects_artboard ON design_objects(artboard_id);
      CREATE INDEX IF NOT EXISTS idx_objects_artboard_order ON design_objects(artboard_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_objects_parent ON design_objects(parent_id);
      CREATE INDEX IF NOT EXISTS idx_objects_type ON design_objects(object_type);
      CREATE INDEX IF NOT EXISTS idx_components_project ON design_components(project_id);
      CREATE INDEX IF NOT EXISTS idx_components_category ON design_components(category);
      CREATE INDEX IF NOT EXISTS idx_components_system ON design_components(is_system);
      CREATE INDEX IF NOT EXISTS idx_tokens_project_type ON design_tokens(project_id, token_type);
      CREATE INDEX IF NOT EXISTS idx_comments_artboard ON design_comments(artboard_id);
      CREATE INDEX IF NOT EXISTS idx_comments_object ON design_comments(object_id);
      CREATE INDEX IF NOT EXISTS idx_comments_thread ON design_comments(thread_id);
      CREATE INDEX IF NOT EXISTS idx_comments_status ON design_comments(status);
      CREATE INDEX IF NOT EXISTS idx_versions_artboard ON design_versions(artboard_id);
      CREATE INDEX IF NOT EXISTS idx_versions_artboard_version ON design_versions(artboard_id, version_number);

      -- ============================
      -- Yjs 协作模块表（Real-time Collaboration with Yjs CRDT）
      -- ============================

      -- Yjs 文档更新表（存储 CRDT 更新）
      CREATE TABLE IF NOT EXISTS knowledge_yjs_updates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        knowledge_id TEXT NOT NULL,
        update_data BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      );

      -- Yjs 文档快照表（用于版本回滚）
      CREATE TABLE IF NOT EXISTS knowledge_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        knowledge_id TEXT NOT NULL,
        snapshot_data BLOB NOT NULL,
        state_vector BLOB NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      );

      -- 协作会话表（跟踪谁在编辑）
      CREATE TABLE IF NOT EXISTS collaboration_sessions (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        org_id TEXT,
        user_did TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_color TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        cursor_position INTEGER,
        selection_start INTEGER,
        selection_end INTEGER,
        last_activity INTEGER NOT NULL,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'idle', 'disconnected')),
        created_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (org_id) REFERENCES organization_info(org_id) ON DELETE CASCADE
      );

      -- 知识库评论表（内联评论和注释）
      CREATE TABLE IF NOT EXISTS knowledge_comments (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        org_id TEXT,
        author_did TEXT NOT NULL,
        author_name TEXT NOT NULL,
        content TEXT NOT NULL,
        position_start INTEGER,
        position_end INTEGER,
        thread_id TEXT,
        parent_comment_id TEXT,
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'deleted')),
        resolved_by TEXT,
        resolved_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (org_id) REFERENCES organization_info(org_id) ON DELETE CASCADE,
        FOREIGN KEY (parent_comment_id) REFERENCES knowledge_comments(id) ON DELETE CASCADE
      );

      -- 组织知识库文件夹表（共享文件夹）
      CREATE TABLE IF NOT EXISTS org_knowledge_folders (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_folder_id TEXT,
        description TEXT,
        icon TEXT,
        color TEXT,
        permissions TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (org_id) REFERENCES organization_info(org_id) ON DELETE CASCADE,
        FOREIGN KEY (parent_folder_id) REFERENCES org_knowledge_folders(id) ON DELETE CASCADE
      );

      -- 组织知识库项表（扩展 knowledge_items）
      CREATE TABLE IF NOT EXISTS org_knowledge_items (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL UNIQUE,
        org_id TEXT NOT NULL,
        folder_id TEXT,
        permissions TEXT NOT NULL,
        is_public BOOLEAN DEFAULT 0,
        created_by TEXT NOT NULL,
        last_edited_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (org_id) REFERENCES organization_info(org_id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES org_knowledge_folders(id) ON DELETE SET NULL
      );

      -- 知识库活动日志表（用于仪表板分析）
      CREATE TABLE IF NOT EXISTS knowledge_activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        knowledge_id TEXT NOT NULL,
        org_id TEXT,
        user_did TEXT NOT NULL,
        user_name TEXT NOT NULL,
        activity_type TEXT NOT NULL CHECK(activity_type IN ('create', 'edit', 'view', 'comment', 'share', 'delete', 'restore')),
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        FOREIGN KEY (org_id) REFERENCES organization_info(org_id) ON DELETE SET NULL
      );

      -- ============================
      -- RSS 订阅相关表
      -- ============================

      -- RSS 订阅源表
      CREATE TABLE IF NOT EXISTS rss_feeds (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        link TEXT,
        language TEXT,
        image_url TEXT,
        category TEXT,
        update_frequency INTEGER DEFAULT 3600,
        last_fetched_at INTEGER,
        last_build_date TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'error')),
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- RSS 文章表
      CREATE TABLE IF NOT EXISTS rss_items (
        id TEXT PRIMARY KEY,
        feed_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        title TEXT NOT NULL,
        link TEXT,
        description TEXT,
        content TEXT,
        author TEXT,
        pub_date TEXT,
        categories TEXT,
        enclosure_url TEXT,
        enclosure_type TEXT,
        is_read INTEGER DEFAULT 0,
        is_starred INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        knowledge_item_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (feed_id) REFERENCES rss_feeds(id) ON DELETE CASCADE,
        FOREIGN KEY (knowledge_item_id) REFERENCES knowledge_items(id) ON DELETE SET NULL,
        UNIQUE(feed_id, item_id)
      );

      -- RSS 订阅分类表
      CREATE TABLE IF NOT EXISTS rss_categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        icon TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      -- RSS 订阅-分类关联表
      CREATE TABLE IF NOT EXISTS rss_feed_categories (
        feed_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (feed_id, category_id),
        FOREIGN KEY (feed_id) REFERENCES rss_feeds(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES rss_categories(id) ON DELETE CASCADE
      );

      -- ============================
      -- 邮件集成相关表
      -- ============================

      -- 邮件账户表
      CREATE TABLE IF NOT EXISTS email_accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT,
        imap_host TEXT NOT NULL,
        imap_port INTEGER NOT NULL,
        imap_tls INTEGER DEFAULT 1,
        smtp_host TEXT NOT NULL,
        smtp_port INTEGER NOT NULL,
        smtp_secure INTEGER DEFAULT 0,
        password TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'error')),
        error_message TEXT,
        last_sync_at INTEGER,
        sync_frequency INTEGER DEFAULT 300,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 邮件邮箱表
      CREATE TABLE IF NOT EXISTS email_mailboxes (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        delimiter TEXT DEFAULT '/',
        flags TEXT,
        sync_enabled INTEGER DEFAULT 1,
        last_sync_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
        UNIQUE(account_id, name)
      );

      -- 邮件表
      CREATE TABLE IF NOT EXISTS emails (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        mailbox_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        uid INTEGER,
        subject TEXT,
        from_address TEXT,
        to_address TEXT,
        cc_address TEXT,
        date TEXT,
        text_content TEXT,
        html_content TEXT,
        has_attachments INTEGER DEFAULT 0,
        is_read INTEGER DEFAULT 0,
        is_starred INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        knowledge_item_id TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (account_id) REFERENCES email_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (mailbox_id) REFERENCES email_mailboxes(id) ON DELETE CASCADE,
        FOREIGN KEY (knowledge_item_id) REFERENCES knowledge_items(id) ON DELETE SET NULL,
        UNIQUE(account_id, mailbox_id, message_id)
      );

      -- 邮件附件表
      CREATE TABLE IF NOT EXISTS email_attachments (
        id TEXT PRIMARY KEY,
        email_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        content_type TEXT,
        size INTEGER,
        file_path TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE
      );

      -- 邮件标签表
      CREATE TABLE IF NOT EXISTS email_labels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        color TEXT,
        icon TEXT,
        created_at INTEGER NOT NULL
      );

      -- 邮件-标签关联表
      CREATE TABLE IF NOT EXISTS email_label_mappings (
        email_id TEXT NOT NULL,
        label_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (email_id, label_id),
        FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE CASCADE,
        FOREIGN KEY (label_id) REFERENCES email_labels(id) ON DELETE CASCADE
      );

      -- ============================
      -- 外部设备文件管理模块
      -- ============================

      -- 外部设备文件索引表
      CREATE TABLE IF NOT EXISTS external_device_files (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        file_path TEXT,
        mime_type TEXT,
        file_size INTEGER,
        category TEXT CHECK(category IN ('DOCUMENT', 'IMAGE', 'VIDEO', 'AUDIO', 'CODE', 'OTHER')),
        last_modified INTEGER,
        indexed_at INTEGER,
        is_cached INTEGER DEFAULT 0,
        cache_path TEXT,
        checksum TEXT,
        metadata TEXT,
        sync_status TEXT DEFAULT 'pending' CHECK(sync_status IN ('pending', 'syncing', 'synced', 'error')),
        last_access INTEGER,
        is_favorite INTEGER DEFAULT 0,
        tags TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
      );

      -- 文件传输任务表
      CREATE TABLE IF NOT EXISTS file_transfer_tasks (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        file_id TEXT NOT NULL,
        transfer_type TEXT NOT NULL CHECK(transfer_type IN ('pull', 'push')),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
        progress REAL DEFAULT 0,
        bytes_transferred INTEGER DEFAULT 0,
        total_bytes INTEGER,
        error_message TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        created_at INTEGER,
        FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE,
        FOREIGN KEY (file_id) REFERENCES external_device_files(id) ON DELETE CASCADE
      );

      -- 文件同步日志表
      CREATE TABLE IF NOT EXISTS file_sync_logs (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        sync_type TEXT NOT NULL CHECK(sync_type IN ('index_sync', 'file_pull')),
        items_count INTEGER DEFAULT 0,
        bytes_transferred INTEGER DEFAULT 0,
        duration_ms INTEGER,
        status TEXT CHECK(status IN ('success', 'partial', 'failed')),
        error_details TEXT,
        created_at INTEGER,
        FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
      );

      -- 协作模块索引
      CREATE INDEX IF NOT EXISTS idx_yjs_updates_knowledge ON knowledge_yjs_updates(knowledge_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_snapshots_knowledge ON knowledge_snapshots(knowledge_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_collab_sessions_knowledge ON collaboration_sessions(knowledge_id, status);
      CREATE INDEX IF NOT EXISTS idx_collab_sessions_org ON collaboration_sessions(org_id, status);
      CREATE INDEX IF NOT EXISTS idx_collab_sessions_activity ON collaboration_sessions(last_activity DESC);
      CREATE INDEX IF NOT EXISTS idx_comments_knowledge ON knowledge_comments(knowledge_id, status);
      CREATE INDEX IF NOT EXISTS idx_comments_org ON knowledge_comments(org_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_comments_thread ON knowledge_comments(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_comments_author ON knowledge_comments(author_did);
      CREATE INDEX IF NOT EXISTS idx_org_folders_org ON org_knowledge_folders(org_id);
      CREATE INDEX IF NOT EXISTS idx_org_folders_parent ON org_knowledge_folders(parent_folder_id);
      CREATE INDEX IF NOT EXISTS idx_org_knowledge_org ON org_knowledge_items(org_id);
      CREATE INDEX IF NOT EXISTS idx_org_knowledge_folder ON org_knowledge_items(folder_id);
      CREATE INDEX IF NOT EXISTS idx_org_knowledge_created ON org_knowledge_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_activities_knowledge ON knowledge_activities(knowledge_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_activities_org ON knowledge_activities(org_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_activities_user ON knowledge_activities(user_did, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_knowledge_activities_type ON knowledge_activities(activity_type, created_at DESC);

      -- RSS 模块索引
      CREATE INDEX IF NOT EXISTS idx_rss_feeds_status ON rss_feeds(status);
      CREATE INDEX IF NOT EXISTS idx_rss_feeds_category ON rss_feeds(category);
      CREATE INDEX IF NOT EXISTS idx_rss_feeds_last_fetched ON rss_feeds(last_fetched_at);
      CREATE INDEX IF NOT EXISTS idx_rss_items_feed ON rss_items(feed_id, pub_date DESC);
      CREATE INDEX IF NOT EXISTS idx_rss_items_read ON rss_items(is_read, pub_date DESC);
      CREATE INDEX IF NOT EXISTS idx_rss_items_starred ON rss_items(is_starred, pub_date DESC);
      CREATE INDEX IF NOT EXISTS idx_rss_items_archived ON rss_items(is_archived);
      CREATE INDEX IF NOT EXISTS idx_rss_items_knowledge ON rss_items(knowledge_item_id);

      -- 邮件模块索引
      CREATE INDEX IF NOT EXISTS idx_email_accounts_status ON email_accounts(status);
      CREATE INDEX IF NOT EXISTS idx_email_accounts_last_sync ON email_accounts(last_sync_at);
      CREATE INDEX IF NOT EXISTS idx_email_mailboxes_account ON email_mailboxes(account_id);
      CREATE INDEX IF NOT EXISTS idx_email_mailboxes_sync ON email_mailboxes(sync_enabled, last_sync_at);
      CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_id, date DESC);
      CREATE INDEX IF NOT EXISTS idx_emails_mailbox ON emails(mailbox_id, date DESC);
      CREATE INDEX IF NOT EXISTS idx_emails_read ON emails(is_read, date DESC);
      CREATE INDEX IF NOT EXISTS idx_emails_starred ON emails(is_starred, date DESC);
      CREATE INDEX IF NOT EXISTS idx_emails_archived ON emails(is_archived);
      CREATE INDEX IF NOT EXISTS idx_emails_knowledge ON emails(knowledge_item_id);
      CREATE INDEX IF NOT EXISTS idx_email_attachments_email ON email_attachments(email_id);

      -- 外部设备文件模块索引
      CREATE INDEX IF NOT EXISTS idx_external_device_files_device ON external_device_files(device_id);
      CREATE INDEX IF NOT EXISTS idx_external_device_files_category ON external_device_files(category);
      CREATE INDEX IF NOT EXISTS idx_external_device_files_sync_status ON external_device_files(sync_status);
      CREATE INDEX IF NOT EXISTS idx_external_device_files_checksum ON external_device_files(checksum);
      CREATE INDEX IF NOT EXISTS idx_external_device_files_is_cached ON external_device_files(is_cached);
      CREATE INDEX IF NOT EXISTS idx_external_device_files_last_access ON external_device_files(last_access);
      CREATE INDEX IF NOT EXISTS idx_file_transfer_tasks_status ON file_transfer_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_file_transfer_tasks_device ON file_transfer_tasks(device_id);
      CREATE INDEX IF NOT EXISTS idx_file_sync_logs_created_at ON file_sync_logs(created_at DESC);

      -- ============================
      -- Cowork 多代理协作系统表结构
      -- ============================

      -- Cowork 团队表
      CREATE TABLE IF NOT EXISTS cowork_teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'failed', 'destroyed', 'archived')),
        max_agents INTEGER DEFAULT 5,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        metadata TEXT  -- JSON格式：团队配置、描述等
      );

      -- Cowork 代理表
      CREATE TABLE IF NOT EXISTS cowork_agents (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'idle' CHECK(status IN ('idle', 'busy', 'waiting', 'terminated', 'removed')),
        assigned_task TEXT,
        created_at INTEGER NOT NULL,
        terminated_at INTEGER,
        metadata TEXT,  -- JSON格式：能力、加入时间等
        FOREIGN KEY (team_id) REFERENCES cowork_teams(id) ON DELETE CASCADE
      );

      -- Cowork 任务表
      CREATE TABLE IF NOT EXISTS cowork_tasks (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'assigned', 'running', 'completed', 'failed')),
        priority INTEGER DEFAULT 0,
        assigned_to TEXT,  -- agent_id
        result TEXT,  -- JSON格式
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        metadata TEXT,  -- JSON格式
        FOREIGN KEY (team_id) REFERENCES cowork_teams(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_to) REFERENCES cowork_agents(id) ON DELETE SET NULL
      );

      -- Cowork 消息表
      CREATE TABLE IF NOT EXISTS cowork_messages (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        from_agent TEXT NOT NULL,
        to_agent TEXT,  -- NULL表示广播
        message TEXT NOT NULL,  -- JSON格式
        timestamp INTEGER NOT NULL,
        metadata TEXT,  -- JSON格式
        FOREIGN KEY (team_id) REFERENCES cowork_teams(id) ON DELETE CASCADE,
        FOREIGN KEY (from_agent) REFERENCES cowork_agents(id) ON DELETE CASCADE,
        FOREIGN KEY (to_agent) REFERENCES cowork_agents(id) ON DELETE CASCADE
      );

      -- Cowork 审计日志表
      CREATE TABLE IF NOT EXISTS cowork_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id TEXT NOT NULL,
        agent_id TEXT,
        operation TEXT NOT NULL,  -- 'read', 'write', 'delete', 'execute'
        resource_type TEXT,  -- 'file', 'task', 'message'
        resource_path TEXT,
        timestamp INTEGER NOT NULL,
        success INTEGER DEFAULT 1,
        error_message TEXT,
        metadata TEXT,  -- JSON格式
        FOREIGN KEY (team_id) REFERENCES cowork_teams(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES cowork_agents(id) ON DELETE SET NULL
      );

      -- Cowork 性能指标表
      CREATE TABLE IF NOT EXISTS cowork_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id TEXT NOT NULL,
        agent_id TEXT,
        metric_type TEXT NOT NULL,  -- 'token_usage', 'cost', 'duration', 'error_rate'
        metric_value REAL NOT NULL,
        tokens_used INTEGER,
        cost REAL,
        timestamp INTEGER NOT NULL,
        metadata TEXT,  -- JSON格式
        FOREIGN KEY (team_id) REFERENCES cowork_teams(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES cowork_agents(id) ON DELETE SET NULL
      );

      -- Cowork 检查点表（用于长时运行任务）
      CREATE TABLE IF NOT EXISTS cowork_checkpoints (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        task_id TEXT,
        checkpoint_data TEXT NOT NULL,  -- JSON格式：完整的团队状态快照
        timestamp INTEGER NOT NULL,
        metadata TEXT,  -- JSON格式
        FOREIGN KEY (team_id) REFERENCES cowork_teams(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES cowork_tasks(id) ON DELETE CASCADE
      );

      -- Cowork 文件沙箱权限表
      CREATE TABLE IF NOT EXISTS cowork_sandbox_permissions (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        path TEXT NOT NULL,  -- 允许访问的路径
        permission TEXT DEFAULT 'read' CHECK(permission IN ('read', 'write', 'execute')),
        granted_at INTEGER NOT NULL,
        granted_by TEXT,  -- user_did
        expires_at INTEGER,
        is_active INTEGER DEFAULT 1,
        metadata TEXT,  -- JSON格式
        FOREIGN KEY (team_id) REFERENCES cowork_teams(id) ON DELETE CASCADE,
        UNIQUE(team_id, path, permission)
      );

      -- Cowork 决策投票表
      CREATE TABLE IF NOT EXISTS cowork_decisions (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        decision_type TEXT NOT NULL,  -- 'task_assignment', 'conflict_resolution', 'custom'
        description TEXT,
        options TEXT,  -- JSON格式：投票选项
        votes TEXT,  -- JSON格式：{agentId: vote}
        result TEXT,  -- JSON格式：投票结果
        threshold REAL DEFAULT 0.5,
        passed INTEGER,  -- 0或1
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        metadata TEXT,  -- JSON格式
        FOREIGN KEY (team_id) REFERENCES cowork_teams(id) ON DELETE CASCADE
      );

      -- Cowork 索引
      CREATE INDEX IF NOT EXISTS idx_cowork_teams_status ON cowork_teams(status);
      CREATE INDEX IF NOT EXISTS idx_cowork_teams_created_at ON cowork_teams(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cowork_agents_team ON cowork_agents(team_id);
      CREATE INDEX IF NOT EXISTS idx_cowork_agents_status ON cowork_agents(status);
      CREATE INDEX IF NOT EXISTS idx_cowork_tasks_team ON cowork_tasks(team_id);
      CREATE INDEX IF NOT EXISTS idx_cowork_tasks_status ON cowork_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_cowork_tasks_assigned_to ON cowork_tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_cowork_tasks_priority ON cowork_tasks(priority DESC);
      CREATE INDEX IF NOT EXISTS idx_cowork_messages_team ON cowork_messages(team_id);
      CREATE INDEX IF NOT EXISTS idx_cowork_messages_from ON cowork_messages(from_agent);
      CREATE INDEX IF NOT EXISTS idx_cowork_messages_to ON cowork_messages(to_agent);
      CREATE INDEX IF NOT EXISTS idx_cowork_messages_timestamp ON cowork_messages(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_cowork_audit_team ON cowork_audit_log(team_id);
      CREATE INDEX IF NOT EXISTS idx_cowork_audit_agent ON cowork_audit_log(agent_id);
      CREATE INDEX IF NOT EXISTS idx_cowork_audit_operation ON cowork_audit_log(operation);
      CREATE INDEX IF NOT EXISTS idx_cowork_audit_timestamp ON cowork_audit_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_cowork_metrics_team ON cowork_metrics(team_id);
      CREATE INDEX IF NOT EXISTS idx_cowork_metrics_agent ON cowork_metrics(agent_id);
      CREATE INDEX IF NOT EXISTS idx_cowork_metrics_type ON cowork_metrics(metric_type);
      CREATE INDEX IF NOT EXISTS idx_cowork_metrics_timestamp ON cowork_metrics(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_cowork_checkpoints_team ON cowork_checkpoints(team_id);
      CREATE INDEX IF NOT EXISTS idx_cowork_checkpoints_task ON cowork_checkpoints(task_id);
      CREATE INDEX IF NOT EXISTS idx_cowork_checkpoints_timestamp ON cowork_checkpoints(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_cowork_sandbox_team ON cowork_sandbox_permissions(team_id);
      CREATE INDEX IF NOT EXISTS idx_cowork_sandbox_path ON cowork_sandbox_permissions(path);
      CREATE INDEX IF NOT EXISTS idx_cowork_sandbox_active ON cowork_sandbox_permissions(is_active);
      CREATE INDEX IF NOT EXISTS idx_cowork_decisions_team ON cowork_decisions(team_id);
      CREATE INDEX IF NOT EXISTS idx_cowork_decisions_type ON cowork_decisions(decision_type);
      CREATE INDEX IF NOT EXISTS idx_cowork_decisions_created_at ON cowork_decisions(created_at DESC);

      -- 🚀 Phase 4: Additional Composite Indexes for Performance
      -- Cowork-specific composite indexes for common query patterns
      CREATE INDEX IF NOT EXISTS idx_cowork_tasks_team_status ON cowork_tasks(team_id, status);
      CREATE INDEX IF NOT EXISTS idx_cowork_tasks_team_priority ON cowork_tasks(team_id, priority DESC, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cowork_agents_team_status ON cowork_agents(team_id, status);
      CREATE INDEX IF NOT EXISTS idx_cowork_messages_team_timestamp ON cowork_messages(team_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_cowork_audit_team_operation ON cowork_audit_log(team_id, operation, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_cowork_audit_path_timestamp ON cowork_audit_log(resource_path, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_cowork_metrics_team_type ON cowork_metrics(team_id, metric_type, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_cowork_sandbox_team_path ON cowork_sandbox_permissions(team_id, path, is_active);

      -- ============================
      -- 企业版组织协作功能表结构 (Enterprise Collaboration)
      -- ============================

      -- ============================
      -- 模块1: 实时协作编辑 (Real-time Collaboration)
      -- ============================

      -- 文档协作锁表（Section Locking）
      CREATE TABLE IF NOT EXISTS collab_document_locks (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        org_id TEXT,
        locked_by_did TEXT NOT NULL,
        locked_by_name TEXT,
        lock_type TEXT NOT NULL CHECK(lock_type IN ('full', 'section')),
        section_start INTEGER,
        section_end INTEGER,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      );

      -- 冲突历史表
      CREATE TABLE IF NOT EXISTS collab_conflict_history (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        org_id TEXT,
        conflict_type TEXT NOT NULL CHECK(conflict_type IN ('concurrent_edit', 'merge_conflict', 'version_mismatch')),
        local_version INTEGER NOT NULL,
        remote_version INTEGER NOT NULL,
        local_content TEXT,
        remote_content TEXT,
        local_user_did TEXT,
        remote_user_did TEXT,
        resolved_by_did TEXT,
        resolution_strategy TEXT CHECK(resolution_strategy IN ('local_wins', 'remote_wins', 'manual_merge', 'auto_merge')),
        merged_content TEXT,
        resolved_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      );

      -- 光标位置表（用户感知系统）
      CREATE TABLE IF NOT EXISTS collab_cursor_positions (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        user_did TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_color TEXT NOT NULL,
        cursor_line INTEGER,
        cursor_column INTEGER,
        selection_start_line INTEGER,
        selection_start_column INTEGER,
        selection_end_line INTEGER,
        selection_end_column INTEGER,
        last_activity INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
        UNIQUE(knowledge_id, user_did)
      );

      -- 协作统计表
      CREATE TABLE IF NOT EXISTS collab_stats (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL UNIQUE,
        org_id TEXT,
        total_edits INTEGER DEFAULT 0,
        total_collaborators INTEGER DEFAULT 0,
        total_conflicts INTEGER DEFAULT 0,
        total_comments INTEGER DEFAULT 0,
        total_sessions INTEGER DEFAULT 0,
        last_edit_at INTEGER,
        last_conflict_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (knowledge_id) REFERENCES knowledge_items(id) ON DELETE CASCADE
      );

      -- 协作模块索引
      CREATE INDEX IF NOT EXISTS idx_collab_locks_knowledge ON collab_document_locks(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_collab_locks_user ON collab_document_locks(locked_by_did);
      CREATE INDEX IF NOT EXISTS idx_collab_locks_expires ON collab_document_locks(expires_at);
      CREATE INDEX IF NOT EXISTS idx_collab_conflicts_knowledge ON collab_conflict_history(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_collab_conflicts_resolved ON collab_conflict_history(resolved_at);
      CREATE INDEX IF NOT EXISTS idx_collab_cursors_knowledge ON collab_cursor_positions(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_collab_cursors_activity ON collab_cursor_positions(last_activity DESC);
      CREATE INDEX IF NOT EXISTS idx_collab_stats_org ON collab_stats(org_id);

      -- ============================
      -- 模块2: 团队任务管理 (Team Task Management)
      -- ============================

      -- 任务看板表
      CREATE TABLE IF NOT EXISTS task_boards (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        board_type TEXT DEFAULT 'kanban' CHECK(board_type IN ('kanban', 'scrum', 'custom')),
        owner_did TEXT NOT NULL,
        settings TEXT, -- JSON: 看板配置
        is_archived INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 看板列表
      CREATE TABLE IF NOT EXISTS task_board_columns (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        position INTEGER NOT NULL,
        wip_limit INTEGER, -- 工作进行中限制
        is_done_column INTEGER DEFAULT 0,
        color TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
      );

      -- 团队任务表
      CREATE TABLE IF NOT EXISTS team_tasks (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        column_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'medium' CHECK(priority IN ('critical', 'high', 'medium', 'low')),
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'review', 'done', 'cancelled')),
        task_type TEXT DEFAULT 'task' CHECK(task_type IN ('epic', 'story', 'task', 'subtask', 'bug', 'feature')),
        parent_task_id TEXT,
        assignee_did TEXT,
        reporter_did TEXT NOT NULL,
        due_date INTEGER,
        start_date INTEGER,
        story_points INTEGER,
        estimated_hours REAL,
        actual_hours REAL,
        labels TEXT, -- JSON array
        position INTEGER DEFAULT 0,
        sprint_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE,
        FOREIGN KEY (column_id) REFERENCES task_board_columns(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_task_id) REFERENCES team_tasks(id) ON DELETE CASCADE
      );

      -- 任务分配表（多人分配）
      CREATE TABLE IF NOT EXISTS task_assignees (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        user_did TEXT NOT NULL,
        role TEXT DEFAULT 'assignee' CHECK(role IN ('assignee', 'reviewer', 'watcher')),
        assigned_at INTEGER NOT NULL,
        assigned_by TEXT,
        FOREIGN KEY (task_id) REFERENCES team_tasks(id) ON DELETE CASCADE,
        UNIQUE(task_id, user_did, role)
      );

      -- 任务标签表
      CREATE TABLE IF NOT EXISTS task_labels (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(org_id, name)
      );

      -- 任务检查清单表
      CREATE TABLE IF NOT EXISTS task_checklists (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        title TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES team_tasks(id) ON DELETE CASCADE
      );

      -- 检查清单项表
      CREATE TABLE IF NOT EXISTS task_checklist_items (
        id TEXT PRIMARY KEY,
        checklist_id TEXT NOT NULL,
        content TEXT NOT NULL,
        is_done INTEGER DEFAULT 0,
        assignee_did TEXT,
        due_date INTEGER,
        position INTEGER DEFAULT 0,
        completed_at INTEGER,
        completed_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (checklist_id) REFERENCES task_checklists(id) ON DELETE CASCADE
      );

      -- 任务评论表
      CREATE TABLE IF NOT EXISTS task_comments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        author_did TEXT NOT NULL,
        author_name TEXT,
        content TEXT NOT NULL,
        parent_id TEXT,
        mentions TEXT, -- JSON array of DIDs
        is_edited INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES team_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (parent_id) REFERENCES task_comments(id) ON DELETE CASCADE
      );

      -- 任务附件表
      CREATE TABLE IF NOT EXISTS task_attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        uploader_did TEXT NOT NULL,
        uploader_name TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES team_tasks(id) ON DELETE CASCADE
      );

      -- 任务活动日志表
      CREATE TABLE IF NOT EXISTS task_activity_log (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        actor_did TEXT NOT NULL,
        actor_name TEXT,
        action TEXT NOT NULL,
        field_changed TEXT,
        old_value TEXT,
        new_value TEXT,
        metadata TEXT, -- JSON
        created_at INTEGER NOT NULL,
        FOREIGN KEY (task_id) REFERENCES team_tasks(id) ON DELETE CASCADE
      );

      -- 任务依赖表
      CREATE TABLE IF NOT EXISTS task_dependencies (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        depends_on_task_id TEXT NOT NULL,
        dependency_type TEXT DEFAULT 'blocks' CHECK(dependency_type IN ('blocks', 'blocked_by', 'relates_to', 'duplicates')),
        lag_days INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        created_by TEXT,
        FOREIGN KEY (task_id) REFERENCES team_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (depends_on_task_id) REFERENCES team_tasks(id) ON DELETE CASCADE,
        UNIQUE(task_id, depends_on_task_id, dependency_type)
      );

      -- Sprint 表
      CREATE TABLE IF NOT EXISTS task_sprints (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        name TEXT NOT NULL,
        goal TEXT,
        start_date INTEGER,
        end_date INTEGER,
        status TEXT DEFAULT 'planning' CHECK(status IN ('planning', 'active', 'completed', 'cancelled')),
        velocity_planned INTEGER,
        velocity_completed INTEGER,
        velocity_average REAL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
      );

      -- 团队报告表
      CREATE TABLE IF NOT EXISTS team_reports (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        board_id TEXT,
        report_type TEXT NOT NULL CHECK(report_type IN ('daily_standup', 'weekly', 'sprint_review', 'retrospective', 'custom')),
        author_did TEXT NOT NULL,
        author_name TEXT,
        yesterday_work TEXT,
        today_plan TEXT,
        blockers TEXT,
        notes TEXT,
        ai_summary TEXT,
        report_date INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE SET NULL
      );

      -- 任务工作流规则表
      CREATE TABLE IF NOT EXISTS task_workflow_rules (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        trigger_event TEXT NOT NULL CHECK(trigger_event IN ('task_created', 'task_moved', 'task_assigned', 'task_completed', 'due_date_approaching', 'custom')),
        trigger_conditions TEXT, -- JSON: 触发条件
        actions TEXT NOT NULL, -- JSON: 执行动作
        enabled INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (board_id) REFERENCES task_boards(id) ON DELETE CASCADE
      );

      -- 任务管理模块索引
      CREATE INDEX IF NOT EXISTS idx_task_columns_board ON task_board_columns(board_id);
      CREATE INDEX IF NOT EXISTS idx_task_columns_position ON task_board_columns(board_id, position);
      CREATE INDEX IF NOT EXISTS idx_team_tasks_board ON team_tasks(board_id);
      CREATE INDEX IF NOT EXISTS idx_team_tasks_column ON team_tasks(column_id);
      CREATE INDEX IF NOT EXISTS idx_team_tasks_assignee ON team_tasks(assignee_did);
      CREATE INDEX IF NOT EXISTS idx_team_tasks_parent ON team_tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_team_tasks_sprint ON team_tasks(sprint_id);
      CREATE INDEX IF NOT EXISTS idx_team_tasks_status ON team_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_team_tasks_priority ON team_tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_team_tasks_due ON team_tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_team_tasks_board_status ON team_tasks(board_id, status);
      CREATE INDEX IF NOT EXISTS idx_task_assignees_task ON task_assignees(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_did);
      CREATE INDEX IF NOT EXISTS idx_task_labels_org ON task_labels(org_id);
      CREATE INDEX IF NOT EXISTS idx_task_checklists_task ON task_checklists(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_checklist_items_list ON task_checklist_items(checklist_id);
      CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_comments_author ON task_comments(author_did);
      CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity_log(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_activity_actor ON task_activity_log(actor_did);
      CREATE INDEX IF NOT EXISTS idx_task_activity_created ON task_activity_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_task_dependencies_task ON task_dependencies(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends ON task_dependencies(depends_on_task_id);
      CREATE INDEX IF NOT EXISTS idx_task_sprints_board ON task_sprints(board_id);
      CREATE INDEX IF NOT EXISTS idx_task_sprints_status ON task_sprints(status);
      CREATE INDEX IF NOT EXISTS idx_team_reports_org ON team_reports(org_id);
      CREATE INDEX IF NOT EXISTS idx_team_reports_board ON team_reports(board_id);
      CREATE INDEX IF NOT EXISTS idx_team_reports_date ON team_reports(report_date DESC);
      CREATE INDEX IF NOT EXISTS idx_task_workflow_board ON task_workflow_rules(board_id);
      CREATE INDEX IF NOT EXISTS idx_task_workflow_enabled ON task_workflow_rules(enabled);

      -- ============================
      -- 模块3: 组织权限增强 (Organization Permission Enhancement)
      -- ============================

      -- 资源类型注册表
      CREATE TABLE IF NOT EXISTS permission_resource_types (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        display_name TEXT,
        description TEXT,
        available_actions TEXT NOT NULL, -- JSON array: ['read', 'write', 'delete', 'admin']
        parent_type TEXT,
        created_at INTEGER NOT NULL
      );

      -- 细粒度权限授予表
      CREATE TABLE IF NOT EXISTS permission_grants (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        grantee_type TEXT NOT NULL CHECK(grantee_type IN ('user', 'role', 'team')),
        grantee_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT, -- NULL means all resources of this type
        permission TEXT NOT NULL,
        conditions TEXT, -- JSON: 条件表达式
        granted_by TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(org_id, grantee_type, grantee_id, resource_type, resource_id, permission)
      );

      -- 权限继承表
      CREATE TABLE IF NOT EXISTS permission_inheritance (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        parent_resource_type TEXT NOT NULL,
        parent_resource_id TEXT NOT NULL,
        child_resource_type TEXT NOT NULL,
        child_resource_id TEXT NOT NULL,
        inherit_permissions TEXT, -- JSON array: 继承的权限列表，NULL表示全部继承
        created_at INTEGER NOT NULL,
        UNIQUE(org_id, parent_resource_type, parent_resource_id, child_resource_type, child_resource_id)
      );

      -- 审批工作流表
      CREATE TABLE IF NOT EXISTS approval_workflows (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        trigger_resource_type TEXT NOT NULL,
        trigger_action TEXT NOT NULL,
        trigger_conditions TEXT, -- JSON
        approval_type TEXT DEFAULT 'sequential' CHECK(approval_type IN ('sequential', 'parallel', 'any_one')),
        approvers TEXT NOT NULL, -- JSON array of steps
        timeout_hours INTEGER DEFAULT 72,
        on_timeout TEXT DEFAULT 'reject' CHECK(on_timeout IN ('approve', 'reject', 'escalate')),
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(org_id, name)
      );

      -- 审批请求表
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        requester_did TEXT NOT NULL,
        requester_name TEXT,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        action TEXT NOT NULL,
        request_data TEXT, -- JSON: 请求详情
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
        current_step INTEGER DEFAULT 0,
        total_steps INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (workflow_id) REFERENCES approval_workflows(id) ON DELETE CASCADE
      );

      -- 审批响应表
      CREATE TABLE IF NOT EXISTS approval_responses (
        id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL,
        approver_did TEXT NOT NULL,
        approver_name TEXT,
        step INTEGER NOT NULL,
        decision TEXT NOT NULL CHECK(decision IN ('approve', 'reject', 'delegate')),
        delegated_to TEXT,
        comment TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE
      );

      -- 权限委托表
      CREATE TABLE IF NOT EXISTS permission_delegations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        delegator_did TEXT NOT NULL,
        delegate_did TEXT NOT NULL,
        delegate_name TEXT,
        permissions TEXT NOT NULL, -- JSON array
        resource_scope TEXT, -- JSON: 资源范围限制
        reason TEXT,
        start_date INTEGER NOT NULL,
        end_date INTEGER NOT NULL,
        status TEXT DEFAULT 'active' CHECK(status IN ('pending', 'active', 'revoked', 'expired')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 组织团队表（子团队）
      CREATE TABLE IF NOT EXISTS org_teams (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        parent_team_id TEXT,
        lead_did TEXT,
        lead_name TEXT,
        avatar TEXT,
        settings TEXT, -- JSON
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (parent_team_id) REFERENCES org_teams(id) ON DELETE CASCADE,
        UNIQUE(org_id, name)
      );

      -- 团队成员表
      CREATE TABLE IF NOT EXISTS org_team_members (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        member_did TEXT NOT NULL,
        member_name TEXT,
        team_role TEXT DEFAULT 'member' CHECK(team_role IN ('lead', 'member', 'guest')),
        joined_at INTEGER NOT NULL,
        invited_by TEXT,
        FOREIGN KEY (team_id) REFERENCES org_teams(id) ON DELETE CASCADE,
        UNIQUE(team_id, member_did)
      );

      -- 权限模块索引
      CREATE INDEX IF NOT EXISTS idx_perm_resource_types_name ON permission_resource_types(name);
      CREATE INDEX IF NOT EXISTS idx_perm_grants_org ON permission_grants(org_id);
      CREATE INDEX IF NOT EXISTS idx_perm_grants_grantee ON permission_grants(grantee_type, grantee_id);
      CREATE INDEX IF NOT EXISTS idx_perm_grants_resource ON permission_grants(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_perm_grants_expires ON permission_grants(expires_at);
      CREATE INDEX IF NOT EXISTS idx_perm_inheritance_org ON permission_inheritance(org_id);
      CREATE INDEX IF NOT EXISTS idx_perm_inheritance_parent ON permission_inheritance(parent_resource_type, parent_resource_id);
      CREATE INDEX IF NOT EXISTS idx_perm_inheritance_child ON permission_inheritance(child_resource_type, child_resource_id);
      CREATE INDEX IF NOT EXISTS idx_approval_workflows_org ON approval_workflows(org_id);
      CREATE INDEX IF NOT EXISTS idx_approval_workflows_trigger ON approval_workflows(trigger_resource_type, trigger_action);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_workflow ON approval_requests(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_org ON approval_requests(org_id);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_requester ON approval_requests(requester_did);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_resource ON approval_requests(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_approval_responses_request ON approval_responses(request_id);
      CREATE INDEX IF NOT EXISTS idx_approval_responses_approver ON approval_responses(approver_did);
      CREATE INDEX IF NOT EXISTS idx_perm_delegations_org ON permission_delegations(org_id);
      CREATE INDEX IF NOT EXISTS idx_perm_delegations_delegator ON permission_delegations(delegator_did);
      CREATE INDEX IF NOT EXISTS idx_perm_delegations_delegate ON permission_delegations(delegate_did);
      CREATE INDEX IF NOT EXISTS idx_perm_delegations_status ON permission_delegations(status);
      CREATE INDEX IF NOT EXISTS idx_perm_delegations_dates ON permission_delegations(start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_org_teams_org ON org_teams(org_id);
      CREATE INDEX IF NOT EXISTS idx_org_teams_parent ON org_teams(parent_team_id);
      CREATE INDEX IF NOT EXISTS idx_org_teams_lead ON org_teams(lead_did);
      CREATE INDEX IF NOT EXISTS idx_org_team_members_team ON org_team_members(team_id);
      CREATE INDEX IF NOT EXISTS idx_org_team_members_member ON org_team_members(member_did);

      -- ============================
      -- 模块4: 跨组织协作 (Cross-Organization Collaboration)
      -- ============================

      -- 组织合作关系表
      CREATE TABLE IF NOT EXISTS org_partnerships (
        id TEXT PRIMARY KEY,
        initiator_org_id TEXT NOT NULL,
        initiator_org_name TEXT,
        partner_org_id TEXT NOT NULL,
        partner_org_name TEXT,
        partnership_type TEXT DEFAULT 'standard' CHECK(partnership_type IN ('standard', 'strategic', 'trusted', 'limited')),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'suspended', 'terminated')),
        trust_level INTEGER DEFAULT 1 CHECK(trust_level >= 1 AND trust_level <= 5),
        agreement_hash TEXT, -- 合作协议哈希
        agreement_content TEXT,
        initiated_by TEXT NOT NULL,
        approved_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER,
        UNIQUE(initiator_org_id, partner_org_id)
      );

      -- 共享工作空间表
      CREATE TABLE IF NOT EXISTS shared_workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        workspace_type TEXT DEFAULT 'project' CHECK(workspace_type IN ('project', 'research', 'event', 'custom')),
        created_by_org_id TEXT NOT NULL,
        created_by_did TEXT NOT NULL,
        visibility TEXT DEFAULT 'private' CHECK(visibility IN ('private', 'members', 'public')),
        settings TEXT, -- JSON
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'archived', 'deleted')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 工作空间成员组织表
      CREATE TABLE IF NOT EXISTS shared_workspace_orgs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        org_name TEXT,
        role TEXT DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member', 'viewer')),
        joined_at INTEGER NOT NULL,
        invited_by TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('pending', 'active', 'suspended', 'left')),
        FOREIGN KEY (workspace_id) REFERENCES shared_workspaces(id) ON DELETE CASCADE,
        UNIQUE(workspace_id, org_id)
      );

      -- 工作空间成员（个人）表
      CREATE TABLE IF NOT EXISTS shared_workspace_members (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        member_did TEXT NOT NULL,
        member_name TEXT,
        member_org_id TEXT NOT NULL,
        role TEXT DEFAULT 'member' CHECK(role IN ('admin', 'contributor', 'viewer')),
        permissions TEXT, -- JSON: 自定义权限
        joined_at INTEGER NOT NULL,
        invited_by TEXT,
        FOREIGN KEY (workspace_id) REFERENCES shared_workspaces(id) ON DELETE CASCADE,
        UNIQUE(workspace_id, member_did)
      );

      -- 跨组织资源共享表
      CREATE TABLE IF NOT EXISTS cross_org_shares (
        id TEXT PRIMARY KEY,
        source_org_id TEXT NOT NULL,
        target_org_id TEXT,
        target_workspace_id TEXT,
        resource_type TEXT NOT NULL CHECK(resource_type IN ('knowledge', 'project', 'task_board', 'file', 'template')),
        resource_id TEXT NOT NULL,
        resource_name TEXT,
        share_type TEXT DEFAULT 'link' CHECK(share_type IN ('link', 'copy', 'sync')),
        permissions TEXT NOT NULL, -- JSON: ['read', 'comment', 'edit']
        encryption_key_id TEXT,
        shared_by TEXT NOT NULL,
        access_count INTEGER DEFAULT 0,
        last_accessed_at INTEGER,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (target_workspace_id) REFERENCES shared_workspaces(id) ON DELETE CASCADE
      );

      -- B2B 数据交换表
      CREATE TABLE IF NOT EXISTS b2b_data_transactions (
        id TEXT PRIMARY KEY,
        sender_org_id TEXT NOT NULL,
        sender_org_name TEXT,
        receiver_org_id TEXT NOT NULL,
        receiver_org_name TEXT,
        transaction_type TEXT NOT NULL CHECK(transaction_type IN ('data_share', 'data_request', 'data_sync', 'data_export')),
        data_type TEXT NOT NULL,
        data_hash TEXT,
        data_size INTEGER,
        encryption_method TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled', 'rejected')),
        error_message TEXT,
        initiated_by TEXT NOT NULL,
        approved_by TEXT,
        metadata TEXT, -- JSON
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      -- 跨组织审计日志表
      CREATE TABLE IF NOT EXISTS cross_org_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_org_id TEXT NOT NULL,
        target_org_id TEXT,
        workspace_id TEXT,
        actor_did TEXT NOT NULL,
        actor_name TEXT,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT, -- JSON
        ip_address TEXT,
        created_at INTEGER NOT NULL
      );

      -- 跨组织发现配置表
      CREATE TABLE IF NOT EXISTS cross_org_discovery (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL UNIQUE,
        org_name TEXT NOT NULL,
        org_description TEXT,
        org_avatar TEXT,
        is_discoverable INTEGER DEFAULT 0,
        discovery_tags TEXT, -- JSON array
        contact_did TEXT,
        contact_email TEXT,
        verified INTEGER DEFAULT 0,
        reputation_score REAL DEFAULT 0,
        partnership_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- 跨组织模块索引
      CREATE INDEX IF NOT EXISTS idx_partnerships_initiator ON org_partnerships(initiator_org_id);
      CREATE INDEX IF NOT EXISTS idx_partnerships_partner ON org_partnerships(partner_org_id);
      CREATE INDEX IF NOT EXISTS idx_partnerships_status ON org_partnerships(status);
      CREATE INDEX IF NOT EXISTS idx_partnerships_type ON org_partnerships(partnership_type);
      CREATE INDEX IF NOT EXISTS idx_shared_workspaces_created_by ON shared_workspaces(created_by_org_id);
      CREATE INDEX IF NOT EXISTS idx_shared_workspaces_status ON shared_workspaces(status);
      CREATE INDEX IF NOT EXISTS idx_shared_workspace_orgs_workspace ON shared_workspace_orgs(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_shared_workspace_orgs_org ON shared_workspace_orgs(org_id);
      CREATE INDEX IF NOT EXISTS idx_shared_workspace_members_workspace ON shared_workspace_members(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_shared_workspace_members_member ON shared_workspace_members(member_did);
      CREATE INDEX IF NOT EXISTS idx_shared_workspace_members_org ON shared_workspace_members(member_org_id);
      CREATE INDEX IF NOT EXISTS idx_cross_org_shares_source ON cross_org_shares(source_org_id);
      CREATE INDEX IF NOT EXISTS idx_cross_org_shares_target ON cross_org_shares(target_org_id);
      CREATE INDEX IF NOT EXISTS idx_cross_org_shares_workspace ON cross_org_shares(target_workspace_id);
      CREATE INDEX IF NOT EXISTS idx_cross_org_shares_resource ON cross_org_shares(resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_b2b_transactions_sender ON b2b_data_transactions(sender_org_id);
      CREATE INDEX IF NOT EXISTS idx_b2b_transactions_receiver ON b2b_data_transactions(receiver_org_id);
      CREATE INDEX IF NOT EXISTS idx_b2b_transactions_status ON b2b_data_transactions(status);
      CREATE INDEX IF NOT EXISTS idx_b2b_transactions_type ON b2b_data_transactions(transaction_type);
      CREATE INDEX IF NOT EXISTS idx_cross_org_audit_source ON cross_org_audit_log(source_org_id);
      CREATE INDEX IF NOT EXISTS idx_cross_org_audit_target ON cross_org_audit_log(target_org_id);
      CREATE INDEX IF NOT EXISTS idx_cross_org_audit_actor ON cross_org_audit_log(actor_did);
      CREATE INDEX IF NOT EXISTS idx_cross_org_audit_created ON cross_org_audit_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cross_org_discovery_discoverable ON cross_org_discovery(is_discoverable);
      CREATE INDEX IF NOT EXISTS idx_cross_org_discovery_verified ON cross_org_discovery(verified);
      CREATE INDEX IF NOT EXISTS idx_cross_org_discovery_reputation ON cross_org_discovery(reputation_score DESC);

      -- ============================================================
      -- 企业审计与合规模块 (v0.34.0)
      -- ============================================================

      -- 统一企业审计日志
      CREATE TABLE IF NOT EXISTS enterprise_audit_log (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        actor_did TEXT NOT NULL,
        operation TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT,
        risk_level TEXT CHECK(risk_level IN ('low','medium','high','critical')),
        compliance_tags TEXT,
        outcome TEXT CHECK(outcome IN ('success','failure','blocked')),
        retention_until INTEGER,
        session_id TEXT
      );

      -- 合规策略
      CREATE TABLE IF NOT EXISTS compliance_policies (
        id TEXT PRIMARY KEY,
        policy_type TEXT NOT NULL,
        framework TEXT NOT NULL,
        rules TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at INTEGER,
        updated_at INTEGER
      );

      -- 数据主体请求 (GDPR)
      CREATE TABLE IF NOT EXISTS data_subject_requests (
        id TEXT PRIMARY KEY,
        request_type TEXT NOT NULL,
        subject_did TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        request_data TEXT,
        response_data TEXT,
        created_at INTEGER,
        completed_at INTEGER,
        deadline INTEGER
      );

      -- 企业审计索引
      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON enterprise_audit_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON enterprise_audit_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON enterprise_audit_log(actor_did);
      CREATE INDEX IF NOT EXISTS idx_audit_log_risk ON enterprise_audit_log(risk_level);
      CREATE INDEX IF NOT EXISTS idx_audit_log_outcome ON enterprise_audit_log(outcome);
      CREATE INDEX IF NOT EXISTS idx_compliance_framework ON compliance_policies(framework);
      CREATE INDEX IF NOT EXISTS idx_compliance_enabled ON compliance_policies(enabled);
      CREATE INDEX IF NOT EXISTS idx_dsr_status ON data_subject_requests(status);
      CREATE INDEX IF NOT EXISTS idx_dsr_subject ON data_subject_requests(subject_did);
      CREATE INDEX IF NOT EXISTS idx_dsr_deadline ON data_subject_requests(deadline);

      -- ============================================================
      -- 插件市场模块 (v0.34.0)
      -- ============================================================

      -- 已安装插件追踪
      CREATE TABLE IF NOT EXISTS installed_plugins (
        id TEXT PRIMARY KEY,
        plugin_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        author TEXT,
        install_path TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        enabled INTEGER DEFAULT 1,
        auto_update INTEGER DEFAULT 1,
        source TEXT DEFAULT 'marketplace',
        metadata TEXT
      );

      -- 插件更新历史
      CREATE TABLE IF NOT EXISTS plugin_update_history (
        id TEXT PRIMARY KEY,
        plugin_id TEXT NOT NULL,
        from_version TEXT,
        to_version TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        success INTEGER,
        error_message TEXT
      );

      -- 插件市场索引
      CREATE INDEX IF NOT EXISTS idx_installed_plugins_plugin_id ON installed_plugins(plugin_id);
      CREATE INDEX IF NOT EXISTS idx_installed_plugins_enabled ON installed_plugins(enabled);
      CREATE INDEX IF NOT EXISTS idx_plugin_update_history_plugin ON plugin_update_history(plugin_id);

      -- ============================================================
      -- 专业化代理模块 (v0.34.0)
      -- ============================================================

      -- 代理模板
      CREATE TABLE IF NOT EXISTS agent_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT,
        capabilities TEXT NOT NULL,
        tools TEXT NOT NULL,
        system_prompt TEXT,
        config TEXT,
        version TEXT DEFAULT '1.0.0',
        enabled INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      -- 代理任务历史
      CREATE TABLE IF NOT EXISTS agent_task_history (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        template_type TEXT NOT NULL,
        task_description TEXT,
        started_at INTEGER,
        completed_at INTEGER,
        success INTEGER,
        result TEXT,
        tokens_used INTEGER
      );

      -- 代理模块索引
      CREATE INDEX IF NOT EXISTS idx_agent_templates_type ON agent_templates(type);
      CREATE INDEX IF NOT EXISTS idx_agent_templates_enabled ON agent_templates(enabled);
      CREATE INDEX IF NOT EXISTS idx_agent_task_history_agent ON agent_task_history(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_task_history_type ON agent_task_history(template_type);

      -- ============================================================
      -- SSO 企业认证模块 (v0.34.0)
      -- ============================================================

      -- SSO 配置
      CREATE TABLE IF NOT EXISTS sso_configurations (
        id TEXT PRIMARY KEY,
        provider_type TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        config TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );

      -- SSO 会话
      CREATE TABLE IF NOT EXISTS sso_sessions (
        id TEXT PRIMARY KEY,
        user_did TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        access_token TEXT,
        refresh_token TEXT,
        expires_at INTEGER,
        created_at INTEGER
      );

      -- 身份映射
      CREATE TABLE IF NOT EXISTS identity_mappings (
        id TEXT PRIMARY KEY,
        did TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        sso_subject TEXT NOT NULL,
        sso_attributes TEXT,
        verified INTEGER DEFAULT 0,
        created_at INTEGER
      );

      -- SSO 索引
      CREATE INDEX IF NOT EXISTS idx_sso_config_type ON sso_configurations(provider_type);
      CREATE INDEX IF NOT EXISTS idx_sso_sessions_did ON sso_sessions(user_did);
      CREATE INDEX IF NOT EXISTS idx_sso_sessions_provider ON sso_sessions(provider_id);
      CREATE INDEX IF NOT EXISTS idx_identity_mappings_did ON identity_mappings(did);
      CREATE INDEX IF NOT EXISTS idx_identity_mappings_provider ON identity_mappings(provider_id);
    `);

    // ============================================================
    // v1.1.0: Skill Pipeline & Metrics tables
    // ============================================================
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS skill_execution_metrics (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        pipeline_id TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        duration_ms INTEGER,
        success INTEGER DEFAULT 0,
        tokens_input INTEGER DEFAULT 0,
        tokens_output INTEGER DEFAULT 0,
        cost_usd REAL DEFAULT 0,
        error_message TEXT,
        context_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_skill_metrics_skill ON skill_execution_metrics(skill_id);
      CREATE INDEX IF NOT EXISTS idx_skill_metrics_time ON skill_execution_metrics(started_at);

      CREATE TABLE IF NOT EXISTS skill_pipeline_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        definition_json TEXT NOT NULL,
        is_template INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        execution_count INTEGER DEFAULT 0,
        last_executed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_defs_category ON skill_pipeline_definitions(category);
      `);

    // ============================================================
    // v0.39.0: Instinct Learning System tables
    // ============================================================
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS instincts (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        category TEXT DEFAULT 'general',
        examples TEXT DEFAULT '[]',
        source TEXT DEFAULT 'auto',
        use_count INTEGER DEFAULT 0,
        last_used TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_instincts_category ON instincts(category);
      CREATE INDEX IF NOT EXISTS idx_instincts_confidence ON instincts(confidence);

      CREATE TABLE IF NOT EXISTS instinct_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        event_data TEXT DEFAULT '{}',
        processed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_observations_processed ON instinct_observations(processed);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON instinct_observations(event_type);
      `);

    // ============================================================
    // v0.39.0: Cowork v2.0.0 — Cross-device Collaboration tables
    // ============================================================
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS p2p_remote_agents (
        peer_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        platform TEXT,
        skills TEXT DEFAULT '[]',
        resources TEXT DEFAULT '{}',
        state TEXT DEFAULT 'offline',
        last_heartbeat TEXT,
        registered_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_remote_agents_state ON p2p_remote_agents(state);

      CREATE TABLE IF NOT EXISTS p2p_remote_tasks (
        task_id TEXT PRIMARY KEY,
        peer_id TEXT NOT NULL,
        skill_id TEXT,
        description TEXT,
        input TEXT DEFAULT '{}',
        status TEXT DEFAULT 'pending',
        result TEXT,
        delegated_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_remote_tasks_status ON p2p_remote_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_remote_tasks_peer ON p2p_remote_tasks(peer_id);

      CREATE TABLE IF NOT EXISTS cowork_webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        events TEXT DEFAULT '[]',
        secret TEXT,
        metadata TEXT DEFAULT '{}',
        active INTEGER DEFAULT 1,
        delivery_count INTEGER DEFAULT 0,
        last_delivery TEXT,
        fail_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS cowork_webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        http_status INTEGER,
        attempt INTEGER DEFAULT 0,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON cowork_webhook_deliveries(webhook_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON cowork_webhook_deliveries(status);
      `);

    // ============================================================
    // v1.3.0: ML Scheduler, Load Balancer, CI/CD Optimizer tables
    // ============================================================
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS ml_task_features (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        features TEXT,
        predicted_complexity REAL,
        predicted_duration INTEGER,
        actual_duration INTEGER,
        actual_complexity REAL,
        model_version INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ml_task_features_task ON ml_task_features(task_id);

      CREATE TABLE IF NOT EXISTS agent_load_metrics (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        active_tasks INTEGER DEFAULT 0,
        queue_depth INTEGER DEFAULT 0,
        avg_response_ms REAL DEFAULT 0,
        error_rate REAL DEFAULT 0,
        load_score REAL DEFAULT 0,
        tokens_processed INTEGER DEFAULT 0,
        last_heartbeat TEXT,
        recorded_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_load_agent ON agent_load_metrics(agent_id);
      CREATE INDEX IF NOT EXISTS idx_agent_load_time ON agent_load_metrics(recorded_at);

      CREATE TABLE IF NOT EXISTS cicd_test_cache (
        id TEXT PRIMARY KEY,
        file_hash TEXT NOT NULL,
        selected_tests TEXT,
        execution_time_ms INTEGER,
        pass_count INTEGER,
        fail_count INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        last_hit_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cicd_cache_hash ON cicd_test_cache(file_hash);

      CREATE TABLE IF NOT EXISTS cicd_test_history (
        id TEXT PRIMARY KEY,
        test_path TEXT NOT NULL,
        passed INTEGER DEFAULT 1,
        duration_ms INTEGER,
        flakiness_score REAL DEFAULT 0,
        run_count INTEGER DEFAULT 0,
        fail_count INTEGER DEFAULT 0,
        last_run_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cicd_history_path ON cicd_test_history(test_path);

      CREATE TABLE IF NOT EXISTS cicd_build_cache (
        id TEXT PRIMARY KEY,
        step_name TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        output_path TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_cicd_build_hash ON cicd_build_cache(input_hash);
      `);

    // ============================================================
    // v0.39.0: Self-Evolution & Knowledge Graph tables (v2.1.0)
    // ============================================================
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS code_kg_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        file_path TEXT,
        line_start INTEGER,
        line_end INTEGER,
        language TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON code_kg_entities(type);
      CREATE INDEX IF NOT EXISTS idx_kg_entities_file ON code_kg_entities(file_path);
      CREATE INDEX IF NOT EXISTS idx_kg_entities_name ON code_kg_entities(name);

      CREATE TABLE IF NOT EXISTS code_kg_relationships (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (source_id) REFERENCES code_kg_entities(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES code_kg_entities(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_kg_rels_source ON code_kg_relationships(source_id);
      CREATE INDEX IF NOT EXISTS idx_kg_rels_target ON code_kg_relationships(target_id);
      CREATE INDEX IF NOT EXISTS idx_kg_rels_type ON code_kg_relationships(type);

      CREATE TABLE IF NOT EXISTS decision_records (
        id TEXT PRIMARY KEY,
        problem TEXT NOT NULL,
        problem_category TEXT,
        solutions TEXT DEFAULT '[]',
        chosen_solution TEXT,
        outcome TEXT,
        context TEXT DEFAULT '{}',
        agents TEXT DEFAULT '[]',
        source TEXT DEFAULT 'manual',
        success_rate REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_category ON decision_records(problem_category);
      CREATE INDEX IF NOT EXISTS idx_decisions_source ON decision_records(source);

      CREATE TABLE IF NOT EXISTS prompt_executions (
        id TEXT PRIMARY KEY,
        skill_name TEXT NOT NULL,
        prompt_hash TEXT,
        prompt_text TEXT,
        result_success INTEGER DEFAULT 0,
        execution_time_ms INTEGER DEFAULT 0,
        feedback TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_exec_skill ON prompt_executions(skill_name);
      CREATE INDEX IF NOT EXISTS idx_prompt_exec_hash ON prompt_executions(prompt_hash);

      CREATE TABLE IF NOT EXISTS prompt_variants (
        id TEXT PRIMARY KEY,
        skill_name TEXT NOT NULL,
        variant_name TEXT,
        prompt_text TEXT NOT NULL,
        success_rate REAL DEFAULT 0,
        use_count INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_variants_skill ON prompt_variants(skill_name);
      CREATE INDEX IF NOT EXISTS idx_prompt_variants_active ON prompt_variants(is_active);

      CREATE TABLE IF NOT EXISTS skill_discovery_log (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        failure_reason TEXT,
        searched_keywords TEXT,
        suggested_skills TEXT DEFAULT '[]',
        installed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_discovery_task ON skill_discovery_log(task_id);

      CREATE TABLE IF NOT EXISTS debate_reviews (
        id TEXT PRIMARY KEY,
        target TEXT NOT NULL,
        reviews TEXT DEFAULT '[]',
        votes TEXT DEFAULT '[]',
        verdict TEXT,
        consensus_score REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_debate_target ON debate_reviews(target);

      CREATE TABLE IF NOT EXISTS ab_comparisons (
        id TEXT PRIMARY KEY,
        task_description TEXT NOT NULL,
        variants TEXT DEFAULT '[]',
        winner TEXT,
        scores TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ab_task ON ab_comparisons(task_description);

      -- ============================================================
      -- Phase 6: Enterprise Edition (v1.0) Tables
      -- ============================================================

      -- Yjs CRDT collaborative editing updates (Feature 2)
      CREATE TABLE IF NOT EXISTS collab_yjs_updates (
        id TEXT PRIMARY KEY,
        knowledge_id TEXT NOT NULL,
        update_data BLOB NOT NULL,
        origin TEXT DEFAULT 'local',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_yjs_knowledge ON collab_yjs_updates(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_yjs_created ON collab_yjs_updates(created_at);

      -- IPFS decentralized storage content registry (Feature 3)
      CREATE TABLE IF NOT EXISTS ipfs_content (
        id TEXT PRIMARY KEY,
        cid TEXT NOT NULL UNIQUE,
        filename TEXT,
        content_type TEXT,
        size INTEGER DEFAULT 0,
        pinned INTEGER DEFAULT 1,
        encrypted INTEGER DEFAULT 0,
        encryption_key TEXT,
        knowledge_id TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ipfs_cid ON ipfs_content(cid);
      CREATE INDEX IF NOT EXISTS idx_ipfs_knowledge ON ipfs_content(knowledge_id);
      CREATE INDEX IF NOT EXISTS idx_ipfs_pinned ON ipfs_content(pinned);

      -- IPFS storage statistics snapshots (Feature 3)
      CREATE TABLE IF NOT EXISTS ipfs_storage_stats (
        id TEXT PRIMARY KEY,
        total_pinned INTEGER DEFAULT 0,
        total_size INTEGER DEFAULT 0,
        peer_count INTEGER DEFAULT 0,
        quota_bytes INTEGER DEFAULT 1073741824,
        mode TEXT DEFAULT 'embedded',
        snapshot_at TEXT DEFAULT (datetime('now'))
      );

      -- Analytics aggregation buckets (Feature 4)
      CREATE TABLE IF NOT EXISTS analytics_aggregations (
        id TEXT PRIMARY KEY,
        bucket_key TEXT NOT NULL,
        granularity TEXT NOT NULL CHECK(granularity IN ('raw', 'hourly', 'daily', 'weekly', 'monthly')),
        metrics TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_analytics_bucket ON analytics_aggregations(bucket_key);
      CREATE INDEX IF NOT EXISTS idx_analytics_granularity ON analytics_aggregations(granularity);
      CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_aggregations(created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_bucket_gran ON analytics_aggregations(bucket_key, granularity);

      -- Autonomous agent goals (Feature 5)
      CREATE TABLE IF NOT EXISTS autonomous_goals (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        priority INTEGER DEFAULT 5 CHECK(priority BETWEEN 1 AND 10),
        status TEXT DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
        tool_permissions TEXT DEFAULT '[]',
        context TEXT,
        decomposed_steps TEXT DEFAULT '[]',
        result TEXT,
        error_message TEXT,
        step_count INTEGER DEFAULT 0,
        tokens_used INTEGER DEFAULT 0,
        max_steps INTEGER DEFAULT 100,
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_goals_status ON autonomous_goals(status);
      CREATE INDEX IF NOT EXISTS idx_goals_priority ON autonomous_goals(priority);
      CREATE INDEX IF NOT EXISTS idx_goals_created ON autonomous_goals(created_at);

      -- Autonomous agent goal execution steps (Feature 5)
      CREATE TABLE IF NOT EXISTS autonomous_goal_steps (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        step_number INTEGER NOT NULL,
        phase TEXT NOT NULL CHECK(phase IN ('reason', 'act', 'observe')),
        thought TEXT,
        action_type TEXT,
        action_params TEXT DEFAULT '{}',
        result TEXT,
        success INTEGER DEFAULT 1,
        tokens_used INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (goal_id) REFERENCES autonomous_goals(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_steps_goal ON autonomous_goal_steps(goal_id);
      CREATE INDEX IF NOT EXISTS idx_steps_number ON autonomous_goal_steps(goal_id, step_number);

      -- Autonomous agent goal logs (Feature 5)
      CREATE TABLE IF NOT EXISTS autonomous_goal_logs (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        level TEXT DEFAULT 'info' CHECK(level IN ('debug', 'info', 'warn', 'error')),
        message TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (goal_id) REFERENCES autonomous_goals(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_goal_logs_goal ON autonomous_goal_logs(goal_id);
      CREATE INDEX IF NOT EXISTS idx_goal_logs_level ON autonomous_goal_logs(level);

      -- ============================================================
      -- Advanced Cryptography Tables (v0.38.0 - v0.43.0)
      -- ============================================================

      -- Post-Quantum key pairs (v0.38.0)
      CREATE TABLE IF NOT EXISTS pq_key_pairs (
        id TEXT PRIMARY KEY,
        algorithm TEXT NOT NULL,
        security_level TEXT,
        public_key TEXT NOT NULL,
        private_key TEXT,
        key_type TEXT DEFAULT 'pqc' CHECK(key_type IN ('pqc', 'hybrid', 'classical')),
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pq_keys_algo ON pq_key_pairs(algorithm);
      CREATE INDEX IF NOT EXISTS idx_pq_keys_type ON pq_key_pairs(key_type);

      -- Zero-Knowledge proofs (v0.39.0)
      CREATE TABLE IF NOT EXISTS zk_proofs (
        id TEXT PRIMARY KEY,
        proof_type TEXT NOT NULL,
        prover_id TEXT,
        proof_data TEXT NOT NULL,
        public_inputs TEXT DEFAULT '{}',
        verification_key TEXT,
        verified INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_zk_proofs_type ON zk_proofs(proof_type);
      CREATE INDEX IF NOT EXISTS idx_zk_proofs_prover ON zk_proofs(prover_id);
      CREATE INDEX IF NOT EXISTS idx_zk_proofs_verified ON zk_proofs(verified);

      -- Homomorphic encryption computations (v0.40.0)
      CREATE TABLE IF NOT EXISTS he_computations (
        id TEXT PRIMARY KEY,
        scheme TEXT NOT NULL CHECK(scheme IN ('paillier', 'bfv', 'ckks', 'tfhe')),
        operation TEXT NOT NULL,
        input_count INTEGER DEFAULT 0,
        result_encrypted TEXT,
        metadata TEXT DEFAULT '{}',
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_he_comp_scheme ON he_computations(scheme);
      CREATE INDEX IF NOT EXISTS idx_he_comp_operation ON he_computations(operation);

      -- MPC sessions (v0.41.0)
      CREATE TABLE IF NOT EXISTS mpc_sessions (
        id TEXT PRIMARY KEY,
        session_type TEXT NOT NULL,
        participant_count INTEGER DEFAULT 0,
        threshold INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed', 'expired')),
        result_hash TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_mpc_sessions_type ON mpc_sessions(session_type);
      CREATE INDEX IF NOT EXISTS idx_mpc_sessions_status ON mpc_sessions(status);

      -- HSM key lifecycle (v0.42.0)
      CREATE TABLE IF NOT EXISTS hsm_key_lifecycle (
        id TEXT PRIMARY KEY,
        key_alias TEXT NOT NULL,
        backend TEXT NOT NULL,
        algorithm TEXT NOT NULL,
        key_type TEXT DEFAULT 'symmetric' CHECK(key_type IN ('symmetric', 'asymmetric', 'hmac')),
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'rotated', 'destroyed', 'backed_up', 'restored')),
        version INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        rotated_at TEXT,
        destroyed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_hsm_keys_alias ON hsm_key_lifecycle(key_alias);
      CREATE INDEX IF NOT EXISTS idx_hsm_keys_backend ON hsm_key_lifecycle(backend);
      CREATE INDEX IF NOT EXISTS idx_hsm_keys_status ON hsm_key_lifecycle(status);

      -- Crypto audit trail (v0.43.0)
      CREATE TABLE IF NOT EXISTS crypto_audit_trail (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('sse', 'proxy-re', 'verifiable', 'agility', 'escrow')),
        actor_id TEXT,
        input_hash TEXT,
        output_hash TEXT,
        success INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_crypto_audit_operation ON crypto_audit_trail(operation);
      CREATE INDEX IF NOT EXISTS idx_crypto_audit_category ON crypto_audit_trail(category);
      CREATE INDEX IF NOT EXISTS idx_crypto_audit_actor ON crypto_audit_trail(actor_id);
      `);

    // ============================================================
    // Git P2P Sync tables (v1.0.0)
    // ============================================================
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS git_p2p_sync_history (
        id TEXT PRIMARY KEY,
        peer_did TEXT NOT NULL,
        peer_device_name TEXT,
        direction TEXT NOT NULL CHECK(direction IN ('push', 'pull', 'bidirectional')),
        refs_synced TEXT DEFAULT '[]',
        objects_transferred INTEGER DEFAULT 0,
        bytes_transferred INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('success', 'partial', 'failed')),
        error_message TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_git_p2p_sync_peer ON git_p2p_sync_history(peer_did);
      CREATE INDEX IF NOT EXISTS idx_git_p2p_sync_status ON git_p2p_sync_history(status);
      CREATE INDEX IF NOT EXISTS idx_git_p2p_sync_created ON git_p2p_sync_history(created_at);

      CREATE TABLE IF NOT EXISTS git_p2p_authorized_devices (
        id TEXT PRIMARY KEY,
        device_did TEXT NOT NULL UNIQUE,
        device_name TEXT,
        device_type TEXT DEFAULT 'unknown',
        public_key TEXT,
        authorized_at TEXT DEFAULT (datetime('now')),
        authorized_by TEXT DEFAULT 'ukey',
        last_seen TEXT,
        is_active INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_git_p2p_auth_did ON git_p2p_authorized_devices(device_did);
      CREATE INDEX IF NOT EXISTS idx_git_p2p_auth_active ON git_p2p_authorized_devices(is_active);
      `);

    // ============================================================
    // Differential Sync tables (v1.1.0)
    // ============================================================
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS db_change_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT NOT NULL,
        row_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('INSERT', 'UPDATE', 'DELETE')),
        changed_columns TEXT DEFAULT '[]',
        old_values TEXT DEFAULT '{}',
        new_values TEXT DEFAULT '{}',
        version INTEGER DEFAULT 1,
        compacted INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_db_change_table ON db_change_log(table_name);
      CREATE INDEX IF NOT EXISTS idx_db_change_row ON db_change_log(row_id);
      CREATE INDEX IF NOT EXISTS idx_db_change_version ON db_change_log(version);
      CREATE INDEX IF NOT EXISTS idx_db_change_compacted ON db_change_log(compacted);

      CREATE TABLE IF NOT EXISTS crdt_counters (
        id TEXT PRIMARY KEY,
        field_name TEXT NOT NULL,
        node_id TEXT NOT NULL,
        value INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(field_name, node_id)
      );
      CREATE INDEX IF NOT EXISTS idx_crdt_counter_field ON crdt_counters(field_name);

      CREATE TABLE IF NOT EXISTS crdt_sets (
        id TEXT PRIMARY KEY,
        set_name TEXT NOT NULL,
        element TEXT NOT NULL,
        added_by TEXT,
        removed INTEGER DEFAULT 0,
        add_clock TEXT DEFAULT '{}',
        remove_clock TEXT DEFAULT '{}',
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_crdt_set_name ON crdt_sets(set_name);
      CREATE INDEX IF NOT EXISTS idx_crdt_set_removed ON crdt_sets(removed);
      `);

    // ============================================================
    // AI Conflict Resolution tables (v1.2.0)
    // ============================================================
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS conflict_patterns (
        id TEXT PRIMARY KEY,
        pattern_type TEXT NOT NULL,
        file_pattern TEXT,
        conflict_signature TEXT,
        resolution_strategy TEXT NOT NULL,
        success_count INTEGER DEFAULT 0,
        total_count INTEGER DEFAULT 0,
        confidence REAL DEFAULT 0.5,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_conflict_pattern_type ON conflict_patterns(pattern_type);
      CREATE INDEX IF NOT EXISTS idx_conflict_pattern_confidence ON conflict_patterns(confidence);

      CREATE TABLE IF NOT EXISTS conflict_resolution_history (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        conflict_type TEXT NOT NULL,
        resolution_level INTEGER NOT NULL CHECK(resolution_level IN (1, 2, 3)),
        resolution_strategy TEXT NOT NULL,
        auto_resolved INTEGER DEFAULT 0,
        user_accepted INTEGER DEFAULT 0,
        ai_confidence REAL,
        base_content TEXT,
        local_content TEXT,
        remote_content TEXT,
        merged_content TEXT,
        pattern_id TEXT,
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_conflict_history_file ON conflict_resolution_history(file_path);
      CREATE INDEX IF NOT EXISTS idx_conflict_history_type ON conflict_resolution_history(conflict_type);
      CREATE INDEX IF NOT EXISTS idx_conflict_history_level ON conflict_resolution_history(resolution_level);
      `);

    // ============================================================
    // Real-time Collaboration tables (v2.0.0)
    // ============================================================
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS collab_rooms (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        topic TEXT NOT NULL UNIQUE,
        owner_did TEXT NOT NULL,
        max_participants INTEGER DEFAULT 10,
        permissions TEXT DEFAULT '{}',
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed', 'archived')),
        created_at TEXT DEFAULT (datetime('now')),
        closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_collab_room_doc ON collab_rooms(document_id);
      CREATE INDEX IF NOT EXISTS idx_collab_room_owner ON collab_rooms(owner_did);
      CREATE INDEX IF NOT EXISTS idx_collab_room_status ON collab_rooms(status);

      CREATE TABLE IF NOT EXISTS collab_participants (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        user_did TEXT NOT NULL,
        user_name TEXT,
        role TEXT DEFAULT 'editor' CHECK(role IN ('viewer', 'editor', 'admin')),
        status TEXT DEFAULT 'online' CHECK(status IN ('online', 'offline', 'editing')),
        joined_at TEXT DEFAULT (datetime('now')),
        last_active TEXT DEFAULT (datetime('now')),
        UNIQUE(room_id, user_did)
      );
      CREATE INDEX IF NOT EXISTS idx_collab_participant_room ON collab_participants(room_id);
      CREATE INDEX IF NOT EXISTS idx_collab_participant_user ON collab_participants(user_did);

      CREATE TABLE IF NOT EXISTS collab_version_snapshots (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        git_tag TEXT,
        content_hash TEXT,
        author_did TEXT NOT NULL,
        message TEXT,
        yjs_state_vector TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_collab_snapshot_room ON collab_version_snapshots(room_id);
      CREATE INDEX IF NOT EXISTS idx_collab_snapshot_doc ON collab_version_snapshots(document_id);
      CREATE INDEX IF NOT EXISTS idx_collab_snapshot_version ON collab_version_snapshots(version);

      CREATE TABLE IF NOT EXISTS collab_offline_edits (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        user_did TEXT NOT NULL,
        yjs_update BLOB,
        edit_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        applied_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_collab_offline_room ON collab_offline_edits(room_id);
      CREATE INDEX IF NOT EXISTS idx_collab_offline_applied ON collab_offline_edits(applied_at);
      `);

    // ============================================================
    // v3.0.0: Dev Pipeline Orchestration tables
    // ============================================================
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS dev_pipelines (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template TEXT,
        requirement TEXT,
        spec_json TEXT DEFAULT '{}',
        status TEXT DEFAULT 'created',
        current_stage TEXT,
        config TEXT DEFAULT '{}',
        metrics TEXT DEFAULT '{}',
        created_by TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dev_pipelines_status ON dev_pipelines(status);
      CREATE INDEX IF NOT EXISTS idx_dev_pipelines_template ON dev_pipelines(template);
      CREATE INDEX IF NOT EXISTS idx_dev_pipelines_created ON dev_pipelines(created_at);

      CREATE TABLE IF NOT EXISTS dev_pipeline_stages (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        stage_name TEXT NOT NULL,
        stage_order INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        input TEXT DEFAULT '{}',
        output TEXT DEFAULT '{}',
        agent_id TEXT,
        gate_approver TEXT,
        gate_comment TEXT,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (pipeline_id) REFERENCES dev_pipelines(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_dev_stages_pipeline ON dev_pipeline_stages(pipeline_id);
      CREATE INDEX IF NOT EXISTS idx_dev_stages_status ON dev_pipeline_stages(status);

      CREATE TABLE IF NOT EXISTS dev_pipeline_artifacts (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        stage_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        content TEXT,
        file_path TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (pipeline_id) REFERENCES dev_pipelines(id) ON DELETE CASCADE,
        FOREIGN KEY (stage_id) REFERENCES dev_pipeline_stages(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_dev_artifacts_pipeline ON dev_pipeline_artifacts(pipeline_id);
      CREATE INDEX IF NOT EXISTS idx_dev_artifacts_stage ON dev_pipeline_artifacts(stage_id);
      CREATE INDEX IF NOT EXISTS idx_dev_artifacts_type ON dev_pipeline_artifacts(artifact_type);
      `);

    // ============================================================
    // v3.3.0: Autonomous Ops tables
    // ============================================================
    dbManager.db.exec(`
      CREATE TABLE IF NOT EXISTS ops_incidents (
        id TEXT PRIMARY KEY,
        severity TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        anomaly_metric TEXT,
        anomaly_value REAL,
        anomaly_method TEXT,
        baseline_value REAL,
        playbook_id TEXT,
        remediation_result TEXT,
        rollback_executed INTEGER DEFAULT 0,
        alert_channels TEXT DEFAULT '[]',
        postmortem TEXT,
        timeline TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        acknowledged_at TEXT,
        resolved_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ops_incidents_severity ON ops_incidents(severity);
      CREATE INDEX IF NOT EXISTS idx_ops_incidents_status ON ops_incidents(status);
      CREATE INDEX IF NOT EXISTS idx_ops_incidents_created ON ops_incidents(created_at);

      CREATE TABLE IF NOT EXISTS ops_remediation_playbooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        trigger_config TEXT DEFAULT '{}',
        steps TEXT DEFAULT '[]',
        rollback_on_failure INTEGER DEFAULT 1,
        notify_channels TEXT DEFAULT '[]',
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        avg_duration_ms INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ops_playbooks_name ON ops_remediation_playbooks(name);
      CREATE INDEX IF NOT EXISTS idx_ops_playbooks_active ON ops_remediation_playbooks(active);

      CREATE TABLE IF NOT EXISTS ops_metrics_baseline (
        id TEXT PRIMARY KEY,
        metric_name TEXT NOT NULL UNIQUE,
        detection_method TEXT NOT NULL,
        threshold REAL,
        window TEXT DEFAULT '5m',
        params TEXT DEFAULT '{}',
        baseline_values TEXT DEFAULT '[]',
        last_calibrated TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ops_baseline_metric ON ops_metrics_baseline(metric_name);
      `);

    // ============================================================
    // v3.1 — 自然语言编程 (2 表)
    // ============================================================
    dbManager.db.exec(`
      -- 自然语言编程记录
      CREATE TABLE IF NOT EXISTS nl_programs (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        spec_json TEXT DEFAULT '{}',
        conventions TEXT DEFAULT '{}',
        generated_files TEXT DEFAULT '[]',
        status TEXT DEFAULT 'draft',
        verification_result TEXT,
        refine_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_nl_programs_status ON nl_programs(status);

      -- 项目编码约定缓存
      CREATE TABLE IF NOT EXISTS nl_program_conventions (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        naming_conventions TEXT DEFAULT '{}',
        architecture_patterns TEXT DEFAULT '{}',
        testing_patterns TEXT DEFAULT '{}',
        style_rules TEXT DEFAULT '{}',
        source TEXT DEFAULT 'auto',
        confidence REAL DEFAULT 0,
        scanned_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_nl_conventions_path ON nl_program_conventions(project_path);
      `);

    // ============================================================
    // v3.2 — 多模态协作 (2 表)
    // ============================================================
    dbManager.db.exec(`
      -- 多模态会话记录
      CREATE TABLE IF NOT EXISTS multimodal_sessions (
        id TEXT PRIMARY KEY,
        modalities TEXT DEFAULT '[]',
        fused_context TEXT,
        status TEXT DEFAULT 'active',
        input_count INTEGER DEFAULT 0,
        output_format TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_mm_sessions_status ON multimodal_sessions(status);

      -- 多模态制品表
      CREATE TABLE IF NOT EXISTS multimodal_artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        artifact_type TEXT NOT NULL,
        modality TEXT,
        content TEXT,
        file_path TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES multimodal_sessions(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_mm_artifacts_session ON multimodal_artifacts(session_id);
      CREATE INDEX IF NOT EXISTS idx_mm_artifacts_type ON multimodal_artifacts(artifact_type);
      `);

    // ============================================================
    // v4.0 — 去中心化代理网络 (3 表)
    // ============================================================
    dbManager.db.exec(`
      -- Agent DID 身份记录
      CREATE TABLE IF NOT EXISTS agent_dids (
        id TEXT PRIMARY KEY,
        did TEXT NOT NULL UNIQUE,
        display_name TEXT,
        capabilities TEXT DEFAULT '[]',
        public_key TEXT,
        private_key_encrypted TEXT,
        organization TEXT,
        status TEXT DEFAULT 'active',
        credential_ids TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_agent_dids_did ON agent_dids(did);
      CREATE INDEX IF NOT EXISTS idx_agent_dids_org ON agent_dids(organization);
      CREATE INDEX IF NOT EXISTS idx_agent_dids_status ON agent_dids(status);

      -- Agent 信誉评分
      CREATE TABLE IF NOT EXISTS agent_reputation (
        id TEXT PRIMARY KEY,
        agent_did TEXT NOT NULL,
        score REAL DEFAULT 0.5,
        total_tasks INTEGER DEFAULT 0,
        successful_tasks INTEGER DEFAULT 0,
        failed_tasks INTEGER DEFAULT 0,
        average_response_time_ms REAL DEFAULT 0,
        reliability REAL DEFAULT 0.5,
        quality REAL DEFAULT 0.5,
        last_active TEXT,
        history TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (agent_did) REFERENCES agent_dids(did) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_rep_did ON agent_reputation(agent_did);
      CREATE INDEX IF NOT EXISTS idx_agent_rep_score ON agent_reputation(score);

      -- 联邦任务日志
      CREATE TABLE IF NOT EXISTS federated_task_log (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        requester_did TEXT NOT NULL,
        executor_did TEXT,
        task_type TEXT,
        description TEXT,
        status TEXT DEFAULT 'pending',
        input_hash TEXT,
        output_hash TEXT,
        credential_proof TEXT,
        duration_ms INTEGER,
        result TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_fed_task_requester ON federated_task_log(requester_did);
      CREATE INDEX IF NOT EXISTS idx_fed_task_executor ON federated_task_log(executor_did);
      CREATE INDEX IF NOT EXISTS idx_fed_task_status ON federated_task_log(status);

      -- v1.1.0 Phase 42: Social AI
      CREATE TABLE IF NOT EXISTS topic_analyses (
        id TEXT PRIMARY KEY,
        content_id TEXT,
        content_type TEXT DEFAULT 'post',
        topics TEXT DEFAULT '[]',
        sentiment TEXT DEFAULT 'neutral',
        sentiment_score REAL DEFAULT 0.0,
        category TEXT DEFAULT 'general',
        keywords TEXT DEFAULT '[]',
        summary TEXT,
        language TEXT DEFAULT 'en',
        source TEXT DEFAULT 'template',
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_topic_analyses_content ON topic_analyses(content_id);
      CREATE INDEX IF NOT EXISTS idx_topic_analyses_category ON topic_analyses(category);
      CREATE INDEX IF NOT EXISTS idx_topic_analyses_created ON topic_analyses(created_at DESC);

      CREATE TABLE IF NOT EXISTS social_graph_edges (
        id TEXT PRIMARY KEY,
        source_did TEXT NOT NULL,
        target_did TEXT NOT NULL,
        interaction_type TEXT NOT NULL,
        weight REAL DEFAULT 1.0,
        interaction_count INTEGER DEFAULT 1,
        last_interaction_at INTEGER,
        closeness_score REAL DEFAULT 0.0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        UNIQUE(source_did, target_did, interaction_type)
      );
      CREATE INDEX IF NOT EXISTS idx_social_graph_source ON social_graph_edges(source_did);
      CREATE INDEX IF NOT EXISTS idx_social_graph_target ON social_graph_edges(target_did);
      CREATE INDEX IF NOT EXISTS idx_social_graph_closeness ON social_graph_edges(closeness_score DESC);

      -- v1.1.0 Phase 42: ActivityPub
      CREATE TABLE IF NOT EXISTS activitypub_actors (
        id TEXT PRIMARY KEY,
        did TEXT,
        preferred_username TEXT NOT NULL,
        display_name TEXT,
        summary TEXT,
        inbox_url TEXT NOT NULL,
        outbox_url TEXT NOT NULL,
        followers_url TEXT,
        following_url TEXT,
        public_key_pem TEXT,
        private_key_pem TEXT,
        icon_url TEXT,
        domain TEXT NOT NULL,
        is_local INTEGER DEFAULT 0,
        follower_count INTEGER DEFAULT 0,
        following_count INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_ap_actors_did ON activitypub_actors(did);
      CREATE INDEX IF NOT EXISTS idx_ap_actors_username ON activitypub_actors(preferred_username, domain);

      CREATE TABLE IF NOT EXISTS activitypub_activities (
        id TEXT PRIMARY KEY,
        activity_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        object_type TEXT,
        object_id TEXT,
        object_content TEXT,
        target_id TEXT,
        raw_json TEXT,
        is_local INTEGER DEFAULT 0,
        processed INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_ap_activities_actor ON activitypub_activities(actor_id);
      CREATE INDEX IF NOT EXISTS idx_ap_activities_type ON activitypub_activities(activity_type);
      CREATE INDEX IF NOT EXISTS idx_ap_activities_created ON activitypub_activities(created_at DESC);

      -- v1.1.0 Phase 43: Compliance + Data Classification
      CREATE TABLE IF NOT EXISTS soc2_evidence (
        id TEXT PRIMARY KEY,
        criteria TEXT NOT NULL,
        evidence_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        data TEXT DEFAULT '{}',
        status TEXT DEFAULT 'collected',
        collector TEXT DEFAULT 'system',
        period_start INTEGER,
        period_end INTEGER,
        verified_at INTEGER,
        verified_by TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_soc2_evidence_criteria ON soc2_evidence(criteria);
      CREATE INDEX IF NOT EXISTS idx_soc2_evidence_type ON soc2_evidence(evidence_type);
      CREATE INDEX IF NOT EXISTS idx_soc2_evidence_status ON soc2_evidence(status);

      CREATE TABLE IF NOT EXISTS data_classifications (
        id TEXT PRIMARY KEY,
        content_hash TEXT,
        content_preview TEXT,
        category TEXT NOT NULL,
        detections TEXT DEFAULT '[]',
        severity TEXT DEFAULT 'low',
        confidence REAL DEFAULT 0.0,
        source TEXT DEFAULT 'rule',
        context TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_data_class_category ON data_classifications(category);
      CREATE INDEX IF NOT EXISTS idx_data_class_severity ON data_classifications(severity);
      CREATE INDEX IF NOT EXISTS idx_data_class_hash ON data_classifications(content_hash);

      -- v1.1.0 Phase 44: SCIM 2.0
      CREATE TABLE IF NOT EXISTS scim_resources (
        id TEXT PRIMARY KEY,
        resource_type TEXT NOT NULL,
        external_id TEXT,
        display_name TEXT,
        user_name TEXT,
        email TEXT,
        active INTEGER DEFAULT 1,
        attributes TEXT DEFAULT '{}',
        members TEXT DEFAULT '[]',
        source TEXT DEFAULT 'scim',
        provider TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_scim_type ON scim_resources(resource_type);
      CREATE INDEX IF NOT EXISTS idx_scim_username ON scim_resources(user_name);
      CREATE INDEX IF NOT EXISTS idx_scim_external ON scim_resources(external_id);

      CREATE TABLE IF NOT EXISTS scim_sync_log (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        provider TEXT,
        status TEXT DEFAULT 'success',
        details TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );
      CREATE INDEX IF NOT EXISTS idx_scim_sync_provider ON scim_sync_log(provider);
      CREATE INDEX IF NOT EXISTS idx_scim_sync_created ON scim_sync_log(created_at DESC);

      -- v1.1.0 Phase 45: Unified Keys + FIDO2
      CREATE TABLE IF NOT EXISTS unified_keys (
        id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        source TEXT NOT NULL,
        derivation_path TEXT,
        public_key TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        algorithm TEXT DEFAULT 'ed25519',
        device_id TEXT,
        is_primary INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_unified_keys_purpose ON unified_keys(purpose);
      CREATE INDEX IF NOT EXISTS idx_unified_keys_source ON unified_keys(source);
      CREATE INDEX IF NOT EXISTS idx_unified_keys_hash ON unified_keys(key_hash);

      CREATE TABLE IF NOT EXISTS fido2_credentials (
        id TEXT PRIMARY KEY,
        credential_id TEXT NOT NULL UNIQUE,
        rp_id TEXT NOT NULL,
        rp_name TEXT,
        user_id TEXT NOT NULL,
        user_name TEXT,
        user_display_name TEXT,
        public_key TEXT NOT NULL,
        private_key TEXT,
        sign_count INTEGER DEFAULT 0,
        attestation_type TEXT DEFAULT 'self',
        transports TEXT DEFAULT '["internal"]',
        is_discoverable INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        last_used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_fido2_rp ON fido2_credentials(rp_id);
      CREATE INDEX IF NOT EXISTS idx_fido2_user ON fido2_credentials(user_id);
      CREATE INDEX IF NOT EXISTS idx_fido2_cred_id ON fido2_credentials(credential_id);
      `);

    // 重新启用外键约束
    logger.info("[Database] 重新启用外键约束...");
    dbManager.db.run("PRAGMA foreign_keys = ON");

    dbManager.ensureTaskBoardOwnerSchema();

    logger.info("[Database] ✓ 所有表和索引创建成功");

    // 保存更改
    dbManager.saveToFile();
    logger.info("[Database] 数据库表创建完成");
  } catch (error) {
    logger.error("[Database] 创建表失败:", error);
    logger.error("[Database] 错误详情:", error.message);
    logger.error("[Database] 错误堆栈:", error.stack);
    throw error;
  }

  // 初始化默认配置和数据库迁移在表创建成功后单独执行
  // 这样即使它们失败也不影响表的创建
  try {
    dbManager.initDefaultSettings();
  } catch (error) {
    logger.warn("[Database] 初始化默认配置失败（可忽略）:", error.message);
  }

  try {
    dbManager.migrateDatabase();
  } catch (error) {
    logger.warn("[Database] 数据库迁移失败（可忽略）:", error.message);
  }
}

module.exports = { createTables };
