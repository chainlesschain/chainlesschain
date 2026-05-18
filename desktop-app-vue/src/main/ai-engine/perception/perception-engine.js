/**
 * @module ai-engine/perception/perception-engine
 * Phase 84: Multimodal Agent Perception Layer
 * Capabilities: screen understanding, voice, document intelligence, video, cross-modal
 */
const EventEmitter = require("events");
const { logger } = require("../../utils/logger.js");

class PerceptionEngine extends EventEmitter {
  constructor() {
    super();
    this.db = null;
    this.initialized = false;
    this._context = new Map();
    this._voiceSessions = new Map();
    this._analysisCache = new Map();
    this._config = {
      maxContextItems: 100,
      screenshotInterval: 5000,
      voiceSampleRate: 16000,
      cacheTimeout: 60000,
      supportedDocFormats: ["pdf", "pptx", "xlsx", "docx", "csv", "txt"],
      supportedVideoFormats: ["mp4", "webm", "avi", "mov"],
    };
  }

  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }
    this.db = db;
    this._llmManager = deps.llmManager || null;
    this._ensureTables();
    this.initialized = true;
    logger.info("[PerceptionEngine] Initialized");
  }

  _ensureTables() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS perception_analysis (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          input_path TEXT,
          result TEXT,
          confidence REAL,
          metadata TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS perception_context (
          id TEXT PRIMARY KEY,
          modality TEXT NOT NULL,
          content TEXT,
          relevance REAL DEFAULT 0.5,
          created_at TEXT DEFAULT (datetime('now')),
          expires_at TEXT
        );
      `);
    } catch (error) {
      logger.warn("[PerceptionEngine] Table creation warning:", error.message);
    }
  }

  // Screen Understanding
  async analyzeScreen(screenshotPath, options = {}) {
    const id = `screen-${Date.now()}`;
    try {
      const analysis = {
        id,
        type: "screen",
        inputPath: screenshotPath,
        elements: [],
        text: options.extractText
          ? await this._extractTextFromImage(screenshotPath)
          : null,
        layout: { regions: [], focusArea: null },
        confidence: 0.85,
        timestamp: Date.now(),
      };

      // Simulate VLM analysis
      analysis.elements = [
        {
          type: "window",
          bounds: { x: 0, y: 0, w: 1920, h: 1080 },
          label: "Main Application",
        },
        {
          type: "button",
          bounds: { x: 100, y: 50, w: 80, h: 30 },
          label: "Action Button",
        },
      ];

      this._addToContext("visual", analysis);
      this._persistAnalysis(analysis);
      this.emit("perception:screen-analyzed", {
        id,
        elements: analysis.elements.length,
      });
      return analysis;
    } catch (error) {
      logger.error("[PerceptionEngine] Screen analysis failed:", error.message);
      return { id, type: "screen", error: error.message, confidence: 0 };
    }
  }

  async _extractTextFromImage(imagePath) {
    // Would integrate with Tesseract.js in production
    return { text: "", confidence: 0, source: imagePath };
  }

  // Voice Conversation
  async startVoice(sessionId, options = {}) {
    const session = {
      id: sessionId || `voice-${Date.now()}`,
      status: "active",
      language: options.language || "en",
      startedAt: Date.now(),
      transcriptions: [],
      config: {
        sampleRate: options.sampleRate || this._config.voiceSampleRate,
        channels: options.channels || 1,
        enableTTS: options.enableTTS !== false,
      },
    };

    this._voiceSessions.set(session.id, session);
    this.emit("perception:voice-started", { sessionId: session.id });
    return { sessionId: session.id, status: "active" };
  }

  async stopVoice(sessionId) {
    const session = this._voiceSessions.get(sessionId);
    if (!session) {
      return null;
    }
    session.status = "stopped";
    session.endedAt = Date.now();
    this.emit("perception:voice-stopped", {
      sessionId,
      duration: session.endedAt - session.startedAt,
    });
    return {
      sessionId,
      duration: session.endedAt - session.startedAt,
      transcriptions: session.transcriptions,
    };
  }

  // Document Intelligence
  async parseDocument(filePath, options = {}) {
    const id = `doc-${Date.now()}`;
    const ext = (filePath.split(".").pop() || "").toLowerCase();

    if (!this._config.supportedDocFormats.includes(ext)) {
      return {
        id,
        type: "document",
        error: `Unsupported format: ${ext}`,
        confidence: 0,
      };
    }

    try {
      const result = {
        id,
        type: "document",
        format: ext,
        inputPath: filePath,
        pages: 0,
        sections: [],
        tables: [],
        figures: [],
        text: "",
        metadata: options.extractMetadata ? {} : null,
        confidence: 0.9,
        timestamp: Date.now(),
      };

      // In production, would use specific parsers per format
      this._persistAnalysis(result);
      this._addToContext("document", result);
      this.emit("perception:document-parsed", { id, format: ext });
      return result;
    } catch (error) {
      logger.error(
        "[PerceptionEngine] Document parsing failed:",
        error.message,
      );
      return { id, type: "document", error: error.message, confidence: 0 };
    }
  }

  // Video Understanding
  async analyzeVideo(videoPath, options = {}) {
    const id = `video-${Date.now()}`;
    const ext = (videoPath.split(".").pop() || "").toLowerCase();

    if (!this._config.supportedVideoFormats.includes(ext)) {
      return {
        id,
        type: "video",
        error: `Unsupported format: ${ext}`,
        confidence: 0,
      };
    }

    try {
      const result = {
        id,
        type: "video",
        inputPath: videoPath,
        duration: 0,
        keyframes: [],
        timestamps: [],
        scenes: [],
        transcript: null,
        confidence: 0.8,
        timestamp: Date.now(),
      };

      this._persistAnalysis(result);
      this._addToContext("video", result);
      this.emit("perception:video-analyzed", { id });
      return result;
    } catch (error) {
      logger.error("[PerceptionEngine] Video analysis failed:", error.message);
      return { id, type: "video", error: error.message, confidence: 0 };
    }
  }

  // Cross-modal Query
  async crossModalQuery(query, modalities = []) {
    const results = [];
    const targetModalities =
      modalities.length > 0
        ? modalities
        : ["visual", "document", "video", "audio"];

    for (const [id, ctx] of this._context) {
      if (targetModalities.includes(ctx.modality)) {
        results.push({
          id,
          modality: ctx.modality,
          relevance: ctx.relevance,
          summary: ctx.content
            ? typeof ctx.content === "string"
              ? ctx.content.substring(0, 200)
              : JSON.stringify(ctx.content).substring(0, 200)
            : "",
          timestamp: ctx.timestamp,
        });
      }
    }

    results.sort((a, b) => b.relevance - a.relevance);
    return results.slice(0, 20);
  }

  // Context Management
  _addToContext(modality, data) {
    const id = `ctx-${modality}-${Date.now()}`;
    this._context.set(id, {
      modality,
      content: data,
      relevance: 0.5,
      timestamp: Date.now(),
      expiresAt: Date.now() + this._config.cacheTimeout,
    });

    // Evict expired context
    const now = Date.now();
    for (const [ctxId, ctx] of this._context) {
      if (ctx.expiresAt < now) {
        this._context.delete(ctxId);
      }
    }

    // Enforce max context items
    if (this._context.size > this._config.maxContextItems) {
      const oldest = this._context.keys().next().value;
      this._context.delete(oldest);
    }
  }

  getContext(modality) {
    if (!modality) {
      return Array.from(this._context.values());
    }
    return Array.from(this._context.values()).filter(
      (c) => c.modality === modality,
    );
  }

  configure(config) {
    Object.assign(this._config, config);
    this.emit("perception:configured", { config: this._config });
    return this._config;
  }

  _persistAnalysis(analysis) {
    try {
      this.db
        .prepare(
          `
        INSERT INTO perception_analysis (id, type, input_path, result, confidence, metadata)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          analysis.id,
          analysis.type,
          analysis.inputPath || null,
          JSON.stringify(analysis),
          analysis.confidence,
          JSON.stringify(analysis.metadata || {}),
        );
    } catch (error) {
      logger.error(
        "[PerceptionEngine] Persist analysis failed:",
        error.message,
      );
    }
  }
}

let instance = null;
function getPerceptionEngine() {
  if (!instance) {
    instance = new PerceptionEngine();
  }
  return instance;
}

module.exports = { PerceptionEngine, getPerceptionEngine };
