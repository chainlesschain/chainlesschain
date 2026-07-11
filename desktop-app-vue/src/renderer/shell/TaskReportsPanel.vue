<template>
  <a-modal
    :open="open"
    :width="1080"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '82vh', overflowY: 'auto' }"
    title="团队报告"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <FileTextOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <a-alert
      v-if="!orgId"
      type="info"
      show-icon
      message="请先选择组织"
      description="团队报告按组织维度工作，请先在组织管理中选择或加入一个组织。"
    />

    <template v-else>
      <div class="tr-toolbar">
        <span class="tr-subtitle">日报、周报与 AI 摘要</span>
        <a-button size="small" :loading="loading" @click="loadReports">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </div>

      <a-row :gutter="16">
        <a-col :span="15">
          <a-card title="报告列表" size="small">
            <template #extra>
              <a-radio-group
                v-model:value="reportType"
                button-style="solid"
                size="small"
              >
                <a-radio-button value="all">全部</a-radio-button>
                <a-radio-button value="daily_standup">日报</a-radio-button>
                <a-radio-button value="weekly">周报</a-radio-button>
              </a-radio-group>
            </template>

            <a-spin :spinning="loading">
              <a-list
                :data-source="filteredReports"
                :pagination="{ pageSize: 5 }"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta
                      :title="item.authorName"
                      :description="formatDate(item.reportDate)"
                    >
                      <template #avatar>
                        <a-avatar>
                          {{ (item.authorName || "?").charAt(0) }}
                        </a-avatar>
                      </template>
                    </a-list-item-meta>
                    <div class="tr-report-content">
                      <div v-if="item.yesterdayWork" class="tr-report-section">
                        <strong>完成工作：</strong>
                        <p>{{ truncate(item.yesterdayWork, 100) }}</p>
                      </div>
                      <div v-if="item.todayPlan" class="tr-report-section">
                        <strong>今日计划：</strong>
                        <p>{{ truncate(item.todayPlan, 100) }}</p>
                      </div>
                      <div
                        v-if="item.blockers"
                        class="tr-report-section tr-blockers"
                      >
                        <strong>阻塞项：</strong>
                        <p>{{ truncate(item.blockers, 50) }}</p>
                      </div>
                      <div v-if="item.aiSummary" class="tr-ai-summary">
                        <a-tag color="blue">AI 摘要</a-tag>
                        <span>{{ item.aiSummary }}</span>
                      </div>
                    </div>
                    <template #actions>
                      <a-button
                        type="link"
                        size="small"
                        @click="viewReport(item)"
                      >
                        查看详情
                      </a-button>
                      <a-button
                        v-if="!item.aiSummary"
                        type="link"
                        size="small"
                        :loading="generatingSummary === item.id"
                        @click="generateSummary(item.id)"
                      >
                        生成摘要
                      </a-button>
                    </template>
                  </a-list-item>
                </template>
                <template #empty>
                  <a-empty description="暂无报告" />
                </template>
              </a-list>
            </a-spin>
          </a-card>
        </a-col>

        <a-col :span="9">
          <a-card title="快速写报告" size="small">
            <a-form :model="quickReport" layout="vertical">
              <a-form-item label="报告类型">
                <a-select v-model:value="quickReport.reportType">
                  <a-select-option value="daily_standup">日报</a-select-option>
                  <a-select-option value="weekly">周报</a-select-option>
                </a-select>
              </a-form-item>
              <a-form-item label="完成工作">
                <a-textarea
                  v-model:value="quickReport.yesterdayWork"
                  :rows="3"
                  placeholder="今天/本周完成了什么..."
                />
              </a-form-item>
              <a-form-item label="计划工作">
                <a-textarea
                  v-model:value="quickReport.todayPlan"
                  :rows="3"
                  placeholder="明天/下周计划做什么..."
                />
              </a-form-item>
              <a-form-item label="阻塞项">
                <a-textarea
                  v-model:value="quickReport.blockers"
                  :rows="2"
                  placeholder="遇到的问题和阻塞..."
                />
              </a-form-item>
              <a-form-item>
                <a-button
                  type="primary"
                  block
                  :loading="submitting"
                  @click="submitQuickReport"
                >
                  提交报告
                </a-button>
              </a-form-item>
            </a-form>
          </a-card>

          <a-card title="本周统计" size="small" style="margin-top: 12px">
            <a-statistic title="提交报告数" :value="weeklyReportCount" />
          </a-card>
        </a-col>
      </a-row>
    </template>

    <!-- 报告详情对话框 -->
    <a-modal
      v-model:open="showReportDetail"
      :title="`${selectedReport?.authorName || ''} 的报告`"
      :footer="null"
      width="700px"
    >
      <template v-if="selectedReport">
        <a-descriptions :column="1" bordered size="small">
          <a-descriptions-item label="报告日期">
            {{ formatDate(selectedReport.reportDate) }}
          </a-descriptions-item>
          <a-descriptions-item label="报告类型">
            <a-tag>
              {{
                selectedReport.reportType === "daily_standup" ? "日报" : "周报"
              }}
            </a-tag>
          </a-descriptions-item>
        </a-descriptions>

        <a-divider />

        <div class="tr-detail-section">
          <h4>完成工作</h4>
          <p>{{ selectedReport.yesterdayWork || "无" }}</p>
        </div>

        <div class="tr-detail-section">
          <h4>计划工作</h4>
          <p>{{ selectedReport.todayPlan || "无" }}</p>
        </div>

        <div v-if="selectedReport.blockers" class="tr-detail-section">
          <h4>阻塞项</h4>
          <p style="color: #ff4d4f">
            {{ selectedReport.blockers }}
          </p>
        </div>

        <div v-if="selectedReport.aiSummary" class="tr-detail-section">
          <h4><RobotOutlined /> AI 摘要</h4>
          <a-alert type="info" :message="selectedReport.aiSummary" />
        </div>
      </template>
    </a-modal>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { message } from "ant-design-vue";
