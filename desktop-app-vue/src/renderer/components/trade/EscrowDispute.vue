<template>
  <div class="escrow-dispute">
    <a-modal
      :open="open"
      title="发起争议"
      width="650px"
      :confirm-loading="disputing"
      @ok="handleSubmit"
      @cancel="handleCancel"
    >
      <div v-if="escrow">
        <!-- 警告提示 -->
        <a-alert
          type="warning"
          message="请谨慎发起争议"
          style="margin-bottom: 16px"
        >
          <template #icon>
            <exclamation-circle-outlined />
          </template>
          <template #description>
            <p>发起争议将会:</p>
            <ul style="margin: 8px 0; padding-left: 20px">
              <li>暂停托管资金的释放</li>
              <li>通知交易对方</li>
              <li>启动仲裁流程</li>
              <li>可能需要提供证据材料</li>
            </ul>
            <p style="margin-top: 8px">
              请确保您有充分的理由发起争议。
            </p>
          </template>
        </a-alert>

        <!-- 托管信息 -->
        <a-card
          size="small"
          title="托管信息"
          style="margin-bottom: 16px"
        >
          <a-descriptions
            :column="2"
            size="small"
            bordered
          >
            <a-descriptions-item
              label="托管ID"
              :span="2"
            >
              <a-typography-text copyable>
                {{ escrow.id }}
              </a-typography-text>
            </a-descriptions-item>

            <a-descriptions-item label="托管金额">
              <span style="color: #faad14; font-weight: 600">
                {{ formatAmount(escrow.amount) }} {{ escrow.asset_symbol || 'CC' }}
              </span>
            </a-descriptions-item>

            <a-descriptions-item label="当前状态">
              <status-badge
                :status="escrow.status"
                type="escrow"
                show-icon
              />
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 争议表单 -->
        <a-form layout="vertical">
          <!-- 争议原因 -->
          <a-form-item
            label="争议原因"
            required
          >
            <a-select
              v-model:value="form.reason"
              placeholder="请选择争议原因"
              @change="handleReasonChange"
            >
              <a-select-option value="not_received">
                <a-space>
                  <close-circle-outlined style="color: #f5222d" />
                  <span>未收到商品/服务</span>
                </a-space>
              </a-select-option>
              <a-select-option value="not_as_described">
                <a-space>
                  <exclamation-circle-outlined style="color: #faad14" />
                  <span>商品/服务与描述不符</span>
                </a-space>
              </a-select-option>
              <a-select-option value="quality_issue">
                <a-space>
                  <warning-outlined style="color: #ff7a45" />
                  <span>质量问题</span>
                </a-space>
              </a-select-option>
              <a-select-option value="fraud">
                <a-space>
                  <stop-outlined style="color: #f5222d" />
                  <span>欺诈行为</span>
                </a-space>
              </a-select-option>
              <a-select-option value="other">
                <a-space>
                  <question-circle-outlined style="color: #8c8c8c" />
                  <span>其他原因</span>
                </a-space>
              </a-select-option>
            </a-select>
          </a-form-item>

          <!-- 详细描述 -->
          <a-form-item
            label="详细描述"
            required
          >
            <a-textarea
              v-model:value="form.description"
              placeholder="请详细描述争议情况，包括具体问题、沟通记录等..."
              :rows="6"
              :maxlength="1000"
              show-count
            />
            <template #extra>
              <span style="color: #8c8c8c">请提供尽可能详细的信息，有助于仲裁处理</span>
            </template>
          </a-form-item>

          <!-- 证据附件 -->
          <a-form-item label="证据材料（可选）">
            <a-upload
              v-model:file-list="form.evidenceFiles"
              :before-upload="handleBeforeUpload"
              :max-count="5"
              list-type="picture-card"
              accept="image/*,.pdf"
            >
              <div>
                <plus-outlined />
                <div style="margin-top: 8px">
                  上传证据
                </div>
              </div>
            </a-upload>
            <template #extra>
              <span style="color: #8c8c8c">
                支持图片和PDF文件，最多5个，每个不超过10MB
              </span>
            </template>
          </a-form-item>

          <!-- 联系方式 -->
          <a-form-item label="联系方式（用于仲裁沟通）">
            <a-input
              v-model:value="form.contact"
              placeholder="邮箱、电话或其他联系方式"
              :maxlength="100"
            >
              <template #prefix>
                <phone-outlined />
              </template>
            </a-input>
          </a-form-item>

          <!-- 期望结果 -->
          <a-form-item label="期望的解决方案">
            <a-checkbox-group v-model:value="form.expectedResolution">
              <a-checkbox value="refund">
                <wallet-outlined /> 全额退款
              </a-checkbox>
              <a-checkbox value="partial_refund">
                <dollar-outlined /> 部分退款
              </a-checkbox>
              <a-checkbox value="resend">
                <reload-outlined /> 重新发货/提供服务
              </a-checkbox>
              <a-checkbox value="compensation">
                <gift-outlined /> 赔偿补偿
              </a-checkbox>
            </a-checkbox-group>
          </a-form-item>
        </a-form>

        <!-- 同意条款 -->
        <a-checkbox
          v-model:checked="form.agreeTerms"
          style="margin-bottom: 16px"
        >
          我已阅读并同意
          <a
            href="#"
            @click.prevent="showTerms = true"
          >《争议仲裁条款》</a>
        </a-checkbox>
      </div>
    </a-modal>

    <!-- 仲裁条款对话框 -->
    <a-modal
      v-model:open="showTerms"
      title="争议仲裁条款"
      width="600px"
      :footer="null"
    >
      <div style="padding: 16px; max-height: 400px; overflow-y: auto">
        <h4>1. 仲裁流程</h4>
        <p>争议发起后，平台将在48小时内介入调查...</p>

        <h4>2. 证据要求</h4>
        <p>双方需提供相关证据材料，包括但不限于...</p>

        <h4>3. 仲裁结果</h4>
        <p>仲裁结果将在7个工作日内给出，结果具有最终效力...</p>

        <h4>4. 费用说明</h4>
        <p>仲裁过程产生的费用由败诉方承担...</p>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  ExclamationCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  StopOutlined,
  QuestionCircleOutlined,
  PhoneOutlined,
  PlusOutlined,
  WalletOutlined,
  DollarOutlined,
  ReloadOutlined,
  GiftOutlined,
} from '@ant-design/icons-vue';
import { useTradeStore } from '../../stores/trade';
import StatusBadge from './common/StatusBadge.vue';

