<template>
  <div class="vc-management">
    <a-card title="可验证凭证管理" :loading="loading">
      <template #extra>
        <a-space>
          <a-button @click="activeTab = 'issued'" :type="activeTab === 'issued' ? 'primary' : 'default'">
            已颁发 ({{ stats.issued }})
          </a-button>
          <a-button @click="activeTab = 'received'" :type="activeTab === 'received' ? 'primary' : 'default'">
            已接收 ({{ stats.received }})
          </a-button>
          <a-button @click="showImportShareModal = true">
            <template #icon><scan-outlined /></template>
            扫码接收
          </a-button>
          <a-button @click="showTemplateManagerModal = true">
            <template #icon><folder-open-outlined /></template>
            模板管理
          </a-button>
          <a-button type="primary" @click="showCreateModal = true">
            <template #icon><plus-outlined /></template>
            颁发凭证
          </a-button>
        </a-space>
      </template>

      <!-- 统计信息 -->
      <a-row :gutter="16" style="margin-bottom: 24px">
        <a-col :span="8">
          <a-statistic title="总凭证数" :value="stats.total" />
        </a-col>
        <a-col :span="8">
          <a-statistic title="已颁发" :value="stats.issued" />
        </a-col>
        <a-col :span="8">
          <a-statistic title="已接收" :value="stats.received" />
        </a-col>
      </a-row>

      <!-- 凭证列表 -->
      <a-list
        :data-source="displayCredentials"
        :pagination="{ pageSize: 10 }"
        item-layout="vertical"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-button type="link" @click="handleViewCredential(item)">
                查看
              </a-button>
              <a-button type="link" @click="handleVerifyCredential(item.id)">
                验证
              </a-button>
              <a-button
                v-if="item.issuer_did === currentDID && item.status === 'active'"
                type="link"
                danger
                @click="handleRevokeCredential(item.id)"
              >
                撤销
              </a-button>
              <a-button type="link" @click="handleExportCredential(item.id)">
                导出
              </a-button>
              <a-button type="link" @click="handleShareCredential(item.id)">
                分享
              </a-button>
            </template>
            <a-list-item-meta>
              <template #title>
                <a-space>
                  <span>{{ getTypeName(item.type) }}</span>
                  <a-tag :color="getStatusColor(item.status)">
                    {{ getStatusLabel(item.status) }}
                  </a-tag>
                </a-space>
              </template>
              <template #description>
                <div class="vc-meta">
                  <div>颁发者: {{ shortenDID(item.issuer_did) }}</div>
                  <div>主体: {{ shortenDID(item.subject_did) }}</div>
                  <div>颁发时间: {{ formatDate(item.issued_at) }}</div>
                  <div v-if="item.expires_at">过期时间: {{ formatDate(item.expires_at) }}</div>
                </div>
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>
      </a-list>
    </a-card>

    <!-- 创建凭证模态框 -->
    <a-modal
      v-model:open="showCreateModal"
      title="颁发可验证凭证"
      :width="700"
      @ok="handleCreateCredential"
      :confirm-loading="creating"
    >
      <a-form :model="createForm" :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <!-- 创建模式选择 -->
        <a-form-item label="创建方式">
          <a-radio-group v-model:value="createMode" @change="handleCreateModeChange">
            <a-radio-button value="template">使用模板</a-radio-button>
            <a-radio-button value="manual">手动输入</a-radio-button>
          </a-radio-group>
        </a-form-item>

        <!-- 模板选择模式 -->
        <template v-if="createMode === 'template'">
          <a-form-item label="选择模板" required>
            <a-select
              v-model:value="selectedTemplateId"
              placeholder="选择凭证模板"
              @change="handleTemplateChange"
              :loading="loadingTemplates"
            >
              <a-select-opt-group label="内置模板">
                <a-select-option
                  v-for="tpl in builtInTemplates"
                  :key="tpl.id"
                  :value="tpl.id"
                >
                  {{ tpl.icon }} {{ tpl.name }}
                </a-select-option>
              </a-select-opt-group>
              <a-select-opt-group label="自定义模板" v-if="customTemplates.length > 0">
                <a-select-option
                  v-for="tpl in customTemplates"
                  :key="tpl.id"
                  :value="tpl.id"
                >
                  {{ tpl.icon }} {{ tpl.name }}
                </a-select-option>
              </a-select-opt-group>
            </a-select>
          </a-form-item>

          <!-- 模板描述 -->
          <a-alert
            v-if="selectedTemplate"
            :message="selectedTemplate.description"
            type="info"
            show-icon
            style="margin-bottom: 16px"
          />

          <!-- 动态生成的模板字段 -->
          <template v-if="selectedTemplate">
            <a-form-item
              v-for="field in selectedTemplate.fields"
              :key="field.key"
              :label="field.label"
              :required="field.required"
            >
              <!-- 文本输入 -->
              <a-input
                v-if="field.type === 'text'"
                v-model:value="templateValues[field.key]"
                :placeholder="field.placeholder || `请输入${field.label}`"
              />

              <!-- 数字输入 -->
              <a-input-number
                v-else-if="field.type === 'number'"
                v-model:value="templateValues[field.key]"
                :min="field.min"
                :max="field.max"
                :placeholder="field.placeholder"
                style="width: 100%"
              />

              <!-- 下拉选择 -->
              <a-select
                v-else-if="field.type === 'select'"
                v-model:value="templateValues[field.key]"
                :placeholder="`请选择${field.label}`"
              >
                <a-select-option
                  v-for="option in field.options"
                  :key="option"
                  :value="option"
                >
                  {{ option }}
                </a-select-option>
              </a-select>

              <!-- 月份选择 -->
              <a-input
                v-else-if="field.type === 'month'"
                v-model:value="templateValues[field.key]"
                type="month"
                :placeholder="field.placeholder"
              />

              <!-- 多行文本 -->
              <a-textarea
                v-else-if="field.type === 'textarea'"
                v-model:value="templateValues[field.key]"
                :placeholder="field.placeholder"
                :rows="3"
              />
            </a-form-item>
          </template>
        </template>

        <!-- 手动输入模式 -->
        <template v-else>
          <a-form-item label="凭证类型" required>
            <a-select v-model:value="createForm.type">
              <a-select-option value="SelfDeclaration">自我声明</a-select-option>
              <a-select-option value="SkillCertificate">技能证书</a-select-option>
              <a-select-option value="TrustEndorsement">信任背书</a-select-option>
              <a-select-option value="EducationCredential">教育凭证</a-select-option>
              <a-select-option value="WorkExperience">工作经历</a-select-option>
            </a-select>
          </a-form-item>

          <a-form-item label="声明内容" required>
            <a-textarea
              v-model:value="createForm.claimsText"
              placeholder='输入 JSON 格式的声明，例如: {"skill": "JavaScript", "level": "Expert"}'
              :rows="6"
            />
            <div class="form-hint">必须是有效的 JSON 格式</div>
          </a-form-item>
        </template>

        <!-- 公共字段 -->
        <a-form-item label="主体 DID" required>
          <a-input
            v-model:value="createForm.subjectDID"
            placeholder="did:chainlesschain:..."
          />
          <div class="form-hint">接收此凭证的人的 DID</div>
        </a-form-item>

        <a-form-item label="有效期（天）">
          <a-input-number
            v-model:value="createForm.expiresInDays"
            :min="0"
            :max="3650"
            placeholder="0表示永久有效"
            style="width: 100%"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 凭证详情模态框 -->
    <a-modal
      v-model:open="showDetailModal"
      :title="currentCredential ? getTypeName(currentCredential.type) + ' - 详情' : '凭证详情'"
      :width="800"
      :footer="null"
    >
      <div v-if="currentCredential">
        <a-descriptions bordered :column="1">
          <a-descriptions-item label="凭证 ID">
            <a-typography-paragraph :copyable="{ text: currentCredential.id }" style="margin: 0">
              {{ currentCredential.id }}
            </a-typography-paragraph>
          </a-descriptions-item>

          <a-descriptions-item label="类型">
            {{ getTypeName(currentCredential.type) }}
          </a-descriptions-item>

          <a-descriptions-item label="颁发者">
            <a-typography-paragraph :copyable="{ text: currentCredential.issuer_did }" style="margin: 0">
              {{ shortenDID(currentCredential.issuer_did) }}
            </a-typography-paragraph>
          </a-descriptions-item>

          <a-descriptions-item label="主体">
            <a-typography-paragraph :copyable="{ text: currentCredential.subject_did }" style="margin: 0">
              {{ shortenDID(currentCredential.subject_did) }}
            </a-typography-paragraph>
          </a-descriptions-item>

          <a-descriptions-item label="状态">
            <a-tag :color="getStatusColor(currentCredential.status)">
              {{ getStatusLabel(currentCredential.status) }}
            </a-tag>
          </a-descriptions-item>

          <a-descriptions-item label="颁发时间">
            {{ formatDate(currentCredential.issued_at) }}
          </a-descriptions-item>

          <a-descriptions-item label="过期时间">
            {{ currentCredential.expires_at ? formatDate(currentCredential.expires_at) : '永久有效' }}
          </a-descriptions-item>

          <a-descriptions-item label="声明内容">
            <pre class="claims-content">{{ formatJSON(currentCredential.claims) }}</pre>
          </a-descriptions-item>
        </a-descriptions>
      </div>
    </a-modal>

    <!-- 验证结果模态框 -->
    <a-modal
      v-model:open="showVerifyModal"
      title="凭证验证结果"
      :footer="null"
    >
      <a-result
        :status="verifyResult ? 'success' : 'error'"
        :title="verifyResult ? '凭证验证成功' : '凭证验证失败'"
        :sub-title="verifyResult ? '此凭证签名有效且未过期' : '此凭证签名无效或已过期'"
      />
    </a-modal>

    <!-- 模板管理模态框 -->
    <a-modal
      v-model:open="showTemplateManagerModal"
      title="模板管理"
      :width="900"
      :footer="null"
    >
      <a-tabs v-model:activeKey="templateManagerTab">
        <!-- 模板列表 -->
        <a-tab-pane key="list" tab="模板列表">
          <a-space style="margin-bottom: 16px">
            <a-button @click="handleImportTemplate">
              <template #icon><import-outlined /></template>
              导入模板
            </a-button>
            <a-button
              :disabled="selectedTemplateIds.length === 0"
              @click="handleExportSelectedTemplates"
            >
              <template #icon><export-outlined /></template>
              导出选中 ({{ selectedTemplateIds.length }})
            </a-button>
          </a-space>

          <a-table
            :dataSource="customTemplates"
            :columns="templateColumns"
            :row-selection="{
              selectedRowKeys: selectedTemplateIds,
              onChange: onTemplateSelectionChange
            }"
            :pagination="{ pageSize: 10 }"
            row-key="id"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'">
                <span>{{ record.icon }} {{ record.name }}</span>
              </template>
              <template v-else-if="column.key === 'type'">
                <a-tag>{{ getTypeName(record.type) }}</a-tag>
              </template>
              <template v-else-if="column.key === 'fieldCount'">
                {{ record.fields ? record.fields.length : 0 }}
              </template>
              <template v-else-if="column.key === 'actions'">
                <a-space>
                  <a-button type="link" size="small" @click="handleExportSingleTemplate(record.id)">
                    导出
                  </a-button>
                  <a-button
                    type="link"
                    size="small"
                    danger
                    @click="handleDeleteTemplate(record.id)"
                  >
                    删除
                  </a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-tab-pane>

        <!-- 导入结果 -->
        <a-tab-pane key="import-result" tab="导入结果" v-if="lastImportResult">
          <a-result
            :status="lastImportResult.failed === 0 ? 'success' : 'warning'"
            :title="lastImportResult.failed === 0 ? '导入成功' : '部分导入成功'"
            :sub-title="`成功: ${lastImportResult.success} 个，失败: ${lastImportResult.failed} 个`"
          >
            <template #extra>
              <a-space direction="vertical" style="width: 100%">
                <div v-if="lastImportResult.imported.length > 0">
                  <h4>成功导入的模板:</h4>
                  <a-tag
                    v-for="name in lastImportResult.imported"
                    :key="name"
                    color="success"
                    style="margin: 4px"
                  >
                    {{ name }}
                  </a-tag>
                </div>

                <div v-if="lastImportResult.errors.length > 0">
                  <h4>导入失败:</h4>
                  <a-alert
                    v-for="(error, index) in lastImportResult.errors"
                    :key="index"
                    type="error"
                    :message="error.template"
                    :description="error.error"
                    style="margin-top: 8px"
                  />
                </div>
              </a-space>
            </template>
          </a-result>
        </a-tab-pane>
      </a-tabs>

      <!-- 隐藏的文件输入 -->
      <input
        ref="fileInput"
        type="file"
        accept=".json"
        style="display: none"
        @change="handleFileSelected"
      />
    </a-modal>

    <!-- 凭证分享模态框 -->
    <a-modal
      v-model:open="showShareModal"
      title="分享凭证"
      :width="500"
      :footer="null"
    >
      <div v-if="shareData" class="share-content">
        <a-alert
          message="扫描二维码或复制链接分享凭证"
          type="info"
          show-icon
          style="margin-bottom: 16px"
        />

        <!-- 二维码 -->
        <div class="qrcode-container">
          <canvas ref="qrcodeCanvas" style="display: none"></canvas>
          <img :src="qrcodeImage" alt="QR Code" style="max-width: 100%" />
        </div>

        <!-- 分享链接 -->
        <a-input-group compact style="margin-top: 16px">
          <a-input
            :value="shareData.shareUrl"
            readonly
            style="width: calc(100% - 80px)"
          />
          <a-button type="primary" @click="copyShareUrl">
            复制链接
          </a-button>
        </a-input-group>

        <!-- JSON 数据 -->
        <a-collapse style="margin-top: 16px">
          <a-collapse-panel key="1" header="查看 JSON 数据">
            <pre class="json-data">{{ JSON.stringify(shareData.fullData, null, 2) }}</pre>
            <a-button block @click="copyShareJson">
              复制 JSON
            </a-button>
          </a-collapse-panel>
        </a-collapse>
      </div>
    </a-modal>

    <!-- 导入分享凭证模态框 -->
    <a-modal
      v-model:open="showImportShareModal"
      title="扫码接收凭证"
      :width="600"
      @ok="handleImportShare"
      :confirm-loading="importing"
    >
      <a-tabs v-model:activeKey="importMethod">
        <a-tab-pane key="qrcode" tab="扫描二维码">
          <div class="import-qrcode">
            <a-alert
              message="请将二维码对准摄像头"
              type="info"
              show-icon
              style="margin-bottom: 16px"
            />
            <div ref="qrScannerContainer" class="qr-scanner"></div>
          </div>
        </a-tab-pane>

        <a-tab-pane key="json" tab="粘贴 JSON">
          <a-textarea
            v-model:value="importJsonText"
            placeholder='粘贴凭证 JSON 数据'
            :rows="12"
          />
        </a-tab-pane>
      </a-tabs>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, nextTick } from 'vue';
