<template>
  <a-dropdown :disabled="!hasResults">
    <a-button :disabled="!hasResults">
      <template #icon><DownloadOutlined /></template>
      导出 ({{ events.length }})
      <DownOutlined />
    </a-button>
    <template #overlay>
      <a-menu @click="onClick">
        <a-menu-item key="json">JSON (.json)</a-menu-item>
        <a-menu-item key="ndjson">NDJSON (.ndjson)</a-menu-item>
        <a-menu-item key="csv">CSV (.csv)</a-menu-item>
      </a-menu>
    </template>
  </a-dropdown>
</template>

<script setup>
import { computed } from "vue";
import { DownloadOutlined, DownOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import {
  eventsToJson,
  eventsToNdjson,
  eventsToCsv,
  downloadAs,
  suggestFilename,
} from "../../utils/pdhExport.js";

const props = defineProps({
  events: { type: Array, required: true },
  category: { type: String, default: null },
});

const hasResults = computed(() => props.events.length > 0);

const MIME = {
  json: "application/json;charset=utf-8",
  ndjson: "application/x-ndjson;charset=utf-8",
  csv: "text/csv;charset=utf-8",
};

function serialize(format) {
  switch (format) {
    case "json": return eventsToJson(props.events);
    case "ndjson": return eventsToNdjson(props.events);
    case "csv": return eventsToCsv(props.events);
    default: throw new Error(`unknown format: ${format}`);
  }
}

function onClick({ key }) {
  try {
    const content = serialize(key);
    const filename = suggestFilename(key, props.category);
    downloadAs(content, filename, MIME[key]);
    message.success(`已导出 ${props.events.length} 条到 ${filename}`);
  } catch (err) {
    message.error(`导出失败: ${err.message || err}`);
  }
}
</script>
