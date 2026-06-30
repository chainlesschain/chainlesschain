<template>
  <a-modal
    :open="open"
    :width="960"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="流水线监控"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <DeploymentUnitOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="dm-toolbar">
      <span class="dm-subtitle">DevOps Pipeline Orchestration</span>
      <a-space size="small">
        <a-button size="small" :loading="store.loading" @click="handleRefresh">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-button type="primary" size="small" @click="showTemplateModal = true">
          <template #icon><PlusOutlined /></template>
          新建流水线
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="[16, 16]" class="dm-stats">
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="运行中"
          :value="store.activePipelines.length"
          :value-style="{ color: '#1890ff' }"
        />
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="成功"
          :value="successCount"
          :value-style="{ color: '#52c41a' }"
        />
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="失败"
          :value="failedCount"
          :value-style="{ color: '#ff4d4f' }"
        />
      </a-col>
      <a-col :xs="12" :sm="6">
        <a-statistic
          title="待审批"
          :value="store.pendingGates.length"
          :value-style="{ color: '#faad14' }"
        />
      </a-col>
    </a-row>

    <a-row :gutter="16">
      <a-col :lg="16" :md="24">
        <a-card title="流水线列表" size="small">
          <a-table
            :columns="pipelineColumns"
            :data-source="store.pipelines"
            :loading="store.loading"
            row-key="id"
            size="small"
            :pagination="{ pageSize: 8 }"
            :custom-row="customRow"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <a-tag :color="statusColor(record.status)">
                  {{ record.status }}
                </a-tag>
              </template>
              <template v-if="column.key === 'actions'">
                <a-space size="small">
                  <a-button
                    v-if="record.status === 'pending'"
                    type="link"
                    size="small"
                    @click.stop="handleStart(record.id)"
                  >
                    启动
                  </a-button>
                  <a-button
                    v-if="record.status === 'running'"
                    type="link"
                    size="small"
                    @click.stop="handlePause(record.id)"
                  >
                    暂停
                  </a-button>
                  <a-button
                    v-if="record.status === 'paused'"
                    type="link"
                    size="small"
                    @click.stop="handleResume(record.id)"
                  >
                    恢复
                  </a-button>
                  <a-button
                    v-if="
                      record.status === 'running' || record.status === 'paused'
                    "
                    type="link"
                    size="small"
                    danger
                    @click.stop="handleCancel(record.id)"
                  >
                    取消
                  </a-button>
                </a-space>
              </template>
            </template>
          </a-table>
        </a-card>

        <a-card
          v-if="store.currentPipeline"
          title="阶段时间线"
          size="small"
          style="margin-top: 16px"
        >
          <a-timeline>
            <a-timeline-item
              v-for="stage in store.currentPipeline.stages"
              :key="stage.id"
              :color="stageTimelineColor(stage.status)"
            >
              <div class="timeline-item">
                <span class="stage-name">{{ stage.name }}</span>
                <a-tag :color="statusColor(stage.status)" size="small">
                  {{ stage.status }}
                </a-tag>
                <span v-if="stage.duration" class="stage-duration">
                  {{ formatDuration(stage.duration) }}
                </span>
              </div>
            </a-timeline-item>
          </a-timeline>
        </a-card>
      </a-col>

      <a-col :lg="8" :md="24">
        <a-card v-if="store.currentPipeline" title="流水线详情" size="small">
          <a-descriptions :column="1" size="small" bordered>
            <a-descriptions-item label="名称">
              {{ store.currentPipeline.name }}
            </a-descriptions-item>
            <a-descriptions-item label="状态">
              <a-tag :color="statusColor(store.currentPipeline.status)">
                {{ store.currentPipeline.status }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="模板">
              {{ store.currentPipeline.template || "-" }}
            </a-descriptions-item>
            <a-descriptions-item label="创建时间">
              {{ store.currentPipeline.createdAt }}
            </a-descriptions-item>
          </a-descriptions>

          <div v-if="store.metrics" style="margin-top: 16px">
            <h4>KPI 指标</h4>
            <a-descriptions :column="1" size="small">
              <a-descriptions-item label="总运行次数">
                {{ store.metrics.totalRuns }}
              </a-descriptions-item>
              <a-descriptions-item label="成功率">
                <a-progress
                  :percent="Math.round(store.metrics.successRate * 100)"
                  size="small"
                />
              </a-descriptions-item>
              <a-descriptions-item label="平均耗时">
                {{ formatDuration(store.metrics.avgDuration) }}
              </a-descriptions-item>
            </a-descriptions>
          </div>
        </a-card>

        <a-card
          v-if="store.pendingGates.length > 0"
          title="待审批门控"
          size="small"
          style="margin-top: 16px"
        >
          <div
            v-for="gate in store.pendingGates"
            :key="gate.stage.id"
            class="gate-item"
          >
            <div class="gate-info">
              <strong>{{ gate.pipeline.name }}</strong> → {{ gate.stage.name }}
            </div>
            <a-space size="small" style="margin-top: 8px">
              <a-button
                type="primary"
                size="small"
                @click="handleApproveGate(gate)"
              >
                批准
              </a-button>
              <a-button size="small" danger @click="openRejectModal(gate)">
                拒绝
              </a-button>
            </a-space>
          </div>
        </a-card>

        <a-empty
          v-if="!store.currentPipeline && store.pendingGates.length === 0"
          description="选择一条流水线查看详情"
          :image="emptyImage"
          style="margin-top: 24px"
        />
      </a-col>
    </a-row>

    <a-modal
      v-model:open="showTemplateModal"
      title="选择流水线模板"
      :confirm-loading="store.loading"
      @ok="handleCreateFromTemplate"
      @cancel="showTemplateModal = false"
    >
      <a-list :data-source="store.templates" :loading="templatesLoading">
        <template #renderItem="{ item }">
          <a-list-item
            :class="{ 'selected-template': selectedTemplate === item.id }"
            @click="selectedTemplate = item.id"
          >
            <a-list-item-meta
              :title="item.name"
              :description="item.description"
            />
          </a-list-item>
        </template>
      </a-list>
    </a-modal>

    <a-modal
      v-model:open="showRejectModal"
      title="拒绝门控"
      @ok="handleRejectGate"
      @cancel="showRejectModal = false"
    >
      <a-textarea
        v-model:value="rejectReason"
        placeholder="请输入拒绝原因"
        :rows="3"
      />
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  ReloadOutlined,
  PlusOutlined,
  DeploymentUnitOutlined,
} from "@ant-design/icons-vue";
import { message, Empty } from "ant-design-vue";
import { useDeploymentStore } from "../stores/deployment";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const emptyImage = Empty.PRESENTED_IMAGE_SIMPLE;

