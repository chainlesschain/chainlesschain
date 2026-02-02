<template>
  <div class="task-reports-page">
    <a-page-header title="团队报告" sub-title="日报、周报与 AI 摘要">
      <template #extra>
        <a-button type="primary" @click="showCreateReport = true">
          <template #icon><PlusOutlined /></template>
          写报告
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="24">
      <!-- 报告列表 -->
      <a-col :span="16">
        <a-card title="报告列表">
          <template #extra>
            <a-radio-group v-model:value="reportType" button-style="solid" size="small">
              <a-radio-button value="all">全部</a-radio-button>
              <a-radio-button value="daily_standup">日报</a-radio-button>
              <a-radio-button value="weekly">周报</a-radio-button>
            </a-radio-group>
          </template>

          <a-spin :spinning="loading">
            <a-list
              :data-source="filteredReports"
              :pagination="{ pageSize: 10 }"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-list-item-meta
                    :title="item.authorName"
                    :description="formatDate(item.reportDate)"
                  >
                    <template #avatar>
                      <a-avatar>{{ item.authorName?.charAt(0) }}</a-avatar>
                    </template>
                  </a-list-item-meta>
                  <div class="report-content">
                    <div v-if="item.yesterdayWork" class="report-section">
                      <strong>完成工作：</strong>
                      <p>{{ truncate(item.yesterdayWork, 100) }}</p>
                    </div>
                    <div v-if="item.todayPlan" class="report-section">
                      <strong>今日计划：</strong>
                      <p>{{ truncate(item.todayPlan, 100) }}</p>
                    </div>
                    <div v-if="item.blockers" class="report-section blockers">
                      <strong>阻塞项：</strong>
                      <p>{{ truncate(item.blockers, 50) }}</p>
                    </div>
                    <div v-if="item.aiSummary" class="ai-summary">
                      <a-tag color="blue">AI 摘要</a-tag>
                      <span>{{ item.aiSummary }}</span>
                    </div>
                  </div>
                  <template #actions>
                    <a-button type="link" @click="viewReport(item)">查看详情</a-button>
                    <a-button
                      v-if="!item.aiSummary"
                      type="link"
                      @click="generateSummary(item.id)"
                      :loading="generatingSummary === item.id"
                    >
                      生成摘要
                    </a-button>
                  </template>
                </a-list-item>
              </template>
            </a-list>
          </a-spin>
        </a-card>
      </a-col>

      <!-- 快速写报告 -->
      <a-col :span="8">
        <a-card title="快速写报告">
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
              <a-button type="primary" block @click="submitQuickReport" :loading="submitting">
                提交报告
              </a-button>
            </a-form-item>
          </a-form>
        </a-card>

        <!-- 统计卡片 -->
        <a-card title="本周统计" style="margin-top: 16px">
          <a-statistic title="提交报告数" :value="weeklyStats.reportCount" />
          <a-progress
            :percent="weeklyStats.completionRate"
            :status="weeklyStats.completionRate >= 80 ? 'success' : 'normal'"
          />
          <p class="stats-hint">{{ weeklyStats.completionRate }}% 完成率</p>
        </a-card>
      </a-col>
    </a-row>

    <!-- 报告详情对话框 -->
    <a-modal
      v-model:open="showReportDetail"
      :title="`${selectedReport?.authorName} 的报告`"
      :footer="null"
      width="700px"
    >
      <template v-if="selectedReport">
        <a-descriptions :column="1" bordered>
          <a-descriptions-item label="报告日期">
            {{ formatDate(selectedReport.reportDate) }}
          </a-descriptions-item>
          <a-descriptions-item label="报告类型">
            <a-tag>{{ selectedReport.reportType === 'daily_standup' ? '日报' : '周报' }}</a-tag>
          </a-descriptions-item>
        </a-descriptions>

        <a-divider />

        <div class="report-detail-section">
          <h4>完成工作</h4>
          <p>{{ selectedReport.yesterdayWork || '无' }}</p>
        </div>

        <div class="report-detail-section">
          <h4>计划工作</h4>
          <p>{{ selectedReport.todayPlan || '无' }}</p>
        </div>

        <div v-if="selectedReport.blockers" class="report-detail-section">
          <h4>阻塞项</h4>
          <p style="color: #ff4d4f">{{ selectedReport.blockers }}</p>
        </div>

        <div v-if="selectedReport.aiSummary" class="report-detail-section">
          <h4><RobotOutlined /> AI 摘要</h4>
          <a-alert type="info" :message="selectedReport.aiSummary" />
        </div>
      </template>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { PlusOutlined, RobotOutlined } from '@ant-design/icons-vue';
