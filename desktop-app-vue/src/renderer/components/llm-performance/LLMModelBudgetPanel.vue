<template>
  <a-card title="按模型预算限制" class="model-budget-panel">
    <template #extra>
      <a-button type="primary" size="small" @click="showAddModal">
        <PlusOutlined /> 添加限制
      </a-button>
    </template>

    <a-skeleton :loading="loading" active>
      <!-- Empty state -->
      <a-empty
        v-if="modelBudgets.length === 0"
        description="暂无模型预算限制"
      >
        <a-button type="primary" @click="showAddModal">
          <PlusOutlined /> 添加第一个限制
        </a-button>
      </a-empty>

      <!-- Model budget list -->
      <div v-else class="budget-list">
        <div
          v-for="budget in modelBudgets"
          :key="`${budget.provider}-${budget.model}`"
          class="budget-card"
          :class="{ disabled: !budget.enabled }"
        >
          <div class="budget-header">
            <div class="model-info">
              <a-tag :color="getProviderColor(budget.provider)">
                {{ budget.provider }}
              </a-tag>
              <span class="model-name">{{ budget.model }}</span>
            </div>
            <div class="budget-actions">
              <a-switch
                v-model:checked="budget.enabled"
                size="small"
                @change="(checked) => toggleBudget(budget, checked)"
              />
              <a-button
                type="text"
                size="small"
                @click="showEditModal(budget)"
              >
                <EditOutlined />
              </a-button>
              <a-popconfirm
                title="确定删除该模型的预算限制？"
                ok-text="删除"
                cancel-text="取消"
                @confirm="deleteBudget(budget)"
              >
                <a-button type="text" size="small" danger>
                  <DeleteOutlined />
                </a-button>
              </a-popconfirm>
            </div>
          </div>

          <div class="budget-progress">
            <!-- Daily -->
            <div v-if="budget.daily_limit_usd > 0" class="progress-item">
              <div class="progress-label">
                <span>日限额</span>
                <span class="progress-value">
                  ${{ (budget.current_daily_spend || 0).toFixed(4) }} /
                  ${{ budget.daily_limit_usd.toFixed(2) }}
                </span>
              </div>
              <a-progress
                :percent="getPercent(budget.current_daily_spend, budget.daily_limit_usd)"
                :status="getProgressStatus(budget.current_daily_spend, budget.daily_limit_usd)"
                size="small"
              />
            </div>

            <!-- Weekly -->
            <div v-if="budget.weekly_limit_usd > 0" class="progress-item">
              <div class="progress-label">
                <span>周限额</span>
                <span class="progress-value">
                  ${{ (budget.current_weekly_spend || 0).toFixed(4) }} /
                  ${{ budget.weekly_limit_usd.toFixed(2) }}
                </span>
              </div>
              <a-progress
                :percent="getPercent(budget.current_weekly_spend, budget.weekly_limit_usd)"
                :status="getProgressStatus(budget.current_weekly_spend, budget.weekly_limit_usd)"
                size="small"
              />
            </div>

            <!-- Monthly -->
            <div v-if="budget.monthly_limit_usd > 0" class="progress-item">
              <div class="progress-label">
                <span>月限额</span>
                <span class="progress-value">
                  ${{ (budget.current_monthly_spend || 0).toFixed(4) }} /
                  ${{ budget.monthly_limit_usd.toFixed(2) }}
                </span>
              </div>
              <a-progress
                :percent="getPercent(budget.current_monthly_spend, budget.monthly_limit_usd)"
                :status="getProgressStatus(budget.current_monthly_spend, budget.monthly_limit_usd)"
                size="small"
              />
            </div>

            <!-- No limits set -->
            <div
              v-if="budget.daily_limit_usd === 0 && budget.weekly_limit_usd === 0 && budget.monthly_limit_usd === 0"
              class="no-limits"
            >
              <WarningOutlined /> 未设置限额
            </div>
          </div>

          <div class="budget-footer">
            <span class="stat">
              <ApiOutlined /> {{ budget.total_calls || 0 }} 次调用
            </span>
            <span class="stat">
              <DollarOutlined /> ${{ (budget.total_cost_usd || 0).toFixed(4) }} 累计
            </span>
            <a-tag v-if="budget.blockOnLimit" color="red" size="small">
              超限阻止
            </a-tag>
            <a-tag v-else-if="budget.alertOnLimit" color="orange" size="small">
              超限告警
            </a-tag>
          </div>
        </div>
      </div>
    </a-skeleton>

    <!-- Add/Edit Modal -->
    <a-modal
      v-model:open="modalVisible"
      :title="isEditing ? '编辑模型预算' : '添加模型预算'"
      :confirm-loading="saving"
      @ok="saveBudget"
      @cancel="closeModal"
    >
      <a-form
        :model="formData"
        :label-col="{ span: 6 }"
        :wrapper-col="{ span: 18 }"
      >
        <a-form-item label="提供商" required>
          <a-select
            v-model:value="formData.provider"
            placeholder="选择提供商"
            :disabled="isEditing"
          >
            <a-select-option value="ollama">Ollama (本地)</a-select-option>
            <a-select-option value="openai">OpenAI</a-select-option>
            <a-select-option value="anthropic">Anthropic</a-select-option>
            <a-select-option value="deepseek">DeepSeek</a-select-option>
            <a-select-option value="volcengine">火山引擎</a-select-option>
            <a-select-option value="dashscope">阿里云</a-select-option>
            <a-select-option value="zhipuai">智谱AI</a-select-option>
            <a-select-option value="moonshot">Moonshot</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="模型" required>
          <a-auto-complete
            v-model:value="formData.model"
            :options="modelOptions"
            placeholder="输入或选择模型名称"
            :disabled="isEditing"
          />
        </a-form-item>

        <a-divider>预算限额 (USD)</a-divider>

        <a-form-item label="日限额">
          <a-input-number
            v-model:value="formData.dailyLimit"
            :min="0"
            :step="0.1"
            :precision="2"
            style="width: 100%"
            placeholder="0 表示无限制"
          />
        </a-form-item>

        <a-form-item label="周限额">
          <a-input-number
            v-model:value="formData.weeklyLimit"
            :min="0"
            :step="0.5"
            :precision="2"
            style="width: 100%"
            placeholder="0 表示无限制"
          />
        </a-form-item>

        <a-form-item label="月限额">
          <a-input-number
            v-model:value="formData.monthlyLimit"
            :min="0"
            :step="1"
            :precision="2"
            style="width: 100%"
            placeholder="0 表示无限制"
          />
        </a-form-item>

        <a-divider>行为设置</a-divider>

        <a-form-item label="超限告警">
          <a-switch v-model:checked="formData.alertOnLimit" />
          <span class="form-hint">达到限额时发送告警通知</span>
        </a-form-item>

        <a-form-item label="超限阻止">
          <a-switch v-model:checked="formData.blockOnLimit" />
          <span class="form-hint">达到限额时阻止该模型的调用</span>
        </a-form-item>
      </a-form>
    </a-modal>
  </a-card>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  WarningOutlined,
  ApiOutlined,
  DollarOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  loading: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["refresh"]);

