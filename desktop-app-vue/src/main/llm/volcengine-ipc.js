/**
 * 火山引擎工具调用 IPC 处理器
 *
 * 提供渲染进程与主进程之间的通信桥梁
 */

const { ipcMain: defaultIpcMain } = require("electron");
const { types: utilTypes } = require("node:util");
const { getLLMConfig } = require("./llm-config");
const { getModelSelector, TaskTypes } = require("./volcengine-models");
const { createVolcengineIpcPrivacy } = require("./volcengine-ipc-privacy");
const {
  createVolcengineIpcAuthorization,
} = require("./volcengine-ipc-authorization");
const {
  createVolcengineFunctionExecutor,
} = require("./volcengine-function-capability");
const {
  projectVolcengineKnowledgeSetupSuccess,
  projectVolcengineToolSuccess,
} = require("./volcengine-tool-success-projection");

const defaultPrivacy = createVolcengineIpcPrivacy();

const SAFE_MODEL_TYPES = new Set([
  "3d_generation",
  "embedding",
  "image_editing",
  "image_generation",
  "text",
  "video_generation",
  "vision",
  "vision_embedding",
]);
const SAFE_CAPABILITIES = new Set([
  "3d_generation",
  "code_generation",
  "deep_thinking",
  "embedding",
  "function_calling",
  "gui_agent",
  "image_editing",
  "image_generation",
  "text_generation",
  "translation",
  "video_generation",
  "video_understanding",
  "vision",
  "vision_embedding",
  "web_search",
]);
const SAFE_PRICE_FIELDS = new Set([
  "cache",
  "high",
  "imagePrice",
  "input",
  "output",
  "perModel",
  "perSecond",
  "standard",
]);
const SAFE_CONFIG_FIELDS = new Set([
  "apiKey",
  "baseURL",
  "embeddingModel",
  "model",
  "videoModel",
]);

function boundedString(value, field) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    /\p{Cc}/u.test(value)
  ) {
    throw new TypeError(`Invalid Volcengine ${field}`);
  }
  return value;
}

function safeNumber(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`Invalid Volcengine ${field}`);
  }
  return value;
}

function projectCapabilities(value) {
  if (!Array.isArray(value) || value.length > SAFE_CAPABILITIES.size) {
    throw new TypeError("Invalid Volcengine model capabilities");
  }
  return value.map((capability) => {
    if (!SAFE_CAPABILITIES.has(capability)) {
      throw new TypeError("Invalid Volcengine model capability");
    }
    return capability;
  });
}

function projectPricing(value) {
  if (
    !value ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid Volcengine model pricing");
  }
  const projected = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !SAFE_PRICE_FIELDS.has(key) ||
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable
    ) {
      throw new TypeError("Invalid Volcengine model pricing field");
    }
    projected[key] = safeNumber(descriptor.value, `pricing.${key}`);
  }
  return projected;
}

function projectSelectedModel(model) {
  return {
    modelId: boundedString(model?.id, "model id"),
    modelName: boundedString(model?.name, "model name"),
    capabilities: projectCapabilities(model?.capabilities),
    pricing: projectPricing(model?.pricing),
    description: boundedString(model?.description, "model description"),
  };
}

function projectCatalogModel(model) {
  if (!SAFE_MODEL_TYPES.has(model?.type)) {
    throw new TypeError("Invalid Volcengine model type");
  }
  return {
    id: boundedString(model.id, "model id"),
    name: boundedString(model.name, "model name"),
    type: model.type,
    capabilities: projectCapabilities(model.capabilities),
    pricing: projectPricing(model.pricing),
    recommended: model.recommended === true,
  };
}

function projectConfigUpdate(value) {
  if (
    !value ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError("Invalid Volcengine configuration");
  }
  const projected = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      !SAFE_CONFIG_FIELDS.has(key) ||
      !descriptor ||
      !Object.hasOwn(descriptor, "value") ||
      !descriptor.enumerable
    ) {
      throw new TypeError("Unsupported Volcengine configuration field");
    }
    if (descriptor.value === "") {
      projected[key] = "";
      continue;
    }
    projected[key] = boundedString(descriptor.value, `configuration ${key}`);
  }
  return projected;
}

/**
 * 获取或创建工具客户端
 */
function getToolsClient() {
  // Every caller in this module is a renderer-reachable, provider-owned
  // model or tool loop. It is not connected to the branded Desktop ingress,
  // so it cannot authenticate projection, evidence, budget, or a Run.
  // Keep the channels registered for an explicit compatibility error, but
  // never construct a client that could bypass LLMManager.
  const error = new Error(
    "Volcengine direct IPC requires a governed model ingress",
  );
  error.code = "CC_AGENT_EVOLUTION_INGRESS_FAILED";
  throw error;
}

/**
 * 注册所有 IPC 处理器
 */
