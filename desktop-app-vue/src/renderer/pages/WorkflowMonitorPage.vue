<template>
  <div class="workflow-monitor-page">
    <!-- 页面标题 -->
    <div class="page-header">
      <div class="header-left">
        <a-button type="text" @click="goBack">
          <ArrowLeftOutlined />
        </a-button>
        <h1>工作流监控</h1>
      </div>
      <div class="header-right">
        <a-button @click="refreshWorkflows">
          <ReloadOutlined />
          刷新
        </a-button>
        <a-button type="primary" @click="showCreateModal">
          <PlusOutlined />
          新建工作流
        </a-button>
      </div>
    </div>

    <!-- Phase D: canonical workflow session panel (read-only from SessionStateManager) -->
    <CanonicalWorkflowPanel v-if="!selectedWorkflowId" />

    <!-- 工作流列表 -->
    <div v-if="!selectedWorkflowId" class="workflows-list">
      <a-empty v-if="workflows.length === 0" description="暂无工作流">
        <a-button type="primary" @click="showCreateModal">
          创建第一个工作流
        </a-button>
      </a-empty>

      <div v-else class="workflow-cards">
        <a-card
          v-for="workflow in workflows"
          :key="workflow.workflowId"
          class="workflow-card"
          :class="getWorkflowCardClass(workflow)"
          hoverable
          @click="selectWorkflow(workflow.workflowId)"
        >
          <template #title>
            <div class="card-title">
              <span class="workflow-icon">{{
                getWorkflowIcon(workflow.overall?.status)
              }}</span>
              <span>{{ workflow.title || "未命名工作流" }}</span>
            </div>
          </template>
          <template #extra>
            <a-tag :color="getStatusColor(workflow.overall?.status)">
              {{ getStatusText(workflow.overall?.status) }}
            </a-tag>
          </template>

          <div class="card-content">
            <a-progress
              :percent="workflow.overall?.percent || 0"
              :status="getProgressStatus(workflow.overall?.status)"
              size="small"
            />
            <div class="card-meta">
              <span>
                <NodeIndexOutlined />
                阶段 {{ workflow.overall?.stage || 0 }}/{{
                  workflow.overall?.totalStages || 6
                }}
              </span>
              <span>
                <ClockCircleOutlined />
                {{ formatDuration(workflow.overall?.elapsedTime) }}
              </span>
            </div>
          </div>

          <template #actions>
            <a-tooltip title="查看详情">
              <EyeOutlined @click.stop="selectWorkflow(workflow.workflowId)" />
            </a-tooltip>
            <a-tooltip
              v-if="workflow.overall?.status === 'running'"
              title="暂停"
            >
              <PauseCircleOutlined
                @click.stop="pauseWorkflow(workflow.workflowId)"
              />
            </a-tooltip>
            <a-tooltip
              v-if="workflow.overall?.status === 'paused'"
              title="继续"
            >
              <PlayCircleOutlined
                @click.stop="resumeWorkflow(workflow.workflowId)"
              />
            </a-tooltip>
            <a-popconfirm
              title="确定删除此工作流？"
              @confirm="deleteWorkflow(workflow.workflowId)"
            >
              <a-tooltip title="删除">
                <DeleteOutlined @click.stop />
              </a-tooltip>
            </a-popconfirm>
          </template>
        </a-card>
      </div>
    </div>

    <!-- 工作流详情 -->
    <div v-else class="workflow-detail">
      <div class="detail-header">
        <a-button type="text" @click="selectedWorkflowId = null">
          <ArrowLeftOutlined />
          返回列表
        </a-button>
      </div>

      <WorkflowProgress
        ref="workflowProgressRef"
        :workflow-id="selectedWorkflowId"
        @complete="handleWorkflowComplete"
        @error="handleWorkflowError"
      />

      <!-- 完成摘要 -->
      <WorkflowSummary
        v-if="showSummary"
        :workflow="completedWorkflow"
        :stages="completedStages"
        :quality-gates="completedGates"
        class="workflow-summary-panel"
        @retry="handleRetry"
        @view-result="handleViewResult"
        @export="handleExport"
        @close="showSummary = false"
      />
    </div>

    <!-- 创建工作流弹窗 -->
    <a-modal
      v-model:open="createModalVisible"
      title="创建新工作流"
      @ok="handleCreateWorkflow"
      @cancel="createModalVisible = false"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item label="工作流名称" required>
          <a-input
            v-model:value="createForm.title"
            placeholder="请输入工作流名称"
          />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="createForm.description"
            placeholder="请输入工作流描述"
            :rows="3"
          />
        </a-form-item>
        <a-form-item label="用户请求" required>
          <a-textarea
            v-model:value="createForm.userRequest"
            placeholder="描述您想要完成的任务"
            :rows="4"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { message, Modal } from "ant-design-vue";
