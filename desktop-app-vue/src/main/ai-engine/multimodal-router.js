/**
 * Multimodal Router - 多模态AI统一路由器
 *
 * 统一管理图片、音频、视频等多模态输入的处理路由
 * 自动检测输入类型并分发到对应的处理管道
 *
 * @module ai-engine/multimodal-router
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const { EventEmitter } = require("events");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

/**
 * 支持的模态类型
 */
const ModalityTypes = {
  IMAGE: "image",
  AUDIO: "audio",
  VIDEO: "video",
  TEXT: "text",
};

/**
 * 文件扩展名 → 模态类型映射
 */
const EXTENSION_MAP = {
  ".jpg": ModalityTypes.IMAGE,
  ".jpeg": ModalityTypes.IMAGE,
  ".png": ModalityTypes.IMAGE,
  ".gif": ModalityTypes.IMAGE,
  ".bmp": ModalityTypes.IMAGE,
  ".webp": ModalityTypes.IMAGE,
  ".svg": ModalityTypes.IMAGE,
  ".mp3": ModalityTypes.AUDIO,
  ".wav": ModalityTypes.AUDIO,
  ".ogg": ModalityTypes.AUDIO,
  ".flac": ModalityTypes.AUDIO,
  ".m4a": ModalityTypes.AUDIO,
  ".aac": ModalityTypes.AUDIO,
  ".mp4": ModalityTypes.VIDEO,
  ".avi": ModalityTypes.VIDEO,
  ".mov": ModalityTypes.VIDEO,
  ".mkv": ModalityTypes.VIDEO,
  ".webm": ModalityTypes.VIDEO,
  ".flv": ModalityTypes.VIDEO,
};

class MultimodalRouter extends EventEmitter {
  constructor({ visionManager, llmManager, database }) {
    super();

    this.visionManager = visionManager;
    this.llmManager = llmManager;
    this.database = database;
    this.initialized = false;

    this.capabilities = {
      [ModalityTypes.IMAGE]: { available: false, provider: null },
      [ModalityTypes.AUDIO]: { available: false, provider: null },
      [ModalityTypes.VIDEO]: { available: false, provider: null },
      [ModalityTypes.TEXT]: { available: true, provider: "llm" },
    };
  }

  async initialize() {
    logger.info("[MultimodalRouter] 初始化多模态路由器...");

    try {
      await this._initializeTables();
      await this._detectCapabilities();

      this.initialized = true;
      logger.info("[MultimodalRouter] 多模态路由器初始化成功");
      this.emit("initialized", this.capabilities);
    } catch (error) {
      logger.error("[MultimodalRouter] 初始化失败:", error);
      throw error;
    }
  }

  async _initializeTables() {
    const db = this.database?.db;
    if (!db) {return;}

    db.exec(`
      CREATE TABLE IF NOT EXISTS multimodal_sessions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        input_path TEXT,
        result TEXT,
        model_used TEXT,
        duration_ms INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS multimodal_capabilities (
        modality TEXT PRIMARY KEY,
        available INTEGER DEFAULT 0,
        provider TEXT,
        last_checked INTEGER
      )
    `);
  }

  async _detectCapabilities() {
    if (this.visionManager) {
      this.capabilities[ModalityTypes.IMAGE] = {
        available: true,
        provider: "vision-manager",
      };
      this.capabilities[ModalityTypes.VIDEO] = {
        available: true,
        provider: "frame-extraction+vision",
      };
    }

    this.capabilities[ModalityTypes.AUDIO] = {
      available: true,
      provider: "speech-pipeline",
    };

    await this._saveCapabilities();
  }

  async _saveCapabilities() {
    const db = this.database?.db;
    if (!db) {return;}

    const stmt = db.prepare(
      "INSERT OR REPLACE INTO multimodal_capabilities (modality, available, provider, last_checked) VALUES (?, ?, ?, ?)",
    );

    const now = Math.floor(Date.now() / 1000);
    for (const [modality, cap] of Object.entries(this.capabilities)) {
      stmt.run(modality, cap.available ? 1 : 0, cap.provider, now);
    }
  }

  detectInputType(inputPath) {
    if (!inputPath) {return ModalityTypes.TEXT;}
    const ext = path.extname(inputPath).toLowerCase();
    return EXTENSION_MAP[ext] || ModalityTypes.TEXT;
  }

  async processInput(input) {
    const { filePath, prompt, type } = input;
    const detectedType = type || this.detectInputType(filePath);

    switch (detectedType) {
      case ModalityTypes.IMAGE:
        return this.analyzeImage(filePath, prompt);
      case ModalityTypes.AUDIO:
        return this.transcribeAudio(filePath, { prompt });
      case ModalityTypes.VIDEO:
        return this.analyzeVideo(filePath, prompt);
      default:
        return { type: ModalityTypes.TEXT, result: prompt };
    }
  }

