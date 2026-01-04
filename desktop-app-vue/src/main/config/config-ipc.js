/**
 * 配置 IPC 处理器
 * 负责处理应用配置相关的前后端通信
 *
 * @module config-ipc
 * @description 提供应用配置的读取和设置 IPC 接口
 */

const { ipcMain } = require('electron');

// 防止重复注册的标志
let isRegistered = false;

/**
 * 注册所有配置 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.appConfig - 应用配置管理器实例
 */
function registerConfigIPC({ appConfig }) {
  if (isRegistered) {
    console.log('[Config IPC] Handlers already registered, skipping...');
    return;
  }

  console.log('[Config IPC] Registering Config IPC handlers...');

  /**
   * 获取配置项
   * Channel: 'config:get'
   *
   * @param {string} key - 配置键（支持点分隔符，如 'app.theme'）
   * @param {any} defaultValue - 默认值（可选）
   * @returns {Promise<any>} 配置值
   */
  ipcMain.handle('config:get', async (_event, key, defaultValue = null) => {
    try {
      if (!appConfig) {
        console.warn('[Config IPC] AppConfig not initialized, returning default value');
        return defaultValue;
      }

      const value = appConfig.get(key, defaultValue);
      return value;
    } catch (error) {
      console.error('[Config IPC] 获取配置失败:', error);
      return defaultValue;
    }
  });

  /**
   * 设置配置项
   * Channel: 'config:set'
   *
   * @param {string} key - 配置键
   * @param {any} value - 配置值
   * @returns {Promise<Object>} { success: boolean }
   */
  ipcMain.handle('config:set', async (_event, key, value) => {
    try {
      if (!appConfig) {
        throw new Error('AppConfig未初始化');
      }

      appConfig.set(key, value);
      return { success: true };
    } catch (error) {
      console.error('[Config IPC] 设置配置失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 获取全部配置
   * Channel: 'config:get-all'
   *
   * @returns {Promise<Object>} 全部配置对象
   */
  ipcMain.handle('config:get-all', async () => {
    try {
      if (!appConfig) {
        console.warn('[Config IPC] AppConfig not initialized, returning empty config');
        return {};
      }

      const allConfig = appConfig.getAll();

      // 🔥 从llm-config.json加载LLM配置并合并
      try {
        const { getLLMConfig } = require('../llm/llm-config');
        const llmConfig = getLLMConfig();
        const llmData = llmConfig.getAll();

        console.log('[Config IPC] 从llm-config.json加载LLM配置:', {
          provider: llmData.provider,
          volcengineModel: llmData.volcengine?.model
        });

        // 映射LLM配置到前端格式
        const mappedLLMConfig = {
          provider: llmData.provider,
          priority: llmData.priority || [],
          autoSelect: llmData.autoSelect,
          autoFallback: llmData.autoFallback,
          selectionStrategy: llmData.selectionStrategy,

          // Ollama
          ollamaHost: llmData.ollama?.url || llmData.ollama?.host || '',
          ollamaModel: llmData.ollama?.model || '',
          ollamaEmbeddingModel: llmData.ollama?.embeddingModel || '',

          // OpenAI
          openaiApiKey: llmData.openai?.apiKey || '',
          openaiBaseUrl: llmData.openai?.baseURL || '',
          openaiModel: llmData.openai?.model || '',
          openaiEmbeddingModel: llmData.openai?.embeddingModel || '',

          // Anthropic
          anthropicApiKey: llmData.anthropic?.apiKey || '',
          anthropicBaseUrl: llmData.anthropic?.baseURL || '',
          anthropicModel: llmData.anthropic?.model || '',
          anthropicEmbeddingModel: llmData.anthropic?.embeddingModel || '',

          // DeepSeek
          deepseekApiKey: llmData.deepseek?.apiKey || '',
          deepseekModel: llmData.deepseek?.model || '',
          deepseekEmbeddingModel: llmData.deepseek?.embeddingModel || '',

          // Volcengine
          volcengineApiKey: llmData.volcengine?.apiKey || '',
          volcengineModel: llmData.volcengine?.model || '',
          volcengineEmbeddingModel: llmData.volcengine?.embeddingModel || '',

          // Dashscope
          dashscopeApiKey: llmData.dashscope?.apiKey || '',
          dashscopeModel: llmData.dashscope?.model || '',
          dashscopeEmbeddingModel: llmData.dashscope?.embeddingModel || '',

          // Zhipu
          zhipuApiKey: llmData.zhipu?.apiKey || '',
          zhipuModel: llmData.zhipu?.model || '',
          zhipuEmbeddingModel: llmData.zhipu?.embeddingModel || '',
        };

        // 合并LLM配置
        allConfig.llm = { ...allConfig.llm, ...mappedLLMConfig };

        console.log('[Config IPC] LLM配置已合并到返回数据');
      } catch (llmError) {
        console.error('[Config IPC] 加载LLM配置失败:', llmError);
        // 即使失败也继续返回其他配置
      }

      return allConfig;
    } catch (error) {
      console.error('[Config IPC] 获取全部配置失败:', error);
      return {};
    }
  });

  /**
   * 更新配置（批量设置）
   * Channel: 'config:update'
   *
   * @param {Object} config - 配置对象（可包含多个键值对）
   * @returns {Promise<Object>} { success: boolean }
   */
  ipcMain.handle('config:update', async (_event, config) => {
    try {
      if (!appConfig) {
        throw new Error('AppConfig未初始化');
      }

      // 批量更新配置
      if (config && typeof config === 'object') {
        for (const [key, value] of Object.entries(config)) {
          appConfig.set(key, value);
        }
      }

      // 🔥 同步LLM配置到专用的llm-config.json文件
      if (config.llm && typeof config.llm === 'object') {
        try {
          const { getLLMConfig } = require('../llm/llm-config');
          const llmConfig = getLLMConfig();

          console.log('[Config IPC] 检测到LLM配置更新，同步到llm-config.json');

          // 更新LLM配置
          if (config.llm.provider) {
            llmConfig.setProvider(config.llm.provider);
          }

          // 更新各提供商的配置
          const providers = ['ollama', 'openai', 'anthropic', 'deepseek', 'volcengine', 'dashscope', 'zhipu'];
          providers.forEach(provider => {
            if (config.llm[`${provider}ApiKey`] !== undefined ||
                config.llm[`${provider}Model`] !== undefined ||
                config.llm[`${provider}BaseUrl`] !== undefined ||
                config.llm[`${provider}EmbeddingModel`] !== undefined) {

              const providerConfig = {};

              // 映射配置键名
              if (config.llm[`${provider}ApiKey`] !== undefined) {
                providerConfig.apiKey = config.llm[`${provider}ApiKey`];
              }
              if (config.llm[`${provider}Model`] !== undefined) {
                providerConfig.model = config.llm[`${provider}Model`];
              }
              if (config.llm[`${provider}BaseUrl`] !== undefined) {
                providerConfig.baseURL = config.llm[`${provider}BaseUrl`];
              }
              if (config.llm[`${provider}EmbeddingModel`] !== undefined) {
                providerConfig.embeddingModel = config.llm[`${provider}EmbeddingModel`];
              }

              // Ollama 特殊处理
              if (provider === 'ollama' && config.llm.ollamaHost) {
                providerConfig.url = config.llm.ollamaHost;
              }

              llmConfig.setProviderConfig(provider, providerConfig);
              console.log(`[Config IPC] 已更新 ${provider} 配置:`, providerConfig);
            }
          });

          // 更新选项
          if (config.llm.priority) {
            llmConfig.set('priority', config.llm.priority);
          }
          if (config.llm.autoSelect !== undefined) {
            llmConfig.set('autoSelect', config.llm.autoSelect);
          }
          if (config.llm.autoFallback !== undefined) {
            llmConfig.set('autoFallback', config.llm.autoFallback);
          }
          if (config.llm.selectionStrategy) {
            llmConfig.set('selectionStrategy', config.llm.selectionStrategy);
          }

          console.log('[Config IPC] LLM配置已同步到llm-config.json');
        } catch (llmError) {
          console.error('[Config IPC] 同步LLM配置失败:', llmError);
          // 不抛出错误，允许通用配置继续保存
        }
      }

      return { success: true };
    } catch (error) {
      console.error('[Config IPC] 更新配置失败:', error);
      return { success: false, error: error.message };
    }
  });

  /**
   * 重置配置为默认值
   * Channel: 'config:reset'
   *
   * @returns {Promise<Object>} { success: boolean }
   */
  ipcMain.handle('config:reset', async () => {
    try {
      if (!appConfig) {
        throw new Error('AppConfig未初始化');
      }

      appConfig.reset();
      return { success: true };
    } catch (error) {
      console.error('[Config IPC] 重置配置失败:', error);
      return { success: false, error: error.message };
    }
  });

  console.log('[Config IPC] Registered 5 config: handlers');
  console.log('[Config IPC] - config:get');
  console.log('[Config IPC] - config:set');
  console.log('[Config IPC] - config:get-all');
  console.log('[Config IPC] - config:update');
  console.log('[Config IPC] - config:reset');

  isRegistered = true;
  console.log('[Config IPC] ✓ All handlers registered successfully');
}

module.exports = { registerConfigIPC };