import { h } from "vue";
import {
  ArrowLeftOutlined,
  ReloadOutlined,
  PlusOutlined,
  ClockCircleOutlined,
  NodeIndexOutlined,
  EyeOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
} from "@ant-design/icons-vue";
import { WorkflowProgress, WorkflowSummary } from "@/components/workflow";
import CanonicalWorkflowPanel from "@/components/workflow/CanonicalWorkflowPanel.vue";

const router = useRouter();

// 状态
const workflows = ref([]);
const selectedWorkflowId = ref(null);
const loading = ref(false);
const createModalVisible = ref(false);
const createForm = ref({
  title: "",
  description: "",
  userRequest: "",
});
const showSummary = ref(false);
const completedWorkflow = ref({});
const completedStages = ref([]);
const completedGates = ref({});
const workflowProgressRef = ref(null);

// 方法
const goBack = () => {
  if (selectedWorkflowId.value) {
    selectedWorkflowId.value = null;
  } else {
    router.back();
  }
};

const refreshWorkflows = async () => {
  loading.value = true;
  try {
    const result = await window.ipc.invoke("workflow:get-all");
    if (result.success) {
      workflows.value = result.data;
    }
  } catch (error) {
    message.error("刷新失败: " + error.message);
  } finally {
    loading.value = false;
  }
};

const showCreateModal = () => {
  createForm.value = {
    title: "",
    description: "",
    userRequest: "",
  };
  createModalVisible.value = true;
};

const handleCreateWorkflow = async () => {
  if (!createForm.value.title || !createForm.value.userRequest) {
    message.warning("请填写必填项");
    return;
  }

  try {
    const result = await window.ipc.invoke("workflow:create-and-start", {
      title: createForm.value.title,
      description: createForm.value.description,
      input: {
        userRequest: createForm.value.userRequest,
      },
      context: {},
    });

    if (result.success) {
      message.success("工作流已创建并启动");
      createModalVisible.value = false;
      selectedWorkflowId.value = result.data.workflowId;
      refreshWorkflows();
    } else {
      message.error(result.error || "创建失败");
    }
  } catch (error) {
    message.error("创建失败: " + error.message);
  }
};

const selectWorkflow = (workflowId) => {
  selectedWorkflowId.value = workflowId;
};

const pauseWorkflow = async (workflowId) => {
  try {
    const result = await window.ipc.invoke("workflow:pause", { workflowId });
    if (result.success) {
      message.success("工作流已暂停");
      refreshWorkflows();
    } else {
      message.error(result.error || "暂停失败");
    }
  } catch (error) {
    message.error("操作失败: " + error.message);
  }
};

const resumeWorkflow = async (workflowId) => {
  try {
    const result = await window.ipc.invoke("workflow:resume", { workflowId });
    if (result.success) {
      message.success("工作流已恢复");
      refreshWorkflows();
    } else {
      message.error(result.error || "恢复失败");
    }
  } catch (error) {
    message.error("操作失败: " + error.message);
  }
};

const deleteWorkflow = async (workflowId) => {
  try {
    const result = await window.ipc.invoke("workflow:delete", { workflowId });
    if (result.success) {
      message.success("工作流已删除");
      if (selectedWorkflowId.value === workflowId) {
        selectedWorkflowId.value = null;
      }
      refreshWorkflows();
    } else {
      message.error(result.error || "删除失败");
    }
  } catch (error) {
    message.error("操作失败: " + error.message);
  }
};

const handleWorkflowComplete = async (data) => {
  message.success("工作流执行完成");
  completedWorkflow.value = data;

  // 获取详细信息
  try {
    const stagesResult = await window.ipc.invoke("workflow:get-stages", {
      workflowId: selectedWorkflowId.value,
    });
    if (stagesResult.success) {
      completedStages.value = stagesResult.data;
    }

    const gatesResult = await window.ipc.invoke("workflow:get-gates", {
      workflowId: selectedWorkflowId.value,
    });
    if (gatesResult.success) {
      completedGates.value = gatesResult.data;
    }
  } catch (error) {
    console.error("获取工作流详情失败:", error);
  }

  showSummary.value = true;
  refreshWorkflows();
};

