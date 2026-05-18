<template>
  <a-card title="LLM 服务配置">
    <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
      <a-form-item label="服务提供商">
        <a-select v-model:value="config.llm.provider" style="width: 100%">
          <a-select-option value="ollama"> Ollama（本地） </a-select-option>
          <a-select-option value="openai"> OpenAI </a-select-option>
          <a-select-option value="anthropic">
            Claude (Anthropic)
          </a-select-option>
          <a-select-option value="volcengine">
            火山引擎（豆包）
          </a-select-option>
          <a-select-option value="dashscope"> 阿里通义千问 </a-select-option>
          <a-select-option value="zhipu"> 智谱 AI </a-select-option>
          <a-select-option value="deepseek"> DeepSeek </a-select-option>
        </a-select>
      </a-form-item>

      <a-divider>智能选择与备份</a-divider>

      <a-form-item label="AI 自主选择">
        <a-switch v-model:checked="config.llm.autoSelect" />
        <span style="margin-left: 8px"> AI 根据任务特点自动选择最优 LLM </span>
      </a-form-item>

      <a-form-item v-if="config.llm.autoSelect" label="选择策略">
        <a-select
          v-model:value="config.llm.selectionStrategy"
          style="width: 100%"
        >
          <a-select-option value="cost"> 成本优先 </a-select-option>
          <a-select-option value="speed"> 速度优先 </a-select-option>
          <a-select-option value="quality"> 质量优先 </a-select-option>
          <a-select-option value="balanced"> 平衡模式（推荐） </a-select-option>
        </a-select>
      </a-form-item>

      <a-form-item label="自动切换备用">
        <a-switch v-model:checked="config.llm.autoFallback" />
        <span style="margin-left: 8px"> 当前 LLM 不可用时自动切换到备用 </span>
      </a-form-item>

      <a-form-item label="优先级顺序">
        <a-select
          v-model:value="config.llm.priority"
          mode="tags"
          style="width: 100%"
          placeholder="拖动调整优先级顺序"
          :options="llmProviderOptions"
        />
        <template #extra>
          <span style="color: #999">
            从左到右依次尝试，第一个可用的 LLM 将被使用
          </span>
        </template>
      </a-form-item>

      <!-- Ollama 配置 -->
      <a-divider v-if="config.llm.provider === 'ollama'">
        Ollama 配置
      </a-divider>
      <template v-if="config.llm.provider === 'ollama'">
        <a-form-item label="服务地址">
          <a-input
            v-model:value="config.llm.ollamaHost"
            placeholder="http://localhost:11434"
          />
        </a-form-item>
        <a-form-item label="对话模型">
          <a-input
            v-model:value="config.llm.ollamaModel"
            placeholder="qwen2:7b"
          />
        </a-form-item>
        <a-form-item label="嵌入模型">
          <a-input
            v-model:value="config.llm.ollamaEmbeddingModel"
            placeholder="nomic-embed-text"
          />
          <template #extra>
            <span style="color: #999">用于生成文本嵌入向量的模型</span>
          </template>
        </a-form-item>
      </template>

      <!-- OpenAI 配置 -->
      <a-divider v-if="config.llm.provider === 'openai'">
        OpenAI 配置
      </a-divider>
      <template v-if="config.llm.provider === 'openai'">
        <a-form-item label="API Key">
          <a-input-password
            v-model:value="config.llm.openaiApiKey"
            placeholder="sk-..."
          />
        </a-form-item>
        <a-form-item label="API 地址">
          <a-input
            v-model:value="config.llm.openaiBaseUrl"
            placeholder="https://api.openai.com/v1"
          />
        </a-form-item>
        <a-form-item label="对话模型">
          <a-input
            v-model:value="config.llm.openaiModel"
            placeholder="gpt-3.5-turbo"
          />
        </a-form-item>
        <a-form-item label="嵌入模型">
          <a-input
            v-model:value="config.llm.openaiEmbeddingModel"
            placeholder="text-embedding-3-small"
          />
          <template #extra>
            <span style="color: #999">
              推荐: text-embedding-3-small 或 text-embedding-3-large
            </span>
          </template>
        </a-form-item>
      </template>

      <!-- Claude (Anthropic) 配置 -->
      <a-divider v-if="config.llm.provider === 'anthropic'">
        Claude (Anthropic) 配置
      </a-divider>
      <template v-if="config.llm.provider === 'anthropic'">
        <a-form-item label="API Key">
          <a-input-password
            v-model:value="config.llm.anthropicApiKey"
            placeholder="sk-ant-..."
          />
        </a-form-item>
        <a-form-item label="API 地址">
          <a-input
            v-model:value="config.llm.anthropicBaseUrl"
            placeholder="https://api.anthropic.com"
          />
        </a-form-item>
        <a-form-item label="对话模型">
          <a-input
            v-model:value="config.llm.anthropicModel"
            placeholder="claude-3-5-sonnet-20241022"
          />
        </a-form-item>
        <a-form-item label="嵌入模型">
          <a-input
            v-model:value="config.llm.anthropicEmbeddingModel"
            placeholder="需使用其他服务（如Voyage AI）"
            disabled
          />
          <template #extra>
            <span style="color: #999">
              Claude暂无嵌入模型API，建议使用OpenAI或其他服务
            </span>
          </template>
        </a-form-item>
      </template>

      <!-- 火山引擎配置 -->
      <a-divider v-if="config.llm.provider === 'volcengine'">
        火山引擎（豆包）配置
      </a-divider>
      <template v-if="config.llm.provider === 'volcengine'">
        <a-form-item label="API Key">
          <a-input-password v-model:value="config.llm.volcengineApiKey" />
        </a-form-item>
        <a-form-item label="对话模型">
          <a-select
            v-model:value="config.llm.volcengineModel"
            placeholder="选择模型版本"
            :options="volcengineModelOptions"
            show-search
            :filter-option="filterOption"
          />
          <template #extra>
            <span style="color: #999">
              推荐使用最新版本：doubao-seed-1-6-251015（注意：模型名称使用下划线，不是点）
            </span>
          </template>
        </a-form-item>
        <a-form-item label="嵌入模型">
          <a-select
            v-model:value="config.llm.volcengineEmbeddingModel"
            placeholder="选择嵌入模型"
            :options="volcengineEmbeddingModelOptions"
            show-search
            :filter-option="filterOption"
          />
          <template #extra>
            <span style="color: #999">
              用于文本向量化，推荐：doubao-embedding-text-240715
            </span>
          </template>
        </a-form-item>
      </template>

      <!-- 阿里通义千问配置 -->
      <a-divider v-if="config.llm.provider === 'dashscope'">
        阿里通义千问配置
      </a-divider>
      <template v-if="config.llm.provider === 'dashscope'">
        <a-form-item label="API Key">
          <a-input-password v-model:value="config.llm.dashscopeApiKey" />
        </a-form-item>
        <a-form-item label="对话模型">
          <a-select
            v-model:value="config.llm.dashscopeModel"
            style="width: 100%"
          >
            <a-select-option value="qwen-turbo">
              Qwen Turbo（推荐）
            </a-select-option>
            <a-select-option value="qwen-plus"> Qwen Plus </a-select-option>
            <a-select-option value="qwen-max"> Qwen Max </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="嵌入模型">
          <a-input
            v-model:value="config.llm.dashscopeEmbeddingModel"
            placeholder="text-embedding-v2"
          />
          <template #extra>
            <span style="color: #999">阿里云灵积提供的嵌入模型</span>
          </template>
        </a-form-item>
      </template>

      <!-- 智谱 AI 配置 -->
      <a-divider v-if="config.llm.provider === 'zhipu'">
        智谱 AI 配置
      </a-divider>
      <template v-if="config.llm.provider === 'zhipu'">
        <a-form-item label="API Key">
          <a-input-password v-model:value="config.llm.zhipuApiKey" />
        </a-form-item>
        <a-form-item label="对话模型">
          <a-input v-model:value="config.llm.zhipuModel" placeholder="glm-4" />
        </a-form-item>
        <a-form-item label="嵌入模型">
          <a-input
            v-model:value="config.llm.zhipuEmbeddingModel"
            placeholder="embedding-2"
          />
          <template #extra>
            <span style="color: #999">智谱AI提供的文本嵌入模型</span>
          </template>
        </a-form-item>
      </template>

      <!-- DeepSeek 配置 -->
      <a-divider v-if="config.llm.provider === 'deepseek'">
        DeepSeek 配置
      </a-divider>
      <template v-if="config.llm.provider === 'deepseek'">
        <a-form-item label="API Key">
          <a-input-password v-model:value="config.llm.deepseekApiKey" />
        </a-form-item>
        <a-form-item label="对话模型">
          <a-input
            v-model:value="config.llm.deepseekModel"
            placeholder="deepseek-chat"
          />
        </a-form-item>
        <a-form-item label="嵌入模型">
          <a-input
            v-model:value="config.llm.deepseekEmbeddingModel"
            placeholder=""
          />
          <template #extra>
            <span style="color: #999">DeepSeek嵌入模型（如支持）</span>
          </template>
        </a-form-item>
      </template>

      <!-- 测试连接按钮 -->
      <a-divider />
      <a-form-item label="功能测试" :wrapper-col="{ span: 18, offset: 6 }">
        <a-space direction="vertical" style="width: 100%">
          <!-- 测试对话功能 -->
          <div>
            <a-space>
              <a-button
                type="primary"
                :loading="testingConnection"
                @click="testLLMConnection"
              >
                测试对话
              </a-button>
              <a-tag
                v-if="llmTestResult"
                :color="llmTestResult.success ? 'success' : 'error'"
              >
                {{ llmTestResult.message }}
              </a-tag>
            </a-space>
          </div>
          <!-- 测试嵌入功能 -->
          <div>
            <a-space>
              <a-button :loading="testingEmbedding" @click="testEmbedding">
                测试嵌入
              </a-button>
              <a-tag
                v-if="embeddingTestResult"
                :color="embeddingTestResult.success ? 'success' : 'error'"
              >
                {{ embeddingTestResult.message }}
              </a-tag>
            </a-space>
          </div>
        </a-space>
      </a-form-item>
    </a-form>
  </a-card>