import { useTaskBoardStore } from '@/stores/taskBoard';
import { useAuthStore } from '@/stores/auth';
import dayjs from 'dayjs';

const taskBoardStore = useTaskBoardStore();
const authStore = useAuthStore();

const loading = ref(false);
const submitting = ref(false);
const generatingSummary = ref(null);
const showCreateReport = ref(false);
const showReportDetail = ref(false);
const reportType = ref('all');
const selectedReport = ref(null);

const quickReport = ref({
  reportType: 'daily_standup',
  yesterdayWork: '',
  todayPlan: '',
  blockers: '',
});

const reports = computed(() => taskBoardStore.reports);
const filteredReports = computed(() => {
  if (reportType.value === 'all') return reports.value;
  return reports.value.filter((r) => r.reportType === reportType.value);
});

const weeklyStats = computed(() => ({
  reportCount: reports.value.filter((r) => {
    const reportDate = dayjs(r.reportDate);
    return reportDate.isAfter(dayjs().startOf('week'));
  }).length,
  completionRate: 75, // 示例数据
}));

const formatDate = (timestamp) => dayjs(timestamp).format('YYYY-MM-DD HH:mm');

const truncate = (text, length) => {
  if (!text) return '';
  return text.length > length ? text.substring(0, length) + '...' : text;
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
      message.success('AI 摘要生成成功');
      await loadReports();
    }
  } catch (error) {
    message.error('生成摘要失败');
  } finally {
    generatingSummary.value = null;
  }
};

const submitQuickReport = async () => {
  if (!quickReport.value.yesterdayWork && !quickReport.value.todayPlan) {
    message.warning('请至少填写完成工作或计划工作');
    return;
  }

  submitting.value = true;
  try {
    const result = await taskBoardStore.createReport({
      ...quickReport.value,
      orgId: authStore.currentOrg?.id,
      authorDid: authStore.currentUser?.did,
      authorName: authStore.currentUser?.name,
      reportDate: Date.now(),
    });

    if (result.success) {
      message.success('报告提交成功');
      quickReport.value = { reportType: 'daily_standup', yesterdayWork: '', todayPlan: '', blockers: '' };
      await loadReports();
    }
  } catch (error) {
    message.error('提交失败');
  } finally {
    submitting.value = false;
  }
};

const loadReports = async () => {
  loading.value = true;
  try {
    await taskBoardStore.loadReports(authStore.currentOrg?.id, { limit: 50 });
  } catch (error) {
    message.error('加载报告失败');
  } finally {
    loading.value = false;
  }
};

onMounted(loadReports);
</script>

<style scoped>
.task-reports-page {
  padding: 0 24px 24px;
}

.report-content {
  flex: 1;
  margin: 0 16px;
}

.report-section {
  margin-bottom: 8px;
}

.report-section p {
  margin: 4px 0 0;
  color: #666;
}

.blockers {
  color: #ff4d4f;
}

.ai-summary {
  margin-top: 8px;
  padding: 8px;
  background: #f5f5f5;
  border-radius: 4px;
}

.stats-hint {
  margin-top: 8px;
  color: #666;
  font-size: 12px;
}

.report-detail-section {
  margin-bottom: 16px;
}

.report-detail-section h4 {
  margin-bottom: 8px;
  color: #333;
}
</style>
