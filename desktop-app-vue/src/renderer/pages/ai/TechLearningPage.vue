<template>
  <div class="tech-learning-page">
    <a-page-header
      title="Tech Learning Engine"
      sub-title="Autonomous technology stack detection and best practice extraction"
    >
      <template #extra>
        <a-button type="primary" @click="handleDetect"> Detect Stack </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="Profiles" :value="store.profileCount" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Practices" :value="store.practices.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Promoted" :value="store.promotedPractices.length" />
      </a-col>
    </a-row>

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="profiles" tab="Tech Profiles">
        <a-empty v-if="store.profiles.length === 0" description="No profiles" />
        <a-table
          v-else
          :columns="profileColumns"
          :data-source="store.profiles"
          :loading="store.loading"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'languages'">
              <a-tag v-for="l in record.languages || []" :key="l">
                {{ l }}
              </a-tag>
            </template>
            <template v-if="column.key === 'actions'">
              <a-button
                size="small"
                type="link"
                @click="handleExtract(record.id)"
              >
                Extract Practices
              </a-button>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <a-tab-pane key="practices" tab="Learned Practices">
        <a-empty
          v-if="store.practices.length === 0"
          description="No practices"
        />
        <a-table
          v-else
          :columns="practiceColumns"
          :data-source="store.practices"
          row-key="id"
          size="small"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'confidence'">
              <a-progress
                :percent="Math.round(record.confidence * 100)"
                size="small"
              />
            </template>
            <template v-if="column.key === 'status'">
              <a-badge
                :status="record.status === 'promoted' ? 'success' : 'default'"
                :text="record.status"
              />
            </template>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <a-alert
      v-if="store.error"
      type="error"
      :message="store.error"
      closable
      style="margin-top: 16px"
      @close="store.error = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useTechLearningStore } from "../../stores/techLearning";

const store = useTechLearningStore();
const activeTab = ref("profiles");

const profileColumns = [
  { title: "Path", dataIndex: "project_path", width: 200 },
  { title: "Languages", key: "languages" },
  { title: "Manifest", dataIndex: "manifest_type", width: 120 },
  { title: "Actions", key: "actions", width: 150 },
];

const practiceColumns = [
  { title: "Title", dataIndex: "title", width: 200 },
  { title: "Category", dataIndex: "category", width: 120 },
  { title: "Confidence", key: "confidence", width: 150 },
  { title: "Status", key: "status", width: 100 },
];

async function handleDetect() {
  const result = await store.detectStack(process.cwd?.() || "/home/project");
  if (result.success) {
    message.success("Stack detected");
  } else {
    message.error(result.error || "Failed");
  }
}

async function handleExtract(profileId: string) {
  const result = await store.extractPractices(profileId);
  if (result.success) {
    message.success("Practices extracted");
    activeTab.value = "practices";
  } else {
    message.error(result.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchProfiles();
  await store.fetchPractices();
});
</script>

<style lang="less" scoped>
.tech-learning-page {
  padding: 24px;
}
</style>