import { message, Modal } from 'ant-design-vue';
import {
  PlusOutlined,
  FolderOpenOutlined,
  ImportOutlined,
  ExportOutlined,
  ScanOutlined,
} from '@ant-design/icons-vue';
import QRCode from 'qrcode';

const loading = ref(false);
const creating = ref(false);
const credentials = ref([]);
const activeTab = ref('issued');
const currentDID = ref('');

// 统计信息
const stats = reactive({
  total: 0,
  issued: 0,
  received: 0,
  byType: {},
});

// 模态框控制
const showCreateModal = ref(false);
const showDetailModal = ref(false);
const showVerifyModal = ref(false);
const showTemplateManagerModal = ref(false);
const verifyResult = ref(false);

// 当前凭证
const currentCredential = ref(null);

// 创建表单
const createForm = reactive({
  type: 'SelfDeclaration',
  subjectDID: '',
  claimsText: '',
  expiresInDays: 0,
});

// 模板相关
const createMode = ref('template');
const loadingTemplates = ref(false);
const templates = ref([]);
const selectedTemplateId = ref(null);
const selectedTemplate = ref(null);
const templateValues = reactive({});

// 内置模板和自定义模板
const builtInTemplates = computed(() => {
  return templates.value.filter((t) => t.isBuiltIn || t.id.startsWith('built-in:'));
});