// State
const modelBudgets = ref([]);
const modalVisible = ref(false);
const isEditing = ref(false);
const saving = ref(false);
const formData = ref({
  provider: "",
  model: "",
  dailyLimit: 0,
  weeklyLimit: 0,
  monthlyLimit: 0,
  alertOnLimit: true,
  blockOnLimit: false,
});

// Model options based on provider
const modelOptions = computed(() => {
  const provider = formData.value.provider;
  const models = {
    ollama: [
      { value: "qwen2:7b" },
      { value: "qwen2:14b" },
      { value: "llama3:8b" },
      { value: "mistral:7b" },
      { value: "codellama:7b" },
    ],
    openai: [
      { value: "gpt-4o" },
      { value: "gpt-4o-mini" },
      { value: "gpt-4-turbo" },
      { value: "gpt-3.5-turbo" },
    ],
    anthropic: [
      { value: "claude-3-opus-20240229" },
      { value: "claude-3-sonnet-20240229" },
      { value: "claude-3-haiku-20240307" },
    ],
    deepseek: [
      { value: "deepseek-chat" },
      { value: "deepseek-coder" },
    ],
    volcengine: [
      { value: "doubao-seed-1-6-flash-250828" },
      { value: "doubao-pro-32k" },
    ],
    dashscope: [
      { value: "qwen-turbo" },
      { value: "qwen-plus" },
      { value: "qwen-max" },
    ],
    zhipuai: [
      { value: "glm-4" },
      { value: "glm-4-flash" },
      { value: "glm-3-turbo" },
    ],
    moonshot: [
      { value: "moonshot-v1-8k" },
      { value: "moonshot-v1-32k" },
    ],
  };
  return models[provider] || [];
});

// Load model budgets
const loadModelBudgets = async () => {
  try {
    const budgets = await window.electronAPI.invoke("llm:get-model-budgets");
    modelBudgets.value = budgets;
  } catch (error) {
    console.error("加载模型预算失败:", error);
    message.error("加载模型预算失败");
  }
};

// Show add modal
const showAddModal = () => {
  isEditing.value = false;
  formData.value = {
    provider: "",
    model: "",
    dailyLimit: 0,
    weeklyLimit: 0,
    monthlyLimit: 0,
    alertOnLimit: true,
    blockOnLimit: false,
  };
  modalVisible.value = true;
};

