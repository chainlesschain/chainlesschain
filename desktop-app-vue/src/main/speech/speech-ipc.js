/**
 * 语音处理 IPC
 * 处理音频转录、实时录音、字幕生成、音频处理等操作
 *
 * @module speech-ipc
 * @description 语音处理模块，提供音频转录、实时录音、音频增强、字幕生成、命令识别等功能
 */

const { ipcMain, dialog } = require("electron");

/**
 * 注册语音处理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Function} dependencies.initializeSpeechManager - 初始化语音管理器的函数
 */
function registerSpeechIPC({ initializeSpeechManager }) {
  console.log("[Speech IPC] Registering Speech IPC handlers...");

  // ============================================================
  // 文件转录操作 (2 handlers)
  // ============================================================

  /**
   * 转录音频文件
   */
  ipcMain.handle(
    "speech:transcribe-file",
    async (event, filePath, options = {}) => {
      try {
        const manager = await initializeSpeechManager();

        // 转发进度事件
        manager.on("transcribe-progress", (progress) => {
          event.sender.send("speech:progress", progress);
        });

        return await manager.transcribeFile(filePath, options);
      } catch (error) {
        console.error("[Speech] 转录音频失败:", error);
        throw error;
      }
    },
  );

  /**
   * 批量转录音频文件
   */
  ipcMain.handle(
    "speech:transcribe-batch",
    async (event, filePaths, options = {}) => {
      try {
        const manager = await initializeSpeechManager();

        // 转发批处理进度事件
        manager.on("batch-progress", (progress) => {
          event.sender.send("speech:batch-progress", progress);
        });

        return await manager.transcribeBatch(filePaths, options);
      } catch (error) {
        console.error("[Speech] 批量转录失败:", error);
        throw error;
      }
    },
  );

  // ============================================================
  // 文件选择操作 (1 handler)
  // ============================================================

  /**
   * 选择音频文件
   */
  ipcMain.handle("speech:select-audio-files", async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "音频文件",
            extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac", "webm"],
          },
          { name: "所有文件", extensions: ["*"] },
        ],
      });

      return result.canceled ? [] : result.filePaths;
    } catch (error) {
      console.error("[Speech] 选择音频文件失败:", error);
      return [];
    }
  });

  // ============================================================
  // 配置管理操作 (4 handlers)
  // ============================================================

  /**
   * 获取配置
   */
  ipcMain.handle("speech:get-config", async () => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.getConfig();
    } catch (error) {
      console.error("[Speech] 获取语音配置失败:", error);
      throw error;
    }
  });

  /**
   * 更新配置
   */
  ipcMain.handle("speech:update-config", async (_event, config) => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.updateConfig(config);
    } catch (error) {
      console.error("[Speech] 更新语音配置失败:", error);
      throw error;
    }
  });

  /**
   * 设置识别引擎
   */
  ipcMain.handle("speech:set-engine", async (_event, engineType) => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.setEngine(engineType);
    } catch (error) {
      console.error("[Speech] 设置识别引擎失败:", error);
      throw error;
    }
  });

  /**
   * 获取可用引擎列表
   */
  ipcMain.handle("speech:get-available-engines", async () => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.getAvailableEngines();
    } catch (error) {
      console.error("[Speech] 获取可用引擎列表失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 历史记录操作 (2 handlers)
  // ============================================================

  /**
   * 获取转录历史
   */
  ipcMain.handle(
    "speech:get-history",
    async (_event, limit = 100, offset = 0) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.getHistory(limit, offset);
      } catch (error) {
        console.error("[Speech] 获取转录历史失败:", error);
        throw error;
      }
    },
  );

  /**
   * 删除历史记录
   */
  ipcMain.handle("speech:delete-history", async (_event, id) => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.deleteHistory(id);
    } catch (error) {
      console.error("[Speech] 删除历史记录失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 音频文件管理操作 (5 handlers)
  // ============================================================

  /**
   * 获取音频文件
   */
  ipcMain.handle("speech:get-audio-file", async (_event, id) => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.getAudioFile(id);
    } catch (error) {
      console.error("[Speech] 获取音频文件失败:", error);
      throw error;
    }
  });

  /**
   * 列出音频文件
   */
  ipcMain.handle("speech:list-audio-files", async (_event, options = {}) => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.listAudioFiles(options);
    } catch (error) {
      console.error("[Speech] 列出音频文件失败:", error);
      throw error;
    }
  });

  /**
   * 搜索音频文件
   */
  ipcMain.handle(
    "speech:search-audio-files",
    async (_event, query, options = {}) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.searchAudioFiles(query, options);
      } catch (error) {
        console.error("[Speech] 搜索音频文件失败:", error);
        throw error;
      }
    },
  );

  /**
   * 删除音频文件
   */
  ipcMain.handle("speech:delete-audio-file", async (_event, id) => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.deleteAudioFile(id);
    } catch (error) {
      console.error("[Speech] 删除音频文件失败:", error);
      throw error;
    }
  });

  /**
   * 获取统计信息
   */
  ipcMain.handle("speech:get-stats", async (_event, userId = "local-user") => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.getStats(userId);
    } catch (error) {
      console.error("[Speech] 获取统计信息失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 音频处理操作 (5 handlers)
  // ============================================================

  /**
   * 降噪音频
   */
  ipcMain.handle(
    "speech:denoise-audio",
    async (_event, inputPath, outputPath, options = {}) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.denoiseAudio(inputPath, outputPath, options);
      } catch (error) {
        console.error("[Speech] 降噪音频失败:", error);
        throw error;
      }
    },
  );

  /**
   * 增强音频
   */
  ipcMain.handle(
    "speech:enhance-audio",
    async (_event, inputPath, outputPath, options = {}) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.enhanceAudio(inputPath, outputPath, options);
      } catch (error) {
        console.error("[Speech] 增强音频失败:", error);
        throw error;
      }
    },
  );

  /**
   * 为识别增强音频
   */
  ipcMain.handle(
    "speech:enhance-for-recognition",
    async (_event, inputPath, outputPath) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.enhanceForRecognition(inputPath, outputPath);
      } catch (error) {
        console.error("[Speech] 为识别增强音频失败:", error);
        throw error;
      }
    },
  );

  /**
   * 检测语言
   */
  ipcMain.handle("speech:detect-language", async (_event, audioPath) => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.detectLanguage(audioPath);
    } catch (error) {
      console.error("[Speech] 检测语言失败:", error);
      throw error;
    }
  });

  /**
   * 批量检测语言
   */
  ipcMain.handle("speech:detect-languages", async (_event, audioPaths) => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.detectLanguages(audioPaths);
    } catch (error) {
      console.error("[Speech] 批量检测语言失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 字幕生成操作 (3 handlers)
  // ============================================================

  /**
   * 生成字幕
   */
  ipcMain.handle(
    "speech:generate-subtitle",
    async (_event, audioId, outputPath, format = "srt") => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.generateSubtitle(audioId, outputPath, format);
      } catch (error) {
        console.error("[Speech] 生成字幕失败:", error);
        throw error;
      }
    },
  );

  /**
   * 转录并生成字幕
   */
  ipcMain.handle(
    "speech:transcribe-and-generate-subtitle",
    async (_event, audioPath, subtitlePath, options = {}) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.transcribeAndGenerateSubtitle(
          audioPath,
          subtitlePath,
          options,
        );
      } catch (error) {
        console.error("[Speech] 转录并生成字幕失败:", error);
        throw error;
      }
    },
  );

  /**
   * 批量生成字幕
   */
  ipcMain.handle(
    "speech:batch-generate-subtitles",
    async (_event, audioIds, outputDir, format = "srt") => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.batchGenerateSubtitles(
          audioIds,
          outputDir,
          format,
        );
      } catch (error) {
        console.error("[Speech] 批量生成字幕失败:", error);
        throw error;
      }
    },
  );

  // ============================================================
  // 实时录音操作 (7 handlers)
  // ============================================================

  /**
   * 开始实时录音
   */
  ipcMain.handle(
    "speech:start-realtime-recording",
    async (_event, options = {}) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.startRealtimeRecording(options);
      } catch (error) {
        console.error("[Speech] 开始实时录音失败:", error);
        throw error;
      }
    },
  );

  /**
   * 添加实时音频数据
   * 注意：从渲染进程传来的可能是 ArrayBuffer、Uint8Array 或 Buffer
   */
  ipcMain.handle(
    "speech:add-realtime-audio-data",
    async (_event, audioData) => {
      try {
        const manager = await initializeSpeechManager();

        // 确保数据是 Buffer 类型
        let buffer;
        if (Buffer.isBuffer(audioData)) {
          buffer = audioData;
        } else if (audioData instanceof ArrayBuffer) {
          buffer = Buffer.from(audioData);
        } else if (
          audioData instanceof Uint8Array ||
          ArrayBuffer.isView(audioData)
        ) {
          buffer = Buffer.from(
            audioData.buffer,
            audioData.byteOffset,
            audioData.byteLength,
          );
        } else {
          // 尝试直接转换
          buffer = Buffer.from(audioData);
        }

        return await manager.addRealtimeAudioData(buffer);
      } catch (error) {
        console.error("[Speech] 添加实时音频数据失败:", error);
        throw error;
      }
    },
  );

  /**
   * 暂停实时录音
   */
  ipcMain.handle("speech:pause-realtime-recording", async () => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.pauseRealtimeRecording();
    } catch (error) {
      console.error("[Speech] 暂停实时录音失败:", error);
      throw error;
    }
  });

  /**
   * 恢复实时录音
   */
  ipcMain.handle("speech:resume-realtime-recording", async () => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.resumeRealtimeRecording();
    } catch (error) {
      console.error("[Speech] 恢复实时录音失败:", error);
      throw error;
    }
  });

  /**
   * 停止实时录音
   */
  ipcMain.handle("speech:stop-realtime-recording", async () => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.stopRealtimeRecording();
    } catch (error) {
      console.error("[Speech] 停止实时录音失败:", error);
      throw error;
    }
  });

  /**
   * 取消实时录音
   */
  ipcMain.handle("speech:cancel-realtime-recording", async () => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.cancelRealtimeRecording();
    } catch (error) {
      console.error("[Speech] 取消实时录音失败:", error);
      throw error;
    }
  });

  /**
   * 获取实时录音状态
   */
  ipcMain.handle("speech:get-realtime-status", async () => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.getRealtimeStatus();
    } catch (error) {
      console.error("[Speech] 获取实时录音状态失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 命令识别操作 (3 handlers)
  // ============================================================

  /**
   * 识别命令
   */
  ipcMain.handle(
    "speech:recognize-command",
    async (_event, text, context = {}) => {
      try {
        const manager = await initializeSpeechManager();
        return await manager.recognizeCommand(text, context);
      } catch (error) {
        console.error("[Speech] 识别命令失败:", error);
        throw error;
      }
    },
  );

  /**
   * 注册命令
   */
  ipcMain.handle("speech:register-command", async (_event, command) => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.registerCommand(command);
    } catch (error) {
      console.error("[Speech] 注册命令失败:", error);
      throw error;
    }
  });

  /**
   * 获取所有命令
   */
  ipcMain.handle("speech:get-all-commands", async () => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.getAllCommands();
    } catch (error) {
      console.error("[Speech] 获取所有命令失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 缓存管理操作 (2 handlers)
  // ============================================================

  /**
   * 获取缓存统计
   */
  ipcMain.handle("speech:get-cache-stats", async () => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.getCacheStats();
    } catch (error) {
      console.error("[Speech] 获取缓存统计失败:", error);
      throw error;
    }
  });

  /**
   * 清除缓存
   */
  ipcMain.handle("speech:clear-cache", async () => {
    try {
      const manager = await initializeSpeechManager();
      return await manager.clearCache();
    } catch (error) {
      console.error("[Speech] 清除缓存失败:", error);
      throw error;
    }
  });

  // ============================================================
  // 实时语音识别操作 (7 handlers) - VoiceFeedbackWidget
  // ============================================================

  /**
   * 获取支持的语言列表
   */
  ipcMain.handle("speech:getLanguages", async () => {
    try {
      const MultiLanguageSupport = require("./multi-language-support");
      const multiLanguageSupport = new MultiLanguageSupport();
      return multiLanguageSupport.getSupportedLanguages();
    } catch (error) {
      console.error("[Speech] 获取语言列表失败:", error);
      throw error;
    }
  });

  /**
   * 获取学习统计
   */
  ipcMain.handle("speech:getLearningStats", async () => {
    try {
      const VoiceTraining = require("./voice-training");
      const training = new VoiceTraining();
      await training.initialize("default-user");
      return await training.getStats();
    } catch (error) {
      console.error("[Speech] 获取学习统计失败:", error);
      return {
        totalTranscriptions: 0,
        averageConfidence: 0,
        vocabularySize: 0,
      };
    }
  });

  /**
   * 获取命令建议
   */
  ipcMain.handle("speech:getCommandSuggestions", async () => {
    // 返回常用命令建议
    return [
      { name: "打开聊天", type: "toggle-chat" },
      { name: "返回首页", type: "navigate", path: "/" },
      { name: "打开设置", type: "navigate", path: "/settings" },
      { name: "查看知识库", type: "navigate", path: "/knowledge/list" },
    ];
  });

  /**
   * 开始录音 (VoiceFeedbackWidget 使用)
   * 复用 realtime recording 逻辑
   */
  ipcMain.handle("speech:startRecording", async (event, options = {}) => {
    try {
      const manager = await initializeSpeechManager();
      console.log("[Speech] 开始录音:", options);

      // 使用 realtime recording 接口
      const result = await manager.startRealtimeRecording({
        sampleRate: options.sampleRate || 16000,
        channels: options.channels || 1,
        language: options.language || "zh",
        engine: options.engine,
        autoDetect: options.autoDetect,
      });

      return { success: true, ...result };
    } catch (error) {
      console.error("[Speech] 开始录音失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 停止录音并获取结果 (VoiceFeedbackWidget 使用)
   * 复用 realtime recording 逻辑，返回识别结果
   */
  ipcMain.handle("speech:stopRecording", async () => {
    try {
      const manager = await initializeSpeechManager();
      console.log("[Speech] 停止录音");

      // 使用 realtime recording 接口停止并获取结果
      // RealtimeVoiceInput.stopRecording() 返回:
      // { transcript, partialResults, finalResults, duration, audioData, chunks, timestamp }
      const result = await manager.stopRealtimeRecording();

      if (result && result.transcript !== undefined) {
        return {
          success: true,
          text: result.transcript || "",
          confidence:
            result.partialResults?.length > 0
              ? result.partialResults.reduce(
                  (sum, r) => sum + (r.confidence || 0),
                  0,
                ) / result.partialResults.length
              : 0.95,
          language: "zh-CN",
          duration: result.duration,
          chunks: result.chunks,
        };
      } else {
        return {
          success: false,
          error: "没有识别到语音内容",
          text: "",
          confidence: 0,
        };
      }
    } catch (error) {
      console.error("[Speech] 停止录音失败:", error);
      return {
        success: false,
        error: error.message,
        text: "",
        confidence: 0,
      };
    }
  });

  /**
   * 取消录音 (VoiceFeedbackWidget 使用)
   * 复用 realtime recording 的取消逻辑
   */
  ipcMain.handle("speech:cancelRecording", async () => {
    try {
      const manager = await initializeSpeechManager();
      console.log("[Speech] 取消录音");

      // 使用 realtime recording 接口取消
      manager.cancelRealtimeRecording();

      return { success: true };
    } catch (error) {
      console.error("[Speech] 取消录音失败:", error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 导出语音数据
   */
  ipcMain.handle("speech:exportData", async () => {
    try {
      const VoiceTraining = require("./voice-training");
      const training = new VoiceTraining();
      await training.initialize("default-user");
      await training.exportProfile();
      return { success: true };
    } catch (error) {
      console.error("[Speech] 导出数据失败:", error);
      throw error;
    }
  });

  /**
   * 导入语音数据
   */
  ipcMain.handle("speech:importData", async () => {
    try {
      const VoiceTraining = require("./voice-training");
      const training = new VoiceTraining();
      await training.initialize("default-user");
      await training.importProfile();
      return { success: true };
    } catch (error) {
      console.error("[Speech] 导入数据失败:", error);
      throw error;
    }
  });

  /**
   * 重置语音数据
   */
  ipcMain.handle("speech:resetData", async () => {
    try {
      const VoiceTraining = require("./voice-training");
      const training = new VoiceTraining();
      await training.initialize("default-user");
      await training.resetProfile();
      return { success: true };
    } catch (error) {
      console.error("[Speech] 重置数据失败:", error);
      throw error;
    }
  });

  console.log("[Speech IPC] ✓ 44 handlers registered");
  console.log("[Speech IPC] - 2 file transcription handlers");
  console.log("[Speech IPC] - 1 file selection handler");
  console.log("[Speech IPC] - 4 configuration handlers");
  console.log("[Speech IPC] - 2 history handlers");
  console.log("[Speech IPC] - 5 audio file management handlers");
  console.log("[Speech IPC] - 5 audio processing handlers");
  console.log("[Speech IPC] - 3 subtitle generation handlers");
  console.log("[Speech IPC] - 7 realtime recording handlers");
  console.log("[Speech IPC] - 3 command recognition handlers");
  console.log("[Speech IPC] - 2 cache management handlers");
}

module.exports = {
  registerSpeechIPC,
};