const customTemplates = computed(() => {
  return templates.value.filter((t) => !t.isBuiltIn && !t.id.startsWith('built-in:'));
});

// 模板管理相关
const templateManagerTab = ref('list');
const selectedTemplateIds = ref([]);
const fileInput = ref(null);
const lastImportResult = ref(null);

const templateColumns = [
  {
    title: '模板名称',
    key: 'name',
    dataIndex: 'name',
  },
  {
    title: '凭证类型',
    key: 'type',
    dataIndex: 'type',
  },
  {
    title: '字段数量',
    key: 'fieldCount',
  },
  {
    title: '使用次数',
    key: 'usage_count',
    dataIndex: 'usage_count',
  },
  {
    title: '操作',
    key: 'actions',
  },
];

// 凭证分享相关
const showShareModal = ref(false);
const shareData = ref(null);
const qrcodeImage = ref('');
const qrcodeCanvas = ref(null);

// 凭证导入相关
const showImportShareModal = ref(false);
const importing = ref(false);
const importMethod = ref('json');
const importJsonText = ref('');
const qrScannerContainer = ref(null);

// 显示的凭证列表
const displayCredentials = computed(() => {
  if (activeTab.value === 'issued') {
    return credentials.value.filter((c) => c.issuer_did === currentDID.value);
  } else {
    return credentials.value.filter((c) => c.subject_did === currentDID.value);
  }
});