// Show edit modal
const showEditModal = (budget) => {
  isEditing.value = true;
  formData.value = {
    provider: budget.provider,
    model: budget.model,
    dailyLimit: budget.daily_limit_usd || 0,
    weeklyLimit: budget.weekly_limit_usd || 0,
    monthlyLimit: budget.monthly_limit_usd || 0,
    alertOnLimit: budget.alertOnLimit,
    blockOnLimit: budget.blockOnLimit,
  };
  modalVisible.value = true;
};

// Close modal
const closeModal = () => {
  modalVisible.value = false;
};

// Save budget
const saveBudget = async () => {
  if (!formData.value.provider || !formData.value.model) {
    message.warning("请选择提供商和模型");
    return;
  }

  saving.value = true;
  try {
    await window.electronAPI.invoke("llm:set-model-budget", {
      provider: formData.value.provider,
      model: formData.value.model,
      dailyLimitUsd: formData.value.dailyLimit,
      weeklyLimitUsd: formData.value.weeklyLimit,
      monthlyLimitUsd: formData.value.monthlyLimit,
      alertOnLimit: formData.value.alertOnLimit,
      blockOnLimit: formData.value.blockOnLimit,
      enabled: true,
    });

    message.success(isEditing.value ? "预算已更新" : "预算已添加");
    modalVisible.value = false;
    await loadModelBudgets();
    emit("refresh");
  } catch (error) {
    console.error("保存预算失败:", error);
    message.error("保存预算失败: " + error.message);
  } finally {
    saving.value = false;
  }
};

// Toggle budget enabled/disabled
const toggleBudget = async (budget, enabled) => {
  try {
    await window.electronAPI.invoke("llm:set-model-budget", {
      provider: budget.provider,
      model: budget.model,
      dailyLimitUsd: budget.daily_limit_usd,
      weeklyLimitUsd: budget.weekly_limit_usd,
      monthlyLimitUsd: budget.monthly_limit_usd,
      alertOnLimit: budget.alertOnLimit,
      blockOnLimit: budget.blockOnLimit,
      enabled,
    });
    message.success(enabled ? "预算已启用" : "预算已禁用");
  } catch (error) {
    console.error("切换预算状态失败:", error);
    message.error("操作失败");
    // Revert the switch
    budget.enabled = !enabled;
  }
};

// Delete budget
const deleteBudget = async (budget) => {
  try {
    await window.electronAPI.invoke("llm:delete-model-budget", {
      provider: budget.provider,
      model: budget.model,
    });
    message.success("预算已删除");
    await loadModelBudgets();
    emit("refresh");
  } catch (error) {
    console.error("删除预算失败:", error);
    message.error("删除预算失败: " + error.message);
  }
};

// Helper functions
const getProviderColor = (provider) => {
  const colors = {
    ollama: "green",
    openai: "blue",
    anthropic: "purple",
    deepseek: "cyan",
    volcengine: "orange",
    dashscope: "gold",
    zhipuai: "magenta",
    moonshot: "geekblue",
  };
  return colors[provider] || "default";
};

const getPercent = (spent, limit) => {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, ((spent || 0) / limit) * 100);
};

const getProgressStatus = (spent, limit) => {
  const percent = getPercent(spent, limit);
  if (percent >= 100) return "exception";
  if (percent >= 80) return "active";
  return "normal";
};

// Lifecycle
onMounted(() => {
  loadModelBudgets();
});

// Expose refresh method
defineExpose({
  refresh: loadModelBudgets,
});
</script>

<style lang="less" scoped>
.model-budget-panel {
  .budget-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .budget-card {
    border: 1px solid #f0f0f0;
    border-radius: 8px;
    padding: 12px;
    background: #fafafa;
    transition: all 0.3s;

    &:hover {
      border-color: #1890ff;
      box-shadow: 0 2px 8px rgba(24, 144, 255, 0.1);
    }

    &.disabled {
      opacity: 0.6;
      background: #f5f5f5;
    }

    .budget-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;

      .model-info {
        display: flex;
        align-items: center;
        gap: 8px;

        .model-name {
          font-weight: 500;
          color: #262626;
        }
      }

      .budget-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }
    }

    .budget-progress {
      .progress-item {
        margin-bottom: 8px;

        &:last-child {
          margin-bottom: 0;
        }

        .progress-label {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: #8c8c8c;
          margin-bottom: 4px;

          .progress-value {
            font-weight: 500;
            color: #595959;
          }
        }
      }

      .no-limits {
        color: #faad14;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
    }

    .budget-footer {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed #f0f0f0;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;

      .stat {
        font-size: 12px;
        color: #8c8c8c;
        display: flex;
        align-items: center;
        gap: 4px;
      }
    }
  }
}

.form-hint {
  margin-left: 8px;
  font-size: 12px;
  color: #8c8c8c;
}

// Mobile
@media (max-width: 576px) {
  .model-budget-panel {
    .budget-card {
      .budget-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }

      .budget-footer {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  }
}
</style>
