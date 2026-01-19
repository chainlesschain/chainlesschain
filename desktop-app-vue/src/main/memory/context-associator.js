/**
 * ContextAssociator - Intelligent Context Association
 *
 * Provides cross-session knowledge extraction and association:
 * - Knowledge extraction from sessions
 * - Session relationship detection
 * - Conversation context tracking
 * - Topic taxonomy management
 * - Knowledge graph building
 *
 * @module context-associator
 * @version 1.0.0
 * @since 2026-01-18
 */

const { logger, createLogger } = require('../utils/logger.js');
const _fs = require("fs").promises;
const _path = require("path");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");

/**
 * ContextAssociator class
 */
class ContextAssociator extends EventEmitter {
  /**
   * Create a ContextAssociator instance
   * @param {Object} options - Configuration options
   * @param {Object} options.database - SQLite database instance
   * @param {Object} [options.llmManager] - LLM Manager for AI extraction
   * @param {Object} [options.sessionManager] - SessionManager for session data
   */
  constructor(options = {}) {
    super();

    if (!options.database) {
      throw new Error("[ContextAssociator] database parameter is required");
    }

    this.db = options.database;
    this.llmManager = options.llmManager || null;
    this.sessionManager = options.sessionManager || null;

    // Knowledge types
    this.knowledgeTypes = [
      "topic",
      "decision",
      "code_snippet",
      "reference",
      "question",
      "answer",
    ];

    // Association types
    this.associationTypes = [
      "topic_similarity",
      "continuation",
      "reference",
      "follow_up",
    ];

    // Minimum similarity for associations
    this.minSimilarityThreshold = 0.3;

    logger.info("[ContextAssociator] Initialized", {
      hasLLM: !!this.llmManager,
      hasSessionManager: !!this.sessionManager,
    });
  }

  /**
   * Initialize the associator
   */
  async initialize() {
    try {
      // Ensure tables exist
      await this._ensureTables();

      logger.info("[ContextAssociator] Initialization complete");
    } catch (error) {
      logger.error("[ContextAssociator] Initialization failed:", error);
      throw error;
    }
  }