import {
  FileTextOutlined,
  ReloadOutlined,
  RobotOutlined,
} from "@ant-design/icons-vue";
import { useTaskBoardStore } from "@/stores/taskBoard";
import { useAuthStore } from "@/stores/auth";
import dayjs from "dayjs";

const props = defineProps({
  open: { type: Boolean, default: false },
  prefillText: { type: String, default: "" },
});
defineEmits(["update:open"]);

const taskBoardStore = useTaskBoardStore();
const authStore = useAuthStore();

const orgId = computed(() => authStore.currentOrg?.id);

const loading = ref(false);
const submitting = ref(false);
const generatingSummary = ref(null);
const showReportDetail = ref(false);
const reportType = ref("all");
const selectedReport = ref(null);

const quickReport = ref({
  reportType: "daily_standup",
  yesterdayWork: "",
  todayPlan: "",
  blockers: "",
});

const reports = computed(() => taskBoardStore.reports);
const filteredReports = computed(() => {
  if (reportType.value === "all") {
    return reports.value;
  }
  return reports.value.filter((r) => r.reportType === reportType.value);
});

const weeklyReportCount = computed(
  () =>
    reports.value.filter((r) =>
      dayjs(r.reportDate).isAfter(dayjs().startOf("week")),
    ).length,
);

const formatDate = (timestamp) => dayjs(timestamp).format("YYYY-MM-DD HH:mm");

const truncate = (text, length) => {
  if (!text) {
    return "";
  }
  return text.length > length ? text.substring(0, length) + "..." : text;
};

const viewReport = (report) => {
  selectedReport.value = report;
  showReportDetail.value = true;
};

const generateSummary = async (reportId) => {
  generatingSummary.value = reportId;
  try {
    const result = await taskBoardStore.generateAISummary(reportId);
    if (result.success) {
      message.success("AI 摘要生成成功");
      await loadReports();
    } else {
      message.error(result.error || "生成摘要失败");
    }
  } catch (_error) {
    message.error("生成摘要失败");
  } finally {
    generatingSummary.value = null;
  }
};

const submitQuickReport = async () => {
  if (!quickReport.value.yesterdayWork && !quickReport.value.todayPlan) {
    message.warning("请至少填写完成工作或计划工作");
    return;
  }

  submitting.value = true;
  try {
    const result = await taskBoardStore.createReport({
      ...quickReport.value,
      orgId: orgId.value,
      authorDid: authStore.currentUser?.did,
      authorName: authStore.currentUser?.name,
      reportDate: Date.now(),
    });

    if (result.success) {
      message.success("报告提交成功");
      quickReport.value = {
        reportType: "daily_standup",
        yesterdayWork: "",
        todayPlan: "",
        blockers: "",
      };
      await loadReports();
    } else {
      message.error(result.error || "提交失败");
    }
  } catch (_error) {
    message.error("提交失败");
  } finally {
    submitting.value = false;
  }
};

const loadReports = async () => {
  if (!orgId.value) {
    return;
  }
  loading.value = true;
  try {
    await taskBoardStore.loadReports(orgId.value, { limit: 50 });
  } catch (_error) {
    message.error("加载报告失败");
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      loadReports();
    }
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
.tr-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.tr-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
.tr-report-content {
  flex: 1;
  margin: 0 16px;
}
.tr-report-section {
  margin-bottom: 8px;
}
.tr-report-section p {
  margin: 4px 0 0;
  color: #666;
}
.tr-blockers {
  color: #ff4d4f;
}
.tr-ai-summary {
  margin-top: 8px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}
.tr-detail-section {
  margin-bottom: 16px;
}
.tr-detail-section h4 {
  margin-bottom: 8px;
  color: #333;
}
</style>