// 加载凭证列表
async function loadCredentials() {
  loading.value = true;
  try {
    const result = await window.electronAPI.vc.getAll();
    credentials.value = result;

    // 加载统计信息
    const statsResult = await window.electronAPI.vc.getStatistics(currentDID.value);
    Object.assign(stats, statsResult);
  } catch (error) {
    message.error('加载凭证失败: ' + error.message);
  } finally {
    loading.value = false;
  }
}

// 加载模板列表
async function loadTemplates() {
  loadingTemplates.value = true;
  try {
    const result = await window.electronAPI.vcTemplate.getAll();
    templates.value = result;
  } catch (error) {
    message.error('加载模板失败: ' + error.message);
  } finally {
    loadingTemplates.value = false;
  }
}

// 处理创建模式切换
function handleCreateModeChange() {
  // 清空表单
  selectedTemplateId.value = null;
  selectedTemplate.value = null;
  Object.keys(templateValues).forEach(key => delete templateValues[key]);
  createForm.claimsText = '';
}

// 处理模板选择
async function handleTemplateChange(templateId) {
  try {
    const template = await window.electronAPI.vcTemplate.get(templateId);
    selectedTemplate.value = template;

    // 清空旧值
    Object.keys(templateValues).forEach(key => delete templateValues[key]);

    // 设置默认值
    if (template && template.fields) {
      template.fields.forEach(field => {
        if (field.defaultValue !== undefined) {
          templateValues[field.key] = field.defaultValue;
        }
      });
    }

    // 自动设置凭证类型
    if (template && template.type) {
      createForm.type = template.type;
    }
  } catch (error) {
    message.error('加载模板详情失败: ' + error.message);
  }
}