function registerVolcengineIPC(dependencies = {}) {
  const ipcMain = dependencies.ipcMain || defaultIpcMain;
  const resolveConfig = dependencies.getLLMConfig || getLLMConfig;
  const resolveModelSelector =
    dependencies.getModelSelector || getModelSelector;
  const resolveToolsClient = dependencies.getToolsClient || getToolsClient;
  const privacy = dependencies.privacy || defaultPrivacy;
  const authorization =
    dependencies.authorization ||
    createVolcengineIpcAuthorization({
      getMainWindow: dependencies.getMainWindow,
      getCurrentIdentity: dependencies.getCurrentIdentity,
      authorizePurpose: dependencies.authorizePurpose,
    });
  const functionExecutionHost = dependencies.functionExecutionHost || null;
  const authorizedIpcMain = {
    handle(channel, handler) {
      const operation = channel.replace(/^volcengine:/u, "");
      ipcMain.handle(channel, async (event, ...args) => {
        let authorizationContext;
        try {
          authorizationContext = await authorization.authorize(
            event,
            operation,
          );
        } catch {
          return privacy.authorizationFailure(operation);
        }
        return handler(event, args[0], authorizationContext);
      });
    },
  };

  privacy.event("handlers-registering");

  // ========== 模型选择器 ==========

  /**
   * 智能选择模型（根据场景）
   */
  authorizedIpcMain.handle(
    "volcengine:select-model",
    async (event, { scenario }) => {
      try {
        const selector = resolveModelSelector();
        const model = selector.selectByScenario(scenario);

        return {
          success: true,
          data: projectSelectedModel(model),
        };
      } catch {
        return privacy.failure("select-model");
      }
    },
  );

  /**
   * 根据任务类型选择模型
   */
  authorizedIpcMain.handle(
    "volcengine:select-model-by-task",
    async (event, { taskType, options }) => {
      try {
        const selector = resolveModelSelector();
        const model = selector.selectModel(taskType, options);

        return {
          success: true,
          data: projectSelectedModel(model),
        };
      } catch {
        return privacy.failure("select-model-by-task");
      }
    },
  );

  /**
   * 估算成本
   */
  authorizedIpcMain.handle(
    "volcengine:estimate-cost",
    async (event, { modelId, inputTokens, outputTokens, imageCount }) => {
      try {
        const selector = resolveModelSelector();
        const cost = selector.estimateCost(
          modelId,
          inputTokens,
          outputTokens,
          imageCount,
        );
        const projectedCost = safeNumber(cost, "estimated cost");

        return {
          success: true,
          data: {
            cost: projectedCost,
            formatted: `¥${projectedCost.toFixed(4)}`,
          },
        };
      } catch {
        return privacy.failure("estimate-cost");
      }
    },
  );

  /**
   * 列出所有模型
   */
  authorizedIpcMain.handle(
    "volcengine:list-models",
    async (event, { filters }) => {
      try {
        const selector = resolveModelSelector();
        const models = selector.listModels(filters || {});

        return {
          success: true,
          data: models.map(projectCatalogModel),
        };
      } catch {
        return privacy.failure("list-models");
      }
    },
  );

  // ========== 联网搜索 ==========

  /**
   * 联网搜索对话
   */
  authorizedIpcMain.handle(
    "volcengine:chat-with-web-search",
    async (event, { messages, options }) => {
      try {
        const client = resolveToolsClient();
        const result = await client.chatWithWebSearch(messages, options || {});

        return {
          success: true,
          data: projectVolcengineToolSuccess(result),
        };
      } catch {
        return privacy.governanceFailure("chat-with-web-search");
      }
    },
  );

  // ========== 图像处理 ==========

  /**
   * 图像处理对话
   */
  authorizedIpcMain.handle(
    "volcengine:chat-with-image",
    async (event, { messages, options }) => {
      try {
        const client = resolveToolsClient();
        const result = await client.chatWithImageProcess(
          messages,
          options || {},
        );

        return {
          success: true,
          data: projectVolcengineToolSuccess(result),
        };
      } catch {
        return privacy.governanceFailure("chat-with-image");
      }
    },
  );

  /**
   * 图像理解（简化接口）
   */
  authorizedIpcMain.handle(
    "volcengine:understand-image",
    async (event, { prompt, imageUrl, options }) => {
      try {
        const client = resolveToolsClient();
        const result = await client.understandImage(
          prompt,
          imageUrl,
          options || {},
        );

        return {
          success: true,
          data: projectVolcengineToolSuccess(result),
        };
      } catch {
        return privacy.governanceFailure("understand-image");
      }
    },
  );

  // ========== 知识库搜索 ==========

  /**
   * 配置知识库（上传文档）
   */
  authorizedIpcMain.handle(
    "volcengine:setup-knowledge-base",
    async (event, { knowledgeBaseId, documents }) => {
      try {
        const client = resolveToolsClient();
        await client.setupKnowledgeBase(knowledgeBaseId, documents);

        return {
          success: true,
          data: projectVolcengineKnowledgeSetupSuccess(),
        };
      } catch {
        return privacy.governanceFailure("setup-knowledge-base");
      }
    },
  );

  /**
   * 知识库搜索对话
   */
  authorizedIpcMain.handle(
    "volcengine:chat-with-knowledge-base",
    async (event, { messages, knowledgeBaseId, options }) => {
      try {
        const client = resolveToolsClient();
        const result = await client.chatWithKnowledgeBase(
          messages,
          knowledgeBaseId,
          options || {},
        );

        return {
          success: true,
          data: projectVolcengineToolSuccess(result),
        };
      } catch {
        return privacy.governanceFailure("chat-with-knowledge-base");
      }
    },
  );

  // ========== 函数调用 ==========

  /**
   * Function Calling 对话
   */
  authorizedIpcMain.handle(
    "volcengine:chat-with-function-calling",
    async (event, { messages, functions, options }) => {
      try {
        const client = resolveToolsClient();
        const result = await client.chatWithFunctionCalling(
          messages,
          functions,
          options || {},
        );

        return {
          success: true,
          data: projectVolcengineToolSuccess(result),
        };
      } catch {
        return privacy.governanceFailure("chat-with-function-calling");
      }
    },
  );

  /**
   * 执行完整的 Function Calling 流程
   * 注意：functionExecutor 需要在主进程侧定义
   */
  authorizedIpcMain.handle(
    "volcengine:execute-function-calling",
    async (
      event,
      { messages, functions, executorType, options },
      authorizationContext,
    ) => {
      try {
        const capabilityExecutor = createVolcengineFunctionExecutor(
          functionExecutionHost,
          { authorization: authorizationContext, executorType },
        );
        const functionExecutor = Object.freeze({
          async execute(functionName, args) {
            privacy.event("function-execution-started");
            return capabilityExecutor.execute(functionName, args);
          },
        });
        const client = resolveToolsClient();

        const result = await client.executeFunctionCalling(
          messages,
          functions,
          functionExecutor,
          options || {},
        );

        return {
          success: true,
          data: projectVolcengineToolSuccess(result),
        };
      } catch {
        return privacy.governanceFailure("execute-function-calling");
      }
    },
  );

  // ========== MCP ==========

  /**
   * MCP 对话
   */
  authorizedIpcMain.handle(
    "volcengine:chat-with-mcp",
    async (event, { messages, mcpConfig, options }) => {
      try {
        const client = resolveToolsClient();
        const result = await client.chatWithMCP(
          messages,
          mcpConfig,
          options || {},
        );

        return {
          success: true,
          data: projectVolcengineToolSuccess(result),
        };
      } catch {
        return privacy.governanceFailure("chat-with-mcp");
      }
    },
  );

  // ========== 多工具混合调用 ==========

  /**
   * 多工具混合对话
   */
  authorizedIpcMain.handle(
    "volcengine:chat-with-multiple-tools",
    async (event, { messages, toolConfig, options }) => {
      try {
        const client = resolveToolsClient();
        const result = await client.chatWithMultipleTools(
          messages,
          toolConfig || {},
          options || {},
        );

        return {
          success: true,
          data: projectVolcengineToolSuccess(result),
        };
      } catch {
        return privacy.governanceFailure("chat-with-multiple-tools");
      }
    },
  );

  // ========== 配置管理 ==========

  /**
   * 检查配置状态
   */
  authorizedIpcMain.handle("volcengine:check-config", async () => {
    try {
      const config = resolveConfig().getProviderConfig("volcengine");

      return {
        success: true,
        data: {
          hasApiKey:
            typeof config?.apiKey === "string" && config.apiKey.length > 0,
        },
      };
    } catch {
      return privacy.failure("check-config");
    }
  });

  /**
   * 更新配置
   */
  authorizedIpcMain.handle(
    "volcengine:update-config",
    async (event, { config }) => {
      try {
        // 更新 LLM 配置
        const llmConfig = resolveConfig();
        llmConfig.setProviderConfig("volcengine", projectConfigUpdate(config));

        return {
          success: true,
          data: { updated: true },
        };
      } catch {
        return privacy.failure("update-config");
      }
    },
  );

  privacy.event("handlers-registered");
}

/**
 * 注销所有 IPC 处理器
 */
function unregisterVolcengineIPC(dependencies = {}) {
  const ipcMain = dependencies.ipcMain || defaultIpcMain;
  const privacy = dependencies.privacy || defaultPrivacy;
  privacy.event("handlers-unregistering");

  const channels = [
    "volcengine:select-model",
    "volcengine:select-model-by-task",
    "volcengine:estimate-cost",
    "volcengine:list-models",
    "volcengine:chat-with-web-search",
    "volcengine:chat-with-image",
    "volcengine:understand-image",
    "volcengine:setup-knowledge-base",
    "volcengine:chat-with-knowledge-base",
    "volcengine:chat-with-function-calling",
    "volcengine:execute-function-calling",
    "volcengine:chat-with-mcp",
    "volcengine:chat-with-multiple-tools",
    "volcengine:check-config",
    "volcengine:update-config",
  ];

  channels.forEach((channel) => {
    ipcMain.removeHandler(channel);
  });

  privacy.event("handlers-unregistered");
}

module.exports = {
  registerVolcengineIPC,
  unregisterVolcengineIPC,
  TaskTypes, // 导出供渲染进程使用
};
