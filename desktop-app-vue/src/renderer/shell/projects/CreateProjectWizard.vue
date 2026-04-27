<template>
  <a-modal
    :open="store.createOpen"
    :width="540"
    :confirm-loading="store.creating"
    :mask-closable="!store.creating"
    :keyboard="!store.creating"
    title="快速新建项目"
    ok-text="创建"
    cancel-text="取消"
    @ok="onSubmit"
    @cancel="onCancel"
  >
    <a-form :model="form" layout="vertical">
      <a-form-item label="项目名称" required>
        <a-input
          v-model:value="form.name"
          placeholder="请输入项目名称"
          size="large"
          :maxlength="100"
          show-count
          @press-enter="onSubmit"
        />
      </a-form-item>
      <a-form-item label="项目描述">
        <a-textarea
          v-model:value="form.description"
          placeholder="简要描述项目用途（可选）"
          :rows="3"
          :maxlength="500"
          show-count
        />
      </a-form-item>
      <a-form-item label="项目类型">
        <a-radio-group v-model:value="form.projectType">
          <a-radio value="document"> <FileTextOutlined /> 文档 </a-radio>
          <a-radio value="web"> <GlobalOutlined /> Web </a-radio>
          <a-radio value="data"> <DatabaseOutlined /> 数据 </a-radio>
          <a-radio value="app"> <AppstoreOutlined /> 应用 </a-radio>
        </a-radio-group>
      </a-form-item>
    </a-form>
    <a-alert
      v-if="store.createError"
      class="form-error"
      :message="store.createError"
      type="error"
      show-icon
      closable
      @close="store.clearCreateError()"
    />
  </a-modal>
</template>

<script setup lang="ts">
import { reactive, watch } from "vue";
import { message as antMessage } from "ant-design-vue";
import {
  AppstoreOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  GlobalOutlined,
} from "@ant-design/icons-vue";
import { useProjectsQuickStore } from "../../stores/projectsQuick";

const store = useProjectsQuickStore();

const form = reactive({
  name: "",
  description: "",
  projectType: "document" as "web" | "document" | "data" | "app",
});

watch(
  () => store.createOpen,
  (open, prev) => {
    if (open && !prev) {
      form.name = "";
      form.description = "";
      form.projectType = "document";
    }
  },
);

async function onSubmit(): Promise<void> {
  const result = await store.createProject({
    name: form.name,
    description: form.description,
    projectType: form.projectType,
  });
  if (result) {
    antMessage.success(`项目「${result.name ?? form.name}」已创建`);
  }
}

function onCancel(): void {
  store.closeCreateForm();
}
</script>

<style scoped>
.form-error {
  margin-top: 12px;
}
</style>
