<template>
  <div class="git-hooks-panel">
    <div class="panel-header">
      <span class="panel-title">Git Hooks</span>
      <a-space size="small">
        <a-button size="small" @click="loadData">
          <ReloadOutlined />
        </a-button>
      </a-space>
    </div>

    <!-- Quick Actions -->
    <div class="panel-section">
      <a-space size="small" wrap>
        <a-button
          size="small"
          type="primary"
          :loading="hooksStore.loading"
          @click="runPreCommit"
        >
          Pre-commit
        </a-button>
        <a-button size="small" :loading="hooksStore.loading" @click="runImpact">
          影响分析
        </a-button>
        <a-button
          size="small"
          :loading="hooksStore.loading"
          @click="runAutoFix"
        >
          自动修复
        </a-button>
      </a-space>
    </div>

    <!-- Pre-commit Results -->
    <div v-if="hooksStore.preCommitResults" class="panel-section">
      <div class="section-label">
        <a-tag
          :color="hooksStore.preCommitResults.passed ? 'green' : 'red'"
          size="small"
        >
          {{ hooksStore.preCommitResults.passed ? "PASSED" : "FAILED" }}
        </a-tag>
        <span class="result-meta">
          {{ hooksStore.preCommitResults.issues.length }} 问题 ·
          {{ hooksStore.preCommitResults.duration }}ms
        </span>
      </div>
      <div
        v-for="(issue, idx) in hooksStore.preCommitResults.issues.slice(0, 10)"
        :key="idx"
        class="issue-row"
      >
        <a-tag
          :color="severityColor(issue.severity)"
          size="small"
          class="issue-tag"
        >
          {{ issue.severity }}
        </a-tag>
        <span class="issue-msg">{{ issue.message || issue.source }}</span>
      </div>
      <div
        v-if="hooksStore.preCommitResults.issues.length > 10"
        class="more-hint"
      >
        +{{ hooksStore.preCommitResults.issues.length - 10 }} more...
      </div>
    </div>

    <!-- Impact Analysis Results -->
    <div v-if="hooksStore.impactResults" class="panel-section">
      <div class="section-label">影响分析</div>
      <div class="impact-score">
        <span>风险评分:</span>
        <a-tag
          :color="riskColor(hooksStore.impactResults.riskScore)"
          size="small"
        >
          {{ hooksStore.impactResults.riskScore || 0 }}
        </a-tag>
      </div>
      <div v-if="hooksStore.impactResults.affectedFiles" class="affected-files">
        <div class="sub-label">受影响文件</div>
        <div
          v-for="(file, idx) in hooksStore.impactResults.affectedFiles.slice(
            0,
            5,
          )"
          :key="idx"
          class="file-row"
        >
          {{ file }}
        </div>
        <div
          v-if="hooksStore.impactResults.affectedFiles.length > 5"
          class="more-hint"
        >
          +{{ hooksStore.impactResults.affectedFiles.length - 5 }} more...
        </div>
      </div>
    </div>

    <!-- Auto-fix Results -->
    <div v-if="hooksStore.autoFixResults" class="panel-section">
      <div class="section-label">自动修复</div>
      <div class="fix-summary">
        <a-tag color="green" size="small">
          {{ (hooksStore.autoFixResults.fixed || []).length }} 已修复
        </a-tag>
        <a-tag
          v-if="(hooksStore.autoFixResults.remaining || []).length"
          color="orange"
          size="small"
        >
          {{ hooksStore.autoFixResults.remaining.length }} 待处理
        </a-tag>
      </div>
    </div>

    <!-- Stats -->
    <div v-if="hooksStore.stats" class="panel-section stats-section">
      <div class="stat-item">
        <span class="stat-label">运行</span>
        <span class="stat-value">{{ hooksStore.stats.totalRuns || 0 }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">通过率</span>
        <span class="stat-value">{{ hooksStore.stats.passRate || 0 }}%</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">平均耗时</span>
        <span class="stat-value"
          >{{ hooksStore.stats.avgDurationMs || 0 }}ms</span
        >
      </div>
    </div>

    <!-- Recent History -->
    <div v-if="hooksStore.history.length" class="panel-section">
      <div class="section-label">历史</div>
      <div
        v-for="(entry, idx) in hooksStore.history.slice(0, 5)"
        :key="idx"
        class="history-row"
      >
        <span
          class="history-dot"
          :style="{
            background: entry.result?.passed !== false ? '#52c41a' : '#ff4d4f',
          }"
        />
        <span class="history-type">{{ entry.type }}</span>
        <span class="history-time">
          {{ formatTime(entry.timestamp) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { message } from "ant-design-vue";
import { ReloadOutlined } from "@ant-design/icons-vue";
import { useGitHooksStore } from "../../stores/git-hooks";

const hooksStore = useGitHooksStore();

onMounted(async () => {
  await loadData();
});

async function loadData() {
  await Promise.all([
    hooksStore.loadConfig(),
    hooksStore.loadHistory(),
    hooksStore.loadStats(),
  ]);
}

async function runPreCommit() {
  try {
    await hooksStore.runPreCommit([]);
    message.success("Pre-commit 检查完成");
  } catch (error) {
    message.error(error.message);
  }
}

async function runImpact() {
  try {
    await hooksStore.runImpactAnalysis([]);
    message.success("影响分析完成");
  } catch (error) {
    message.error(error.message);
  }
}

async function runAutoFix() {
  try {
    await hooksStore.runAutoFix([]);
    message.success("自动修复完成");
  } catch (error) {
    message.error(error.message);
  }
}

function severityColor(severity) {
  if (severity === "error") {
    return "red";
  }
  if (severity === "warning") {
    return "orange";
  }
  return "blue";
}

function riskColor(score) {
  if (score >= 80) {
    return "red";
  }
  if (score >= 50) {
    return "orange";
  }
  return "green";
}

function formatTime(ts) {
  if (!ts) {
    return "";
  }
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}
</script>

<style scoped>
.git-hooks-panel {
  padding: 12px;
  font-size: 13px;
  height: 100%;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.panel-title {
  font-weight: 600;
  font-size: 14px;
  color: #262626;
}

.panel-section {
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f0f0f0;
}

.panel-section:last-child {
  border-bottom: none;
}

.section-label {
  font-weight: 600;
  font-size: 12px;
  color: #595959;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.result-meta {
  font-weight: 400;
  font-size: 12px;
  color: #8c8c8c;
}

.issue-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 4px;
}

.issue-tag {
  flex-shrink: 0;
}

.issue-msg {
  font-size: 12px;
  color: #595959;
  word-break: break-all;
  line-height: 1.4;
}

.more-hint {
  font-size: 11px;
  color: #bfbfbf;
  padding-left: 4px;
}

.impact-score {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  color: #595959;
}

.sub-label {
  font-size: 11px;
  color: #8c8c8c;
  margin-bottom: 4px;
}

.file-row {
  font-size: 12px;
  color: #595959;
  padding: 2px 0;
  font-family: "Menlo", "Consolas", monospace;
  word-break: break-all;
}

.affected-files {
  margin-top: 6px;
}

.fix-summary {
  display: flex;
  gap: 6px;
}

.stats-section {
  display: flex;
  gap: 16px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-label {
  font-size: 11px;
  color: #8c8c8c;
}

.stat-value {
  font-weight: 600;
  font-size: 14px;
  color: #262626;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
}

.history-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.history-type {
  font-size: 12px;
  color: #262626;
}

.history-time {
  font-size: 11px;
  color: #bfbfbf;
  margin-left: auto;
}
</style>
