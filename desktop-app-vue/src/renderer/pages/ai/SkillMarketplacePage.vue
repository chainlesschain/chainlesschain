<template>
  <div class="skill-marketplace-page">
    <a-page-header
      title="Skill Marketplace"
      sub-title="Skill-as-a-Service protocol"
    >
      <template #extra>
        <a-button type="primary" @click="showPublishModal = true">
          Publish Skill
        </a-button>
      </template>
    </a-page-header>
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="8">
        <a-statistic title="Total Skills" :value="store.skillCount" />
      </a-col>
      <a-col :span="8">
        <a-statistic title="Published" :value="store.publishedSkills.length" />
      </a-col>
      <a-col :span="8">
        <a-statistic title="Versions" :value="store.versions.length" />
      </a-col>
    </a-row>
    <a-table
      :columns="columns"
      :data-source="store.skills"
      :loading="store.loading"
      row-key="id"
      size="small"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'status'">
          <a-badge
            :status="record.status === 'published' ? 'success' : 'default'"
            :text="record.status"
          />
        </template>
      </template>
    </a-table>
    <a-modal
      v-model:open="showPublishModal"
      title="Publish Skill"
      :confirm-loading="store.loading"
      @ok="handlePublish"
    >
      <a-form layout="vertical">
        <a-form-item label="Name">
          <a-input v-model:value="form.name" placeholder="Skill name" />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea
            v-model:value="form.description"
            placeholder="Description"
          />
        </a-form-item>
        <a-form-item label="Version">
          <a-input v-model:value="form.version" placeholder="1.0.0" />
        </a-form-item>
      </a-form>
    </a-modal>
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
import { useSkillServiceStore } from "../../stores/skillService";

const store = useSkillServiceStore();
const showPublishModal = ref(false);
const form = ref({ name: "", description: "", version: "1.0.0" });
const columns = [
  { title: "Name", dataIndex: "name", width: 200 },
  { title: "Version", dataIndex: "version", width: 100 },
  { title: "Status", key: "status", width: 100 },
  { title: "Owner", dataIndex: "owner_did", width: 150 },
];

async function handlePublish() {
  if (!form.value.name) {
    message.warning("Name is required");
    return;
  }
  const r = await store.publishSkill(form.value);
  if (r.success) {
    message.success("Skill published");
    showPublishModal.value = false;
    form.value = { name: "", description: "", version: "1.0.0" };
  } else {
    message.error(r.error || "Failed");
  }
}

onMounted(() => store.fetchSkills());
</script>

<style lang="less" scoped>
.skill-marketplace-page {
  padding: 24px;
}
</style>