const store = useDeploymentStore();

const showTemplateModal = ref(false);
const showRejectModal = ref(false);
const selectedTemplate = ref("");
const rejectReason = ref("");
const templatesLoading = ref(false);
const rejectTarget = ref<{ pipeline: any; stage: any } | null>(null);

const successCount = computed(
  () => store.pipelines.filter((p) => p.status === "success").length,
);
const failedCount = computed(
  () => store.pipelines.filter((p) => p.status === "failed").length,
);

const pipelineColumns = [
  { title: "名称", dataIndex: "name", key: "name", ellipsis: true },
  { title: "状态", key: "status", width: 100 },
  { title: "模板", dataIndex: "template", key: "template", width: 110 },
  { title: "创建时间", dataIndex: "createdAt", key: "createdAt", width: 170 },
  { title: "操作", key: "actions", width: 190 },
];

function customRow(record: any) {
  return { onClick: () => handleSelectPipeline(record) };
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    pending: "default",
    running: "processing",
    paused: "warning",
    success: "success",
    failed: "error",
    cancelled: "default",
    gate_pending: "warning",
    skipped: "default",
  };
  return map[status] || "default";
}

function stageTimelineColor(status: string): string {
  const map: Record<string, string> = {
    pending: "gray",
    running: "blue",
    success: "green",
    failed: "red",
    gate_pending: "orange",
    skipped: "gray",
  };
  return map[status] || "gray";
}

function formatDuration(ms: number): string {
  if (!ms) {
    return "-";
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

async function handleRefresh() {
  await store.getAllPipelines();
  if (store.currentPipeline) {
    await store.getStatus(store.currentPipeline.id);
    await store.getMetrics(store.currentPipeline.id);
  }
}

function handleSelectPipeline(record: any) {
  store.getStatus(record.id);
  store.getMetrics(record.id);
}

async function handleStart(id: string) {
  const result = await store.startPipeline(id);
  if (result.success) {
    message.success("流水线已启动");
  }
}

async function handlePause(id: string) {
  const result = await store.pausePipeline(id);
  if (result.success) {
    message.success("流水线已暂停");
  }
}

async function handleResume(id: string) {
  const result = await store.resumePipeline(id);
  if (result.success) {
    message.success("流水线已恢复");
  }
}

async function handleCancel(id: string) {
  const result = await store.cancelPipeline(id);
  if (result.success) {
    message.success("流水线已取消");
  }
}

async function handleApproveGate(gate: any) {
  const result = await store.approveGate(gate.pipeline.id, gate.stage.id);
  if (result.success) {
    message.success("门控已批准");
  }
}

function openRejectModal(gate: any) {
  rejectTarget.value = gate;
  rejectReason.value = "";
  showRejectModal.value = true;
}

async function handleRejectGate() {
  if (!rejectTarget.value) {
    return;
  }
  const result = await store.rejectGate(
    rejectTarget.value.pipeline.id,
    rejectTarget.value.stage.id,
    rejectReason.value,
  );
  if (result.success) {
    message.success("门控已拒绝");
    showRejectModal.value = false;
  }
}

async function handleCreateFromTemplate() {
  if (!selectedTemplate.value) {
    message.warning("请选择一个模板");
    return;
  }
  const result = await store.createPipeline({
    template: selectedTemplate.value,
  });
  if (result.success) {
    message.success("流水线已创建");
    showTemplateModal.value = false;
    selectedTemplate.value = "";
  }
}

// Load list + templates on open.
watch(
  () => props.open,
  async (isOpen) => {
    if (!isOpen) {
      return;
    }
    store.initEventListeners();
    await store.getAllPipelines();
    templatesLoading.value = true;
    await store.getTemplates();
    templatesLoading.value = false;
  },
  { immediate: true },
);
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.dm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.dm-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.dm-stats {
  margin-bottom: 16px;
  text-align: center;
}
.timeline-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.timeline-item .stage-name {
  font-weight: 500;
}
.timeline-item .stage-duration {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}
.gate-item {
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
}
.gate-item:last-child {
  border-bottom: none;
}
.gate-item .gate-info {
  font-size: 13px;
}
.selected-template {
  background: #e6f7ff;
  border-radius: 4px;
  cursor: pointer;
}
</style>
