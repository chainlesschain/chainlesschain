<template>
  <div class="volcengine-tools-config">
    <a-card
      title="火山引擎工具调用配置"
      :bordered="false"
    >
      <!-- API 配置状态 -->
      <a-alert
        v-if="!configStatus.hasApiKey"
        message="API Key 未配置"
        description="请先在设置中配置火山引擎 API Key"
        type="warning"
        show-icon
        style="margin-bottom: 16px"
      />

      <!-- 模型智能选择 -->
      <a-card
        type="inner"
        title="智能模型选择"
        style="margin-bottom: 16px"
      >
        <a-form layout="vertical">
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="场景类型">
                <a-select
                  v-model:value="scenarioForm.type"
                  @change="onScenarioChange"
                >
                  <a-select-option value="chat">
                    AI对话
                  </a-select-option>
                  <a-select-option value="image">
                    图像理解
                  </a-select-option>
                  <a-select-option value="video">
                    视频生成
                  </a-select-option>
                  <a-select-option value="embedding">
                    知识库向量化
                  </a-select-option>
                  <a-select-option value="code">
                    代码生成
                  </a-select-option>
                </a-select>
              </a-form-item>
            </a-col>

            <a-col :span="12">
              <a-form-item label="预算等级">
                <a-select v-model:value="scenarioForm.userBudget">
                  <a-select-option value="low">
                    低成本
                  </a-select-option>
                  <a-select-option value="medium">
                    中等
                  </a-select-option>
                  <a-select-option value="high">
                    高质量
                  </a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
          </a-row>

          <a-form-item label="高级选项">
            <a-checkbox-group v-model:value="scenarioForm.advanced">
              <a-checkbox value="hasImage">
                包含图片
              </a-checkbox>
              <a-checkbox value="hasVideo">
                包含视频
              </a-checkbox>
              <a-checkbox value="needsThinking">
                需要深度思考
              </a-checkbox>
              <a-checkbox value="needsFunctionCalling">
                需要函数调用
              </a-checkbox>
              <a-checkbox value="needsWebSearch">
                需要联网搜索
              </a-checkbox>
            </a-checkbox-group>
          </a-form-item>

          <a-form-item>
            <a-button
              type="primary"
              :loading="selecting"
              @click="selectModel"
            >
              智能选择模型
            </a-button>
          </a-form-item>
        </a-form>

        <!-- 选择结果 -->
        <a-card
          v-if="selectedModel"
          type="inner"
          title="推荐模型"
          style="margin-top: 16px"
        >
          <a-descriptions
            :column="2"
            size="small"
          >
            <a-descriptions-item label="模型名称">
              <a-tag color="blue">
                {{ selectedModel.modelName }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="模型ID">
              {{ selectedModel.modelId }}
            </a-descriptions-item>
            <a-descriptions-item
              label="能力"
              :span="2"
            >
              <a-space>
                <a-tag
                  v-for="cap in selectedModel.capabilities"
                  :key="cap"
                  color="green"
                >
                  {{ cap }}
                </a-tag>
              </a-space>
            </a-descriptions-item>
            <a-descriptions-item
              label="价格"
              :span="2"
            >
              输入: ¥{{ selectedModel.pricing.input }}/百万tokens
              <span v-if="selectedModel.pricing.output">
                | 输出: ¥{{ selectedModel.pricing.output }}/百万tokens
              </span>
            </a-descriptions-item>
            <a-descriptions-item
              label="描述"
              :span="2"
            >
              {{ selectedModel.description }}
            </a-descriptions-item>
          </a-descriptions>
        </a-card>
      </a-card>

      <!-- 工具调用配置 -->
      <a-card
        type="inner"
        title="工具调用"
        style="margin-bottom: 16px"
      >
        <a-space
          direction="vertical"
          style="width: 100%"
        >
          <!-- 联网搜索 -->
          <a-card size="small">
            <template #title>
              <a-space>
                <GlobalOutlined />
                联网搜索 (Web Search)
              </a-space>
            </template>
            <a-switch
              v-model:checked="toolsEnabled.webSearch"
              checked-children="启用"
              un-checked-children="禁用"
            />
            <a-select
              v-if="toolsEnabled.webSearch"
              v-model:value="toolsConfig.webSearchMode"
              style="width: 200px; margin-left: 16px"
              size="small"
            >
              <a-select-option value="auto">
                自动搜索
              </a-select-option>
              <a-select-option value="always">
                总是搜索
              </a-select-option>
              <a-select-option value="never">
                从不搜索
              </a-select-option>
            </a-select>
          </a-card>

          <!-- 图像处理 -->
          <a-card size="small">
            <template #title>
              <a-space>
                <PictureOutlined />
                图像处理 (Image Process)
              </a-space>
            </template>
            <a-switch
              v-model:checked="toolsEnabled.imageProcess"
              checked-children="启用"
              un-checked-children="禁用"
            />
          </a-card>

          <!-- 知识库搜索 -->
          <a-card size="small">
            <template #title>
              <a-space>
                <DatabaseOutlined />
                知识库搜索 (Knowledge Search)
              </a-space>
            </template>
            <a-switch
              v-model:checked="toolsEnabled.knowledgeSearch"
              checked-children="启用"
              un-checked-children="禁用"
            />
            <a-input
              v-if="toolsEnabled.knowledgeSearch"
              v-model:value="toolsConfig.knowledgeBaseId"
              placeholder="知识库ID"
              style="width: 300px; margin-left: 16px"
              size="small"
            />
          </a-card>

          <!-- 函数调用 -->
          <a-card size="small">
            <template #title>
              <a-space>
                <ApiOutlined />
                函数调用 (Function Calling)
              </a-space>
            </template>
            <a-switch
              v-model:checked="toolsEnabled.functionCalling"
              checked-children="启用"
              un-checked-children="禁用"
            />
          </a-card>
        </a-space>
      </a-card>

      <!-- 测试工具 -->
      <a-card
        type="inner"
        title="测试工具"
      >
        <a-space>
          <a-button
            :loading="testing.webSearch"
            @click="testWebSearch"
          >
            测试联网搜索
          </a-button>
          <a-button
            :loading="testing.image"
            @click="testImageUnderstanding"
          >
            测试图像理解
          </a-button>
          <a-button @click="listAllModels">
            列出所有模型
          </a-button>
          <a-button @click="estimateCost">
            估算成本
          </a-button>
        </a-space>
      </a-card>

      <!-- 测试结果 -->
      <a-card
        v-if="testResult"
        type="inner"
        title="测试结果"
        style="margin-top: 16px"
      >
        <pre style="max-height: 400px; overflow-y: auto; background: #f5f5f5; padding: 12px; border-radius: 4px">{{ testResult }}</pre>
      </a-card>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, reactive, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import {
  GlobalOutlined,
  PictureOutlined,
  DatabaseOutlined,
  ApiOutlined,
} from '@ant-design/icons-vue';

const { ipcRenderer } = window.require('electron');

// 配置状态
const configStatus = ref({
  hasApiKey: false,
  baseURL: '',
  model: '',
});

// 场景表单
const scenarioForm = reactive({
  type: 'chat',
  userBudget: 'medium',
  advanced: [],
});

// 工具启用状态
const toolsEnabled = reactive({
  webSearch: false,
  imageProcess: false,
  knowledgeSearch: false,
  functionCalling: false,
});

// 工具配置
const toolsConfig = reactive({
  webSearchMode: 'auto',
  knowledgeBaseId: '',
});

// 状态
const selecting = ref(false);
const selectedModel = ref(null);
const testing = reactive({
  webSearch: false,
  image: false,
});
const testResult = ref(null);

// 检查配置状态
onMounted(async () => {
  try {
    const result = await ipcRenderer.invoke('volcengine:check-config');
    if (result.success) {
      configStatus.value = result.data;
    }
  } catch (error) {
    logger.error('检查配置失败:', error);
  }
});

// 场景变化
const onScenarioChange = () => {
  // 根据场景自动调整高级选项
  scenarioForm.advanced = [];
  switch (scenarioForm.type) {
    case 'image':
      scenarioForm.advanced = ['hasImage'];
      break;
    case 'video':
      scenarioForm.advanced = ['hasVideo'];
      break;
  }
};

// 智能选择模型
const selectModel = async () => {
  selecting.value = true;
  try {
    const scenario = {
      userBudget: scenarioForm.userBudget,
      hasImage: scenarioForm.advanced.includes('hasImage'),
      hasVideo: scenarioForm.advanced.includes('hasVideo'),
      needsThinking: scenarioForm.advanced.includes('needsThinking'),
      needsFunctionCalling: scenarioForm.advanced.includes('needsFunctionCalling'),
      needsWebSearch: scenarioForm.advanced.includes('needsWebSearch'),
    };

    if (scenarioForm.type === 'image') {
      scenario.needsImageGeneration = true;
    } else if (scenarioForm.type === 'video') {
      scenario.needsVideoGeneration = true;
    } else if (scenarioForm.type === 'embedding') {
      scenario.needsEmbedding = true;
    }

    const result = await ipcRenderer.invoke('volcengine:select-model', { scenario });

    if (result.success) {
      selectedModel.value = result.data;
      message.success('模型选择成功');
    } else {
      message.error(`选择失败: ${result.error}`);
    }
  } catch (error) {
    message.error(`选择出错: ${error.message}`);
  } finally {
    selecting.value = false;
  }
};

// 测试联网搜索
const testWebSearch = async () => {
  testing.webSearch = true;
  testResult.value = null;

  try {
    const messages = [
      { role: 'user', content: '2026年春节是哪一天？' }
    ];

    const result = await ipcRenderer.invoke('volcengine:chat-with-web-search', {
      messages,
      options: { searchMode: 'always' }
    });

    if (result.success) {
      testResult.value = JSON.stringify(result.data, null, 2);
      message.success('联网搜索测试成功');
    } else {
      message.error(`测试失败: ${result.error}`);
    }
  } catch (error) {
    message.error(`测试出错: ${error.message}`);
  } finally {
    testing.webSearch = false;
  }
};

// 测试图像理解
const testImageUnderstanding = async () => {
  testing.image = true;
  testResult.value = null;

  try {
    const result = await ipcRenderer.invoke('volcengine:understand-image', {
      prompt: '请描述这张图片的内容',
      imageUrl: 'https://example.com/image.jpg',
      options: { userBudget: 'medium' }
    });

    if (result.success) {
      testResult.value = JSON.stringify(result.data, null, 2);
      message.success('图像理解测试成功');
    } else {
      message.error(`测试失败: ${result.error}`);
    }
  } catch (error) {
    message.error(`测试出错: ${error.message}`);
  } finally {
    testing.image = false;
  }
};

// 列出所有模型
const listAllModels = async () => {
  try {
    const result = await ipcRenderer.invoke('volcengine:list-models', {
      filters: { recommended: true }
    });

    if (result.success) {
      testResult.value = `推荐模型列表 (共${result.data.length}个):\n\n` +
        result.data.map(m =>
          `${m.name} (${m.id})\n  类型: ${m.type}\n  能力: ${m.capabilities.join(', ')}\n  价格: ¥${m.pricing.input}/百万tokens`
        ).join('\n\n');
      message.success('模型列表获取成功');
    } else {
      message.error(`获取失败: ${result.error}`);
    }
  } catch (error) {
    message.error(`获取出错: ${error.message}`);
  }
};

// 估算成本
const estimateCost = async () => {
  if (!selectedModel.value) {
    message.warning('请先选择一个模型');
    return;
  }

  try {
    const result = await ipcRenderer.invoke('volcengine:estimate-cost', {
      modelId: selectedModel.value.modelId,
      inputTokens: 100000,  // 100K
      outputTokens: 30000,  // 30K
      imageCount: 5,
    });

    if (result.success) {
      testResult.value = `成本估算:\n\n` +
        `模型: ${selectedModel.value.modelName}\n` +
        `输入: 100,000 tokens\n` +
        `输出: 30,000 tokens\n` +
        `图片: 5 张\n\n` +
        `预估成本: ${result.data.formatted}`;
      message.success('成本估算完成');
    } else {
      message.error(`估算失败: ${result.error}`);
    }
  } catch (error) {
    message.error(`估算出错: ${error.message}`);
  }
};
</script>

<style scoped>
.volcengine-tools-config {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}
</style>