</template>

<script setup>
import { logger } from "@/utils/logger";
import { ref } from "vue";
import { message } from "ant-design-vue";

const config = defineModel("config", { type: Object, required: true });

const testingConnection = ref(false);
const llmTestResult = ref(null);
const testingEmbedding = ref(false);
const embeddingTestResult = ref(null);

const llmProviderOptions = [
  { label: "Ollama（本地）", value: "ollama" },
  { label: "OpenAI", value: "openai" },
  { label: "Claude (Anthropic)", value: "anthropic" },
  { label: "火山引擎（豆包）", value: "volcengine" },
  { label: "阿里通义千问", value: "dashscope" },
  { label: "智谱 AI", value: "zhipu" },
  { label: "DeepSeek", value: "deepseek" },
];

const volcengineModelOptions = [
  {
    label: "doubao-seed-1-6-251015（推荐 - 最新，支持reasoning_effort）",
    value: "doubao-seed-1-6-251015",
  },
  {
    label: "doubao-seed-1-6-250615（支持thinking控制）",
    value: "doubao-seed-1-6-250615",
  },
  {
    label: "doubao-1-5-pro-32k-250115（高性能32k）",
    value: "doubao-1-5-pro-32k-250115",
  },
  {
    label: "doubao-1-5-lite-250115（轻量版）",
    value: "doubao-1-5-lite-250115",
  },
  {
    label: "doubao-1-5-vision-pro-250115（视觉模型）",
    value: "doubao-1-5-vision-pro-250115",
  },
  {
    label: "doubao-pro-32k-241215（高性能32k）",
    value: "doubao-pro-32k-241215",
  },
  { label: "doubao-pro-32k-240828", value: "doubao-pro-32k-240828" },
  { label: "doubao-lite-32k（轻量32k）", value: "doubao-lite-32k" },
];

