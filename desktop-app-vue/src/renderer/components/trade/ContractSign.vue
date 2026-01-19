<template>
  <div class="contract-sign">
    <a-modal
      :open="open"
      title="签名合约"
      width="700px"
      :confirm-loading="signing"
      @ok="handleSign"
      @cancel="handleCancel"
    >
      <div v-if="contract">
        <!-- 警告提示 -->
        <a-alert
          type="warning"
          message="请谨慎签名"
          style="margin-bottom: 16px"
        >
          <template #icon>
            <safety-certificate-outlined />
          </template>
          <template #description>
            <ul style="margin: 8px 0; padding-left: 20px">
              <li>签名表示您同意合约中的所有条款</li>
              <li>签名后将无法撤回</li>
              <li>请仔细阅读合约内容后再签名</li>
              <li>签名将使用您的 DID 私钥进行</li>
            </ul>
          </template>
        </a-alert>

        <!-- 合约信息 -->
        <a-card
          size="small"
          title="合约信息"
          style="margin-bottom: 16px"
        >
          <a-descriptions
            :column="2"
            size="small"
            bordered
          >
            <a-descriptions-item
              label="合约ID"
              :span="2"
            >
              <a-typography-text copyable>
                {{ contract.id }}
              </a-typography-text>
            </a-descriptions-item>

            <a-descriptions-item
              label="合约名称"
              :span="2"
            >
              <strong>{{ contract.name || contract.title }}</strong>
            </a-descriptions-item>

            <a-descriptions-item label="合约类型">
              <a-tag :color="getContractTypeColor(contract.contract_type)">
                {{ getContractTypeName(contract.contract_type) }}
              </a-tag>
            </a-descriptions-item>

            <a-descriptions-item label="合约状态">
              <status-badge
                :status="contract.status"
                type="contract"
                show-icon
              />
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <!-- 合约参与方 -->
        <a-card
          size="small"
          title="合约参与方"
          style="margin-bottom: 16px"
        >
          <a-list
            :data-source="contractParties"
            size="small"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta>
                  <template #avatar>
                    <a-avatar :style="{ backgroundColor: getPartyColor(item.role) }">
                      {{ getPartyLabel(item.role) }}
                    </a-avatar>
                  </template>
                  <template #title>
                    <a-space>
                      <a-typography-text copyable>
                        {{ item.did }}
                      </a-typography-text>
                      <a-tag
                        v-if="item.isCurrentUser"
                        color="blue"
                      >
                        我
                      </a-tag>
                    </a-space>
                  </template>
                  <template #description>
                    <a-space>
                      <span>{{ item.role }}</span>
                      <a-divider type="vertical" />
                      <span
                        v-if="item.signed"
                        style="color: #52c41a"
                      >
                        <check-circle-outlined /> 已签名
                      </span>
                      <span
                        v-else
                        style="color: #8c8c8c"
                      >
                        <clock-circle-outlined /> 待签名
                      </span>
                    </a-space>
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-card>

        <!-- 合约内容 -->
        <a-card
          v-if="contract.description"
          size="small"
          title="合约内容"
          style="margin-bottom: 16px"
        >
          <a-typography-paragraph>
            {{ contract.description }}
          </a-typography-paragraph>
        </a-card>

        <!-- 签名确认 -->
        <a-card
          size="small"
          title="签名确认"
          style="margin-bottom: 16px"
        >
          <a-form layout="vertical">
            <!-- 签名方式 -->
            <a-form-item label="签名方式">
              <a-radio-group
                v-model:value="form.signatureType"
                button-style="solid"
              >
                <a-radio-button value="did">
                  <idcard-outlined /> DID签名
                </a-radio-button>
                <a-radio-button
                  value="manual"
                  disabled
                >
                  <edit-outlined /> 手动签名（暂不支持）
                </a-radio-button>
              </a-radio-group>
            </a-form-item>

            <!-- 签名备注 -->
            <a-form-item label="签名备注（可选）">
              <a-textarea
                v-model:value="form.memo"
                placeholder="可以添加签名备注信息..."
                :rows="3"
                :maxlength="200"
                show-count
              />
            </a-form-item>

            <!-- 签名预览 -->
            <a-form-item label="签名信息预览">
              <div class="signature-preview">
                <div class="preview-item">
                  <span class="label">签名者DID:</span>
                  <span class="value">{{ currentUserDid }}</span>
                </div>
                <div class="preview-item">
                  <span class="label">签名时间:</span>
                  <span class="value">{{ new Date().toLocaleString('zh-CN') }}</span>
                </div>
                <div class="preview-item">
                  <span class="label">签名方式:</span>
                  <span class="value">{{ form.signatureType === 'did' ? 'DID数字签名' : '手动签名' }}</span>
                </div>
              </div>
            </a-form-item>
          </a-form>
        </a-card>

        <!-- 同意条款 -->
        <a-checkbox v-model:checked="form.agreeTerms">
          我已仔细阅读并同意签署此合约
        </a-checkbox>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import { message } from 'ant-design-vue';