// 创建凭证
async function handleCreateCredential() {
  if (!createForm.subjectDID) {
    message.warning('请填写主体 DID');
    return;
  }

  let claims;

  // 模板模式
  if (createMode.value === 'template') {
    if (!selectedTemplateId.value) {
      message.warning('请选择模板');
      return;
    }

    try {
      // 使用模板填充值
      claims = await window.electronAPI.vcTemplate.fillValues(
        selectedTemplateId.value,
        templateValues
      );

      // 增加模板使用次数
      await window.electronAPI.vcTemplate.incrementUsage(selectedTemplateId.value);
    } catch (error) {
      message.error('填充模板值失败: ' + error.message);
      return;
    }
  } else {
    // 手动输入模式
    if (!createForm.claimsText) {
      message.warning('请填写声明内容');
      return;
    }

    // 验证 JSON 格式
    try {
      claims = JSON.parse(createForm.claimsText);
    } catch (error) {
      message.error('声明内容必须是有效的 JSON 格式');
      return;
    }
  }

  creating.value = true;
  try {
    const params = {
      type: createForm.type,
      issuerDID: currentDID.value,
      subjectDID: createForm.subjectDID,
      claims,
      expiresIn: createForm.expiresInDays > 0 ? createForm.expiresInDays * 24 * 60 * 60 * 1000 : null,
    };

    await window.electronAPI.vc.create(params);
    message.success('凭证已颁发');

    // 重置表单
    createForm.type = 'SelfDeclaration';
    createForm.subjectDID = '';
    createForm.claimsText = '';
    createForm.expiresInDays = 0;
    selectedTemplateId.value = null;
    selectedTemplate.value = null;
    Object.keys(templateValues).forEach(key => delete templateValues[key]);

    showCreateModal.value = false;
    await loadCredentials();
  } catch (error) {
    message.error('颁发凭证失败: ' + error.message);
  } finally {
    creating.value = false;
  }
}