const volcengineEmbeddingModelOptions = [
  {
    label: "doubao-embedding-text-240715（推荐 - 最新，2560维）",
    value: "doubao-embedding-text-240715",
  },
  {
    label: "doubao-embedding-text-240515（2048维）",
    value: "doubao-embedding-text-240515",
  },
  {
    label: "doubao-embedding-large（大模型）",
    value: "doubao-embedding-large",
  },
  {
    label: "doubao-embedding-vision（视觉嵌入）",
    value: "doubao-embedding-vision",
  },
];

const filterOption = (input, option) => {
  return (
    option.value.toLowerCase().includes(input.toLowerCase()) ||
    option.label.toLowerCase().includes(input.toLowerCase())
  );
};

const testLLMConnection = async () => {
  testingConnection.value = true;
  llmTestResult.value = null;

  try {
    const provider = config.value.llm.provider;
    if (provider === "openai" && !config.value.llm.openaiApiKey) {
      throw new Error("请先输入 OpenAI API Key");
    }
    if (provider === "anthropic" && !config.value.llm.anthropicApiKey) {
      throw new Error("请先输入 Claude API Key");
    }
    if (provider === "volcengine" && !config.value.llm.volcengineApiKey) {
      throw new Error("请先输入火山引擎 API Key");
    }
    if (provider === "deepseek" && !config.value.llm.deepseekApiKey) {
      throw new Error("请先输入 DeepSeek API Key");
    }
    if (provider === "dashscope" && !config.value.llm.dashscopeApiKey) {
      throw new Error("请先输入阿里通义千问 API Key");
    }
    if (provider === "zhipu" && !config.value.llm.zhipuApiKey) {
      throw new Error("请先输入智谱 AI API Key");
    }

    const llmConfig = {
      provider: provider,
      options: {
        temperature: 0.7,
        timeout: 120000,
      },
    };

    switch (provider) {
      case "ollama":
        llmConfig.ollama = {
          url: config.value.llm.ollamaHost || "http://localhost:11434",
          model: config.value.llm.ollamaModel || "llama2",
        };
        break;
      case "openai":
        llmConfig.openai = {
          apiKey: config.value.llm.openaiApiKey,
          baseURL:
            config.value.llm.openaiBaseUrl || "https://api.openai.com/v1",
          model: config.value.llm.openaiModel || "gpt-3.5-turbo",
        };
        break;
      case "anthropic":
        llmConfig.anthropic = {
          apiKey: config.value.llm.anthropicApiKey,
          baseURL:
            config.value.llm.anthropicBaseUrl || "https://api.anthropic.com",
          model:
            config.value.llm.anthropicModel || "claude-3-5-sonnet-20241022",
          version: "2023-06-01",
        };
        break;
      case "volcengine":
        llmConfig.volcengine = {
          apiKey: config.value.llm.volcengineApiKey,
          baseURL: "https://ark.cn-beijing.volces.com/api/v3",
          model: config.value.llm.volcengineModel || "doubao-pro-4k",
        };
        break;
      case "deepseek":
        llmConfig.deepseek = {
          apiKey: config.value.llm.deepseekApiKey,
          baseURL: "https://api.deepseek.com/v1",
          model: config.value.llm.deepseekModel || "deepseek-chat",
        };
        break;
      case "dashscope":
        llmConfig.dashscope = {
          apiKey: config.value.llm.dashscopeApiKey,
          model: config.value.llm.dashscopeModel || "qwen-turbo",
        };
        break;
      case "zhipu":
        llmConfig.zhipu = {
          apiKey: config.value.llm.zhipuApiKey,
          model: config.value.llm.zhipuModel || "glm-4",
        };
        break;
    }

    await window.electronAPI.llm.setConfig(llmConfig);
    const result = await window.electronAPI.llm.checkStatus();

    if (result.available) {
      llmTestResult.value = {
        success: true,
        message: "连接成功！服务正常运行",
      };
      message.success("LLM 服务连接成功");
    } else {
      llmTestResult.value = {
        success: false,
        message: "连接失败: " + (result.error || "未知错误"),
      };
      message.error("LLM 服务连接失败");
    }
  } catch (error) {
    logger.error("测试LLM连接失败:", error);
    llmTestResult.value = {
      success: false,
      message: "测试失败: " + error.message,
    };
    message.error("测试失败：" + error.message);
  } finally {
    testingConnection.value = false;
  }
};

