<template>
  <div class="contract-arbitration">
    <a-card>
      <template #title>
        <a-space>
          <gavel-outlined />
          <span>合约仲裁管理</span>
        </a-space>
      </template>
      <template #extra>
        <a-button @click="loadArbitrations">
          <template #icon>
            <reload-outlined />
          </template>
          刷新
        </a-button>
      </template>

      <!-- 筛选 -->
      <a-row :gutter="[16, 16]" style="margin-bottom: 16px">
        <a-col :span="8">
          <a-select
            v-model:value="filterStatus"
            style="width: 100%"
            @change="loadArbitrations"
          >
            <a-select-option value=""> 全部状态 </a-select-option>
            <a-select-option value="pending"> 待处理 </a-select-option>
            <a-select-option value="investigating"> 调查中 </a-select-option>
            <a-select-option value="resolved"> 已解决 </a-select-option>
            <a-select-option value="rejected"> 已拒绝 </a-select-option>
          </a-select>
        </a-col>
      </a-row>

      <!-- 仲裁列表 -->
      <a-spin :spinning="loading">
        <a-list
          :data-source="arbitrations"
          item-layout="vertical"
          :pagination="{ pageSize: 10 }"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta>
                <template #title>
                  <a-space>
                    <a-tag :color="getStatusColor(item.status)">
                      {{ getStatusName(item.status) }}
                    </a-tag>
                    <span style="font-weight: bold"
                      >合约仲裁 #{{ item.id.substring(0, 8) }}</span
                    >
                  </a-space>
                </template>
                <template #description>
                  <a-descriptions :column="2" size="small">
                    <a-descriptions-item label="合约ID">
                      <a-typography-text copyable style="font-size: 12px">
                        {{ item.contractId }}
                      </a-typography-text>
                    </a-descriptions-item>
                    <a-descriptions-item label="发起者">
                      <a-typography-text copyable style="font-size: 12px">
                        {{ shortenDid(item.initiatorDid) }}
                      </a-typography-text>
                    </a-descriptions-item>
                    <a-descriptions-item label="发起时间">
                      {{ formatTime(item.createdAt) }}
                    </a-descriptions-item>
                    <a-descriptions-item
                      v-if="item.arbitratorDid"
                      label="仲裁员"
                    >
                      {{ shortenDid(item.arbitratorDid) }}
                    </a-descriptions-item>
                  </a-descriptions>
                </template>
              </a-list-item-meta>

              <!-- 争议原因 -->
              <div class="arbitration-reason">
                <h4>争议原因</h4>
                <p>{{ item.reason }}</p>
              </div>

              <!-- 证据 -->
              <div v-if="item.evidence" class="arbitration-evidence">
                <h4>提交的证据</h4>
                <a-space wrap>
                  <a-tag
                    v-for="(evidence, index) in parseEvidence(item.evidence)"
                    :key="index"
                    color="blue"
                  >
                    {{ evidence }}
                  </a-tag>
                </a-space>
              </div>

              <!-- 仲裁结果 -->
              <div v-if="item.resolution" class="arbitration-resolution">
                <a-alert
                  :type="item.status === 'resolved' ? 'success' : 'warning'"
                  show-icon
                >
                  <template #message>
                    <strong>仲裁结果</strong>
                  </template>
                  <template #description>
                    {{ item.resolution }}
                  </template>
                </a-alert>
              </div>

              <!-- 操作按钮 -->
              <template #actions>
                <a-button
                  v-if="item.status === 'pending' && isArbitrator"
                  type="primary"
                  size="small"
                  @click="acceptArbitration(item)"
                >
                  <check-outlined /> 接受仲裁
                </a-button>
                <a-button
                  v-if="item.status === 'investigating' && isArbitrator"
                  type="primary"
                  size="small"
                  @click="resolveArbitration(item)"
                >
                  <solution-outlined /> 提交裁决
                </a-button>
                <a-button size="small" @click="viewContract(item.contractId)">
                  <file-text-outlined /> 查看合约
                </a-button>
              </template>
            </a-list-item>
          </template>

          <template #empty>
            <a-empty description="暂无仲裁记录" />
          </template>
        </a-list>
      </a-spin>
    </a-card>

    <!-- 提交裁决对话框 -->
    <a-modal
      v-model:open="showResolutionModal"
      title="提交仲裁裁决"
      width="700px"
      :confirm-loading="submitting"
      @ok="handleSubmitResolution"
    >
      <div v-if="selectedArbitration">
        <a-alert
          message="仲裁信息"
          type="info"
          show-icon
          style="margin-bottom: 16px"
        >
          <template #description>
            <p><strong>合约ID:</strong> {{ selectedArbitration.contractId }}</p>
            <p><strong>争议原因:</strong> {{ selectedArbitration.reason }}</p>
          </template>
        </a-alert>

        <a-form layout="vertical">
          <!-- 裁决结果 -->
          <a-form-item label="裁决结果" required>
            <a-radio-group v-model:value="resolutionForm.decision">
              <a-radio value="favor_initiator"> 支持发起方 </a-radio>
              <a-radio value="favor_respondent"> 支持被诉方 </a-radio>
              <a-radio value="compromise"> 折中方案 </a-radio>
              <a-radio value="reject"> 驳回仲裁 </a-radio>
            </a-radio-group>
          </a-form-item>

          <!-- 裁决说明 -->
          <a-form-item label="裁决说明" required>
            <a-textarea
              v-model:value="resolutionForm.resolution"
              :rows="6"
              placeholder="详细说明裁决理由和处理方案..."
              :maxlength="1000"
              show-count
            />
          </a-form-item>

          <!-- 补偿金额 -->
          <a-form-item label="补偿金额（如适用）">
            <a-input-number
              v-model:value="resolutionForm.compensationAmount"
              :min="0"
              style="width: 100%"
              placeholder="输入补偿金额（可选）"
            >
              <template #prefix> ¥ </template>
            </a-input-number>
          </a-form-item>
        </a-form>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, reactive, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  GavelOutlined,
  ReloadOutlined,
  CheckOutlined,
  SolutionOutlined,
  FileTextOutlined,
} from "@ant-design/icons-vue";