const handleWorkflowError = (data) => {
  message.error("工作流执行失败: " + data.error);
  completedWorkflow.value = { ...data, success: false };
  showSummary.value = true;
  refreshWorkflows();
};

const handleRetry = async () => {
  try {
    const result = await window.ipc.invoke("workflow:retry", {
      workflowId: selectedWorkflowId.value,
    });
    if (result.success) {
      message.success("工作流重试中");
      showSummary.value = false;
    } else {
      message.error(result.error || "重试失败");
    }
  } catch (error) {
    message.error("操作失败: " + error.message);
  }
};

const handleViewResult = () => {
  if (!completedWorkflow.value?.results) {
    message.warning("暂无执行结果");
    return;
  }

  const results = completedWorkflow.value.results;

  // 构建结果展示内容
  const renderResults = () => {
    if (typeof results === "string") {
      return h(
        "pre",
        {
          style: {
            maxHeight: "400px",
            overflow: "auto",
            whiteSpace: "pre-wrap",
          },
        },
        results,
      );
    }

    if (Array.isArray(results)) {
      return h(
        "div",
        { class: "result-list" },
        results.map((item, index) =>
          h(
            "div",
            {
              key: index,
              style: {
                marginBottom: "12px",
                padding: "12px",
                background: "#f5f5f5",
                borderRadius: "6px",
              },
            },
            [
              h(
                "div",
                { style: { fontWeight: "bold", marginBottom: "8px" } },
                `步骤 ${index + 1}`,
              ),
              h(
                "pre",
                {
                  style: {
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    fontSize: "12px",
                  },
                },
                typeof item === "object"
                  ? JSON.stringify(item, null, 2)
                  : String(item),
              ),
            ],
          ),
        ),
      );
    }

    return h(
      "pre",
      {
        style: { maxHeight: "400px", overflow: "auto", whiteSpace: "pre-wrap" },
      },
      JSON.stringify(results, null, 2),
    );
  };

  Modal.info({
    title: "工作流执行结果",
    width: 700,
    content: h("div", { style: { maxHeight: "500px", overflow: "auto" } }, [
      renderResults(),
    ]),
    okText: "关闭",
  });
};

const handleExport = async () => {
  try {
    // 构建报告数据
    const reportData = {
      title: completedWorkflow.value.title || "工作流执行报告",
      workflowId: selectedWorkflowId.value,
      exportedAt: new Date().toISOString(),
      summary: {
        success: completedWorkflow.value.success,
        duration: completedWorkflow.value.duration,
        completedStages: completedStages.value.filter(
          (s) => s.status === "completed",
        ).length,
        totalStages: completedStages.value.length,
      },
      stages: completedStages.value.map((stage) => ({
        name: stage.name,
        status: stage.status,
        duration: stage.duration,
      })),
      qualityGates: completedGates.value,
      results: completedWorkflow.value.results,
      error: completedWorkflow.value.error || null,
    };

    // 生成 Markdown 报告
    const markdown = generateMarkdownReport(reportData);

    // 触发下载
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `workflow-report-${selectedWorkflowId.value}-${new Date().toISOString().split("T")[0]}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    message.success("报告导出成功");
  } catch (error) {
    message.error("导出失败: " + error.message);
  }
};

const generateMarkdownReport = (data) => {
  const lines = [
    `# ${data.title}`,
    "",
    `> 导出时间: ${new Date(data.exportedAt).toLocaleString()}`,
    "",
    "## 执行摘要",
    "",
    `- **状态**: ${data.summary.success ? "成功" : "失败"}`,
    `- **总耗时**: ${formatDuration(data.summary.duration)}`,
    `- **完成阶段**: ${data.summary.completedStages} / ${data.summary.totalStages}`,
    "",
    "## 阶段详情",
    "",
    "| 阶段 | 状态 | 耗时 |",
    "|------|------|------|",
  ];

  for (const stage of data.stages) {
    const statusIcon =
      stage.status === "completed"
        ? "✅"
        : stage.status === "failed"
          ? "❌"
          : "⏳";
    lines.push(
      `| ${stage.name} | ${statusIcon} ${stage.status} | ${formatDuration(stage.duration)} |`,
    );
  }

  lines.push("");
  lines.push("## 质量门禁");
  lines.push("");

  const gates = Object.entries(data.qualityGates || {});
  if (gates.length > 0) {
    lines.push("| 门禁 | 状态 | 评分 |");
    lines.push("|------|------|------|");
    for (const [name, gate] of gates) {
      const passed = gate.passed || gate.status === "passed";
      lines.push(
        `| ${name} | ${passed ? "✅ 通过" : "❌ 未通过"} | ${gate.score || "-"} |`,
      );
    }
  } else {
    lines.push("_无质量门禁数据_");
  }

  if (data.error) {
    lines.push("");
    lines.push("## 错误信息");
    lines.push("");
    lines.push("```");
    lines.push(data.error);
    lines.push("```");
  }

  if (data.results) {
    lines.push("");
    lines.push("## 执行结果");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(data.results, null, 2));
    lines.push("```");
  }

  lines.push("");
  lines.push("---");
  lines.push("_由 ChainlessChain 工作流系统生成_");

  return lines.join("\n");
};