const testEmbedding = async () => {
  testingEmbedding.value = true;
  embeddingTestResult.value = null;

  try {
    const provider = config.value.llm.provider;
    if (provider === "openai" && !config.value.llm.openaiApiKey) {
      throw new Error("请先输入 OpenAI API Key");
    }
    if (provider === "volcengine" && !config.value.llm.volcengineApiKey) {
      throw new Error("请先输入火山引擎 API Key");
    }
    if (provider === "deepseek" && !config.value.llm.deepseekApiKey) {
      throw new Error("请先输入 DeepSeek API Key");
    }
    if (provider === "dashscope" && !config.value.llm.dashscopeApiKey) {
      throw new Error("请先输入阿里通义千问 API Key");
    }
    if (provider === "zhipu" && !config.value.llm.zhipuApiKey) {
      throw new Error("请先输入智谱 AI API Key");
    }

    const llmConfig = {
      provider: provider,
      options: {
        timeout: 120000,
      },
    };

    switch (provider) {
      case "ollama":
        llmConfig.ollama = {
          url: config.value.llm.ollamaHost || "http://localhost:11434",
          model: config.value.llm.ollamaModel || "llama2",
          embeddingModel:
            config.value.llm.ollamaEmbeddingModel || "nomic-embed-text",
        };
        break;
      case "openai":
        llmConfig.openai = {
          apiKey: config.value.llm.openaiApiKey,
          baseURL:
            config.value.llm.openaiBaseUrl || "https://api.openai.com/v1",
          model: config.value.llm.openaiModel || "gpt-3.5-turbo",
          embeddingModel:
            config.value.llm.openaiEmbeddingModel || "text-embedding-3-small",
        };
        break;
      case "volcengine":
        llmConfig.volcengine = {
          apiKey: config.value.llm.volcengineApiKey,
          baseURL: "https://ark.cn-beijing.volces.com/api/v3",
          model: config.value.llm.volcengineModel || "doubao-pro-4k",
          embeddingModel:
            config.value.llm.volcengineEmbeddingModel || "doubao-embedding",
        };
        break;
      case "deepseek":
        llmConfig.deepseek = {
          apiKey: config.value.llm.deepseekApiKey,
          baseURL: "https://api.deepseek.com/v1",
          model: config.value.llm.deepseekModel || "deepseek-chat",
          embeddingModel: config.value.llm.deepseekEmbeddingModel || "",
        };
        break;
      case "dashscope":
        llmConfig.dashscope = {
          apiKey: config.value.llm.dashscopeApiKey,
          model: config.value.llm.dashscopeModel || "qwen-turbo",
          embeddingModel:
            config.value.llm.dashscopeEmbeddingModel || "text-embedding-v2",
        };
        break;
      case "zhipu":
        llmConfig.zhipu = {
          apiKey: config.value.llm.zhipuApiKey,
          model: config.value.llm.zhipuModel || "glm-4",
          embeddingModel: config.value.llm.zhipuEmbeddingModel || "embedding-2",
        };
        break;
      default:
        throw new Error(`提供商 ${provider} 可能不支持嵌入模型`);
    }

    await window.electronAPI.llm.setConfig(llmConfig);

    const testText = "这是一段用于测试嵌入模型的中文文本。";
    const result = await window.electronAPI.llm.embeddings(testText);

    if (result && Array.isArray(result) && result.length > 0) {
      embeddingTestResult.value = {
        success: true,
        message: `嵌入生成成功！向量维度: ${result.length}`,
      };
      message.success(`嵌入模型测试成功，向量维度: ${result.length}`);
    } else {
      embeddingTestResult.value = {
        success: false,
        message: "嵌入生成失败: 返回结果为空",
      };
      message.error("嵌入模型测试失败");
    }
  } catch (error) {
    logger.error("测试嵌入模型失败:", error);
    embeddingTestResult.value = {
      success: false,
      message: "测试失败: " + error.message,
    };
    message.error("测试失败：" + error.message);
  } finally {
    testingEmbedding.value = false;
  }
};
</script>