// Store
const tradeStore = useTradeStore();

// Props
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  escrow: {
    type: Object,
    default: null,
  },
});

// Emits
const emit = defineEmits(['disputed', 'update:open']);

// 状态
const disputing = ref(false);
const showTerms = ref(false);

const form = reactive({
  reason: '',
  description: '',
  evidenceFiles: [],
  contact: '',
  expectedResolution: [],
  agreeTerms: false,
});

// 工具函数
const formatAmount = (amount) => {
  if (!amount && amount !== 0) {return '0';}
  const num = parseFloat(amount);
  if (isNaN(num)) {return '0';}
  return num.toLocaleString('en-US', { maximumFractionDigits: 8 });
};

// 事件处理

// 原因变化
const handleReasonChange = (value) => {
  // 根据原因自动填充描述模板
  const templates = {
    not_received: '我在约定时间内未收到商品/服务。',
    not_as_described: '收到的商品/服务与卖家描述的存在明显差异。',
    quality_issue: '商品/服务存在质量问题。',
    fraud: '交易过程中存在欺诈行为。',
    other: '',
  };

  if (!form.description && templates[value]) {
    form.description = templates[value];
  }
};

// 上传前验证
const handleBeforeUpload = (file) => {
  // 检查文件大小
  const isLt10M = file.size / 1024 / 1024 < 10;
  if (!isLt10M) {
    message.error('文件大小不能超过 10MB');
    return false;
  }

  // 检查文件类型
  const isValidType = file.type.startsWith('image/') || file.type === 'application/pdf';
  if (!isValidType) {
    message.error('只支持图片和PDF文件');
    return false;
  }

  return false; // 阻止自动上传
};

// 提交争议
const handleSubmit = async () => {
  try {
    // 验证表单
    if (!validateForm()) {
      return;
    }

    disputing.value = true;

    const disputeData = {
      escrowId: props.escrow.id,
      reason: form.reason,
      description: form.description,
      contact: form.contact,
      expectedResolution: form.expectedResolution,
      evidenceFiles: form.evidenceFiles.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type,
      })),
    };

    // 使用 store 发起争议
    await tradeStore.disputeEscrow(props.escrow.id, form.reason, form.description);

    console.log('[EscrowDispute] 争议已发起:', props.escrow.id);
    message.success('争议已发起，等待仲裁处理');

    // 通知父组件
    emit('disputed', disputeData);

    // 关闭对话框
    emit('update:open', false);

    // 重置表单
    resetForm();
  } catch (error) {
    console.error('[EscrowDispute] 发起争议失败:', error);
    message.error(error.message || '发起争议失败');
  } finally {
    disputing.value = false;
  }
};

// 验证表单
const validateForm = () => {
  if (!form.reason) {
    message.warning('请选择争议原因');
    return false;
  }

  if (!form.description || form.description.trim().length === 0) {
    message.warning('请填写详细描述');
    return false;
  }

  if (form.description.trim().length < 20) {
    message.warning('详细描述至少需要 20 个字符');
    return false;
  }

  if (!form.agreeTerms) {
    message.warning('请阅读并同意仲裁条款');
    return false;
  }

  return true;
};

// 取消
const handleCancel = () => {
  emit('update:open', false);
  resetForm();
};

// 重置表单
const resetForm = () => {
  form.reason = '';
  form.description = '';
  form.evidenceFiles = [];
  form.contact = '';
  form.expectedResolution = [];
  form.agreeTerms = false;
};

// 监听对话框打开
watch(
  () => props.open,
  (newVal) => {
    if (newVal) {
      resetForm();
    }
  }
);
</script>

<style scoped>
.escrow-dispute {
  /* 样式 */
}

:deep(.ant-alert-warning) {
  border-radius: 8px;
}

:deep(.ant-alert ul) {
  margin-bottom: 0;
}

:deep(.ant-alert ul li) {
  margin-bottom: 4px;
}

:deep(.ant-upload-list-picture-card-container) {
  width: 104px;
  height: 104px;
}
</style>
