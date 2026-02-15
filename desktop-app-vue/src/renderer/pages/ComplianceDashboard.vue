<template>
  <div class="compliance-dashboard">
    <a-page-header title="合规管理仪表板">
      <template #extra>
        <a-button type="primary" :loading="auditStore.loading" @click="handleGenerateReport">
          <FileTextOutlined /> 生成报告
        </a-button>
      </template>
    </a-page-header>

    <div class="dashboard-content">
      <!-- Compliance Score Overview -->
      <a-row :gutter="[16, 16]" class="score-overview">
        <a-col :xs="24" :sm="8">
          <a-card title="GDPR" class="score-card">
            <div class="score-circle">
              <a-progress
                type="circle"
                :percent="gdprScore"
                :stroke-color="getScoreColor(gdprScore)"
                :format="(p: number) => `${p}%`"
              />
            </div>
            <div class="score-label">GDPR 合规分数</div>
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="8">
          <a-card title="SOC2" class="score-card">
            <div class="score-circle">
              <a-progress
                type="circle"
                :percent="soc2Score"
                :stroke-color="getScoreColor(soc2Score)"
                :format="(p: number) => `${p}%`"
              />
            </div>
            <div class="score-label">SOC2 合规分数</div>
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="8">
          <a-card title="总体评分" class="score-card">
            <div class="score-circle">
              <a-progress
                type="circle"
                :percent="overallScore"
                :stroke-color="getScoreColor(overallScore)"
                :format="(p: number) => `${p}%`"
              />
            </div>
            <div class="score-label">总体合规分数</div>
          </a-card>
        </a-col>
      </a-row>

      <!-- Tabs Section -->
      <a-tabs v-model:activeKey="activeTab" class="compliance-tabs">
        <!-- Tab 1: Compliance Policies -->
        <a-tab-pane key="policies" tab="合规策略">
          <div class="tab-toolbar">
            <a-button type="primary" @click="openPolicyModal()">
              <PlusOutlined /> 新建策略
            </a-button>
          </div>
          <a-table
            :columns="policyColumns"
            :data-source="auditStore.policies"
            :loading="auditStore.loading"
            row-key="id"
            :pagination="{ pageSize: 10 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.dataIndex === 'rules'">
                <span class="rules-summary">{{ formatRulesSummary(record.rules) }}</span>
              </template>
              <template v-if="column.dataIndex === 'enabled'">
                <a-switch
                  :checked="record.enabled"
                  @change="(checked: boolean) => handleTogglePolicy(record as CompliancePolicy, checked)"
                />
              </template>
              <template v-if="column.key === 'actions'">
                <a-space>
                  <a-button size="small" @click="openPolicyModal(record as CompliancePolicy)">
                    <EditOutlined /> 编辑
                  </a-button>
                  <a-popconfirm
                    title="确定要删除此策略吗?"
                    @confirm="handleDeletePolicy(record.id)"
                  >
                    <a-button size="small" danger>
                      <DeleteOutlined /> 删除
                    </a-button>
                  </a-popconfirm>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-tab-pane>

        <!-- Tab 2: Compliance Checks -->
        <a-tab-pane key="checks" tab="合规检查">
          <div class="tab-toolbar">
            <a-space>
              <a-select
                v-model:value="selectedFramework"
                style="width: 200px"
                placeholder="选择合规框架"
                @change="handleFrameworkChange"
              >
                <a-select-option value="GDPR">GDPR</a-select-option>
                <a-select-option value="SOC2">SOC2</a-select-option>
                <a-select-option value="HIPAA">HIPAA</a-select-option>
                <a-select-option value="ISO27001">ISO27001</a-select-option>
              </a-select>
              <a-button type="primary" :loading="auditStore.loading" @click="runComplianceCheck">
                <SafetyCertificateOutlined /> 运行检查
              </a-button>
            </a-space>
          </div>

          <div v-if="auditStore.complianceResult" class="check-results">
            <a-row :gutter="[16, 16]">
              <a-col :span="24">
                <a-statistic
                  title="合规分数"
                  :value="auditStore.complianceResult.score"
                  suffix="/ 100"
                  :value-style="{ color: getScoreColor(auditStore.complianceResult.score) }"
                />
              </a-col>
            </a-row>

            <a-divider>检查项目</a-divider>

            <a-list
              :data-source="auditStore.complianceResult.checks"
              item-layout="horizontal"
              size="small"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #avatar>
                      <CheckCircleOutlined v-if="item.passed" style="color: #52c41a; font-size: 20px" />
                      <CloseCircleOutlined v-else style="color: #ff4d4f; font-size: 20px" />
                    </template>
                    <template #title>{{ item.name }}</template>
                    <template #description>{{ item.details }}</template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>

            <div v-if="auditStore.complianceResult.recommendations.length > 0" class="recommendations">
              <a-divider>改进建议</a-divider>
              <a-alert
                v-for="(rec, idx) in auditStore.complianceResult.recommendations"
                :key="idx"
                type="info"
                :message="rec"
                show-icon
                class="recommendation-item"
              />
            </div>
          </div>

          <a-empty v-else description="请选择框架并运行合规检查" />
        </a-tab-pane>

        <!-- Tab 3: DSR Tracking -->
        <a-tab-pane key="dsr" tab="数据主体请求">
          <div class="tab-toolbar">
            <a-button type="primary" @click="openDSRModal()">
              <PlusOutlined /> 新建请求
            </a-button>
          </div>
          <a-table
            :columns="dsrColumns"
            :data-source="auditStore.dsrRequests"
            :loading="auditStore.loading"
            row-key="id"
            :pagination="{ pageSize: 10 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.dataIndex === 'status'">
                <a-tag :color="getDSRStatusColor(record.status)">
                  {{ getDSRStatusLabel(record.status) }}
                </a-tag>
              </template>
              <template v-if="column.dataIndex === 'created_at'">
                {{ formatDate(record.created_at) }}
              </template>
              <template v-if="column.dataIndex === 'deadline'">
                <span :class="{ 'overdue': record.deadline < Date.now() && record.status !== 'completed' && record.status !== 'rejected' }">
                  {{ formatDate(record.deadline) }}
                </span>
              </template>
              <template v-if="column.key === 'actions'">
                <a-space>
                  <a-button
                    v-if="record.status === 'pending'"
                    size="small"
                    type="primary"
                    @click="handleProcessDSR(record.id)"
                  >
                    处理
                  </a-button>
                  <a-button
                    v-if="record.status === 'pending' || record.status === 'in_progress'"
                    size="small"
                    @click="openApproveModal(record as DataSubjectRequest)"
                  >
                    审批
                  </a-button>
                  <a-button
                    size="small"
                    @click="handleViewDSRDetail(record.id)"
                  >
                    <EyeOutlined /> 详情
                  </a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-tab-pane>

        <!-- Tab 4: Data Retention -->
        <a-tab-pane key="retention" tab="数据保留">
          <div class="retention-section">
            <a-space direction="vertical" :size="16" style="width: 100%">
              <a-card title="数据保留策略管理">
                <a-space>
                  <a-button :loading="retentionLoading" @click="handlePreviewDeletion">
                    <SearchOutlined /> 预览待删除数据
                  </a-button>
                  <a-popconfirm
                    title="确定要执行数据保留策略吗?此操作将删除过期数据。"
                    @confirm="handleApplyRetention"
                  >
                    <a-button type="primary" danger :loading="retentionLoading">
                      <DeleteOutlined /> 应用保留策略
                    </a-button>
                  </a-popconfirm>
                </a-space>
              </a-card>

              <a-card v-if="retentionPreview" title="预览结果">
                <a-statistic
                  title="受影响记录数"
                  :value="retentionPreview.affectedCount || 0"
                  :value-style="{ color: retentionPreview.affectedCount > 0 ? '#ff4d4f' : '#52c41a' }"
                />
                <a-divider />
                <div v-if="retentionPreview.details">
                  <p v-for="(count, table) in retentionPreview.details" :key="String(table)">
                    <strong>{{ table }}</strong>: {{ count }} 条记录
                  </p>
                </div>
              </a-card>
            </a-space>
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- Policy Create/Edit Modal -->
    <a-modal
      v-model:open="policyModalVisible"
      :title="editingPolicy ? '编辑策略' : '新建策略'"
      :confirm-loading="auditStore.loading"
      @ok="handleSavePolicy"
      @cancel="closePolicyModal"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="合规框架">
          <a-select v-model:value="policyForm.framework" placeholder="选择合规框架">
            <a-select-option value="GDPR">GDPR</a-select-option>
            <a-select-option value="SOC2">SOC2</a-select-option>
            <a-select-option value="HIPAA">HIPAA</a-select-option>
            <a-select-option value="ISO27001">ISO27001</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="策略类型">
          <a-select v-model:value="policyForm.policy_type" placeholder="选择策略类型">
            <a-select-option value="data_protection">数据保护</a-select-option>
            <a-select-option value="access_control">访问控制</a-select-option>
            <a-select-option value="audit_logging">审计日志</a-select-option>
            <a-select-option value="data_retention">数据保留</a-select-option>
            <a-select-option value="encryption">加密要求</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="规则 (JSON)">
          <a-textarea
            v-model:value="policyForm.rules"
            :rows="6"
            placeholder='请输入 JSON 格式的规则，例如: {"minPasswordLength": 8}'
          />
        </a-form-item>
        <a-form-item label="启用">
          <a-switch v-model:checked="policyForm.enabled" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- DSR Create Modal -->
    <a-modal
      v-model:open="dsrModalVisible"
      title="新建数据主体请求"
      :confirm-loading="auditStore.loading"
      @ok="handleCreateDSR"
      @cancel="closeDSRModal"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="请求类型">
          <a-select v-model:value="dsrForm.request_type" placeholder="选择请求类型">
            <a-select-option value="access">数据访问</a-select-option>
            <a-select-option value="deletion">数据删除</a-select-option>
            <a-select-option value="rectification">数据更正</a-select-option>
            <a-select-option value="portability">数据迁移</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="主体 DID">
          <a-input v-model:value="dsrForm.subject_did" placeholder="请输入数据主体的 DID" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- DSR Approve Modal -->
    <a-modal
      v-model:open="approveModalVisible"
      title="审批数据主体请求"
      :confirm-loading="auditStore.loading"
      @ok="handleApproveDSR"
      @cancel="closeApproveModal"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="请求类型">
          <span>{{ getDSRTypeLabel(approvingRequest?.request_type) }}</span>
        </a-form-item>
        <a-form-item label="主体 DID">
          <span>{{ approvingRequest?.subject_did }}</span>
        </a-form-item>
        <a-form-item label="审批意见">
          <a-textarea
            v-model:value="approveForm.comment"
            :rows="4"
            placeholder="请输入审批意见"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- DSR Detail Modal -->
    <a-modal
      v-model:open="detailModalVisible"
      title="请求详情"
      :footer="null"
    >
      <a-descriptions v-if="dsrDetail" bordered :column="1" size="small">
        <a-descriptions-item label="请求ID">{{ dsrDetail.id }}</a-descriptions-item>
        <a-descriptions-item label="请求类型">{{ getDSRTypeLabel(dsrDetail.request_type) }}</a-descriptions-item>
        <a-descriptions-item label="主体 DID">{{ dsrDetail.subject_did }}</a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="getDSRStatusColor(dsrDetail.status)">
            {{ getDSRStatusLabel(dsrDetail.status) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="创建时间">{{ formatDate(dsrDetail.created_at) }}</a-descriptions-item>
        <a-descriptions-item label="截止时间">{{ formatDate(dsrDetail.deadline) }}</a-descriptions-item>
        <a-descriptions-item v-if="dsrDetail.completed_at" label="完成时间">{{ formatDate(dsrDetail.completed_at) }}</a-descriptions-item>
        <a-descriptions-item v-if="dsrDetail.request_data" label="请求数据">{{ dsrDetail.request_data }}</a-descriptions-item>
        <a-descriptions-item v-if="dsrDetail.response_data" label="响应数据">{{ dsrDetail.response_data }}</a-descriptions-item>
      </a-descriptions>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import { message } from 'ant-design-vue';
import {
  FileTextOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SafetyCertificateOutlined,
  EyeOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue';
import { useAuditStore } from '../stores/audit';
import type { CompliancePolicy, DataSubjectRequest } from '../stores/audit';

const auditStore = useAuditStore();

// ==================== State ====================

const activeTab = ref('policies');
const selectedFramework = ref('GDPR');

// Score state
const gdprScore = ref(0);
const soc2Score = ref(0);

const overallScore = computed(() => {
  const scores = [gdprScore.value, soc2Score.value].filter((s) => s > 0);
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
});

// Policy modal
const policyModalVisible = ref(false);
const editingPolicy = ref<CompliancePolicy | null>(null);
const policyForm = reactive({
  framework: 'GDPR' as string,
  policy_type: 'data_protection' as string,
  rules: '' as string,
  enabled: true as boolean,
});

// DSR modal
const dsrModalVisible = ref(false);
const dsrForm = reactive({
  request_type: 'access' as DataSubjectRequest['request_type'],
  subject_did: '' as string,
});

// Approve modal
const approveModalVisible = ref(false);
const approvingRequest = ref<DataSubjectRequest | null>(null);
const approveForm = reactive({
  comment: '' as string,
});

// Detail modal
const detailModalVisible = ref(false);
const dsrDetail = ref<DataSubjectRequest | null>(null);

// Retention
const retentionLoading = ref(false);
const retentionPreview = ref<{ affectedCount: number; details?: Record<string, number> } | null>(null);

// ==================== Table Columns ====================

const policyColumns = [
  { title: '合规框架', dataIndex: 'framework', key: 'framework', width: 120 },
  { title: '策略类型', dataIndex: 'policy_type', key: 'policy_type', width: 140 },
  { title: '规则概要', dataIndex: 'rules', key: 'rules', ellipsis: true },
  { title: '启用', dataIndex: 'enabled', key: 'enabled', width: 80 },
  { title: '操作', key: 'actions', width: 180 },
];

const dsrColumns = [
  { title: '请求类型', dataIndex: 'request_type', key: 'request_type', width: 120 },
  { title: '主体 DID', dataIndex: 'subject_did', key: 'subject_did', ellipsis: true },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
  { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 160 },
  { title: '截止时间', dataIndex: 'deadline', key: 'deadline', width: 160 },
  { title: '操作', key: 'actions', width: 220 },
];

// ==================== Lifecycle ====================

onMounted(async () => {
  await Promise.all([
    loadPolicies(),
    loadDSRRequests(),
    loadComplianceScores(),
  ]);
});

// ==================== Data Loading ====================

async function loadPolicies() {
  try {
    await auditStore.fetchPolicies();
  } catch {
    message.error('加载合规策略失败');
  }
}

async function loadDSRRequests() {
  try {
    await auditStore.fetchDSRRequests();
  } catch {
    message.error('加载数据主体请求失败');
  }
}

async function loadComplianceScores() {
  try {
    const gdprResult = await auditStore.checkCompliance('GDPR');
    if (gdprResult.success && gdprResult.result) {
      gdprScore.value = gdprResult.result.score;
    }
  } catch {
    // GDPR check may fail silently
  }

  try {
    const soc2Result = await auditStore.checkCompliance('SOC2');
    if (soc2Result.success && soc2Result.result) {
      soc2Score.value = soc2Result.result.score;
    }
  } catch {
    // SOC2 check may fail silently
  }
}

// ==================== Score Helpers ====================

function getScoreColor(score: number): string {
  if (score > 80) return '#52c41a';
  if (score > 60) return '#faad14';
  return '#ff4d4f';
}

// ==================== Policy Handlers ====================

function openPolicyModal(policy?: CompliancePolicy) {
  if (policy) {
    editingPolicy.value = policy;
    policyForm.framework = policy.framework;
    policyForm.policy_type = policy.policy_type;
    policyForm.rules = policy.rules;
    policyForm.enabled = policy.enabled;
  } else {
    editingPolicy.value = null;
    policyForm.framework = 'GDPR';
    policyForm.policy_type = 'data_protection';
    policyForm.rules = '';
    policyForm.enabled = true;
  }
  policyModalVisible.value = true;
}

function closePolicyModal() {
  policyModalVisible.value = false;
  editingPolicy.value = null;
}

async function handleSavePolicy() {
  if (!policyForm.framework || !policyForm.policy_type) {
    message.warning('请填写必填字段');
    return;
  }

  // Validate JSON rules
  if (policyForm.rules) {
    try {
      JSON.parse(policyForm.rules);
    } catch {
      message.error('规则必须是有效的 JSON 格式');
      return;
    }
  }

  try {
    if (editingPolicy.value) {
      await auditStore.updatePolicy(editingPolicy.value.id, {
        framework: policyForm.framework,
        policy_type: policyForm.policy_type,
        rules: policyForm.rules,
        enabled: policyForm.enabled,
      });
      message.success('策略已更新');
    } else {
      await auditStore.createPolicy({
        framework: policyForm.framework,
        policy_type: policyForm.policy_type,
        rules: policyForm.rules,
        enabled: policyForm.enabled,
      });
      message.success('策略已创建');
    }
    closePolicyModal();
  } catch {
    message.error('保存策略失败');
  }
}

async function handleTogglePolicy(policy: CompliancePolicy, checked: boolean) {
  try {
    await auditStore.updatePolicy(policy.id, { enabled: checked });
    message.success(checked ? '策略已启用' : '策略已禁用');
  } catch {
    message.error('更新策略状态失败');
  }
}

async function handleDeletePolicy(policyId: string) {
  try {
    await auditStore.deletePolicy(policyId);
    message.success('策略已删除');
  } catch {
    message.error('删除策略失败');
  }
}

function formatRulesSummary(rules: string): string {
  if (!rules) return '-';
  try {
    const parsed = JSON.parse(rules);
    const keys = Object.keys(parsed);
    if (keys.length === 0) return '-';
    return keys.slice(0, 3).join(', ') + (keys.length > 3 ? '...' : '');
  } catch {
    return rules.length > 50 ? rules.substring(0, 50) + '...' : rules;
  }
}

// ==================== Compliance Check Handlers ====================

function handleFrameworkChange(framework: string) {
  selectedFramework.value = framework;
  runComplianceCheck();
}

async function runComplianceCheck() {
  try {
    await auditStore.checkCompliance(selectedFramework.value);
    // Update score refs based on framework
    if (auditStore.complianceResult) {
      if (selectedFramework.value === 'GDPR') {
        gdprScore.value = auditStore.complianceResult.score;
      } else if (selectedFramework.value === 'SOC2') {
        soc2Score.value = auditStore.complianceResult.score;
      }
    }
    message.success('合规检查完成');
  } catch {
    message.error('合规检查失败');
  }
}

async function handleGenerateReport() {
  try {
    await auditStore.generateReport(selectedFramework.value);
    message.success('合规报告已生成');
  } catch {
    message.error('生成合规报告失败');
  }
}

// ==================== DSR Handlers ====================

function getDSRStatusColor(status: string): string {
  const map: Record<string, string> = {
    pending: 'blue',
    in_progress: 'orange',
    completed: 'green',
    rejected: 'red',
  };
  return map[status] || 'default';
}

function getDSRStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: '待处理',
    in_progress: '处理中',
    completed: '已完成',
    rejected: '已拒绝',
  };
  return map[status] || status;
}

function getDSRTypeLabel(type?: string): string {
  const map: Record<string, string> = {
    access: '数据访问',
    deletion: '数据删除',
    rectification: '数据更正',
    portability: '数据迁移',
  };
  return map[type || ''] || type || '-';
}

function formatDate(timestamp: number): string {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString('zh-CN');
}

function openDSRModal() {
  dsrForm.request_type = 'access';
  dsrForm.subject_did = '';
  dsrModalVisible.value = true;
}

function closeDSRModal() {
  dsrModalVisible.value = false;
}

async function handleCreateDSR() {
  if (!dsrForm.subject_did) {
    message.warning('请输入数据主体 DID');
    return;
  }

  try {
    await auditStore.createDSR({
      request_type: dsrForm.request_type,
      subject_did: dsrForm.subject_did,
      deadline: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    message.success('数据主体请求已创建');
    closeDSRModal();
  } catch {
    message.error('创建数据主体请求失败');
  }
}

async function handleProcessDSR(requestId: string) {
  try {
    await auditStore.processDSR(requestId, 'start');
    message.success('已开始处理请求');
  } catch {
    message.error('处理请求失败');
  }
}

function openApproveModal(request: DataSubjectRequest) {
  approvingRequest.value = request;
  approveForm.comment = '';
  approveModalVisible.value = true;
}

function closeApproveModal() {
  approveModalVisible.value = false;
  approvingRequest.value = null;
}

async function handleApproveDSR() {
  if (!approvingRequest.value) return;

  try {
    await auditStore.approveDSR(
      approvingRequest.value.id,
      'current-user',
      approveForm.comment || undefined,
    );
    message.success('请求已审批通过');
    closeApproveModal();
  } catch {
    message.error('审批请求失败');
  }
}

async function handleViewDSRDetail(requestId: string) {
  try {
    const result = await auditStore.getDSRDetail(requestId);
    if (result.success) {
      dsrDetail.value = result.request || null;
      detailModalVisible.value = true;
    }
  } catch {
    message.error('获取请求详情失败');
  }
}

// ==================== Retention Handlers ====================

async function handlePreviewDeletion() {
  retentionLoading.value = true;
  try {
    const result = await auditStore.previewDeletion();
    if (result.success) {
      retentionPreview.value = {
        affectedCount: result.affectedCount || 0,
        details: result.details || {},
      };
    }
    message.success('预览完成');
  } catch {
    message.error('预览数据删除失败');
  } finally {
    retentionLoading.value = false;
  }
}

async function handleApplyRetention() {
  retentionLoading.value = true;
  try {
    const result = await auditStore.applyRetention();
    if (result.success) {
      message.success('数据保留策略已执行');
      retentionPreview.value = null;
    }
  } catch {
    message.error('执行数据保留策略失败');
  } finally {
    retentionLoading.value = false;
  }
}
</script>

<style scoped>
.compliance-dashboard {
  min-height: 100%;
}

.dashboard-content {
  padding: 24px;
}

.score-overview {
  margin-bottom: 24px;
}

.score-card {
  text-align: center;
}

.score-circle {
  display: flex;
  justify-content: center;
  padding: 16px 0;
}

.score-label {
  color: #666;
  font-size: 13px;
  margin-top: 8px;
}

.compliance-tabs {
  background: #fff;
  padding: 16px;
  border-radius: 8px;
}

.tab-toolbar {
  margin-bottom: 16px;
}

.rules-summary {
  color: #888;
  font-size: 12px;
}

.check-results {
  padding: 16px 0;
}

.recommendations {
  margin-top: 16px;
}

.recommendation-item {
  margin-bottom: 8px;
}

.overdue {
  color: #ff4d4f;
  font-weight: 600;
}

.retention-section {
  padding: 16px 0;
}
</style>
