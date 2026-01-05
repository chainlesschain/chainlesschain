/**
 * Mock数据库服务
 * 用于E2E测试，使用内存数据库
 */

class MockDatabase {
  constructor() {
    this.isEnabled = process.env.MOCK_DATABASE === 'true';
    this.data = {
      conversations: [],
      messages: [],
      notes: [],
      projects: [],
      sessions: []
    };
    this.idCounter = 1;
  }

  /**
   * 初始化数据库
   */
  async initialize() {
    console.log('[MockDatabase] 初始化内存数据库');

    // 添加一些测试数据
    this.data.conversations = [
      {
        id: 'conv-1',
        title: '测试对话',
        created_at: Date.now(),
        updated_at: Date.now()
      }
    ];

    return true;
  }

  /**
   * 保存消息
   */
  async saveMessage(conversationId, message) {
    const msg = {
      id: `msg-${this.idCounter++}`,
      conversation_id: conversationId,
      role: message.role,
      content: message.content,
      timestamp: Date.now(),
      ...message
    };

    this.data.messages.push(msg);
    return msg;
  }

  /**
   * 获取对话消息
   */
  async getMessages(conversationId, limit = 50) {
    return this.data.messages
      .filter(m => m.conversation_id === conversationId)
      .slice(-limit);
  }

  /**
   * 创建对话
   */
  async createConversation(title) {
    const conversation = {
      id: `conv-${this.idCounter++}`,
      title: title || '新对话',
      created_at: Date.now(),
      updated_at: Date.now()
    };

    this.data.conversations.push(conversation);
    return conversation;
  }

  /**
   * 获取所有对话
   */
  async getConversations(limit = 20) {
    return this.data.conversations.slice(-limit);
  }

  /**
   * 保存笔记
   */
  async saveNote(note) {
    const savedNote = {
      id: note.id || `note-${this.idCounter++}`,
      title: note.title || '无标题',
      content: note.content || '',
      tags: note.tags || [],
      created_at: note.created_at || Date.now(),
      updated_at: Date.now(),
      ...note
    };

    // 更新或添加
    const index = this.data.notes.findIndex(n => n.id === savedNote.id);
    if (index >= 0) {
      this.data.notes[index] = savedNote;
    } else {
      this.data.notes.push(savedNote);
    }

    return savedNote;
  }

  /**
   * 获取笔记
   */
  async getNote(noteId) {
    return this.data.notes.find(n => n.id === noteId);
  }

  /**
   * 获取所有笔记
   */
  async getNotes(limit = 100) {
    return this.data.notes.slice(-limit);
  }

  /**
   * 保存项目
   */
  async saveProject(project) {
    const savedProject = {
      id: project.id || `proj-${this.idCounter++}`,
      name: project.name || '未命名项目',
      type: project.type || 'general',
      status: project.status || 'active',
      created_at: project.created_at || Date.now(),
      updated_at: Date.now(),
      ...project
    };

    const index = this.data.projects.findIndex(p => p.id === savedProject.id);
    if (index >= 0) {
      this.data.projects[index] = savedProject;
    } else {
      this.data.projects.push(savedProject);
    }

    return savedProject;
  }

  /**
   * 获取项目
   */
  async getProject(projectId) {
    return this.data.projects.find(p => p.id === projectId);
  }

  /**
   * 获取所有项目
   */
  async getProjects(limit = 50) {
    return this.data.projects.slice(-limit);
  }

  /**
   * 保存规划会话
   */
  async savePlanSession(session) {
    const savedSession = {
      id: session.id || `session-${this.idCounter++}`,
      user_request: session.userRequest || session.user_request,
      status: session.status || 'planning',
      task_plan: session.taskPlan || session.task_plan,
      created_at: session.created_at || Date.now(),
      updated_at: Date.now(),
      ...session
    };

    const index = this.data.sessions.findIndex(s => s.id === savedSession.id);
    if (index >= 0) {
      this.data.sessions[index] = savedSession;
    } else {
      this.data.sessions.push(savedSession);
    }

    return savedSession;
  }

  /**
   * 获取规划会话
   */
  async getPlanSession(sessionId) {
    return this.data.sessions.find(s => s.id === sessionId);
  }

  /**
   * 获取所有规划会话
   */
  async getPlanSessions(limit = 20) {
    return this.data.sessions.slice(-limit);
  }

  /**
   * 执行原始SQL（mock实现）
   */
  async exec(sql, params = []) {
    console.log('[MockDatabase] 执行SQL:', sql, params);
    // Mock实现，返回空结果
    return { changes: 0, lastID: 0 };
  }

  /**
   * 查询（mock实现）
   */
  async all(sql, params = []) {
    console.log('[MockDatabase] 查询:', sql, params);

    // 简单的表名匹配
    if (sql.includes('conversations')) {
      return this.data.conversations;
    }
    if (sql.includes('messages')) {
      return this.data.messages;
    }
    if (sql.includes('notes')) {
      return this.data.notes;
    }
    if (sql.includes('projects')) {
      return this.data.projects;
    }
    if (sql.includes('sessions')) {
      return this.data.sessions;
    }

    return [];
  }

  /**
   * 获取单行（mock实现）
   */
  async get(sql, params = []) {
    const results = await this.all(sql, params);
    return results[0] || null;
  }

  /**
   * 运行SQL（mock实现）
   */
  async run(sql, params = []) {
    console.log('[MockDatabase] 运行:', sql, params);
    return { changes: 1, lastID: this.idCounter++ };
  }

  /**
   * 清空数据
   */
  async clear() {
    console.log('[MockDatabase] 清空所有数据');
    this.data = {
      conversations: [],
      messages: [],
      notes: [],
      projects: [],
      sessions: []
    };
    this.idCounter = 1;
  }

  /**
   * 关闭数据库
   */
  async close() {
    console.log('[MockDatabase] 关闭数据库连接');
    return true;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      conversations: this.data.conversations.length,
      messages: this.data.messages.length,
      notes: this.data.notes.length,
      projects: this.data.projects.length,
      sessions: this.data.sessions.length
    };
  }
}

module.exports = MockDatabase;
