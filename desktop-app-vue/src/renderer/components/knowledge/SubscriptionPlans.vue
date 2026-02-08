<template>
  <div class="subscription-plans">
    <a-card>
      <template #title>
        <a-space>
          <calendar-outlined />
          <span>订阅计划管理</span>
        </a-space>
      </template>
      <template #extra>
        <a-space>
          <a-button type="primary" @click="showCreateModal = true">
            <template #icon>
              <plus-outlined />
            </template>
            创建计划
          </a-button>
          <a-button @click="loadPlans">
            <template #icon>
              <reload-outlined />
            </template>
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 订阅计划列表 -->
      <a-spin :spinning="loading">
        <a-row :gutter="[16, 16]">
          <a-col
            v-for="plan in plans"
            :key="plan.id"
            :xs="24"
            :sm="12"
            :md="8"
            :lg="6"
          >
            <a-card
              hoverable
              class="plan-card"
              :class="{ recommended: plan.isRecommended }"
            >
              <template #title>
                <div class="plan-title">
                  {{ plan.name }}
                  <a-tag
                    v-if="plan.isRecommended"
                    color="orange"
                    style="margin-left: 8px"
                  >
                    推荐
                  </a-tag>
                </div>
              </template>

              <div class="plan-price">
                <span class="price-amount">¥{{ plan.monthlyPrice }}</span>
                <span class="price-period">/月</span>
              </div>

              <a-divider />

              <div class="plan-features">
                <div
                  v-for="(feature, index) in parsedFeatures(plan.features)"
                  :key="index"
                  class="feature-item"
                >
                  <check-outlined style="color: #52c41a" />
                  <span>{{ feature }}</span>
                </div>
              </div>

              <a-divider />

              <div class="plan-stats">
                <a-space direction="vertical" size="small" style="width: 100%">
                  <div class="stat-item">
                    <team-outlined />
                    <span>{{ plan.subscriberCount || 0 }} 位订阅者</span>
                  </div>
                  <div class="stat-item">
                    <clock-circle-outlined />
                    <span>创建于 {{ formatDate(plan.createdAt) }}</span>
                  </div>
                </a-space>
              </div>

              <template #actions>
                <a-button type="link" @click="editPlan(plan)">
                  <edit-outlined /> 编辑
                </a-button>
                <a-popconfirm
                  title="确定要删除这个计划吗？"
                  @confirm="deletePlan(plan.id)"
                >
                  <a-button type="link" danger>
                    <delete-outlined /> 删除
                  </a-button>
                </a-popconfirm>
              </template>
            </a-card>
          </a-col>
        </a-row>

        <!-- 空状态 -->
        <a-empty v-if="plans.length === 0" description="暂无订阅计划">
          <a-button type="primary" @click="showCreateModal = true">
            创建第一个计划
          </a-button>
        </a-empty>
      </a-spin>
    </a-card>

    <!-- 创建/编辑订阅计划对话框 -->
    <a-modal
      v-model:open="showCreateModal"
      :title="editingPlan ? '编辑订阅计划' : '创建订阅计划'"
      width="700px"
      :confirm-loading="saving"
      @ok="handleSave"
      @cancel="handleCancel"
    >
      <a-form layout="vertical">
        <!-- 计划名称 -->
        <a-form-item label="计划名称" required>
          <a-input
            v-model:value="form.name"
            placeholder="例如：基础版、专业版、企业版"
            :maxlength="50"
          />
        </a-form-item>

        <!-- 计划描述 -->
        <a-form-item label="计划描述">
          <a-textarea
            v-model:value="form.description"
            :rows="3"
            placeholder="简要描述这个订阅计划..."
            :maxlength="500"
            show-count
          />
        </a-form-item>

        <!-- 月费 -->
        <a-form-item label="月费（元）" required>
          <a-input-number
            v-model:value="form.monthlyPrice"
            :min="0"
            :max="99999"
            style="width: 100%"
            placeholder="设置月费价格"
          >
            <template #prefix> ¥ </template>
          </a-input-number>
        </a-form-item>

        <!-- 计划特性 -->
        <a-form-item label="计划特性（每行一个）" required>
          <a-textarea
            v-model:value="featuresText"
            :rows="6"
            placeholder="输入订阅计划包含的特性，每行一个：&#10;- 无限制访问所有文章&#10;- 每月2次咨询服务&#10;- 专属社群"
          />
        </a-form-item>

        <!-- 推荐标签 -->
        <a-form-item label="推荐设置">
          <a-checkbox v-model:checked="form.isRecommended">
            标记为推荐计划（显示推荐标签）
          </a-checkbox>
        </a-form-item>

        <!-- 状态 -->
        <a-form-item label="计划状态">
          <a-radio-group v-model:value="form.status">
            <a-radio value="active"> 激活（用户可订阅） </a-radio>
            <a-radio value="inactive"> 停用（暂时关闭） </a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>

      <!-- 提示 -->
      <a-alert
        message="订阅计划提示"
        type="info"
        show-icon
        style="margin-top: 16px"
      >
        <template #description>
          <ul style="margin: 8px 0; padding-left: 20px">
            <li>订阅者将按月支付费用，自动续订</li>
            <li>订阅期间可访问您的所有付费内容</li>
            <li>修改价格不影响现有订阅者</li>
            <li>推荐计划会在列表中突出显示</li>
          </ul>
        </template>
      </a-alert>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  CalendarOutlined,
  PlusOutlined,
  ReloadOutlined,
  CheckOutlined,
  TeamOutlined,
  ClockCircleOutlined,
  EditOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import { useTradeStore } from "../../stores/trade";

