<template>
  <div class="contract-execute">
    <a-modal
      :open="open"
      title="执行合约"
      width="750px"
      :confirm-loading="executing"
      @ok="handleExecute"
      @cancel="handleCancel"
    >
      <div v-if="contract">
        <!-- 合约信息 -->
        <a-card size="small" title="合约信息" style="margin-bottom: 16px">
          <a-descriptions :column="2" size="small" bordered>
            <a-descriptions-item label="合约ID" :span="2">
              <a-typography-text copyable>
                {{ contract.id }}
              </a-typography-text>
            </a-descriptions-item>
            <a-descriptions-item label="合约名称" :span="2">
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

        <!-- 条件检查 -->
        <a-card size="small" title="条件检查" style="margin-bottom: 16px">
          <a-spin :spinning="checkingConditions">
            <a-list
              v-if="conditions.length > 0"
              :data-source="conditions"
              size="small"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta>
                    <template #avatar>
                      <a-badge
                        :status="item.met ? 'success' : 'error'"
                        :text="item.met ? '✓' : '✗'"
                      />
                    </template>
                    <template #title>
                      {{ getConditionTypeName(item.type) }}
                      <a-tag v-if="item.required" color="red" size="small">
                        必需
                      </a-tag>
                    </template>
                    <template #description>
                      <span
                        :style="{ color: item.met ? '#52c41a' : '#f5222d' }"
                      >
                        {{ item.met ? "条件已满足" : "条件未满足" }}
                      </span>
                    </template>
                  </a-list-item-meta>
                </a-list-item>
              </template>
            </a-list>

            <a-empty v-else description="无条件限制" :image="simpleImage" />

            <a-alert
              v-if="conditionCheckResult"
              :type="conditionCheckResult.allMet ? 'success' : 'error'"
              style="margin-top: 16px"
            >
              <template #message>
                {{
                  conditionCheckResult.allMet
                    ? "✅ 所有必需条件已满足，可以执行"
                    : "❌ 存在未满足的必需条件，无法执行"
                }}
              </template>
            </a-alert>
          </a-spin>

          <a-button
            type="primary"
            size="small"
            style="margin-top: 12px"
            @click="handleCheckConditions"
          >
            <reload-outlined /> 重新检查
          </a-button>
        </a-card>

        <!-- 执行参数 -->
        <a-card size="small" title="执行参数" style="margin-bottom: 16px">
          <a-form layout="vertical">
            <a-form-item label="执行备注">
              <a-textarea
                v-model:value="form.memo"
                placeholder="可以添加执行备注..."
                :rows="3"
                :maxlength="200"
                show-count
              />
            </a-form-item>
          </a-form>
        </a-card>

        <!-- 执行预警 -->
        <a-alert type="warning" message="执行确认" style="margin-bottom: 16px">
          <template #description>
            <ul style="margin: 8px 0; padding-left: 20px">
              <li>执行合约将触发预定义的操作（如资金转移、资产转让等）</li>
              <li>执行后无法撤回</li>
              <li>请确认所有条件已满足</li>
              <li>执行结果将被永久记录在区块链上</li>
            </ul>
          </template>
        </a-alert>

        <!-- 同意确认 -->
        <a-checkbox v-model:checked="form.agreeExecute">
          我确认所有信息无误，同意执行此合约
        </a-checkbox>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, computed, watch } from "vue";
import { Empty, message } from "ant-design-vue";
import { ReloadOutlined } from "@ant-design/icons-vue";
import { useTradeStore } from "../../stores/trade";
import StatusBadge from "./common/StatusBadge.vue";

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
const emit = defineEmits(["executed", "update:open"]);

// 状态
const executing = ref(false);
const checkingConditions = ref(false);
const conditions = ref([]);
const conditionCheckResult = ref(null);
const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE;

const form = reactive({
  memo: "",
  agreeExecute: false,
});

// 工具函数
const getContractTypeColor = (type) => {
  const colorMap = {
    trade: "green",
    service: "blue",
    escrow: "orange",
    subscription: "purple",
    exchange: "cyan",
  };
  return colorMap[type] || "default";
};

const getContractTypeName = (type) => {
  const nameMap = {
    trade: "交易合约",
    service: "服务合约",
    escrow: "托管合约",
    subscription: "订阅合约",
    exchange: "交换合约",
  };
  return nameMap[type] || type;
};

const getConditionTypeName = (type) => {
  const nameMap = {
    time: "时间条件",
    payment: "支付条件",
    signature: "签名条件",
    balance: "余额条件",
    approval: "审批条件",
    custom: "自定义条件",
  };
  return nameMap[type] || type;
};

// 检查条件
const handleCheckConditions = async () => {
  if (!props.contract) {
    return;
  }

  checkingConditions.value = true;
  try {
    // 使用 store 检查条件
    const result = await tradeStore.checkContractConditions(props.contract.id);

    conditions.value = result.conditions || [];
    conditionCheckResult.value = {
      allMet: result.allMet,
    };

    logger.info("[ContractExecute] 条件检查完成:", result);

    if (result.allMet) {
      message.success("所有必需条件已满足");
    } else {
      message.warning("存在未满足的必需条件");
    }
  } catch (error) {
    logger.error("[ContractExecute] 检查条件失败:", error);
    message.error(error.message || "检查条件失败");
  } finally {
    checkingConditions.value = false;
  }
};

// 执行合约
const handleExecute = async () => {
  try {
    // 验证
    if (!validateForm()) {
      return;
    }

    executing.value = true;

    // 使用 store 执行合约
    await tradeStore.executeContract(props.contract.id);

    logger.info("[ContractExecute] 合约执行成功:", props.contract.id);
    message.success("合约执行成功！");

    // 通知父组件
    emit("executed", {
      contractId: props.contract.id,
      memo: form.memo,
    });

    // 关闭对话框
    emit("update:open", false);

    // 重置表单
    resetForm();
  } catch (error) {
    logger.error("[ContractExecute] 执行失败:", error);
    message.error(error.message || "执行失败");
  } finally {
    executing.value = false;
  }
};

// 验证表单
const validateForm = () => {
  if (!props.contract) {
    message.warning("合约信息无效");
    return false;
  }

  if (props.contract.status !== "active") {
    message.warning("只能执行激活状态的合约");
    return false;
  }

  if (conditionCheckResult.value && !conditionCheckResult.value.allMet) {
    message.warning("存在未满足的必需条件，无法执行");
    return false;
  }

  if (!form.agreeExecute) {
    message.warning("请确认同意执行合约");
    return false;
  }

  return true;
};

// 取消
const handleCancel = () => {
  emit("update:open", false);
  resetForm();
};

// 重置表单
const resetForm = () => {
  form.memo = "";
  form.agreeExecute = false;
  conditions.value = [];
  conditionCheckResult.value = null;
};

// 监听对话框打开
watch(
  () => props.open,
  async (newVal) => {
    if (newVal && props.contract) {
      resetForm();
      await handleCheckConditions();
    }
  },
);
</script>

<style scoped>
.contract-execute {
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
</style>
