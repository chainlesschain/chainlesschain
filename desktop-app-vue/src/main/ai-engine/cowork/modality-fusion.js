/**
 * Modality Fusion Engine — 5-Modality Input Fusion (v3.2)
 *
 * Unifies inputs from 5 modalities into a single representation:
 * - Text: direct text input
 * - Image: OCR via Tesseract.js + Sharp preprocessing
 * - Audio: transcription placeholder (Whisper API, Phase B)
 * - Document: structured extraction via DocumentParser
 * - Screen: desktop capture + OCR (Phase B)
 *
 * @module ai-engine/cowork/modality-fusion
 */

const { EventEmitter } = require("events");
const { logger } = require("../../utils/logger.js");

// ============================================================
// Constants
// ============================================================

const MODALITIES = {
  TEXT: "text",
  IMAGE: "image",
  AUDIO: "audio",
  DOCUMENT: "document",
  SCREEN: "screen",
};

const SESSION_STATUS = {
  ACTIVE: "active",
  PROCESSING: "processing",
  COMPLETED: "completed",
  ARCHIVED: "archived",
};

const DEFAULT_CONFIG = {
  maxInputsPerSession: 20,
  maxImageSizeMB: 10,
  maxDocSizeMB: 50,
  ocrLanguage: "eng+chi_sim",
  enableImagePreprocessing: true,
  contextWindowTokens: 4000,
};

// ============================================================
// ModalityFusion Class
// ============================================================