// Store
const tradeStore = useTradeStore();

// 从 store 获取状态
const loading = computed(() => tradeStore.knowledge.loading);
const plans = computed(() => tradeStore.knowledge.subscriptionPlans);

// 本地状态
const saving = ref(false);
const showCreateModal = ref(false);
const editingPlan = ref(null);
const featuresText = ref("");

const form = reactive({
  name: "",
  description: "",
  monthlyPrice: 0,
  features: "",
  isRecommended: false,
  status: "active",
});

// 加载订阅计划
const loadPlans = async () => {
  try {
    // 获取当前用户DID
    const currentIdentity = await window.electronAPI.did.getCurrentIdentity();
    const userDid = currentIdentity?.did;

    if (!userDid) {
      message.warning("请先创建DID身份");
      return;
    }

    // 使用 store 加载订阅计划（这里可能需要传 creatorDid）
    // 暂时使用直接 IPC 调用
    const result =
      await window.electronAPI.knowledge.getSubscriptionPlans(userDid);
    tradeStore.knowledge.subscriptionPlans = result || [];

    logger.info("[SubscriptionPlans] 计划列表已加载:", plans.value.length);
  } catch (error) {
    logger.error("[SubscriptionPlans] 加载计划失败:", error);
    message.error(error.message || "加载计划失败");
  }
};

// 解析特性列表
const parsedFeatures = (features) => {
  if (!features) {
    return [];
  }
  if (typeof features === "string") {
    return features
      .split(",")
      .map((f) => f.trim())
      .filter((f) => f);
  }
  return features;
};

// 保存计划
const handleSave = async () => {
  try {
    // 验证
    if (!validateForm()) {
      return;
    }

    saving.value = true;

    // 准备数据
    const planData = {
      name: form.name,
      description: form.description,
      monthlyPrice: form.monthlyPrice,
      features: featuresText.value
        .split("\n")
        .map((f) => f.trim().replace(/^[-•]\s*/, ""))
        .filter((f) => f)
        .join(","),
      isRecommended: form.isRecommended,
      status: form.status,
    };

    if (editingPlan.value) {
      // 更新计划
      await window.electronAPI.knowledge.updateSubscriptionPlan(
        editingPlan.value.id,
        planData,
      );

      logger.info("[SubscriptionPlans] 计划已更新:", editingPlan.value.id);
      message.success("计划已更新！");
    } else {
      // 创建计划
      await window.electronAPI.knowledge.createSubscriptionPlan(planData);

      logger.info("[SubscriptionPlans] 计划已创建");
      message.success("计划创建成功！");
    }

    showCreateModal.value = false;
    editingPlan.value = null;
    resetForm();

    await loadPlans();
  } catch (error) {
    logger.error("[SubscriptionPlans] 保存计划失败:", error);
    message.error(error.message || "保存计划失败");
  } finally {
    saving.value = false;
  }
};

// 验证表单
const validateForm = () => {
  if (!form.name || form.name.trim() === "") {
    message.warning("请输入计划名称");
    return false;
  }

  if (form.monthlyPrice === 0) {
    message.warning("请设置月费价格");
    return false;
  }

  if (!featuresText.value || featuresText.value.trim() === "") {
    message.warning("请输入至少一个特性");
    return false;
  }

  return true;
};

// 编辑计划
const editPlan = (plan) => {
  editingPlan.value = plan;
  form.name = plan.name;
  form.description = plan.description || "";
  form.monthlyPrice = plan.monthlyPrice;
  featuresText.value = parsedFeatures(plan.features).join("\n");
  form.isRecommended = plan.isRecommended || false;
  form.status = plan.status || "active";
  showCreateModal.value = true;
};

// 删除计划
const deletePlan = async (planId) => {
  try {
    await window.electronAPI.knowledge.deleteSubscriptionPlan(planId);

    logger.info("[SubscriptionPlans] 计划已删除:", planId);
    message.success("计划已删除！");

    await loadPlans();
  } catch (error) {
    logger.error("[SubscriptionPlans] 删除计划失败:", error);
    message.error(error.message || "删除计划失败");
  }
};

// 取消
const handleCancel = () => {
  showCreateModal.value = false;
  editingPlan.value = null;
  resetForm();
};

// 重置表单
const resetForm = () => {
  form.name = "";
  form.description = "";
  form.monthlyPrice = 0;
  featuresText.value = "";
  form.isRecommended = false;
  form.status = "active";
};

// 格式化日期
const formatDate = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleDateString("zh-CN");
};

// 生命周期
onMounted(() => {
  loadPlans();
});
</script>

<style scoped>
.subscription-plans {
  padding: 20px;
}

.plan-card {
  height: 100%;
  position: relative;
}

.plan-card.recommended {
  border: 2px solid #faad14;
  box-shadow: 0 4px 12px rgba(250, 173, 20, 0.2);
}

.plan-title {
  font-size: 16px;
  font-weight: bold;
  display: flex;
  align-items: center;
}

.plan-price {
  text-align: center;
  padding: 16px 0;
}

.price-amount {
  font-size: 36px;
  font-weight: bold;
  color: #1890ff;
}

.price-period {
  font-size: 14px;
  color: #999;
  margin-left: 4px;
}

.plan-features {
  min-height: 120px;
  margin: 16px 0;
}

.feature-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 14px;
}

.plan-stats {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

.stat-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #666;
}

:deep(.ant-alert ul) {
  margin-bottom: 0;
}

:deep(.ant-alert ul li) {
  margin-bottom: 4px;
}
</style>