// 状态
const loading = ref(false);
const submitting = ref(false);
const arbitrations = ref([]);
const filterStatus = ref("");
const showResolutionModal = ref(false);
const selectedArbitration = ref(null);
const isArbitrator = ref(false); // 实际应该从用户角色判断

const resolutionForm = reactive({
  decision: "favor_initiator",
  resolution: "",
  compensationAmount: 0,
});

// 加载仲裁列表
const loadArbitrations = async () => {
  try {
    loading.value = true;

    // 获取当前用户DID
    const currentIdentity = await window.electronAPI.did.getCurrentIdentity();
    const userDid = currentIdentity?.did;

    if (!userDid) {
      message.warning("请先创建DID身份");
      return;
    }

    const filters = {
      status: filterStatus.value || undefined,
    };

    // 调用IPC获取仲裁列表（这里应该有一个API）
    // 暂时使用空数组
    arbitrations.value =
      (await window.electronAPI.contract.getArbitrations?.(filters)) || [];

    logger.info(
      "[ContractArbitration] 仲裁列表已加载:",
      arbitrations.value.length,
    );
  } catch (error) {
    logger.error("[ContractArbitration] 加载仲裁列表失败:", error);
    message.error(error.message || "加载仲裁列表失败");
  } finally {
    loading.value = false;
  }
};

// 接受仲裁
const acceptArbitration = async (arbitration) => {
  try {
    await window.electronAPI.contract.acceptArbitration?.(arbitration.id);

    logger.info("[ContractArbitration] 已接受仲裁:", arbitration.id);
    message.success("已接受仲裁，开始调查");

    await loadArbitrations();
  } catch (error) {
    logger.error("[ContractArbitration] 接受仲裁失败:", error);
    message.error(error.message || "接受仲裁失败");
  }
};

// 提交裁决
const resolveArbitration = (arbitration) => {
  selectedArbitration.value = arbitration;
  resolutionForm.decision = "favor_initiator";
  resolutionForm.resolution = "";
  resolutionForm.compensationAmount = 0;
  showResolutionModal.value = true;
};

// 提交裁决表单
const handleSubmitResolution = async () => {
  try {
    if (!resolutionForm.resolution || resolutionForm.resolution.trim() === "") {
      message.warning("请填写裁决说明");
      return;
    }

    submitting.value = true;

    const resolutionData = {
      decision: resolutionForm.decision,
      resolution: resolutionForm.resolution,
      compensationAmount: resolutionForm.compensationAmount || 0,
    };

    await window.electronAPI.contract.resolveArbitration?.(
      selectedArbitration.value.id,
      resolutionData,
    );

    logger.info(
      "[ContractArbitration] 裁决已提交:",
      selectedArbitration.value.id,
    );
    message.success("裁决已提交");

    showResolutionModal.value = false;
    selectedArbitration.value = null;

    await loadArbitrations();
  } catch (error) {
    logger.error("[ContractArbitration] 提交裁决失败:", error);
    message.error(error.message || "提交裁决失败");
  } finally {
    submitting.value = false;
  }
};

// 查看合约
const viewContract = (contractId) => {
  // 这里应该打开合约详情对话框或跳转
  logger.info("[ContractArbitration] 查看合约:", contractId);
  message.info("跳转到合约详情");
};

// 工具函数
const getStatusColor = (status) => {
  const colors = {
    pending: "orange",
    investigating: "blue",
    resolved: "green",
    rejected: "red",
  };
  return colors[status] || "default";
};

const getStatusName = (status) => {
  const names = {
    pending: "待处理",
    investigating: "调查中",
    resolved: "已解决",
    rejected: "已拒绝",
  };
  return names[status] || status;
};

const parseEvidence = (evidence) => {
  if (!evidence) {
    return [];
  }
  if (typeof evidence === "string") {
    try {
      return JSON.parse(evidence);
    } catch {
      return evidence
        .split(",")
        .map((e) => e.trim())
        .filter((e) => e);
    }
  }
  return evidence;
};

const shortenDid = (did) => {
  if (!did) {
    return "";
  }
  return did.length > 20 ? `${did.slice(0, 10)}...${did.slice(-8)}` : did;
};

const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
};

// 生命周期
onMounted(() => {
  loadArbitrations();
});
</script>

<style scoped>
.contract-arbitration {
  padding: 20px;
}

.arbitration-reason,
.arbitration-evidence,
.arbitration-resolution {
  margin-top: 16px;
  padding: 12px;
  background: #fafafa;
  border-radius: 4px;
}

.arbitration-reason h4,
.arbitration-evidence h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: bold;
  color: #333;
}

.arbitration-reason p {
  margin: 0;
  font-size: 13px;
  color: #666;
  line-height: 1.6;
}

.arbitration-resolution {
  background: transparent;
  padding: 0;
  margin-top: 16px;
}
</style>
