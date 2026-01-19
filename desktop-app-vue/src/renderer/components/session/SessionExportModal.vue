<template>
  <a-modal
    :open="open"
    :title="isBatch ? '批量导出会话' : '导出会话'"
    :confirm-loading="exporting"
    ok-text="导出"
    @update:open="$emit('update:open', $event)"
    @ok="handleExport"
  >
    <a-form
      :model="form"
      layout="vertical"
    >
      <a-form-item label="导出格式">
        <a-radio-group v-model:value="form.format">
          <a-radio-button value="json">
            <FileOutlined /> JSON
          </a-radio-button>
          <a-radio-button
            value="markdown"
            :disabled="isBatch"
          >
            <FileMarkdownOutlined /> Markdown
          </a-radio-button>
        </a-radio-group>
        <div
          v-if="isBatch"
          class="format-hint"
        >
          批量导出仅支持 JSON 格式
        </div>
      </a-form-item>

      <a-form-item
        v-if="form.format === 'json'"
        label="导出选项"
      >
        <a-checkbox-group v-model:value="form.jsonOptions">
          <a-checkbox value="includeMetadata">
            包含元数据
          </a-checkbox>
          <a-checkbox value="includeStats">
            包含统计信息
          </a-checkbox>
          <a-checkbox value="pretty">
            格式化输出
          </a-checkbox>
        </a-checkbox-group>
      </a-form-item>

      <a-form-item
        v-if="form.format === 'markdown'"
        label="Markdown 选项"
      >
        <a-checkbox-group v-model:value="form.markdownOptions">
          <a-checkbox value="includeMetadata">
            包含元数据头
          </a-checkbox>
          <a-checkbox value="includeTimestamps">
            包含时间戳
          </a-checkbox>
        </a-checkbox-group>
      </a-form-item>

      <a-form-item v-if="isBatch">
        <a-alert
          type="info"
          :message="`将导出 ${sessionIds.length} 个会话`"
          show-icon
        />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup>
import { ref, reactive, watch } from "vue";
import { FileOutlined, FileMarkdownOutlined } from "@ant-design/icons-vue";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  sessionId: {
    type: String,
    default: null,
  },
  isBatch: {
    type: Boolean,
    default: false,
  },
  sessionIds: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["update:open", "export"]);

// 状态
const exporting = ref(false);
const form = reactive({
  format: "json",
  jsonOptions: ["includeMetadata", "pretty"],
  markdownOptions: ["includeMetadata", "includeTimestamps"],
});

// 监听打开状态重置表单
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      form.format = "json";
      form.jsonOptions = ["includeMetadata", "pretty"];
      form.markdownOptions = ["includeMetadata", "includeTimestamps"];
    }
  },
);

// 批量模式只能用 JSON
watch(
  () => props.isBatch,
  (isBatch) => {
    if (isBatch) {
      form.format = "json";
    }
  },
);

// 导出
const handleExport = async () => {
  exporting.value = true;

  try {
    const options = {
      includeMetadata:
        form.format === "json"
          ? form.jsonOptions.includes("includeMetadata")
          : form.markdownOptions.includes("includeMetadata"),
      includeStats: form.jsonOptions.includes("includeStats"),
      pretty: form.jsonOptions.includes("pretty"),
      includeTimestamps: form.markdownOptions.includes("includeTimestamps"),
    };

    emit("export", form.format, options);
  } finally {
    exporting.value = false;
  }
};
</script>

<style lang="less" scoped>
.format-hint {
  font-size: 12px;
  color: #8c8c8c;
  margin-top: 8px;
}
</style>