  async analyzeImage(imagePath, prompt = "Describe this image") {
    const startTime = Date.now();
    const sessionId = uuidv4();

    try {
      let result;
      if (this.visionManager) {
        result = await this.visionManager.analyzeImage(imagePath, {
          prompt,
          type: "analyze",
        });
      } else {
        result = {
          text: "Vision analysis not available - no vision manager configured",
        };
      }

      const duration = Date.now() - startTime;
      await this._saveSession(
        sessionId,
        ModalityTypes.IMAGE,
        imagePath,
        result,
        duration,
      );

      this.emit("analysis-complete", {
        sessionId,
        type: ModalityTypes.IMAGE,
        duration,
      });
      return { sessionId, type: ModalityTypes.IMAGE, result, duration };
    } catch (error) {
      logger.error("[MultimodalRouter] 图片分析失败:", error);
      throw error;
    }
  }

  async transcribeAudio(audioPath, opts = {}) {
    const startTime = Date.now();
    const sessionId = uuidv4();

    try {
      const result = {
        text: `[Audio transcription placeholder for: ${path.basename(audioPath)}]`,
        language: opts.language || "auto",
        segments: [],
      };

      const duration = Date.now() - startTime;
      await this._saveSession(
        sessionId,
        ModalityTypes.AUDIO,
        audioPath,
        result,
        duration,
      );

      this.emit("transcription-complete", { sessionId, duration });
      return { sessionId, type: ModalityTypes.AUDIO, result, duration };
    } catch (error) {
      logger.error("[MultimodalRouter] 音频转写失败:", error);
      throw error;
    }
  }

  async analyzeVideo(videoPath, prompt = "Describe this video") {
    const startTime = Date.now();
    const sessionId = uuidv4();

    try {
      const result = {
        summary: `[Video analysis placeholder for: ${path.basename(videoPath)}]`,
        frames: [],
        duration_seconds: 0,
        prompt,
      };

      const duration = Date.now() - startTime;
      await this._saveSession(
        sessionId,
        ModalityTypes.VIDEO,
        videoPath,
        result,
        duration,
      );

      this.emit("video-analysis-complete", { sessionId, duration });
      return { sessionId, type: ModalityTypes.VIDEO, result, duration };
    } catch (error) {
      logger.error("[MultimodalRouter] 视频分析失败:", error);
      throw error;
    }
  }

  async multimodalChat(messages) {
    const results = [];

    for (const msg of messages) {
      if (msg.image) {
        results.push(
          await this.analyzeImage(msg.image, msg.text || "Describe this image"),
        );
      } else if (msg.audio) {
        results.push(await this.transcribeAudio(msg.audio));
      } else if (msg.video) {
        results.push(await this.analyzeVideo(msg.video, msg.text));
      } else {
        results.push({ type: ModalityTypes.TEXT, result: msg.text });
      }
    }

    return { messages: results };
  }

  getCapabilities() {
    return { ...this.capabilities };
  }

  async getSession(sessionId) {
    const db = this.database?.db;
    if (!db) {return null;}

    const row = db
      .prepare("SELECT * FROM multimodal_sessions WHERE id = ?")
      .get(sessionId);
    if (!row) {return null;}

    return { ...row, result: row.result ? JSON.parse(row.result) : null };
  }

  async listSessions({ limit = 20, offset = 0, type } = {}) {
    const db = this.database?.db;
    if (!db) {return { sessions: [], total: 0 };}

    let query = "SELECT * FROM multimodal_sessions";
    let countQuery = "SELECT COUNT(*) as total FROM multimodal_sessions";
    const params = [];

    if (type) {
      query += " WHERE type = ?";
      countQuery += " WHERE type = ?";
      params.push(type);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    const rows = db.prepare(query).all(...params, limit, offset);
    const { total } = db.prepare(countQuery).get(...params);

    return {
      sessions: rows.map((r) => ({
        ...r,
        result: r.result ? JSON.parse(r.result) : null,
      })),
      total,
    };
  }

  async deleteSession(sessionId) {
    const db = this.database?.db;
    if (!db) {return false;}

    const result = db
      .prepare("DELETE FROM multimodal_sessions WHERE id = ?")
      .run(sessionId);
    return result.changes > 0;
  }

  async getStats() {
    const db = this.database?.db;
    if (!db) {return {};}

    const stats = db
      .prepare(
        `SELECT type, COUNT(*) as count, AVG(duration_ms) as avg_duration,
         SUM(duration_ms) as total_duration
         FROM multimodal_sessions GROUP BY type`,
      )
      .all();

    return { byType: stats, capabilities: this.getCapabilities() };
  }

  async checkHealth() {
    const health = {};
    for (const [modality, cap] of Object.entries(this.capabilities)) {
      health[modality] = {
        available: cap.available,
        provider: cap.provider,
        status: cap.available ? "healthy" : "unavailable",
      };
    }
    return health;
  }

  async configure(modality, settings) {
    if (this.capabilities[modality]) {
      Object.assign(this.capabilities[modality], settings);
      await this._saveCapabilities();
    }
    return this.capabilities[modality] || null;
  }

  async _saveSession(sessionId, type, inputPath, result, duration) {
    const db = this.database?.db;
    if (!db) {return;}

    db.prepare(
      `INSERT INTO multimodal_sessions (id, type, input_path, result, model_used, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      type,
      inputPath || null,
      JSON.stringify(result),
      this.capabilities[type]?.provider || "unknown",
      duration,
    );
  }
}

module.exports = { MultimodalRouter, ModalityTypes, EXTENSION_MAP };
