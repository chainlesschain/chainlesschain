<template>
  <div class="skill-manager-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h1>
          <ToolOutlined />
          技能管理
        </h1>
        <p class="page-description">
          管理和测试 AI 代理技能，自动匹配最佳执行策略
        </p>
      </div>
      <div class="header-right">
        <a-space>
          <a-button @click="handleRefresh" :loading="isLoading">
            <ReloadOutlined />
            刷新
          </a-button>
          <a-button type="primary" @click="showTestSkillModal">
            <ExperimentOutlined />
            测试技能
          </a-button>
        </a-space>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-section">
      <a-row :gutter="16">
        <a-col :xs="24" :sm="8">
          <a-card :loading="loading.skills">
            <a-statistic
              title="已注册技能"
              :value="skills.length"
              :prefix="h(ToolOutlined)"
              :value-style="{ color: '#1890ff' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="8">
          <a-card :loading="loading.skills">
            <a-statistic
              title="Office 技能"
              :value="officeSkills.length"
              :prefix="h(FileTextOutlined)"
              :value-style="{ color: '#52c41a' }"
            />
          </a-card>
        </a-col>
        <a-col :xs="24" :sm="8">
          <a-card :loading="loading.skills">
            <a-statistic
              title="执行历史"
              :value="skillExecutionHistory.length"
              :prefix="h(HistoryOutlined)"
              :value-style="{ color: '#faad14' }"
            />
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- 技能列表 -->
    <a-card title="技能列表" :bordered="false" class="skills-section">
      <a-list
        :data-source="skills"
        :loading="loading.skills"
        :grid="{ gutter: 16, xs: 1, sm: 2, md: 2, lg: 3, xl: 4 }"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <SkillCard
              :skill="item"
              @view-detail="handleViewSkillDetail"
              @test="handleTestSkill"
            />
          </a-list-item>
        </template>
      </a-list>

      <!-- 空状态 -->
      <a-empty
        v-if="!loading.skills && skills.length === 0"
        description="暂无已注册技能"
        style="margin: 40px 0;"
      />
    </a-card>

    <!-- 执行历史 -->
    <a-card
      v-if="skillExecutionHistory.length > 0"
      title="最近执行历史"
      :bordered="false"
      class="history-section"
      style="margin-top: 24px;"
    >
      <a-timeline>
        <a-timeline-item
          v-for="(record, index) in skillExecutionHistory.slice(0, 10)"
          :key="index"
          :color="record.result.success ? 'green' : 'red'"
        >
          <div class="history-item">
            <div class="history-header">
              <strong>{{ record.task.name || '未命名任务' }}</strong>
              <a-tag :color="record.result.success ? 'success' : 'error'">
                {{ record.result.success ? '成功' : '失败' }}
              </a-tag>
            </div>
            <div class="history-meta">
              <span>技能: {{ record.skill }}</span>
              <a-divider type="vertical" />
              <span>{{ formatDate(record.timestamp) }}</span>
            </div>
          </div>
        </a-timeline-item>
      </a-timeline>
    </a-card>

    <!-- 技能测试模态框 -->
    <a-modal
      v-model:open="testSkillModalVisible"
      title="测试技能匹配"
      :width="700"
      :confirm-loading="testing"
      @ok="confirmTestSkill"
    >
      <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="任务类型">
          <a-select v-model:value="testForm.type" placeholder="选择任务类型">
            <a-select-option value="office">Office 文档</a-select-option>
            <a-select-option value="coding">编程</a-select-option>
            <a-select-option value="data-analysis">数据分析</a-select-option>
            <a-select-option value="other">其他</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="操作">
          <a-input
            v-model:value="testForm.operation"
            placeholder="例如: createExcel, createWord"
          />
        </a-form-item>

        <a-form-item label="任务名称">
          <a-input
            v-model:value="testForm.name"
            placeholder="例如: 生成销售报表"
          />
        </a-form-item>

        <a-form-item label="任务描述">
          <a-textarea
            v-model:value="testForm.description"
            placeholder="详细描述任务需求..."
            :rows="4"
          />
        </a-form-item>

        <a-form-item label="文件类型">
          <a-select
            v-model:value="testForm.fileType"
            placeholder="选择文件类型（可选）"
            allow-clear
          >
            <a-select-option value="xlsx">Excel (.xlsx)</a-select-option>
            <a-select-option value="docx">Word (.docx)</a-select-option>
            <a-select-option value="pptx">PowerPoint (.pptx)</a-select-option>
            <a-select-option value="pdf">PDF (.pdf)</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>

      <!-- 测试结果 -->
      <div v-if="testResults.length > 0" class="test-results">
        <a-divider>匹配结果</a-divider>

        <a-table
          :columns="testResultColumns"
          :data-source="testResults"
          :pagination="false"
          size="small"
          row-key="skill"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'score'">
              <a-progress
                :percent="record.score"
                :status="record.score >= 80 ? 'success' : 'normal'"
                size="small"
              />
            </template>

            <template v-else-if="column.key === 'recommended'">
              <a-tag v-if="record.score === Math.max(...testResults.map(r => r.score))" color="green">
                推荐
              </a-tag>
            </template>
          </template>
        </a-table>
      </div>
    </a-modal>

    <!-- 技能详情抽屉 -->
    <a-drawer
      v-model:open="skillDetailDrawerVisible"
      title="技能详情"
      placement="right"
      :width="600"
      :destroy-on-close="true"
    >
      <SkillDetailPanel
        v-if="currentSkill"
        :skill="currentSkill"
        @close="skillDetailDrawerVisible = false"
      />
    </a-drawer>
  </div>
