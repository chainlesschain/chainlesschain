<template>
  <a-table
    :data-source="items"
    :columns="tableColumns"
    :pagination="false"
    size="small"
    row-key="id"
    :scroll="{ y: 260 }"
  />
</template>

<script setup lang="ts">
import { computed } from "vue";

interface Props {
  items: Record<string, unknown>[];
  columns: string[];
}
const props = defineProps<Props>();

const tableColumns = computed(() =>
  props.columns.map((key) => ({
    title: key,
    dataIndex: key,
    key,
    ellipsis: true,
  })),
);
</script>
