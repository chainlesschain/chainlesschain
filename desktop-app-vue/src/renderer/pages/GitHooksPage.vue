<template>
  <div class="git-hooks-page">
    <a-page-header title="Git Hooks" sub-title="AI-Powered Git Workflow">
      <template #extra>
        <a-button @click="loadAll"> 刷新 </a-button>
      </template>
    </a-page-header>

    <div style="padding: 16px">
      <a-row :gutter="16">
        <!-- Config -->
        <a-col :span="8">
          <a-card title="配置">
            <a-form v-if="hooksStore.config" layout="vertical">
              <a-form-item label="Pre-commit 检查">
                <a-switch
                  v-model:checked="hooksStore.config.preCommitEnabled"
                  @change="saveConfig"
                />
              </a-form-item>
              <a-form-item label="影响分析">
                <a-switch
                  v-model:checked="hooksStore.config.impactAnalysisEnabled"
                  @change="saveConfig"
                />
              </a-form-item>
              <a-form-item label="自动修复">
                <a-switch
                  v-model:checked="hooksStore.config.autoFixEnabled"
                  @change="saveConfig"
                />
              </a-form-item>
            </a-form>

            <a-card title="统计" size="small" style="margin-top: 16px">
              <a-descriptions :column="1" size="small">
                <a-descriptions-item label="总运行次数">
                  {{ hooksStore.stats?.totalRuns || 0 }}
                </a-descriptions-item>
                <a-descriptions-item label="通过率">
                  {{ hooksStore.stats?.passRate || 0 }}%
                </a-descriptions-item>
                <a-descriptions-item label="平均耗时">
                  {{ hooksStore.stats?.avgDurationMs || 0 }}ms
                </a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-card>
        </a-col>

        <!-- Actions -->
        <a-col :span="8">
          <a-card title="操作">
            <a-space direction="vertical" style="width: 100%">
              <a-button
                type="primary"
                block
                :loading="hooksStore.loading"
                @click="runPreCommit"
              >
                运行 Pre-commit 检查
              </a-button>
              <a-button block :loading="hooksStore.loading" @click="runImpact">
                运行影响分析
              </a-button>
              <a-button block :loading="hooksStore.loading" @click="runAutoFix">
                运行自动修复
              </a-button>
            </a-space>
          </a-card>

          <!-- Pre-commit results -->
          <a-card
            v-if="hooksStore.preCommitResults"
            title="Pre-commit 结果"
            style="margin-top: 16px"
          >
            <a-result
              :status="hooksStore.preCommitResults.passed ? 'success' : 'error'"
              :title="hooksStore.preCommitResults.passed ? 'PASSED' : 'FAILED'"
              :sub-title="`${hooksStore.preCommitResults.issues.length} 问题, ${hooksStore.preCommitResults.duration}ms`"
            />
            <a-list
              :data-source="hooksStore.preCommitResults.issues"
              size="small"
            >
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-tag
                    :color="
                      item.severity === 'error'
                        ? 'red'
                        : item.severity === 'warning'
                          ? 'orange'
                          : 'blue'
                    "
                  >
                    {{ item.severity }}
                  </a-tag>
                  {{ item.message || item.source }}
                </a-list-item>
              </template>
            </a-list>
          </a-card>
        </a-col>

        <!-- History -->
        <a-col :span="8">
          <a-card title="历史记录">
            <a-timeline>
              <a-timeline-item
                v-for="(entry, idx) in hooksStore.history"
                :key="idx"
                :color="entry.result?.passed !== false ? 'green' : 'red'"
              >
                <strong>{{ entry.type }}</strong>
                <br />
                <span style="font-size: 12px; color: #999">
                  {{ new Date(entry.timestamp).toLocaleString() }}
                  · {{ entry.result?.duration || 0 }}ms
                </span>
              </a-timeline-item>
            </a-timeline>
          </a-card>
        </a-col>
      </a-row>
    </div>
  </div>
</template>

<script setup>
import { onMounted } from "vue";
import { message } from "ant-design-vue";
import { useGitHooksStore } from "../stores/git-hooks";

const hooksStore = useGitHooksStore();

onMounted(async () => {
  await loadAll();
});

async function loadAll() {
  await Promise.all([
    hooksStore.loadConfig(),
    hooksStore.loadHistory(),
    hooksStore.loadStats(),
  ]);
}

async function saveConfig() {
  if (hooksStore.config) {
    await hooksStore.updateConfig(hooksStore.config);
  }
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
</script>
