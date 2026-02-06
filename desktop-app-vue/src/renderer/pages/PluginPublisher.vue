<template>
  <div class="plugin-publisher">
    <a-page-header
      title="发布插件"
      sub-title="将您的插件发布到ChainlessChain插件市场"
      @back="() => $router.back()"
    >
      <template #extra>
        <a-button @click="showDeveloperGuide">
          <QuestionCircleOutlined />
          开发者指南
        </a-button>
      </template>
    </a-page-header>

    <div class="publisher-content">
      <a-steps
        :current="currentStep"
        style="margin-bottom: 32px"
      >
        <a-step title="基本信息" />
        <a-step title="上传插件" />
        <a-step title="权限配置" />
        <a-step title="发布确认" />
      </a-steps>

      <!-- 步骤1: 基本信息 -->
      <div
        v-show="currentStep === 0"
        class="step-content"
      >
        <a-form
          :model="pluginInfo"
          :label-col="{ span: 4 }"
          :wrapper-col="{ span: 16 }"
        >
          <a-form-item
            label="插件名称"
            required
          >
            <a-input
              v-model:value="pluginInfo.name"
              placeholder="输入插件名称"
            />
          </a-form-item>

          <a-form-item
            label="插件ID"
            required
          >
            <a-input
              v-model:value="pluginInfo.id"
              placeholder="例如: my-awesome-plugin"
            >
              <template #addonBefore>
                chainlesschain-
              </template>
            </a-input>
            <div class="form-hint">
              插件ID必须唯一，只能包含小写字母、数字和连字符
            </div>
          </a-form-item>

          <a-form-item
            label="版本号"
            required
          >
            <a-input
              v-model:value="pluginInfo.version"
              placeholder="例如: 1.0.0"
            />
            <div class="form-hint">
              遵循语义化版本规范 (Semantic Versioning)
            </div>
          </a-form-item>

          <a-form-item
            label="简短描述"
            required
          >
            <a-textarea
              v-model:value="pluginInfo.description"
              placeholder="用一句话描述您的插件功能"
              :rows="2"
              :maxlength="200"
              show-count
            />
          </a-form-item>

          <a-form-item label="详细介绍">
            <a-textarea
              v-model:value="pluginInfo.longDescription"
              placeholder="详细介绍插件的功能、使用方法等"
              :rows="6"
            />
          </a-form-item>

          <a-form-item
            label="分类"
            required
          >
            <a-select
              v-model:value="pluginInfo.category"
              placeholder="选择插件分类"
            >
              <a-select-option value="ai">
                AI增强
              </a-select-option>
              <a-select-option value="productivity">
                效率工具
              </a-select-option>
              <a-select-option value="data">
                数据处理
              </a-select-option>
              <a-select-option value="integration">
                第三方集成
              </a-select-option>
              <a-select-option value="ui">
                界面扩展
              </a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="标签">
            <a-select
              v-model:value="pluginInfo.tags"
              mode="tags"
              placeholder="添加标签，按回车确认"
              :max-tag-count="5"
            />
            <div class="form-hint">
              最多5个标签，帮助用户发现您的插件
            </div>
          </a-form-item>

          <a-form-item label="作者">
            <a-input
              v-model:value="pluginInfo.author"
              placeholder="您的名字或组织名称"
            />
          </a-form-item>

          <a-form-item label="主页">
            <a-input
              v-model:value="pluginInfo.homepage"
              placeholder="https://github.com/your-username/your-plugin"
            />
          </a-form-item>

          <a-form-item label="仓库地址">
            <a-input
              v-model:value="pluginInfo.repository"
              placeholder="https://github.com/your-username/your-plugin"
            />
          </a-form-item>

          <a-form-item label="许可证">
            <a-select
              v-model:value="pluginInfo.license"
              placeholder="选择开源许可证"
            >
              <a-select-option value="MIT">
                MIT
              </a-select-option>
              <a-select-option value="Apache-2.0">
                Apache 2.0
              </a-select-option>
              <a-select-option value="GPL-3.0">
                GPL 3.0
              </a-select-option>
              <a-select-option value="BSD-3-Clause">
                BSD 3-Clause
              </a-select-option>
              <a-select-option value="ISC">
                ISC
              </a-select-option>
            </a-select>
          </a-form-item>
        </a-form>
      </div>

      <!-- 步骤2: 上传插件 -->
      <div
        v-show="currentStep === 1"
        class="step-content"
      >
        <a-alert
          message="上传要求"
          description="请上传包含manifest.json的ZIP文件，文件大小不超过50MB"
          type="info"
          show-icon
          style="margin-bottom: 24px"
        />

        <a-upload-dragger
          v-model:file-list="fileList"
          name="plugin"
          :multiple="false"
          :before-upload="beforeUpload"
          accept=".zip"
          @change="handleFileChange"
        >
          <p class="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p class="ant-upload-text">
            点击或拖拽文件到此区域上传
          </p>
          <p class="ant-upload-hint">
            支持ZIP格式的插件包，最大50MB
          </p>
        </a-upload-dragger>

        <div
          v-if="pluginFile"
          class="file-info"
        >
          <a-descriptions
            title="文件信息"
            bordered
            :column="2"
          >
            <a-descriptions-item label="文件名">
              {{ pluginFile.name }}
            </a-descriptions-item>
            <a-descriptions-item label="文件大小">
              {{ formatFileSize(pluginFile.size) }}
            </a-descriptions-item>
          </a-descriptions>
        </div>

        <div
          v-if="manifestData"
          class="manifest-preview"
        >
          <h3>Manifest 预览</h3>
          <a-descriptions
            bordered
            :column="1"
          >
            <a-descriptions-item label="插件ID">
              {{ manifestData.id }}
            </a-descriptions-item>
            <a-descriptions-item label="版本">
              {{ manifestData.version }}
            </a-descriptions-item>
            <a-descriptions-item label="名称">
              {{ manifestData.name }}
            </a-descriptions-item>
            <a-descriptions-item label="描述">
              {{ manifestData.description }}
            </a-descriptions-item>
          </a-descriptions>
        </div>
      </div>

      <!-- 步骤3: 权限配置 -->
      <div
        v-show="currentStep === 2"
        class="step-content"
      >
        <a-alert
          message="权限说明"
          description="请仔细选择插件需要的权限，用户会看到这些权限要求"
          type="warning"
          show-icon
          style="margin-bottom: 24px"
        />

        <a-checkbox-group
          v-model:value="pluginInfo.permissions"
          style="width: 100%"
        >
          <a-row :gutter="[16, 16]">
            <a-col
              v-for="perm in availablePermissions"
              :key="perm.value"
              :span="12"
            >
              <a-card
                size="small"
                hoverable
              >
                <a-checkbox :value="perm.value">
                  <strong>{{ perm.label }}</strong>
                </a-checkbox>
                <p class="permission-desc">
                  {{ perm.description }}
                </p>
              </a-card>
            </a-col>
          </a-row>
        </a-checkbox-group>
      </div>

      <!-- 步骤4: 发布确认 -->
      <div
        v-show="currentStep === 3"
        class="step-content"
      >
        <a-result
          status="info"
          title="准备发布"
          sub-title="请确认以下信息无误后发布插件"
        >
          <template #extra>
            <a-descriptions
              bordered
              :column="2"
            >
              <a-descriptions-item label="插件名称">
                {{ pluginInfo.name }}
              </a-descriptions-item>
              <a-descriptions-item label="插件ID">
                {{ pluginInfo.id }}
              </a-descriptions-item>
              <a-descriptions-item label="版本">
                {{ pluginInfo.version }}
              </a-descriptions-item>
              <a-descriptions-item label="分类">
                {{ getCategoryLabel(pluginInfo.category) }}
              </a-descriptions-item>
              <a-descriptions-item
                label="标签"
                :span="2"
              >
                <a-tag
                  v-for="tag in pluginInfo.tags"
                  :key="tag"
                >
                  {{ tag }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item
                label="权限"
                :span="2"
              >
                <a-tag
                  v-for="perm in pluginInfo.permissions"
                  :key="perm"
                  color="orange"
                >
                  {{ getPermissionLabel(perm) }}
                </a-tag>
              </a-descriptions-item>
            </a-descriptions>

            <a-checkbox
              v-model:checked="agreedToTerms"
              style="margin-top: 24px"
            >
              我已阅读并同意
              <a @click.prevent="showTerms">《插件发布协议》</a>
            </a-checkbox>
          </template>
        </a-result>
      </div>

      <!-- 操作按钮 -->
      <div class="step-actions">
        <a-space>
          <a-button
            v-if="currentStep > 0"
            @click="prevStep"
          >
            上一步
          </a-button>
          <a-button
            v-if="currentStep < 3"
            type="primary"
            :disabled="!canProceed"
            @click="nextStep"
          >
            下一步
          </a-button>
          <a-button
            v-if="currentStep === 3"
            type="primary"
            :loading="publishing"
            :disabled="!agreedToTerms"
            @click="publishPlugin"
          >
            <CloudUploadOutlined />
            发布插件
          </a-button>
        </a-space>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, h } from 'vue';