  /**
   * Ensure database tables exist
   * @private
   */
  async _ensureTables() {
    try {
      const tableCheck = this.db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='session_knowledge'
      `);
      const exists = tableCheck.get();

      if (!exists) {
        // Create session_knowledge table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS session_knowledge (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            knowledge_type TEXT NOT NULL,
            content TEXT NOT NULL,
            summary TEXT,
            tags TEXT,
            entities TEXT,
            importance REAL DEFAULT 0.5,
            confidence REAL DEFAULT 0.5,
            source_message_id TEXT,
            metadata TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create session_associations table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS session_associations (
            id TEXT PRIMARY KEY,
            session_id_1 TEXT NOT NULL,
            session_id_2 TEXT NOT NULL,
            association_type TEXT NOT NULL,
            similarity_score REAL,
            shared_topics TEXT,
            shared_entities TEXT,
            confidence REAL DEFAULT 0.5,
            is_confirmed INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create conversation_context table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS conversation_context (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL UNIQUE,
            topics TEXT,
            key_decisions TEXT,
            unresolved_questions TEXT,
            mentioned_entities TEXT,
            code_references TEXT,
            context_vector TEXT,
            last_activity_type TEXT,
            message_count INTEGER DEFAULT 0,
            turn_count INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create topic_taxonomy table
        this.db
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS topic_taxonomy (
            id TEXT PRIMARY KEY,
            topic_name TEXT NOT NULL UNIQUE,
            parent_topic_id TEXT,
            description TEXT,
            usage_count INTEGER DEFAULT 0,
            related_topics TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `,
          )
          .run();

        // Create indexes
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_session_knowledge_session ON session_knowledge(session_id)`,
          )
          .run();
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_session_knowledge_type ON session_knowledge(knowledge_type, importance DESC)`,
          )
          .run();
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_session_associations_session1 ON session_associations(session_id_1)`,
          )
          .run();
        this.db
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_session_associations_session2 ON session_associations(session_id_2)`,
          )
          .run();

        logger.info("[ContextAssociator] Database tables created");
      }
    } catch (error) {
      logger.error("[ContextAssociator] Failed to ensure tables:", error);
      throw error;
    }
  }

  // ============================================================
  // Knowledge Extraction
  // ============================================================

  /**
   * Extract knowledge from a session
   * @param {string} sessionId - Session ID
   * @param {Object} options - Extraction options
   * @returns {Promise<Array>} Extracted knowledge items
   */
  async extractKnowledgeFromSession(sessionId, options = {}) {
    const { useLLM = true, messageLimit = 50 } = options;

    logger.info(
      `[ContextAssociator] Extracting knowledge from session: ${sessionId}`,
    );

    try {
      // Get session messages
      const messages = await this._getSessionMessages(sessionId, messageLimit);

      if (messages.length === 0) {
        logger.info("[ContextAssociator] No messages found for session");
        return [];
      }

      let extractedKnowledge = [];

      if (useLLM && this.llmManager) {
        extractedKnowledge = await this._extractWithLLM(sessionId, messages);
      } else {
        extractedKnowledge = await this._extractWithRules(sessionId, messages);
      }

      // Save extracted knowledge
      for (const knowledge of extractedKnowledge) {
        await this._saveKnowledge(knowledge);
      }

      // Update conversation context
      await this._updateConversationContext(sessionId, extractedKnowledge);

      // Find related sessions
      await this._findAndCreateAssociations(sessionId, extractedKnowledge);

      this.emit("knowledge-extracted", {
        sessionId,
        count: extractedKnowledge.length,
      });
      logger.info(
        `[ContextAssociator] Extracted ${extractedKnowledge.length} knowledge items`,
      );

      return extractedKnowledge;
    } catch (error) {
      logger.error("[ContextAssociator] Knowledge extraction failed:", error);
      throw error;
    }
  }

  /**
   * Get session messages
   * @private
   */
  async _getSessionMessages(sessionId, limit) {
    try {
      // Try to get from llm_sessions first
      const sessionStmt = this.db.prepare(`
        SELECT messages FROM llm_sessions WHERE id = ?
      `);
      const session = sessionStmt.get(sessionId);

      if (session?.messages) {
        const messages = JSON.parse(session.messages);
        return messages.slice(-limit);
      }

      // Try chat_messages table
      const messagesStmt = this.db.prepare(`
        SELECT * FROM chat_messages
        WHERE conversation_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `);
      return messagesStmt.all(sessionId, limit);
    } catch (error) {
      logger.error(
        "[ContextAssociator] Failed to get session messages:",
        error,
      );
      return [];
    }
  }

  /**
   * Extract knowledge using LLM
   * @private
   */
  async _extractWithLLM(sessionId, messages) {
    try {
      // Format conversation for LLM
      const conversationText = messages
        .map((m) => `${m.role || "user"}: ${m.content}`)
        .join("\n");

      const prompt = `Analyze this conversation and extract key knowledge items.

Conversation:
${conversationText.substring(0, 4000)}

Extract and categorize:
1. Main topics discussed
2. Key decisions made
3. Code snippets or technical references
4. Unresolved questions
5. Important answers or solutions

Respond in JSON format:
{
  "topics": ["topic1", "topic2"],
  "decisions": [{"content": "...", "importance": 0.8}],
  "code_snippets": [{"content": "...", "language": "..."}],
  "questions": [{"content": "...", "resolved": false}],
  "answers": [{"content": "...", "to_question": "..."}]
}`;

      const response = await this.llmManager.complete({
        prompt,
        temperature: 0.2,
        maxTokens: 1000,
      });

      // Parse LLM response
      const extracted = this._parseLLMResponse(response, sessionId);
      return extracted;
    } catch (error) {
      logger.error("[ContextAssociator] LLM extraction failed:", error);
      // Fall back to rule-based extraction
      return this._extractWithRules(sessionId, messages);
    }
  }

  /**
   * Parse LLM response into knowledge items
   * @private
   */
  _parseLLMResponse(response, sessionId) {
    const knowledge = [];

    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return knowledge;
      }

      const data = JSON.parse(jsonMatch[0]);

      // Process topics
      if (data.topics && Array.isArray(data.topics)) {
        for (const topic of data.topics) {
          knowledge.push({
            id: uuidv4(),
            sessionId,
            type: "topic",
            content: topic,
            importance: 0.7,
            confidence: 0.8,
            tags: [topic.toLowerCase()],
          });
        }
      }

      // Process decisions
      if (data.decisions && Array.isArray(data.decisions)) {
        for (const decision of data.decisions) {
          knowledge.push({
            id: uuidv4(),
            sessionId,
            type: "decision",
            content: decision.content || decision,
            importance: decision.importance || 0.8,
            confidence: 0.7,
            tags: ["decision"],
          });
        }
      }

      // Process code snippets
      if (data.code_snippets && Array.isArray(data.code_snippets)) {
        for (const snippet of data.code_snippets) {
          knowledge.push({
            id: uuidv4(),
            sessionId,
            type: "code_snippet",
            content: snippet.content || snippet,
            importance: 0.6,
            confidence: 0.9,
            tags: ["code", snippet.language || "unknown"],
          });
        }
      }

      // Process questions
      if (data.questions && Array.isArray(data.questions)) {
        for (const question of data.questions) {
          knowledge.push({
            id: uuidv4(),
            sessionId,
            type: "question",
            content: question.content || question,
            importance: question.resolved ? 0.4 : 0.7,
            confidence: 0.7,
            tags: ["question", question.resolved ? "resolved" : "unresolved"],
          });
        }
      }

      // Process answers
      if (data.answers && Array.isArray(data.answers)) {
        for (const answer of data.answers) {
          knowledge.push({
            id: uuidv4(),
            sessionId,
            type: "answer",
            content: answer.content || answer,
            importance: 0.7,
            confidence: 0.7,
            tags: ["answer"],
          });
        }
      }
    } catch (error) {
      logger.error("[ContextAssociator] Failed to parse LLM response:", error);
    }

    return knowledge;
  }

  /**
   * Extract knowledge using rules
   * @private
   */
  async _extractWithRules(sessionId, messages) {
    const knowledge = [];

    for (const message of messages) {
      const content = message.content || "";

      // Extract code snippets
      const codeBlocks = content.match(/```[\s\S]*?```/g) || [];
      for (const code of codeBlocks) {
        const languageMatch = code.match(/```(\w+)/);
        knowledge.push({
          id: uuidv4(),
          sessionId,
          type: "code_snippet",
          content: code,
          importance: 0.6,
          confidence: 0.9,
          tags: ["code", languageMatch?.[1] || "unknown"],
        });
      }

      // Extract questions
      const questions = content.match(/[^.!?]*\?/g) || [];
      for (const question of questions) {
        if (question.length > 10) {
          knowledge.push({
            id: uuidv4(),
            sessionId,
            type: "question",
            content: question.trim(),
            importance: 0.6,
            confidence: 0.6,
            tags: ["question"],
          });
        }
      }

      // Extract potential decisions (sentences with "decided", "will", "should")
      const decisionPatterns =
        /(?:we|I)\s+(?:decided|will|should|need to|have to)[^.!?]*/gi;
      const decisions = content.match(decisionPatterns) || [];
      for (const decision of decisions) {
        knowledge.push({
          id: uuidv4(),
          sessionId,
          type: "decision",
          content: decision.trim(),
          importance: 0.7,
          confidence: 0.5,
          tags: ["decision"],
        });
      }

      // Extract URLs as references
      const urls = content.match(/https?:\/\/[^\s]+/g) || [];
      for (const url of urls) {
        knowledge.push({
          id: uuidv4(),
          sessionId,
          type: "reference",
          content: url,
          importance: 0.5,
          confidence: 0.9,
          tags: ["url", "reference"],
        });
      }
    }

    // Extract topics from combined content
    const combinedContent = messages.map((m) => m.content || "").join(" ");
    const topics = this._extractTopics(combinedContent);
    for (const topic of topics) {
      knowledge.push({
        id: uuidv4(),
        sessionId,
        type: "topic",
        content: topic,
        importance: 0.5,
        confidence: 0.4,
        tags: [topic.toLowerCase()],
      });
    }

    return knowledge;
  }

  /**
   * Extract topics from text
   * @private
   */
  _extractTopics(text) {
    // Simple keyword extraction
    const words = text.toLowerCase().split(/\W+/);
    const wordFreq = {};

    // Common stop words to ignore
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "and",
      "or",
      "but",
      "in",
      "on",
      "at",
      "to",
      "for",
      "of",
      "with",
      "by",
      "from",
      "as",
      "is",
      "was",
      "are",
      "were",
      "been",
      "be",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "must",
      "shall",
      "can",
      "need",
      "this",
      "that",
      "these",
      "those",
      "i",
      "you",
      "he",
      "she",
      "it",
      "we",
      "they",
      "what",
      "which",
      "who",
      "when",
      "where",
      "why",
      "how",
      "all",
      "each",
      "every",
      "both",
      "few",
      "more",
      "most",
      "other",
      "some",
      "such",
      "no",
      "nor",
      "not",
      "only",
      "own",
      "same",
      "so",
      "than",
      "too",
      "very",
      "just",
      "also",
      "now",
      "here",
      "there",
    ]);

    for (const word of words) {
      if (word.length > 3 && !stopWords.has(word)) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    }

    // Get top topics by frequency
    const sortedWords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);

    return sortedWords;
  }

  /**
   * Save knowledge to database
   * @private
   */
  async _saveKnowledge(knowledge) {
    const now = Date.now();

    try {
      this.db
        .prepare(
          `
        INSERT INTO session_knowledge (
          id, session_id, knowledge_type, content, summary, tags,
          entities, importance, confidence, source_message_id,
          metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          knowledge.id,
          knowledge.sessionId,
          knowledge.type,
          knowledge.content,
          knowledge.summary || null,
          knowledge.tags ? JSON.stringify(knowledge.tags) : null,
          knowledge.entities ? JSON.stringify(knowledge.entities) : null,
          knowledge.importance,
          knowledge.confidence,
          knowledge.sourceMessageId || null,
          knowledge.metadata ? JSON.stringify(knowledge.metadata) : null,
          now,
          now,
        );
    } catch (error) {
      logger.error("[ContextAssociator] Failed to save knowledge:", error);
    }
  }

  /**
   * Update conversation context
   * @private
   */
  async _updateConversationContext(sessionId, knowledge) {
    const now = Date.now();

    try {
      // Aggregate topics
      const topics = knowledge
        .filter((k) => k.type === "topic")
        .map((k) => k.content);

      // Aggregate decisions
      const decisions = knowledge
        .filter((k) => k.type === "decision")
        .map((k) => k.content);

      // Aggregate unresolved questions
      const questions = knowledge
        .filter((k) => k.type === "question" && k.tags?.includes("unresolved"))
        .map((k) => k.content);

      // Check if context exists
      const existing = this.db
        .prepare(
          `SELECT id FROM conversation_context WHERE conversation_id = ?`,
        )
        .get(sessionId);

      if (existing) {
        this.db
          .prepare(
            `
          UPDATE conversation_context
          SET topics = ?, key_decisions = ?, unresolved_questions = ?,
              message_count = message_count + 1, updated_at = ?
          WHERE id = ?
        `,
          )
          .run(
            JSON.stringify(topics),
            JSON.stringify(decisions),
            JSON.stringify(questions),
            now,
            existing.id,
          );
      } else {
        this.db
          .prepare(
            `
          INSERT INTO conversation_context (
            id, conversation_id, topics, key_decisions, unresolved_questions,
            message_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        `,
          )
          .run(
            uuidv4(),
            sessionId,
            JSON.stringify(topics),
            JSON.stringify(decisions),
            JSON.stringify(questions),
            now,
            now,
          );
      }
    } catch (error) {
      logger.error("[ContextAssociator] Failed to update context:", error);
    }
  }

  /**
   * Find and create associations with other sessions
   * @private
   */
  async _findAndCreateAssociations(sessionId, knowledge) {
    try {
      // Get tags from current session's knowledge
      const currentTags = new Set();
      for (const k of knowledge) {
        if (k.tags) {
          for (const tag of k.tags) {
            currentTags.add(tag);
          }
        }
      }

      if (currentTags.size === 0) {
        return;
      }

      // Find other sessions with similar tags
      const otherSessions = this.db
        .prepare(
          `
        SELECT DISTINCT session_id, tags
        FROM session_knowledge
        WHERE session_id != ?
        GROUP BY session_id
      `,
        )
        .all(sessionId);

      for (const other of otherSessions) {
        const otherTags = new Set();

        // Get all tags for this session
        const otherKnowledge = this.db
          .prepare(`SELECT tags FROM session_knowledge WHERE session_id = ?`)
          .all(other.session_id);

        for (const k of otherKnowledge) {
          if (k.tags) {
            try {
              const tags = JSON.parse(k.tags);
              for (const tag of tags) {
                otherTags.add(tag);
              }
            } catch (_e) {
              // Ignore JSON parse errors
            }
          }
        }

        // Calculate similarity
        const intersection = [...currentTags].filter((t) => otherTags.has(t));
        const union = new Set([...currentTags, ...otherTags]);
        const similarity = intersection.length / union.size;

        if (similarity >= this.minSimilarityThreshold) {
          await this._createAssociation(
            sessionId,
            other.session_id,
            "topic_similarity",
            similarity,
            intersection,
          );
        }
      }
    } catch (error) {
      logger.error("[ContextAssociator] Failed to find associations:", error);
    }
  }

  /**
   * Create a session association
   * @private
   */
  async _createAssociation(
    sessionId1,
    sessionId2,
    type,
    similarity,
    sharedTopics,
  ) {
    try {
      // Check if association already exists
      const existing = this.db
        .prepare(
          `
        SELECT id FROM session_associations
        WHERE ((session_id_1 = ? AND session_id_2 = ?)
          OR (session_id_1 = ? AND session_id_2 = ?))
          AND association_type = ?
      `,
        )
        .get(sessionId1, sessionId2, sessionId2, sessionId1, type);

      if (existing) {
        // Update existing association
        this.db
          .prepare(
            `
          UPDATE session_associations
          SET similarity_score = ?, shared_topics = ?
          WHERE id = ?
        `,
          )
          .run(similarity, JSON.stringify(sharedTopics), existing.id);
      } else {
        // Create new association
        this.db
          .prepare(
            `
          INSERT INTO session_associations (
            id, session_id_1, session_id_2, association_type,
            similarity_score, shared_topics, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            uuidv4(),
            sessionId1,
            sessionId2,
            type,
            similarity,
            JSON.stringify(sharedTopics),
            Date.now(),
          );
      }
    } catch (error) {
      logger.error("[ContextAssociator] Failed to create association:", error);
    }
  }

  // ============================================================
  // Session Queries
  // ============================================================

  /**
   * Find related sessions
   * @param {string} sessionId - Session ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Related sessions
   */
  async findRelatedSessions(sessionId, options = {}) {
    const { limit = 10, minSimilarity = 0.3 } = options;

    try {
      const stmt = this.db.prepare(`
        SELECT
          CASE WHEN session_id_1 = ? THEN session_id_2 ELSE session_id_1 END as related_session_id,
          association_type,
          similarity_score,
          shared_topics,
          is_confirmed
        FROM session_associations
        WHERE (session_id_1 = ? OR session_id_2 = ?)
          AND similarity_score >= ?
        ORDER BY similarity_score DESC
        LIMIT ?
      `);

      const results = stmt.all(
        sessionId,
        sessionId,
        sessionId,
        minSimilarity,
        limit,
      );

      return results.map((r) => ({
        sessionId: r.related_session_id,
        associationType: r.association_type,
        similarity: r.similarity_score,
        sharedTopics: r.shared_topics ? JSON.parse(r.shared_topics) : [],
        confirmed: r.is_confirmed === 1,
      }));
    } catch (error) {
      logger.error(
        "[ContextAssociator] Failed to find related sessions:",
        error,
      );
      return [];
    }
  }

  /**
   * Analyze conversation context
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} Conversation context
   */
  async analyzeConversation(conversationId) {
    try {
      // Get existing context
      const context = this.db
        .prepare(`SELECT * FROM conversation_context WHERE conversation_id = ?`)
        .get(conversationId);

      if (context) {
        return {
          id: context.id,
          conversationId: context.conversation_id,
          topics: context.topics ? JSON.parse(context.topics) : [],
          keyDecisions: context.key_decisions
            ? JSON.parse(context.key_decisions)
            : [],
          unresolvedQuestions: context.unresolved_questions
            ? JSON.parse(context.unresolved_questions)
            : [],
          mentionedEntities: context.mentioned_entities
            ? JSON.parse(context.mentioned_entities)
            : [],
          codeReferences: context.code_references
            ? JSON.parse(context.code_references)
            : [],
          messageCount: context.message_count,
          turnCount: context.turn_count,
          updatedAt: context.updated_at,
        };
      }

      // Extract knowledge and build context
      await this.extractKnowledgeFromSession(conversationId, { useLLM: false });

      // Return newly created context
      return this.analyzeConversation(conversationId);
    } catch (error) {
      logger.error(
        "[ContextAssociator] Failed to analyze conversation:",
        error,
      );
      return null;
    }
  }

  /**
   * Search knowledge
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Matching knowledge items
   */
  async searchKnowledge(query, options = {}) {
    const { type, limit = 20, minImportance = 0 } = options;

    try {
      let sql = `
        SELECT * FROM session_knowledge
        WHERE content LIKE ?
          AND importance >= ?
      `;
      const params = [`%${query}%`, minImportance];

      if (type) {
        sql += ` AND knowledge_type = ?`;
        params.push(type);
      }

      sql += ` ORDER BY importance DESC, created_at DESC LIMIT ?`;
      params.push(limit);

      const stmt = this.db.prepare(sql);
      return stmt.all(...params).map((k) => ({
        id: k.id,
        sessionId: k.session_id,
        type: k.knowledge_type,
        content: k.content,
        summary: k.summary,
        tags: k.tags ? JSON.parse(k.tags) : [],
        importance: k.importance,
        confidence: k.confidence,
        createdAt: k.created_at,
      }));
    } catch (error) {
      logger.error("[ContextAssociator] Failed to search knowledge:", error);
      return [];
    }
  }

  /**
   * Get knowledge for a session
   * @param {string} sessionId - Session ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Knowledge items
   */
  async getSessionKnowledge(sessionId, options = {}) {
    const { type, limit = 50 } = options;

    try {
      let sql = `SELECT * FROM session_knowledge WHERE session_id = ?`;
      const params = [sessionId];

      if (type) {
        sql += ` AND knowledge_type = ?`;
        params.push(type);
      }

      sql += ` ORDER BY importance DESC, created_at DESC LIMIT ?`;
      params.push(limit);

      const stmt = this.db.prepare(sql);
      return stmt.all(...params).map((k) => ({
        id: k.id,
        type: k.knowledge_type,
        content: k.content,
        summary: k.summary,
        tags: k.tags ? JSON.parse(k.tags) : [],
        importance: k.importance,
        confidence: k.confidence,
        createdAt: k.created_at,
      }));
    } catch (error) {
      logger.error(
        "[ContextAssociator] Failed to get session knowledge:",
        error,
      );
      return [];
    }
  }

  // ============================================================
  // Topic Taxonomy
  // ============================================================

  /**
   * Get or create a topic
   * @param {string} topicName - Topic name
   * @param {Object} options - Options
   * @returns {Promise<Object>} Topic
   */
  async getOrCreateTopic(topicName, options = {}) {
    const { parentTopicId, description } = options;
    const normalizedName = topicName.toLowerCase().trim();
    const now = Date.now();

    try {
      const existing = this.db
        .prepare(`SELECT * FROM topic_taxonomy WHERE topic_name = ?`)
        .get(normalizedName);

      if (existing) {
        // Increment usage count
        this.db
          .prepare(
            `
          UPDATE topic_taxonomy
          SET usage_count = usage_count + 1, updated_at = ?
          WHERE id = ?
        `,
          )
          .run(now, existing.id);

        return {
          id: existing.id,
          name: existing.topic_name,
          parentId: existing.parent_topic_id,
          usageCount: existing.usage_count + 1,
        };
      }

      // Create new topic
      const id = uuidv4();
      this.db
        .prepare(
          `
        INSERT INTO topic_taxonomy (
          id, topic_name, parent_topic_id, description,
          usage_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?)
      `,
        )
        .run(
          id,
          normalizedName,
          parentTopicId || null,
          description || null,
          now,
          now,
        );

      return {
        id,
        name: normalizedName,
        parentId: parentTopicId,
        usageCount: 1,
      };
    } catch (error) {
      logger.error("[ContextAssociator] Failed to get/create topic:", error);
      throw error;
    }
  }

  /**
   * Get popular topics
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Popular topics
   */
  async getPopularTopics(options = {}) {
    const { limit = 20 } = options;

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM topic_taxonomy
        ORDER BY usage_count DESC
        LIMIT ?
      `);

      return stmt.all(limit).map((t) => ({
        id: t.id,
        name: t.topic_name,
        parentId: t.parent_topic_id,
        description: t.description,
        usageCount: t.usage_count,
      }));
    } catch (error) {
      logger.error("[ContextAssociator] Failed to get popular topics:", error);
      return [];
    }
  }

  // ============================================================
  // Statistics
  // ============================================================

  /**
   * Get statistics
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    try {
      const knowledgeStats = this.db
        .prepare(
          `
        SELECT
          COUNT(*) as total,
          COUNT(DISTINCT session_id) as sessions,
          AVG(importance) as avg_importance
        FROM session_knowledge
      `,
        )
        .get();

      const typeBreakdown = this.db
        .prepare(
          `
        SELECT knowledge_type, COUNT(*) as count
        FROM session_knowledge
        GROUP BY knowledge_type
        ORDER BY count DESC
      `,
        )
        .all();

      const associationStats = this.db
        .prepare(
          `
        SELECT
          COUNT(*) as total,
          AVG(similarity_score) as avg_similarity
        FROM session_associations
      `,
        )
        .get();

      const topicStats = this.db
        .prepare(
          `
        SELECT
          COUNT(*) as total,
          SUM(usage_count) as total_usage
        FROM topic_taxonomy
      `,
        )
        .get();

      return {
        knowledge: {
          total: knowledgeStats.total || 0,
          sessions: knowledgeStats.sessions || 0,
          avgImportance: knowledgeStats.avg_importance || 0,
          byType: typeBreakdown,
        },
        associations: {
          total: associationStats.total || 0,
          avgSimilarity: associationStats.avg_similarity || 0,
        },
        topics: {
          total: topicStats.total || 0,
          totalUsage: topicStats.total_usage || 0,
        },
      };
    } catch (error) {
      logger.error("[ContextAssociator] Failed to get stats:", error);
      return {};
    }
  }
}

module.exports = {
  ContextAssociator,
};
