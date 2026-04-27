<template>
  <a-modal
    :open="store.createOpen"
    :width="600"
    :confirm-loading="store.creating"
    :mask-closable="!store.creating"
    :keyboard="!store.creating"
    title="创建社区"
    ok-text="创建"
    cancel-text="取消"
    @ok="onSubmit"
    @cancel="onCancel"
  >
    <a-alert
      message="新社区会以你当前的默认 DID 身份作为创建者，自动获得 owner 角色"
      type="info"
      show-icon
      style="margin-bottom: 16px"
    />

    <a-form
      :model="form"
      :label-col="{ span: 6 }"
      :wrapper-col="{ span: 18 }"
      layout="horizontal"
    >
      <a-form-item label="社区名称" required>
        <a-input
          v-model:value="form.name"
          placeholder="例如：Open Source 学习圈"
          :maxlength="100"
          show-count
        />
      </a-form-item>

      <a-form-item label="简介">
        <a-textarea
          v-model:value="form.description"
          placeholder="一句话介绍社区主题（可选）"
          :rows="2"
          :maxlength="300"
          show-count
        />
      </a-form-item>

      <a-form-item label="头像 URL">
        <a-input
          v-model:value="form.iconUrl"
          placeholder="头像 URL 或本地路径（可选）"
          :maxlength="500"
        />
      </a-form-item>

      <a-form-item label="社区规则">
        <a-textarea
          v-model:value="form.rulesMd"
          placeholder="支持 Markdown，发布前可以让成员阅读（可选）"
          :rows="4"
          :maxlength="4000"
        />
        <div class="form-hint">建议列出禁止行为、违规处理流程等。</div>
      </a-form-item>

      <a-form-item label="成员上限">
        <a-input-number
          v-model:value="form.memberLimit"
          :min="1"
          :max="100000"
          :step="100"
          style="width: 100%"
        />
        <div class="form-hint">达到上限后不再接受新成员（默认 1000）。</div>
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
import { useCommunityQuickStore } from "../../stores/communityQuick";

const store = useCommunityQuickStore();

const form = reactive({
  name: "",
  description: "",
  iconUrl: "",
  rulesMd: "",
  memberLimit: 1000,
});

watch(
  () => store.createOpen,
  (open, prev) => {
    if (open && !prev) {
      form.name = "";
      form.description = "";
      form.iconUrl = "";
      form.rulesMd = "";
      form.memberLimit = 1000;
    }
  },
);

async function onSubmit(): Promise<void> {
  const result = await store.createCommunity({
    name: form.name,
    description: form.description,
    iconUrl: form.iconUrl,
    rulesMd: form.rulesMd,
    memberLimit: form.memberLimit,
  });
  if (result) {
    antMessage.success(`社区「${result.name ?? form.name}」已创建`);
  }
}

function onCancel(): void {
  store.closeCreateForm();
}
</script>

<style scoped>
.form-hint {
  font-size: 12px;
  color: var(--cc-shell-muted, #999);
  margin-top: 4px;
}

.form-error {
  margin-top: 12px;
}
</style>
