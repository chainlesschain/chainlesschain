<template>
  <a-drawer
    :open="open"
    :title="title"
    placement="right"
    width="520"
    :destroy-on-close="true"
    @close="close"
  >
    <a-alert
      type="info"
      show-icon
      message="凭据仅用于本次官方 API 采集"
      description="access token 与 App Key 不会写入本地配置、数据中台、审计日志或同步水位。提交后表单会立即清空。"
      style="margin-bottom: 16px"
    />

    <a-form v-if="spec" layout="vertical" :model="form">
      <a-form-item
        v-for="field in spec.fields"
        :key="field.key"
        :label="field.label"
        :required="field.required === true"
      >
        <a-input-password
          v-if="field.secret"
          v-model:value="form[field.key]"
          :data-field="field.key"
          :placeholder="field.placeholder"
          autocomplete="new-password"
          :spellcheck="false"
        />
        <a-input
          v-else
          v-model:value="form[field.key]"
          :data-field="field.key"
          :placeholder="field.placeholder"
          autocomplete="off"
          :spellcheck="false"
        />
      </a-form-item>

      <a-form-item label="扫描范围">
        <a-checkbox v-model:checked="form.recursive">
          递归采集子目录
        </a-checkbox>
      </a-form-item>

      <a-alert
        v-if="source?.name === 'doc-wps'"
        type="warning"
        show-icon
        message="App ID 与 App Key 必须同时填写或同时留空"
      />
    </a-form>

    <a-empty v-else description="该来源没有可用的 OAuth 采集配置" />

    <template #footer>
      <a-space>
        <a-button @click="close">取消</a-button>
        <a-button type="primary" :disabled="!canSubmit" @click="submit">
          开始采集
        </a-button>
      </a-space>
    </template>
  </a-drawer>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, watch } from "vue";
import {
  oauthCollectionOptions,
  oauthCollectionSpec,
} from "../utils/pdhCollectionMode.js";

const props = defineProps({
  open: { type: Boolean, default: false },
  source: { type: Object, default: null },
});

const emit = defineEmits(["update:open", "collect"]);

const form = reactive({
  accessToken: "",
  accountId: "",
  dir: "",
  driveId: "",
  parentId: "0",
  appId: "",
  appKey: "",
  recursive: true,
});

const spec = computed(() => oauthCollectionSpec(props.source));
const title = computed(() => {
  if (props.source?.name === "doc-baidu-netdisk") {
    return "百度网盘 OAuth 采集";
  }
  if (props.source?.name === "doc-wps") return "WPS OAuth 采集";
  return "OAuth 授权采集";
});
const canSubmit = computed(
  () => oauthCollectionOptions(props.source, form) !== null,
);

function resetForm() {
  form.accessToken = "";
  form.accountId = "";
  form.dir = "";
  form.driveId = "";
  form.parentId = "0";
  form.appId = "";
  form.appKey = "";
  form.recursive = true;
}

function close() {
  resetForm();
  emit("update:open", false);
}

function submit() {
  const options = oauthCollectionOptions(props.source, form);
  if (!options) return;
  const name = props.source.name;
  resetForm();
  emit("update:open", false);
  emit("collect", { name, options });
}

watch(
  () => [props.open, props.source?.name],
  ([open]) => {
    if (open) resetForm();
  },
);

onBeforeUnmount(resetForm);
</script>