</template>

<script setup>
import { h, ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  ToolOutlined,
  ReloadOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  HistoryOutlined,
} from "@ant-design/icons-vue";
import { useCoworkStore } from "../stores/cowork";
import SkillCard from "../components/cowork/SkillCard.vue";
import SkillDetailPanel from "../components/cowork/SkillDetailPanel.vue";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { logger, createLogger } from '@/utils/logger';

const skillLogger = createLogger('skill-manager');

// Store
const store = useCoworkStore();

// 状态
const testSkillModalVisible = ref(false);
const skillDetailDrawerVisible = ref(false);
const testing = ref(false);
const testResults = ref([]);

// 测试表单
const testForm = ref({
  type: "",
  operation: "",
  name: "",
  description: "",
  fileType: "",
});

// 测试结果表格列
const testResultColumns = [
  {
    title: "技能名称",
    dataIndex: "skill",
    key: "skill",
  },
  {
    title: "匹配分数",
    dataIndex: "score",
    key: "score",
    width: 200,
  },
  {
    title: "推荐",
    key: "recommended",
    width: 80,
  },
];

// 从 Store 获取状态
const loading = computed(() => store.loading);
const skills = computed(() => store.skills);
const officeSkills = computed(() => store.officeSkills);
const skillExecutionHistory = computed(() => store.skillExecutionHistory);
const currentSkill = computed(() => store.currentSkill);
const isLoading = computed(() => store.isLoading);

// ==========================================
// 生命周期钩子
// ==========================================

onMounted(async () => {
  skillLogger.info("SkillManager 挂载");

  // 加载技能列表
  await loadSkills();
});

// ==========================================
// 数据加载
// ==========================================

async function loadSkills() {
  try {
    await store.loadSkills();
    skillLogger.info("技能列表加载完成");
  } catch (error) {
    skillLogger.error("加载技能列表失败:", error);
    message.error("加载技能列表失败");
  }
}

async function handleRefresh() {
  skillLogger.info("刷新技能列表");
  await loadSkills();
  message.success("刷新成功");
}

// ==========================================
// 技能操作
// ==========================================

function handleViewSkillDetail(skill) {
  skillLogger.info("查看技能详情:", skill.name);
  store.currentSkill = skill;
  skillDetailDrawerVisible.value = true;
}

function handleTestSkill(skill) {
  skillLogger.info("测试技能:", skill.name);

  // 预填充表单
  testForm.value = {
    type: skill.type || "",
    operation: skill.supportedOperations?.[0] || "",
    name: "",
    description: "",
    fileType: skill.supportedFileTypes?.[0] || "",
  };

  testSkillModalVisible.value = true;
}

// ==========================================
// 技能测试
// ==========================================

function showTestSkillModal() {
  testSkillModalVisible.value = true;

  // 重置表单和结果
  testForm.value = {
    type: "",
    operation: "",
    name: "",
    description: "",
    fileType: "",
  };
  testResults.value = [];
}

async function confirmTestSkill() {
  if (!testForm.value.type) {
    message.error("请选择任务类型");
    return;
  }

  testing.value = true;

  try {
    const task = {
      type: testForm.value.type,
      operation: testForm.value.operation,
      name: testForm.value.name,
      description: testForm.value.description,
      fileType: testForm.value.fileType,
    };

    const result = await store.testSkillMatch(task);

    if (result.success) {
      testResults.value = result.skills || [];

      if (testResults.value.length === 0) {
        message.warning("没有找到匹配的技能");
      } else {
        message.success(`找到 ${testResults.value.length} 个匹配的技能`);
      }
    } else {
      message.error(result.error || "技能匹配测试失败");
    }
  } catch (error) {
    skillLogger.error("技能匹配测试失败:", error);
    message.error("技能匹配测试失败: " + error.message);
  } finally {
    testing.value = false;
  }
}

// ==========================================
// 辅助函数
// ==========================================

function formatDate(timestamp) {
  if (!timestamp) return "-";

  try {
    return formatDistanceToNow(new Date(timestamp), {
      locale: zhCN,
      addSuffix: true,
    });
  } catch (error) {
    return "-";
  }
}
</script>

<style scoped lang="scss">
.skill-manager-page {
  padding: 24px;
  background: #f0f2f5;
  min-height: calc(100vh - 64px);

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 24px;

    .header-left {
      h1 {
        font-size: 24px;
        font-weight: 600;
        color: #262626;
        margin: 0 0 8px 0;
        display: flex;
        align-items: center;
        gap: 12px;

        :deep(.anticon) {
          font-size: 28px;
          color: #1890ff;
        }
      }

      .page-description {
        color: #8c8c8c;
        margin: 0;
        font-size: 14px;
      }
    }

    .header-right {
      display: flex;
      gap: 12px;
    }
  }

  .stats-section {
    margin-bottom: 24px;

    .ant-card {
      border-radius: 8px;
    }
  }

  .skills-section,
  .history-section {
    border-radius: 8px;

    :deep(.ant-card-head) {
      font-weight: 600;
      font-size: 16px;
    }
  }

  .history-item {
    .history-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;

      strong {
        color: #262626;
      }
    }

    .history-meta {
      font-size: 13px;
      color: #8c8c8c;
    }
  }

  .test-results {
    margin-top: 16px;
  }
}

// 响应式调整
@media (max-width: 768px) {
  .skill-manager-page {
    padding: 16px;

    .page-header {
      flex-direction: column;
      gap: 16px;

      .header-right {
        width: 100%;

        :deep(.ant-space) {
          width: 100%;
          justify-content: flex-end;
        }
      }
    }
  }
}
</style>
