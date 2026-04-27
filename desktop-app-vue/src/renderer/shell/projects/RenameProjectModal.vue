<template>
  <a-modal
    :open="store.renameOpen"
    :width="480"
    :confirm-loading="store.renaming"
    :mask-closable="!store.renaming"
    :keyboard="!store.renaming"
    title="重命名项目"
    ok-text="保存"
    cancel-text="取消"
    @ok="onSubmit"
    @cancel="onCancel"
  >
    <a-form layout="vertical">
      <a-form-item label="项目名称" required>
        <a-input
          v-model:value="newName"
          placeholder="请输入项目名称"
          size="large"
          :maxlength="100"
          show-count
          @press-enter="onSubmit"
        />
      </a-form-item>
    </a-form>
    <a-alert
      v-if="store.renameError"
      class="form-error"
      :message="store.renameError"
      type="error"
      show-icon
      closable
      @close="store.clearRenameError()"
    />
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { message as antMessage } from "ant-design-vue";
import { useProjectsQuickStore } from "../../stores/projectsQuick";

const store = useProjectsQuickStore();
const newName = ref("");

watch(
  () => store.renameOpen,
  (open, prev) => {
    if (open && !prev) {
      newName.value =
        typeof store.renamingProject?.name === "string"
          ? store.renamingProject.name
          : "";
    }
  },
);

async function onSubmit(): Promise<void> {
  const id = store.renamingProject?.id;
  if (!id) {
    return;
  }
  const ok = await store.renameProject(id, newName.value);
  if (ok) {
    antMessage.success(`已重命名为「${newName.value.trim()}」`);
  }
}

function onCancel(): void {
  store.closeRenameForm();
}
</script>

<style scoped>
.form-error {
  margin-top: 12px;
}
</style>
