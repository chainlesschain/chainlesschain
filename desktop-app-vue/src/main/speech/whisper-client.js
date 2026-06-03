/**
 * Whisper STT Client
 *
 * Speech-to-Text client supporting both local (whisper.cpp) and OpenAI API modes.
 *
 * Features:
 * - Local transcription via whisper.cpp binary
 * - Cloud transcription via OpenAI Whisper API
 * - Real-time streaming transcription
 * - Model management (list, download)
 * - Full voice chat pipeline (STT -> LLM -> TTS)
 *
 * @module whisper-client
 * @version 1.0.0
 */

const { logger } = require("../utils/logger.js");
const EventEmitter = require("events");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

/**
 * Internal dependency container for testability.
 * In tests, override these before constructing WhisperClient instances.
 * @private
 */
const _deps = { fs, spawn, uuidv4, getAxios: () => require("axios") };

/**
 * Model definitions with metadata
 */
const WHISPER_MODELS = {
  tiny: {
    name: "ggml-tiny.bin",
    size: "tiny",
    label: "Tiny (75 MB)",
    sizeBytes: 75 * 1024 * 1024,
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
  },
  base: {
    name: "ggml-base.bin",
    size: "base",
    label: "Base (142 MB)",
    sizeBytes: 142 * 1024 * 1024,
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
  },
  small: {
    name: "ggml-small.bin",
    size: "small",
    label: "Small (466 MB)",
    sizeBytes: 466 * 1024 * 1024,
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
  },
  medium: {
    name: "ggml-medium.bin",
    size: "medium",
    label: "Medium (1.5 GB)",
    sizeBytes: 1536 * 1024 * 1024,
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
  },
  large: {
    name: "ggml-large-v3.bin",
    size: "large",
    label: "Large v3 (3.1 GB)",
    sizeBytes: 3174 * 1024 * 1024,
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
  },
};

/**
 * WhisperClient class
 *
 * Provides speech-to-text capabilities using whisper.cpp (local) or OpenAI API.
 */
class WhisperClient extends EventEmitter {
  /**
   * @param {Object} config - Configuration
   * @param {string} [config.mode='local'] - Operation mode: 'local' or 'api'
   * @param {string} [config.modelPath] - Path to the whisper.cpp model file
   * @param {string} [config.modelSize='base'] - Model size: tiny, base, small, medium, large
   * @param {string} [config.language='auto'] - Language code (e.g., 'en', 'zh', 'auto')
   * @param {string} [config.apiKey] - OpenAI API key (for API mode)
   * @param {string} [config.apiBaseURL='https://api.openai.com/v1'] - API base URL
   * @param {string} [config.binaryPath] - Path to whisper.cpp main binary
   */
  constructor(config = {}) {
    super();

    this.mode = config.mode || "local";
    this.modelPath = config.modelPath || null;
    this.modelSize = config.modelSize || "base";
    this.language = config.language || "auto";
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
    this.apiBaseURL =
      config.apiBaseURL ||
      process.env.OPENAI_BASE_URL ||
      "https://api.openai.com/v1";
    this.binaryPath = config.binaryPath || null;

    // Active streaming sessions
    this.activeStreams = new Map();

    // Statistics
    this.stats = {
      totalTranscriptions: 0,
      totalDuration: 0,
      totalCharacters: 0,
      errors: 0,
      byMode: { local: 0, api: 0 },
    };

    logger.info(
      `[WhisperClient] Initialized in '${this.mode}' mode, model size: ${this.modelSize}`,
    );
  }