import { message, Modal } from 'ant-design-vue';
import { useRouter } from 'vue-router';
import {
  QuestionCircleOutlined,
  InboxOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons-vue';

const router = useRouter();

// 状态
const currentStep = ref(0);
const publishing = ref(false);
const agreedToTerms = ref(false);

const pluginInfo = ref({
  name: '',
  id: '',
  version: '1.0.0',
  description: '',
  longDescription: '',
  category: null,
  tags: [],
  author: '',
  homepage: '',
  repository: '',
  license: 'MIT',
  permissions: []
});

const fileList = ref([]);
const pluginFile = ref(null);
const manifestData = ref(null);

// 可用权限列表
const availablePermissions = [
  { value: 'database:read', label: '读取数据库', description: '允许插件读取笔记和数据' },
  { value: 'database:write', label: '写入数据库', description: '允许插件创建和修改数据' },
  { value: 'llm:query', label: '调用AI模型', description: '允许插件使用LLM服务' },
  { value: 'rag:search', label: '搜索知识库', description: '允许插件搜索和检索知识' },
  { value: 'file:read', label: '读取文件', description: '允许插件读取文件系统' },
  { value: 'file:write', label: '写入文件', description: '允许插件写入文件' },
  { value: 'network:request', label: '网络请求', description: '允许插件访问互联网' },
  { value: 'ui:register', label: '注册UI组件', description: '允许插件添加界面元素' },
];

// 计算属性
const canProceed = computed(() => {
  switch (currentStep.value) {
    case 0:
      return pluginInfo.value.name && pluginInfo.value.id && pluginInfo.value.version;
    case 1:
      return pluginFile.value !== null;
    case 2:
      return true;
    case 3:
      return agreedToTerms.value;
    default:
      return false;
  }
});

// 方法
const nextStep = () => {
  if (canProceed.value) {
    currentStep.value++;
  }
};

const prevStep = () => {
  currentStep.value--;
};

const beforeUpload = (file) => {
  const isZip = file.type === 'application/zip' || file.name.endsWith('.zip');
  if (!isZip) {
    message.error('只能上传ZIP文件！');
    return false;
  }

  const isLt50M = file.size / 1024 / 1024 < 50;
  if (!isLt50M) {
    message.error('文件大小不能超过50MB！');
    return false;
  }

  return false; // 阻止自动上传
};

const handleFileChange = (info) => {
  if (info.fileList.length > 0) {
    pluginFile.value = info.fileList[0].originFileObj;
    // TODO: 解析ZIP文件，读取manifest.json
    // manifestData.value = await parseManifest(pluginFile.value);
  } else {
    pluginFile.value = null;
    manifestData.value = null;
  }
};

const publishPlugin = async () => {
  publishing.value = true;

  try {
    // TODO: 调用发布API
    // await window.electronAPI.plugin.publishToMarketplace(pluginInfo.value, pluginFile.value);

    message.success('插件发布成功！');
    router.push('/plugins/marketplace');
  } catch (error) {
    message.error('发布失败: ' + error.message);
  } finally {
    publishing.value = false;
  }
};

const formatFileSize = (bytes) => {
  if (bytes < 1024) {return bytes + ' B';}
  if (bytes < 1024 * 1024) {return (bytes / 1024).toFixed(2) + ' KB';}
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

const getCategoryLabel = (category) => {
  const labels = {
    ai: 'AI增强',
    productivity: '效率工具',
    data: '数据处理',
    integration: '第三方集成',
    ui: '界面扩展'
  };
  return labels[category] || category;
};

const getPermissionLabel = (perm) => {
  const permission = availablePermissions.find(p => p.value === perm);
  return permission ? permission.label : perm;
};

const showDeveloperGuide = () => {
  Modal.info({
    title: '插件开发者指南',
    width: 700,
    content: h('div', { style: 'max-height: 400px; overflow-y: auto' }, [
      h('h4', '1. 插件结构'),
      h('p', '每个插件需要包含 manifest.json 配置文件，定义插件的元数据、权限和入口点。'),
      h('h4', { style: 'margin-top: 16px' }, '2. 必要文件'),
      h('ul', [
        h('li', 'manifest.json - 插件配置文件'),
        h('li', 'index.js - 插件主入口'),
        h('li', 'README.md - 插件说明文档')
      ]),
      h('h4', { style: 'margin-top: 16px' }, '3. 权限声明'),
      h('p', '在 manifest.json 中声明所需权限，如 database:read、llm:query 等。'),
      h('h4', { style: 'margin-top: 16px' }, '4. API 文档'),
      h('p', '完整的 API 文档请访问官方开发者文档网站。')
    ]),
    okText: '关闭'
  });
};

const showTerms = () => {
  Modal.info({
    title: '插件发布协议',
    width: 700,
    content: h('div', { style: 'max-height: 400px; overflow-y: auto' }, [
      h('h4', '插件发布须知'),
      h('p', '发布插件即表示您同意以下条款：'),
      h('ol', [
        h('li', '您确认拥有该插件的完整版权或已获得合法授权。'),
        h('li', '插件不包含任何恶意代码、后门或其他有害内容。'),
        h('li', '插件遵守当地法律法规，不含违法违规内容。'),
        h('li', '您同意用户对插件的评价和反馈。'),
        h('li', '平台有权下架违规插件。'),
        h('li', '您同意为插件提供必要的维护和支持。')
      ]),
      h('p', { style: 'margin-top: 16px; color: #666' }, '最后更新: 2025年1月')
    ]),
    okText: '我已阅读并同意'
  });
};
</script>

<style scoped lang="less">
.plugin-publisher {
  padding: 24px;
  background: #f0f2f5;
  min-height: 100vh;
}

.publisher-content {
  background: white;
  padding: 32px;
  border-radius: 8px;
  max-width: 1200px;
  margin: 0 auto;
}

.step-content {
  min-height: 400px;
  padding: 24px 0;
}

.form-hint {
  color: #999;
  font-size: 12px;
  margin-top: 4px;
}

.file-info,
.manifest-preview {
  margin-top: 24px;
}

.permission-desc {
  color: #666;
  font-size: 12px;
  margin: 4px 0 0 24px;
}

.step-actions {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid #f0f0f0;
  text-align: center;
}
</style>