class ModalityFusion extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.db = null;
    this.documentParser = null;
    this.config = { ...DEFAULT_CONFIG };
    this.sessions = new Map();
    this.stats = {
      totalSessions: 0,
      totalInputs: 0,
      modalityDistribution: {},
      averageFusionTimeMs: 0,
    };
    this._fusionTimes = [];

    // Modality processors registry
    this._processors = new Map();
  }

  /**
   * Initialize with database and dependencies
   * @param {Object} db - Database instance
   * @param {Object} deps - Dependencies
   * @param {Object} [deps.documentParser] - DocumentParser instance
   */
  async initialize(db, deps = {}) {
    if (this.initialized) {
      return;
    }

    this.db = db;
    this.documentParser = deps.documentParser || null;

    // Register built-in processors
    this._registerProcessor(MODALITIES.TEXT, this._processText.bind(this));
    this._registerProcessor(MODALITIES.IMAGE, this._processImage.bind(this));
    this._registerProcessor(
      MODALITIES.DOCUMENT,
      this._processDocument.bind(this),
    );
    this._registerProcessor(MODALITIES.AUDIO, this._processAudio.bind(this));
    this._registerProcessor(MODALITIES.SCREEN, this._processScreen.bind(this));

    logger.info("[ModalityFusion] Initialized with 5 modality processors");
    this.initialized = true;
  }

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Fuse multiple modality inputs into a unified session
   * @param {Object} options
   * @param {Array} options.modalities - Array of { type, data, label?, metadata? }
   * @param {string} [options.sessionId] - Existing session to append to
   * @returns {Object} Fusion result with sessionId and fusedContext
   */
  async fuseInput(options = {}) {
    if (!this.initialized) {
      throw new Error("ModalityFusion not initialized");
    }

    const { modalities = [], sessionId: existingSessionId } = options;
    if (!modalities.length) {
      throw new Error("At least one modality input is required");
    }

    const startTime = Date.now();

    // Get or create session
    let session;
    if (existingSessionId && this.sessions.has(existingSessionId)) {
      session = this.sessions.get(existingSessionId);
    } else {
      session = this._createSession();
    }

    session.status = SESSION_STATUS.PROCESSING;

    // Process each modality input
    const processedInputs = [];
    for (const input of modalities) {
      const processor = this._processors.get(input.type);
      if (!processor) {
        logger.warn(`[ModalityFusion] Unknown modality: ${input.type}`);
        continue;
      }

      try {
        const processed = await processor(input);
        processedInputs.push({
          type: input.type,
          label: input.label || input.type,
          text: processed.text || "",
          metadata: { ...input.metadata, ...processed.metadata },
        });

        // Save artifact
        this._saveArtifact(session.id, {
          type: `input-${input.type}`,
          modality: input.type,
          content: processed.text || "",
          metadata: processed.metadata,
        });

        // Track modality usage
        this.stats.modalityDistribution[input.type] =
          (this.stats.modalityDistribution[input.type] || 0) + 1;
      } catch (error) {
        logger.error(
          `[ModalityFusion] Processing ${input.type} failed: ${error.message}`,
        );
        processedInputs.push({
          type: input.type,
          label: input.label || input.type,
          text: `[处理失败: ${error.message}]`,
          metadata: { error: true },
        });
      }
    }

    // Update session
    const modalityTypes = [...new Set(processedInputs.map((p) => p.type))];
    session.modalities = [
      ...new Set([...session.modalities, ...modalityTypes]),
    ];
    session.inputs.push(...processedInputs);
    session.inputCount += processedInputs.length;
    session.status = SESSION_STATUS.ACTIVE;
    session.updatedAt = new Date().toISOString();

    // Build fused context preview
    session.fusedContextPreview = this._buildQuickPreview(session.inputs);

    this.sessions.set(session.id, session);
    this._persistSession(session);

    // Stats
    const elapsed = Date.now() - startTime;
    this._fusionTimes.push(elapsed);
    if (this._fusionTimes.length > 100) {
      this._fusionTimes.shift();
    }
    this.stats.totalInputs += processedInputs.length;
    this.stats.averageFusionTimeMs = Math.round(
      this._fusionTimes.reduce((a, b) => a + b, 0) / this._fusionTimes.length,
    );

    this.emit("fusion:completed", {
      sessionId: session.id,
      modalities: modalityTypes,
      inputCount: processedInputs.length,
    });

    logger.info(
      `[ModalityFusion] Fused ${processedInputs.length} inputs → session ${session.id} (${elapsed}ms)`,
    );

    return {
      sessionId: session.id,
      fusedContext: session.fusedContextPreview,
      modalities: session.modalities,
      inputCount: session.inputCount,
    };
  }

  /**
   * Get session details
   * @param {string} sessionId
   * @returns {Object|null} Session data
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || this._loadSession(sessionId);
  }

  /**
   * Get supported modalities
   * @returns {Array} List of supported modality types with info
   */
  getSupportedModalities() {
    const supported = [];
    for (const [type, processor] of this._processors) {
      supported.push({
        type,
        available: true,
        description: this._getModalityDescription(type),
      });
    }
    return supported;
  }

  /**
   * Get session artifacts
   * @param {string} sessionId
   * @returns {Array} Artifacts
   */
  getArtifacts(sessionId) {
    if (!this.db) {
      return [];
    }
    try {
      return this.db
        .prepare(
          `SELECT id, artifact_type, modality, content, metadata, created_at
           FROM multimodal_artifacts WHERE session_id = ? ORDER BY created_at`,
        )
        .all(sessionId)
        .map((r) => ({
          ...r,
          metadata: JSON.parse(r.metadata || "{}"),
        }));
    } catch {
      return [];
    }
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this.stats,
      activeSessions: this.sessions.size,
    };
  }

  /**
   * Get config
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Update config
   */
  configure(updates) {
    Object.assign(this.config, updates);
    return this.getConfig();
  }

  // ============================================================
  // Modality Processors
  // ============================================================

  _registerProcessor(type, handler) {
    this._processors.set(type, handler);
  }

  async _processText(input) {
    const text =
      typeof input.data === "string" ? input.data : String(input.data);
    return {
      text,
      metadata: {
        charCount: text.length,
        language: this._detectLanguage(text),
      },
    };
  }

  async _processImage(input) {
    // OCR via Tesseract.js — attempt to extract text from image
    try {
      const imageData = input.data;
      const metadata = { source: "image" };

      // If base64 string, record size
      if (typeof imageData === "string" && imageData.length > 100) {
        const sizeBytes = Math.round((imageData.length * 3) / 4);
        metadata.sizeBytes = sizeBytes;

        if (sizeBytes > this.config.maxImageSizeMB * 1024 * 1024) {
          return {
            text: "[图像过大，超过限制]",
            metadata: { ...metadata, error: "size-exceeded" },
          };
        }
      }

      // Attempt OCR (graceful fallback if Tesseract not available)
      let ocrText = "";
      try {
        const Tesseract = require("tesseract.js");
        const {
          data: { text },
        } = await Tesseract.recognize(
          typeof imageData === "string"
            ? Buffer.from(imageData, "base64")
            : imageData,
          this.config.ocrLanguage,
        );
        ocrText = text.trim();
      } catch {
        ocrText = "[OCR 不可用 — 图像已记录但未提取文本]";
        metadata.ocrFailed = true;
      }

      // Image preprocessing with Sharp for description
      let description = "";
      try {
        const sharp = require("sharp");
        const buffer =
          typeof imageData === "string"
            ? Buffer.from(imageData, "base64")
            : imageData;
        const sharpMeta = await sharp(buffer).metadata();
        description = `图像 (${sharpMeta.width}x${sharpMeta.height}, ${sharpMeta.format})`;
        metadata.width = sharpMeta.width;
        metadata.height = sharpMeta.height;
        metadata.format = sharpMeta.format;
      } catch {
        description = "图像 (元数据不可用)";
      }

      const resultText = ocrText
        ? `${description}\nOCR 识别文本:\n${ocrText}`
        : description;

      return { text: resultText, metadata };
    } catch (error) {
      return {
        text: `[图像处理失败: ${error.message}]`,
        metadata: { error: error.message },
      };
    }
  }

  async _processDocument(input) {
    if (this.documentParser?.initialized) {
      try {
        const result = await this.documentParser.parse(
          input.data,
          input.metadata || {},
        );
        return {
          text: result.text || "",
          metadata: {
            pages: result.pages,
            tables: result.tables?.length || 0,
            format: result.format,
          },
        };
      } catch (error) {
        return {
          text: `[文档解析失败: ${error.message}]`,
          metadata: { error: error.message },
        };
      }
    }

    // Fallback: try to read as plain text
    if (typeof input.data === "string") {
      return { text: input.data, metadata: { format: "text", fallback: true } };
    }

    return {
      text: "[DocumentParser 未初始化]",
      metadata: { error: "parser-unavailable" },
    };
  }

  async _processAudio(input) {
    // Phase B placeholder — Whisper API integration
    return {
      text: "[语音转录: Phase B 实现 — Whisper API 集成]",
      metadata: {
        phase: "3.2.B",
        status: "placeholder",
        audioFormat: input.metadata?.format || "unknown",
      },
    };
  }

  async _processScreen(input) {
    // Phase B placeholder — Electron desktopCapturer
    return {
      text: "[屏幕捕获: Phase B 实现 — desktopCapturer + OCR]",
      metadata: {
        phase: "3.2.B",
        status: "placeholder",
      },
    };
  }

  // ============================================================
  // Helpers
  // ============================================================

  _createSession() {
    const id = `mm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session = {
      id,
      modalities: [],
      inputs: [],
      inputCount: 0,
      fusedContextPreview: null,
      status: SESSION_STATUS.ACTIVE,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.sessions.set(id, session);
    this.stats.totalSessions++;
    return session;
  }

  _buildQuickPreview(inputs) {
    const sections = [];
    for (const input of inputs) {
      const label = input.label || input.type;
      const truncated =
        input.text.length > 500 ? input.text.slice(0, 500) + "..." : input.text;
      sections.push(`[${label}]\n${truncated}`);
    }
    return sections.join("\n\n---\n\n");
  }

  _detectLanguage(text) {
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const totalChars = text.replace(/\s/g, "").length;
    if (totalChars === 0) {
      return "unknown";
    }
    return chineseChars / totalChars > 0.3 ? "zh" : "en";
  }

  _getModalityDescription(type) {
    const descriptions = {
      [MODALITIES.TEXT]: "文本输入 — 直接文字描述",
      [MODALITIES.IMAGE]: "图像输入 — OCR 文字识别 (Tesseract.js)",
      [MODALITIES.AUDIO]: "语音输入 — 语音转录 (Whisper API, Phase B)",
      [MODALITIES.DOCUMENT]: "文档输入 — PDF/DOCX/XLSX 结构化提取",
      [MODALITIES.SCREEN]: "屏幕输入 — 屏幕截图/录制 + OCR (Phase B)",
    };
    return descriptions[type] || type;
  }

  // ============================================================
  // Persistence
  // ============================================================

  _persistSession(session) {
    if (!this.db) {
      return;
    }
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO multimodal_sessions
           (id, modalities, fused_context, status, input_count, metadata, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          session.id,
          JSON.stringify(session.modalities),
          session.fusedContextPreview || "",
          session.status,
          session.inputCount,
          JSON.stringify(session.metadata),
          session.createdAt,
          session.updatedAt,
        );
    } catch (error) {
      logger.warn(`[ModalityFusion] Persist session error: ${error.message}`);
    }
  }

  _loadSession(sessionId) {
    if (!this.db) {
      return null;
    }
    try {
      const row = this.db
        .prepare("SELECT * FROM multimodal_sessions WHERE id = ?")
        .get(sessionId);
      if (!row) {
        return null;
      }
      const session = {
        id: row.id,
        modalities: JSON.parse(row.modalities || "[]"),
        inputs: [],
        inputCount: row.input_count,
        fusedContextPreview: row.fused_context,
        status: row.status,
        metadata: JSON.parse(row.metadata || "{}"),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      this.sessions.set(sessionId, session);
      return session;
    } catch {
      return null;
    }
  }

  _saveArtifact(sessionId, artifact) {
    if (!this.db) {
      return;
    }
    const id = `mma-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      this.db
        .prepare(
          `INSERT INTO multimodal_artifacts
           (id, session_id, artifact_type, modality, content, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        )
        .run(
          id,
          sessionId,
          artifact.type,
          artifact.modality || null,
          artifact.content || "",
          JSON.stringify(artifact.metadata || {}),
        );
    } catch (error) {
      logger.warn(`[ModalityFusion] Save artifact error: ${error.message}`);
    }
  }
}

// ============================================================
// Singleton
// ============================================================

let instance = null;

function getModalityFusion() {
  if (!instance) {
    instance = new ModalityFusion();
  }
  return instance;
}

module.exports = {
  ModalityFusion,
  getModalityFusion,
  MODALITIES,
  SESSION_STATUS,
};
