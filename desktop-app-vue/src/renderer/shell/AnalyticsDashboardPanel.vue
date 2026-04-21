<template>
  <a-modal
    :open="open"
    :width="720"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    title="高级分析"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <BarChartOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <p class="panel-desc">
      AI 调用、Token 使用、错误率、技能执行等指标的跨时段分析。
      下方为可用指标组（完整仪表盘请访问 <code>/analytics</code>）。
    </p>

    <a-row :gutter="[12, 12]">
      <a-col v-for="group in groups" :key="group.id" :span="12">
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-label">{{ group.label }}</span>
            <a-tag :color="group.tone">
              {{ group.tag }}
            </a-tag>
          </div>
          <p class="metric-desc">
            {{ group.desc }}
          </p>
        </div>
      </a-col>
    </a-row>

    <a-divider />

    <a-space>
      <a-button size="small" @click="exportAs('csv')"> 导出 CSV </a-button>
      <a-button size="small" @click="exportAs('json')"> 导出 JSON </a-button>
      <a-button size="small" type="primary" @click="refresh">
        刷新指标
      </a-button>
    </a-space>
  </a-modal>
</template>

<script setup lang="ts">
import { message as antMessage } from "ant-design-vue";
import { BarChartOutlined } from "@ant-design/icons-vue";

interface MetricGroup {
  id: string;
  label: string;
  tag: string;
  tone: string;
  desc: string;
}

defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const groups: MetricGroup[] = [
  {
    id: "ai",
    label: "AI 调用",
    tag: "LLM",
    tone: "blue",
    desc: "按模型/技能/时间查看调用次数与分布。",
  },
  {
    id: "tokens",
    label: "Token 用量",
    tag: "Cost",
    tone: "green",
    desc: "输入/输出 token 数、总成本、模型对比。",
  },
  {
    id: "skills",
    label: "技能执行",
    tag: "Skills",
    tone: "purple",
    desc: "139 个内置技能的调用次数与耗时。",
  },
  {
    id: "errors",
    label: "错误趋势",
    tag: "Errors",
    tone: "red",
    desc: "错误类型分布、错误率、可用性 SLO。",
  },
  {
    id: "uptime",
    label: "系统可用性",
    tag: "Uptime",
    tone: "cyan",
    desc: "进程健康、IPC 延迟、数据库时延。",
  },
  {
    id: "automation",
    label: "自动化执行",
    tag: "Flow",
    tone: "orange",
    desc: "工作流/钩子/定时任务的执行统计。",
  },
];

function exportAs(format: "csv" | "json"): void {
  antMessage.info(
    `导出为 ${format.toUpperCase()}（主进程接入将在后续迭代完成）`,
  );
}

function refresh(): void {
  antMessage.info("刷新指标（主进程接入将在后续迭代完成）");
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  background: var(--cc-shell-hover, #f5f5f5);
  border-left: 3px solid var(--cc-primary, #1677ff);
  border-radius: 4px;
  font-size: 13px;
}

.prefill-text {
  flex: 1;
  color: var(--cc-shell-text, #1f1f1f);
}

.panel-desc {
  margin: 0 0 16px 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 13px;
  line-height: 1.6;
}

.panel-desc code {
  padding: 1px 6px;
  background: var(--cc-shell-sider-bg, #fafafa);
  border-radius: 3px;
  font-size: 12px;
}

.metric-card {
  padding: 10px 12px;
  background: var(--cc-shell-card, #fff);
  border: 1px solid var(--cc-shell-border, #eee);
  border-radius: 8px;
}

.metric-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.metric-label {
  font-weight: 600;
  color: var(--cc-shell-text, #1f1f1f);
  font-size: 13px;
}

.metric-desc {
  margin: 0;
  color: var(--cc-shell-muted, #595959);
  font-size: 12px;
  line-height: 1.5;
}
</style>