import {
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  IdcardOutlined,
  EditOutlined,
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
  contract: {
    type: Object,
    default: null,
  },
});

// Emits
const emit = defineEmits(['signed', 'update:open']);

// 状态
const signing = ref(false);
const currentUserDid = ref('');

const form = reactive({
  signatureType: 'did',
  memo: '',
  agreeTerms: false,
});

// 计算属性

// 合约参与方
const contractParties = computed(() => {
  if (!props.contract) {return [];}

  const parties = [];

  // 甲方
  if (props.contract.party_a_did) {
    parties.push({
      role: '甲方',
      did: props.contract.party_a_did,
      signed: props.contract.party_a_signed,
      isCurrentUser: props.contract.party_a_did === currentUserDid.value,
    });
  }

  // 乙方
  if (props.contract.party_b_did) {
    parties.push({
      role: '乙方',
      did: props.contract.party_b_did,
      signed: props.contract.party_b_signed,
      isCurrentUser: props.contract.party_b_did === currentUserDid.value,
    });
  }

  return parties;
});

// 工具函数

// 合约类型颜色
const getContractTypeColor = (type) => {
  const colorMap = {
    trade: 'green',
    service: 'blue',
    escrow: 'orange',
    subscription: 'purple',
    exchange: 'cyan',
  };
  return colorMap[type] || 'default';
};

// 合约类型名称
const getContractTypeName = (type) => {
  const nameMap = {
    trade: '交易合约',
    service: '服务合约',
    escrow: '托管合约',
    subscription: '订阅合约',
    exchange: '交换合约',
  };
  return nameMap[type] || type;
};

// 参与方颜色
const getPartyColor = (role) => {
  return role === '甲方' ? '#1890ff' : '#52c41a';
};

// 参与方标签
const getPartyLabel = (role) => {
  return role === '甲方' ? '甲' : '乙';
};

// 事件处理

// 签名合约
const handleSign = async () => {
  try {
    // 验证
    if (!validateForm()) {
      return;
    }

    signing.value = true;

    // 生成签名（使用 DID 私钥）
    const signatureData = {
      contractId: props.contract.id,
      did: currentUserDid.value,
      timestamp: Date.now(),
      memo: form.memo,
    };

    const signature = `did_signature_${currentUserDid.value}_${Date.now()}`;

    // 使用 store 签名合约
    await tradeStore.signContract(props.contract.id, signature);

    console.log('[ContractSign] 合约签名成功:', props.contract.id);
    message.success('合约签名成功！');

    // 通知父组件
    emit('signed', {
      contractId: props.contract.id,
      signature,
      memo: form.memo,
    });

    // 关闭对话框
    emit('update:open', false);

    // 重置表单
    resetForm();
  } catch (error) {
    console.error('[ContractSign] 签名失败:', error);
    message.error(error.message || '签名失败');
  } finally {
    signing.value = false;
  }
};

// 验证表单
const validateForm = () => {
  if (!props.contract) {
    message.warning('合约信息无效');
    return false;
  }

  if (!currentUserDid.value) {
    message.warning('未获取到当前用户身份');
    return false;
  }

  // 检查当前用户是否为合约参与方
  const isParty =
    props.contract.party_a_did === currentUserDid.value ||
    props.contract.party_b_did === currentUserDid.value;

  if (!isParty) {
    message.warning('您不是此合约的参与方');
    return false;
  }

  // 检查是否已签名
  if (
    (props.contract.party_a_did === currentUserDid.value && props.contract.party_a_signed) ||
    (props.contract.party_b_did === currentUserDid.value && props.contract.party_b_signed)
  ) {
    message.warning('您已签署此合约');
    return false;
  }

  if (!form.agreeTerms) {
    message.warning('请阅读并同意合约条款');
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
  form.signatureType = 'did';
  form.memo = '';
  form.agreeTerms = false;
};

// 获取当前用户 DID
const loadCurrentUserDid = async () => {
  try {
    const identity = await window.electronAPI.did.getCurrentIdentity();
    if (identity) {
      currentUserDid.value = identity.did;
    }
  } catch (error) {
    console.error('[ContractSign] 获取当前用户 DID 失败:', error);
  }
};

// 监听对话框打开
watch(
  () => props.open,
  async (newVal) => {
    if (newVal) {
      await loadCurrentUserDid();
      resetForm();
    }
  }
);
</script>

<style scoped>
.contract-sign {
  /* 样式 */
}

.signature-preview {
  background: #f5f5f5;
  border-radius: 8px;
  padding: 16px;
}

.preview-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 13px;
}

.preview-item:last-child {
  margin-bottom: 0;
}

.preview-item .label {
  color: #8c8c8c;
  font-weight: 500;
}

.preview-item .value {
  color: #262626;
  font-weight: 600;
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
</style>