// 查看凭证
function handleViewCredential(credential) {
  currentCredential.value = credential;
  showDetailModal.value = true;
}

// 验证凭证
async function handleVerifyCredential(id) {
  try {
    const vcDocument = await window.electronAPI.vc.export(id);
    const result = await window.electronAPI.vc.verify(vcDocument);
    verifyResult.value = result;
    showVerifyModal.value = true;
  } catch (error) {
    message.error('验证失败: ' + error.message);
  }
}

// 撤销凭证
function handleRevokeCredential(id) {
  Modal.confirm({
    title: '确认撤销',
    content: '撤销后，此凭证将失效且无法恢复，确定要继续吗？',
    okText: '确定',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.vc.revoke(id, currentDID.value);
        message.success('凭证已撤销');
        await loadCredentials();
      } catch (error) {
        message.error('撤销失败: ' + error.message);
      }
    },
  });
}

// 导出凭证
async function handleExportCredential(id) {
  try {
    const vcDocument = await window.electronAPI.vc.export(id);
    const blob = new Blob([JSON.stringify(vcDocument, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vc-${id.split(':').pop()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('凭证已导出');
  } catch (error) {
    message.error('导出失败: ' + error.message);
  }
}

// 获取类型名称
function getTypeName(type) {
  const names = {
    SelfDeclaration: '自我声明',
    SkillCertificate: '技能证书',
    TrustEndorsement: '信任背书',
    EducationCredential: '教育凭证',
    WorkExperience: '工作经历',
  };
  return names[type] || type;
}

// 获取状态标签
function getStatusLabel(status) {
  const labels = {
    active: '有效',
    revoked: '已撤销',
    expired: '已过期',
  };
  return labels[status] || status;
}

// 获取状态颜色
function getStatusColor(status) {
  const colors = {
    active: 'success',
    revoked: 'error',
    expired: 'default',
  };
  return colors[status] || 'default';
}

// 缩短 DID
function shortenDID(did) {
  if (!did) return '';
  const parts = did.split(':');
  if (parts.length === 3) {
    const identifier = parts[2];
    return `did:${parts[1]}:${identifier.substring(0, 8)}...${identifier.substring(
      identifier.length - 6
    )}`;
  }
  return did;
}

// 格式化日期
function formatDate(timestamp) {
  if (!timestamp) return '未知';
  const date = new Date(timestamp);
  return date.toLocaleString('zh-CN');
}

// 格式化 JSON
function formatJSON(jsonString) {
  try {
    return JSON.stringify(JSON.parse(jsonString), null, 2);
  } catch (error) {
    return jsonString;
  }
}

// 模板选择变化
function onTemplateSelectionChange(selectedKeys) {
  selectedTemplateIds.value = selectedKeys;
}

// 导出单个模板
async function handleExportSingleTemplate(id) {
  try {
    const exportData = await window.electronAPI.vcTemplate.export(id);
    const template = await window.electronAPI.vcTemplate.get(id);

    // 下载为 JSON 文件
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `template-${template.name}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    message.success('模板已导出');
  } catch (error) {
    message.error('导出失败: ' + error.message);
  }
}

// 导出选中的模板
async function handleExportSelectedTemplates() {
  if (selectedTemplateIds.value.length === 0) {
    message.warning('请选择要导出的模板');
    return;
  }

  try {
    const exportData = await window.electronAPI.vcTemplate.exportMultiple(
      selectedTemplateIds.value
    );

    // 下载为 JSON 文件
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `templates-${exportData.count}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    message.success(`已导出 ${exportData.count} 个模板`);
    selectedTemplateIds.value = [];
  } catch (error) {
    message.error('导出失败: ' + error.message);
  }
}

// 导入模板
function handleImportTemplate() {
  fileInput.value.click();
}

// 文件选择处理
async function handleFileSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importData = JSON.parse(text);

    // 显示确认对话框
    Modal.confirm({
      title: '确认导入',
      content: importData.template
        ? `将导入模板: ${importData.template.name}`
        : `将导入 ${importData.templates?.length || 0} 个模板`,
      okText: '导入',
      cancelText: '取消',
      onOk: async () => {
        await performImport(importData);
      },
    });
  } catch (error) {
    message.error('读取文件失败: ' + error.message);
  }

  // 清空文件输入
  event.target.value = '';
}

// 执行导入
async function performImport(importData) {
  try {
    const result = await window.electronAPI.vcTemplate.import(
      importData,
      currentDID.value,
      { overwrite: false }
    );

    lastImportResult.value = result;
    templateManagerTab.value = 'import-result';

    // 重新加载模板列表
    await loadTemplates();

    if (result.failed === 0) {
      message.success(`成功导入 ${result.success} 个模板`);
    } else {
      message.warning(
        `部分导入成功: ${result.success} 个成功，${result.failed} 个失败`
      );
    }
  } catch (error) {
    message.error('导入失败: ' + error.message);
  }
}

// 删除模板
function handleDeleteTemplate(id) {
  Modal.confirm({
    title: '确认删除',
    content: '删除后将无法恢复，确定要继续吗？',
    okText: '确定',
    okType: 'danger',
    cancelText: '取消',
    async onOk() {
      try {
        await window.electronAPI.vcTemplate.delete(id);
        message.success('模板已删除');
        await loadTemplates();
      } catch (error) {
        message.error('删除失败: ' + error.message);
      }
    },
  });
}

// 分享凭证
async function handleShareCredential(id) {
  try {
    console.log('[VCManagement] 生成分享数据:', id);

    // 生成分享数据
    const data = await window.electronAPI.vc.generateShareData(id);
    shareData.value = data;

    // 生成二维码
    await nextTick();
    if (qrcodeCanvas.value) {
      try {
        // 生成二维码到 canvas
        await QRCode.toCanvas(qrcodeCanvas.value, data.qrCodeData, {
          width: 300,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        });

        // 转换为图片URL
        qrcodeImage.value = qrcodeCanvas.value.toDataURL();
      } catch (error) {
        console.error('[VCManagement] 生成二维码失败:', error);
        message.error('生成二维码失败');
        return;
      }
    }

    // 显示分享模态框
    showShareModal.value = true;

    console.log('[VCManagement] 分享数据已生成');
  } catch (error) {
    console.error('[VCManagement] 生成分享数据失败:', error);
    message.error('生成分享数据失败: ' + error.message);
  }
}

// 复制分享链接
function copyShareUrl() {
  if (!shareData.value) return;

  navigator.clipboard.writeText(shareData.value.shareUrl)
    .then(() => {
      message.success('链接已复制到剪贴板');
    })
    .catch((error) => {
      console.error('[VCManagement] 复制链接失败:', error);
      message.error('复制链接失败');
    });
}

// 复制分享JSON
function copyShareJson() {
  if (!shareData.value) return;

  const jsonText = JSON.stringify(shareData.value.fullData, null, 2);
  navigator.clipboard.writeText(jsonText)
    .then(() => {
      message.success('JSON数据已复制到剪贴板');
    })
    .catch((error) => {
      console.error('[VCManagement] 复制JSON失败:', error);
      message.error('复制JSON失败');
    });
}

// 导入分享凭证
async function handleImportShare() {
  if (!importJsonText.value.trim()) {
    message.warning('请粘贴凭证JSON数据');
    return;
  }

  importing.value = true;
  try {
    console.log('[VCManagement] 导入分享凭证...');

    // 解析JSON
    let shareData;
    try {
      shareData = JSON.parse(importJsonText.value);
    } catch (error) {
      message.error('JSON格式错误，请检查数据');
      return;
    }

    // 导入凭证
    const result = await window.electronAPI.vc.importFromShare(shareData);

    message.success('凭证已成功导入');
    console.log('[VCManagement] 凭证已导入:', result.id);

    // 关闭模态框并刷新列表
    showImportShareModal.value = false;
    importJsonText.value = '';
    importMethod.value = 'json';

    // 重新加载凭证列表
    await loadCredentials();
  } catch (error) {
    console.error('[VCManagement] 导入凭证失败:', error);
    message.error('导入失败: ' + error.message);
  } finally {
    importing.value = false;
  }
}

onMounted(async () => {
  // 获取当前 DID
  const identity = await window.electronAPI.did.getCurrentIdentity();
  if (identity) {
    currentDID.value = identity.did;
  }

  await loadCredentials();
  await loadTemplates();
});
</script>

<style scoped>
.vc-management {
  padding: 20px;
}

.vc-meta {
  font-size: 13px;
  color: #666;
  line-height: 1.8;
}

.form-hint {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}

.claims-content {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 300px;
  font-size: 12px;
  margin: 0;
}

.share-content {
  padding: 16px 0;
}

.qrcode-container {
  display: flex;
  justify-content: center;
  padding: 24px;
  background: #f9f9f9;
  border-radius: 8px;
}

.qrcode-container img {
  border: 2px solid #e0e0e0;
  border-radius: 4px;
}

.json-data {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 300px;
  font-size: 12px;
  margin: 0 0 12px 0;
}

.import-qrcode {
  padding: 16px 0;
}

.qr-scanner {
  width: 100%;
  min-height: 300px;
  background: #f9f9f9;
  border: 2px dashed #d9d9d9;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