// 辅助方法
const getWorkflowIcon = (status) => {
  const iconMap = {
    idle: "📋",
    running: "🔄",
    paused: "⏸️",
    completed: "✅",
    failed: "❌",
    cancelled: "🚫",
  };
  return iconMap[status] || "📋";
};

const getStatusColor = (status) => {
  const colorMap = {
    idle: "default",
    running: "processing",
    paused: "warning",
    completed: "success",
    failed: "error",
    cancelled: "default",
  };
  return colorMap[status] || "default";
};

const getStatusText = (status) => {
  const textMap = {
    idle: "等待中",
    running: "执行中",
    paused: "已暂停",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  };
  return textMap[status] || "未知";
};

const getProgressStatus = (status) => {
  if (status === "failed") {
    return "exception";
  }
  if (status === "completed") {
    return "success";
  }
  return "active";
};

const getWorkflowCardClass = (workflow) => ({
  running: workflow.overall?.status === "running",
  paused: workflow.overall?.status === "paused",
  completed: workflow.overall?.status === "completed",
  failed: workflow.overall?.status === "failed",
});

const formatDuration = (ms) => {
  if (!ms || ms === 0) {
    return "0秒";
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}秒`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}分${remainingSeconds}秒`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}时${remainingMinutes}分`;
};

// 事件监听
const handleWorkflowUpdate = (data) => {
  // 更新列表中的工作流
  const index = workflows.value.findIndex(
    (w) => w.workflowId === data.workflowId,
  );
  if (index >= 0) {
    workflows.value[index] = {
      ...workflows.value[index],
      ...data,
    };
  }
};

// 生命周期
onMounted(() => {
  refreshWorkflows();

  // 监听工作流更新事件
  if (window.ipc) {
    window.ipc.on("workflow:progress", handleWorkflowUpdate);
  }
});

onUnmounted(() => {
  if (window.ipc) {
    window.ipc.off("workflow:progress", handleWorkflowUpdate);
  }
});
</script>

<style scoped lang="scss">
.workflow-monitor-page {
  padding: 24px;
  min-height: 100vh;
  background: #f5f5f5;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;

    h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
      color: #262626;
    }
  }

  .header-right {
    display: flex;
    gap: 12px;
  }
}

.workflows-list {
  :deep(.ant-empty) {
    padding: 60px;
    background: #fff;
    border-radius: 12px;
  }
}

.workflow-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 20px;
}

.workflow-card {
  border-radius: 12px;
  transition: all 0.3s;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }

  &.running {
    border-color: #91d5ff;

    :deep(.ant-card-head) {
      background: linear-gradient(180deg, #e6f7ff 0%, #fff 100%);
    }
  }

  &.completed {
    border-color: #b7eb8f;

    :deep(.ant-card-head) {
      background: linear-gradient(180deg, #f6ffed 0%, #fff 100%);
    }
  }

  &.failed {
    border-color: #ffccc7;

    :deep(.ant-card-head) {
      background: linear-gradient(180deg, #fff2f0 0%, #fff 100%);
    }
  }

  .card-title {
    display: flex;
    align-items: center;
    gap: 8px;

    .workflow-icon {
      font-size: 18px;
    }
  }

  .card-content {
    padding: 8px 0;
  }

  .card-meta {
    display: flex;
    justify-content: space-between;
    margin-top: 12px;
    font-size: 12px;
    color: #8c8c8c;

    span {
      display: flex;
      align-items: center;
      gap: 4px;
    }
  }
}

.workflow-detail {
  .detail-header {
    margin-bottom: 16px;
  }
}

.workflow-summary-panel {
  margin-top: 24px;
}
</style>