  /**
   * Transcribe an audio file
   * @param {string} audioPath - Path to the audio file
   * @param {Object} [options] - Transcription options
   * @param {string} [options.language] - Override language
   * @param {string} [options.prompt] - Initial prompt hint
   * @param {number} [options.temperature=0] - Sampling temperature
   * @param {string} [options.responseFormat='json'] - Response format (API mode)
   * @returns {Promise<Object>} Transcription result { text, segments, language, duration }
   */
  async transcribe(audioPath, options = {}) {
    const startTime = Date.now();

    // Validate audio file exists
    if (!_deps.fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    logger.info(
      `[WhisperClient] Transcribing: ${path.basename(audioPath)} (mode: ${this.mode})`,
    );

    let result;

    if (this.mode === "api") {
      result = await this._transcribeAPI(audioPath, options);
    } else {
      result = await this._transcribeLocal(audioPath, options);
    }

    const processingTime = Date.now() - startTime;

    // Update statistics
    this.stats.totalTranscriptions++;
    this.stats.totalCharacters += (result.text || "").length;
    this.stats.totalDuration += result.duration || 0;
    this.stats.byMode[this.mode]++;

    logger.info(
      `[WhisperClient] Transcription complete: ${(result.text || "").length} chars in ${processingTime}ms`,
    );

    this.emit("transcription:complete", {
      audioPath,
      text: result.text,
      processingTime,
    });

    return {
      text: result.text || "",
      segments: result.segments || [],
      language: result.language || this.language,
      duration: result.duration || 0,
      processingTime,
    };
  }

  /**
   * Transcribe using local whisper.cpp binary
   * @param {string} audioPath - Audio file path
   * @param {Object} options - Options
   * @returns {Promise<Object>}
   * @private
   */
  async _transcribeLocal(audioPath, options = {}) {
    const language = options.language || this.language;
    const resolvedModelPath =
      this.modelPath || this._getModelPath(this.modelSize);

    // Verify model file exists
    if (!_deps.fs.existsSync(resolvedModelPath)) {
      throw new Error(
        `Whisper model not found at: ${resolvedModelPath}. Please download it first using downloadModel().`,
      );
    }

    const binaryPath = this.binaryPath || "whisper-cpp-main";

    const args = [
      "--model",
      resolvedModelPath,
      "--output-json",
      "-f",
      audioPath,
    ];

    if (language && language !== "auto") {
      args.push("--language", language);
    }

    if (options.prompt) {
      args.push("--prompt", options.prompt);
    }

    if (options.temperature !== undefined) {
      args.push("--temperature", String(options.temperature));
    }

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const proc = _deps.spawn(binaryPath, args);

      proc.stdout.on("data", (data) => {
        stdout += data.toString("utf8");
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString("utf8");
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          this.stats.errors++;
          const errMsg =
            stderr.trim() || `whisper.cpp exited with code ${code}`;
          logger.error(`[WhisperClient] Local transcription failed: ${errMsg}`);
          reject(new Error(`Whisper transcription failed: ${errMsg}`));
          return;
        }

        try {
          const parsed = this._parseWhisperOutput(stdout);
          resolve(parsed);
        } catch (parseError) {
          logger.error(
            `[WhisperClient] Failed to parse whisper output: ${parseError.message}`,
          );
          // Fallback: treat stdout as plain text
          resolve({
            text: stdout.trim(),
            segments: [],
            language: language,
            duration: 0,
          });
        }
      });

      proc.on("error", (err) => {
        this.stats.errors++;
        logger.error(
          `[WhisperClient] Failed to spawn whisper.cpp: ${err.message}`,
        );
        reject(
          new Error(
            `Failed to start whisper.cpp (${binaryPath}): ${err.message}. Ensure whisper.cpp is installed.`,
          ),
        );
      });
    });
  }

  /**
   * Transcribe using OpenAI Whisper API
   * @param {string} audioPath - Audio file path
   * @param {Object} options - Options
   * @returns {Promise<Object>}
   * @private
   */
  async _transcribeAPI(audioPath, options = {}) {
    if (!this.apiKey) {
      throw new Error(
        "API key is required for Whisper API mode. Set OPENAI_API_KEY or pass apiKey in config.",
      );
    }

    let axios;
    try {
      axios = _deps.getAxios();
    } catch (e) {
      throw new Error(
        "axios is required for API mode. Install it with: npm install axios",
      );
    }

    const FormData = require("form-data");

    const language = options.language || this.language;
    const responseFormat = options.responseFormat || "verbose_json";

    const formData = new FormData();
    formData.append("file", _deps.fs.createReadStream(audioPath));
    formData.append("model", "whisper-1");

    if (language && language !== "auto") {
      formData.append("language", language);
    }

    if (options.prompt) {
      formData.append("prompt", options.prompt);
    }

    if (options.temperature !== undefined) {
      formData.append("temperature", String(options.temperature));
    }

    formData.append("response_format", responseFormat);

    const url = `${this.apiBaseURL}/audio/transcriptions`;

    try {
      const response = await axios.post(url, formData, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...formData.getHeaders(),
        },
        timeout: options.timeout || 120000,
        maxContentLength: 100 * 1024 * 1024,
      });

      const data = response.data;

      if (responseFormat === "verbose_json") {
        return {
          text: data.text || "",
          segments: (data.segments || []).map((seg) => ({
            start: seg.start,
            end: seg.end,
            text: seg.text,
          })),
          language: data.language || language,
          duration: data.duration || 0,
        };
      }

      // For other formats (json, text, srt, vtt)
      const text = typeof data === "string" ? data : data.text || "";
      return {
        text,
        segments: [],
        language: language,
        duration: 0,
      };
    } catch (error) {
      this.stats.errors++;
      if (error.response) {
        const status = error.response.status;
        const message =
          error.response.data?.error?.message ||
          error.response.statusText ||
          "Unknown API error";
        throw new Error(`Whisper API error (${status}): ${message}`);
      }
      throw new Error(`Whisper API request failed: ${error.message}`);
    }
  }

  /**
   * Start real-time streaming transcription
   * @param {Object} [options] - Streaming options
   * @param {number} [options.step=3000] - Chunk step duration in ms
   * @param {string} [options.language] - Language override
   * @returns {Promise<string>} Stream ID
   */
  async startStream(options = {}) {
    if (this.mode !== "local") {
      throw new Error(
        "Streaming transcription is only available in local mode with whisper.cpp",
      );
    }

    const streamId = _deps.uuidv4();
    const language = options.language || this.language;
    const step = options.step || 3000;
    const resolvedModelPath =
      this.modelPath || this._getModelPath(this.modelSize);

    if (!_deps.fs.existsSync(resolvedModelPath)) {
      throw new Error(
        `Whisper model not found at: ${resolvedModelPath}. Please download it first.`,
      );
    }

    const binaryPath = this.binaryPath || "whisper-cpp-main";

    const args = [
      "--model",
      resolvedModelPath,
      "--stream",
      "--step",
      String(step),
      "-f",
      "-",
    ];

    if (language && language !== "auto") {
      args.push("--language", language);
    }

    logger.info(`[WhisperClient] Starting stream ${streamId}`);

    const proc = _deps.spawn(binaryPath, args);

    let buffer = "";

    proc.stdout.on("data", (data) => {
      buffer += data.toString("utf8");

      // Parse line-by-line for partial transcripts
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          this.emit("transcript", {
            streamId,
            text: trimmed,
            partial: true,
            timestamp: Date.now(),
          });
        }
      }
    });

    proc.stderr.on("data", (data) => {
      const text = data.toString("utf8").trim();
      if (text) {
        logger.debug(`[WhisperClient] Stream ${streamId} stderr: ${text}`);
      }
    });

    proc.on("close", (code) => {
      // Flush remaining buffer
      if (buffer.trim().length > 0) {
        this.emit("transcript", {
          streamId,
          text: buffer.trim(),
          partial: false,
          timestamp: Date.now(),
        });
      }

      this.activeStreams.delete(streamId);

      this.emit("stream:end", { streamId, code });
      logger.info(`[WhisperClient] Stream ${streamId} ended with code ${code}`);
    });

    proc.on("error", (err) => {
      this.activeStreams.delete(streamId);
      this.stats.errors++;
      this.emit("stream:error", { streamId, error: err.message });
      logger.error(`[WhisperClient] Stream ${streamId} error: ${err.message}`);
    });

    this.activeStreams.set(streamId, {
      process: proc,
      startedAt: Date.now(),
      language,
    });

    return streamId;
  }

  /**
   * Stop a streaming transcription session
   * @param {string} streamId - The stream ID to stop
   */
  async stopStream(streamId) {
    const stream = this.activeStreams.get(streamId);

    if (!stream) {
      throw new Error(`Stream not found: ${streamId}`);
    }

    logger.info(`[WhisperClient] Stopping stream ${streamId}`);

    const proc = stream.process;

    // Gracefully close stdin to signal end of input, then kill
    if (proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.end();
    }

    // Give it a moment to finish, then force kill
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!proc.killed) {
          proc.kill("SIGKILL");
        }
        this.activeStreams.delete(streamId);
        resolve();
      }, 3000);

      proc.on("close", () => {
        clearTimeout(timeout);
        this.activeStreams.delete(streamId);
        resolve();
      });

      // Try SIGTERM first
      if (!proc.killed) {
        proc.kill("SIGTERM");
      }
    });
  }

  /**
   * List available whisper models with download status
   * @returns {Promise<Array<Object>>} Array of model info objects
   */
  async listModels() {
    const modelsDir = this._getModelsDir();
    const models = [];

    for (const [size, modelInfo] of Object.entries(WHISPER_MODELS)) {
      const modelPath = path.join(modelsDir, modelInfo.name);
      let downloaded = false;

      try {
        _deps.fs.accessSync(modelPath, _deps.fs.constants.F_OK);
        downloaded = true;
      } catch (e) {
        downloaded = false;
      }

      models.push({
        size,
        name: modelInfo.name,
        label: modelInfo.label,
        downloaded,
        path: modelPath,
        sizeBytes: modelInfo.sizeBytes,
        url: modelInfo.url,
      });
    }

    return models;
  }

  /**
   * Download a whisper model from HuggingFace
   * @param {string} modelSize - Model size to download (tiny, base, small, medium, large)
   * @returns {Promise<Object>} Download result { path, size }
   */
  async downloadModel(modelSize) {
    const modelInfo = WHISPER_MODELS[modelSize];

    if (!modelInfo) {
      const validSizes = Object.keys(WHISPER_MODELS).join(", ");
      throw new Error(
        `Invalid model size: ${modelSize}. Valid sizes: ${validSizes}`,
      );
    }

    let axios;
    try {
      axios = _deps.getAxios();
    } catch (e) {
      throw new Error(
        "axios is required for model download. Install it with: npm install axios",
      );
    }

    const modelsDir = this._getModelsDir();
    const outputPath = path.join(modelsDir, modelInfo.name);

    // Create models directory if needed
    if (!_deps.fs.existsSync(modelsDir)) {
      _deps.fs.mkdirSync(modelsDir, { recursive: true });
    }

    // Check if already downloaded
    if (_deps.fs.existsSync(outputPath)) {
      const stat = _deps.fs.statSync(outputPath);
      logger.info(
        `[WhisperClient] Model '${modelSize}' already exists at ${outputPath} (${stat.size} bytes)`,
      );
      return { path: outputPath, size: stat.size };
    }

    logger.info(
      `[WhisperClient] Downloading model '${modelSize}' from ${modelInfo.url}`,
    );

    this.emit("download:start", {
      modelSize,
      url: modelInfo.url,
      expectedSize: modelInfo.sizeBytes,
    });

    const tempPath = outputPath + ".downloading";

    try {
      const response = await axios({
        method: "get",
        url: modelInfo.url,
        responseType: "stream",
        timeout: 0, // No timeout for large downloads
      });

      const totalSize =
        parseInt(response.headers["content-length"], 10) || modelInfo.sizeBytes;
      let downloadedSize = 0;

      const writer = _deps.fs.createWriteStream(tempPath);

      return new Promise((resolve, reject) => {
        response.data.on("data", (chunk) => {
          downloadedSize += chunk.length;
          const progress = Math.round((downloadedSize / totalSize) * 100);

          this.emit("download:progress", {
            modelSize,
            downloaded: downloadedSize,
            total: totalSize,
            progress,
          });
        });

        response.data.pipe(writer);

        writer.on("finish", () => {
          // Rename temp file to final
          _deps.fs.renameSync(tempPath, outputPath);

          const stat = _deps.fs.statSync(outputPath);

          logger.info(
            `[WhisperClient] Model '${modelSize}' downloaded successfully (${stat.size} bytes)`,
          );

          this.emit("download:complete", {
            modelSize,
            path: outputPath,
            size: stat.size,
          });

          resolve({ path: outputPath, size: stat.size });
        });

        writer.on("error", (err) => {
          // Clean up temp file on error
          try {
            _deps.fs.unlinkSync(tempPath);
          } catch (cleanupErr) {
            // Ignore cleanup errors
          }

          this.stats.errors++;
          this.emit("download:error", {
            modelSize,
            error: err.message,
          });

          reject(new Error(`Model download failed: ${err.message}`));
        });

        response.data.on("error", (err) => {
          writer.destroy();
          try {
            _deps.fs.unlinkSync(tempPath);
          } catch (cleanupErr) {
            // Ignore cleanup errors
          }

          this.stats.errors++;
          this.emit("download:error", {
            modelSize,
            error: err.message,
          });

          reject(new Error(`Model download stream error: ${err.message}`));
        });
      });
    } catch (error) {
      // Clean up temp file on error
      try {
        if (_deps.fs.existsSync(tempPath)) {
          _deps.fs.unlinkSync(tempPath);
        }
      } catch (cleanupErr) {
        // Ignore cleanup errors
      }

      this.stats.errors++;
      this.emit("download:error", {
        modelSize,
        error: error.message,
      });

      throw new Error(
        `Failed to download model '${modelSize}': ${error.message}`,
      );
    }
  }

  /**
   * Full voice chat pipeline: STT -> LLM -> TTS
   * @param {string} audioPath - Path to the user's audio input
   * @param {Object} llmManager - LLM manager instance with chatWithMessages()
   * @param {Object|null} ttsManager - TTS manager instance (optional)
   * @param {Object} [options] - Options
   * @param {string} [options.language] - Language override
   * @param {string} [options.systemPrompt] - System prompt for LLM
   * @param {string} [options.conversationId] - Conversation ID for context
   * @param {Object} [options.ttsOptions] - TTS synthesis options
   * @returns {Promise<Object>} Voice chat result
   */
  async voiceChat(audioPath, llmManager, ttsManager, options = {}) {
    const chatId = _deps.uuidv4();

    logger.info(`[WhisperClient] Voice chat ${chatId}: starting pipeline`);

    this.emit("voicechat:start", { chatId, audioPath });

    // Step 1: Transcribe audio to text
    this.emit("voicechat:step", { chatId, step: "stt", status: "started" });

    let userText;
    try {
      const transcription = await this.transcribe(audioPath, {
        language: options.language,
      });
      userText = transcription.text;

      if (!userText || userText.trim().length === 0) {
        throw new Error("No speech detected in the audio input");
      }

      this.emit("voicechat:step", {
        chatId,
        step: "stt",
        status: "complete",
        text: userText,
      });
    } catch (error) {
      this.emit("voicechat:step", {
        chatId,
        step: "stt",
        status: "error",
        error: error.message,
      });
      throw new Error(`STT failed: ${error.message}`);
    }

    // Step 2: Send text to LLM
    this.emit("voicechat:step", { chatId, step: "llm", status: "started" });

    let assistantText;
    try {
      if (!llmManager || typeof llmManager.chatWithMessages !== "function") {
        throw new Error(
          "LLM manager is required and must have a chatWithMessages method",
        );
      }

      const messages = [];

      if (options.systemPrompt) {
        messages.push({ role: "system", content: options.systemPrompt });
      }

      messages.push({ role: "user", content: userText });

      const llmResponse = await llmManager.chatWithMessages(messages, {
        conversationId: options.conversationId,
      });

      assistantText =
        typeof llmResponse === "string"
          ? llmResponse
          : llmResponse.content || llmResponse.text || "";

      if (!assistantText || assistantText.trim().length === 0) {
        assistantText =
          "I received your message but could not generate a response.";
      }

      this.emit("voicechat:step", {
        chatId,
        step: "llm",
        status: "complete",
        text: assistantText,
      });
    } catch (error) {
      this.emit("voicechat:step", {
        chatId,
        step: "llm",
        status: "error",
        error: error.message,
      });
      throw new Error(`LLM failed: ${error.message}`);
    }

    // Step 3: Synthesize response to speech (if TTS available)
    let audioResponse = null;

    if (ttsManager && typeof ttsManager.synthesize === "function") {
      this.emit("voicechat:step", { chatId, step: "tts", status: "started" });

      try {
        const ttsResult = await ttsManager.synthesize(
          assistantText,
          options.ttsOptions || {},
        );

        audioResponse = {
          audio: ttsResult.audio || null,
          format: ttsResult.format || "wav",
          provider: ttsResult.provider || "unknown",
          duration: ttsResult.duration || 0,
        };

        this.emit("voicechat:step", {
          chatId,
          step: "tts",
          status: "complete",
          audioResponse,
        });
      } catch (error) {
        logger.warn(
          `[WhisperClient] TTS synthesis failed (non-fatal): ${error.message}`,
        );
        this.emit("voicechat:step", {
          chatId,
          step: "tts",
          status: "error",
          error: error.message,
        });
        // TTS failure is non-fatal; we still return the text
      }
    } else {
      logger.info(
        "[WhisperClient] TTS manager not available, skipping synthesis",
      );
    }

    const result = {
      chatId,
      userText,
      assistantText,
      audioResponse,
    };

    this.emit("voicechat:complete", result);

    logger.info(`[WhisperClient] Voice chat ${chatId}: pipeline complete`);

    return result;
  }

  /**
   * Get statistics
   * @returns {Object} Usage statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeStreams: this.activeStreams.size,
      mode: this.mode,
      modelSize: this.modelSize,
    };
  }

  /**
   * Terminate all active streams and clean up
   */
  async terminate() {
    logger.info(
      `[WhisperClient] Terminating ${this.activeStreams.size} active streams`,
    );

    const stopPromises = [];
    for (const streamId of this.activeStreams.keys()) {
      stopPromises.push(
        this.stopStream(streamId).catch((err) => {
          logger.warn(
            `[WhisperClient] Error stopping stream ${streamId}: ${err.message}`,
          );
        }),
      );
    }

    await Promise.all(stopPromises);

    this.removeAllListeners();
    logger.info("[WhisperClient] Terminated");
  }

  // ========== Internal Helpers ==========

  /**
   * Get the file path for a given model size
   * @param {string} modelSize - Model size identifier
   * @returns {string} Full path to the model file
   * @private
   */
  _getModelPath(modelSize) {
    const modelInfo = WHISPER_MODELS[modelSize];
    if (!modelInfo) {
      throw new Error(`Unknown model size: ${modelSize}`);
    }

    const modelsDir = this._getModelsDir();
    return path.join(modelsDir, modelInfo.name);
  }

  /**
   * Get the models directory
   * Uses Electron app.getPath('userData') if available, otherwise falls back to cwd
   * @returns {string} Models directory path
   * @private
   */
  _getModelsDir() {
    let baseDir;

    try {
      const { app } = require("electron");
      baseDir = app.getPath("userData");
    } catch (e) {
      // Fallback when not running inside Electron (e.g., tests)
      baseDir = process.cwd();
    }

    return path.join(baseDir, "models", "whisper");
  }

  /**
   * Parse whisper.cpp JSON output into a structured result
   * @param {string} jsonStr - Raw JSON output from whisper.cpp
   * @returns {Object} Parsed transcription result
   * @private
   */
  _parseWhisperOutput(jsonStr) {
    if (!jsonStr || typeof jsonStr !== "string") {
      throw new Error("Empty or invalid whisper output");
    }

    const trimmed = jsonStr.trim();

    // whisper.cpp may output JSON with a "transcription" array
    const data = JSON.parse(trimmed);

    // Handle whisper.cpp JSON format
    if (data.transcription && Array.isArray(data.transcription)) {
      const segments = data.transcription.map((seg) => ({
        start: seg.timestamps?.from
          ? this._parseTimestamp(seg.timestamps.from)
          : seg.offsets?.from
            ? seg.offsets.from / 1000
            : 0,
        end: seg.timestamps?.to
          ? this._parseTimestamp(seg.timestamps.to)
          : seg.offsets?.to
            ? seg.offsets.to / 1000
            : 0,
        text: (seg.text || "").trim(),
      }));

      const fullText = segments.map((s) => s.text).join(" ");
      const lastSegment = segments[segments.length - 1];
      const duration = lastSegment ? lastSegment.end : 0;

      return {
        text: fullText,
        segments,
        language: data.result?.language || this.language,
        duration,
      };
    }

    // Handle OpenAI-compatible JSON format
    if (data.text !== undefined) {
      return {
        text: data.text || "",
        segments: (data.segments || []).map((seg) => ({
          start: seg.start || 0,
          end: seg.end || 0,
          text: (seg.text || "").trim(),
        })),
        language: data.language || this.language,
        duration: data.duration || 0,
      };
    }

    // Handle plain text inside JSON
    throw new Error(
      "Unrecognized whisper output format: missing 'transcription' or 'text' field",
    );
  }

  /**
   * Parse a whisper.cpp timestamp string (e.g., "00:00:01.234") to seconds
   * @param {string} timestamp - Timestamp string
   * @returns {number} Time in seconds
   * @private
   */
  _parseTimestamp(timestamp) {
    if (typeof timestamp === "number") {
      return timestamp;
    }

    const parts = timestamp.split(":");
    if (parts.length === 3) {
      const hours = parseFloat(parts[0]);
      const minutes = parseFloat(parts[1]);
      const seconds = parseFloat(parts[2]);
      return hours * 3600 + minutes * 60 + seconds;
    }

    if (parts.length === 2) {
      const minutes = parseFloat(parts[0]);
      const seconds = parseFloat(parts[1]);
      return minutes * 60 + seconds;
    }

    return parseFloat(timestamp) || 0;
  }
}

module.exports = { WhisperClient, _deps };
