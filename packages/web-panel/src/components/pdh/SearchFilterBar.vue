<template>
  <div class="pdh-filter-bar">
    <a-input-search
      :value="filters.q"
      :placeholder="placeholderText"
      enter-button="搜索"
      allow-clear
      :loading="isLoading"
      style="flex: 1; max-width: 480px;"
      @update:value="onQInput"
      @search="onSearch"
    >
      <template #prefix><SearchOutlined /></template>
    </a-input-search>

    <a-select
      :value="filters.adapter"
      placeholder="所有 adapter"
      allow-clear
      :options="adapterOptions"
      style="width: 200px;"
      @update:value="(v) => $emit('set-filter', 'adapter', v || null)"
    />

    <a-range-picker
      :value="dateRangeValue"
      :placeholder="['开始日期', '结束日期']"
      style="width: 280px;"
      @update:value="onDateChange"
    />

    <a-button
      v-if="hasActiveFilters"
      type="link"
      danger
      @click="$emit('reset')"
    >
      <template #icon><CloseCircleOutlined /></template>
      清空筛选
    </a-button>

    <span v-if="shortQuery" class="hint">
      <InfoCircleOutlined /> 关键词需至少 3 字 (FTS5 trigram 限制)
    </span>
    <span v-else-if="mode === 'like'" class="hint">
      <InfoCircleOutlined /> 当前为 LIKE 兜底模式
    </span>
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  SearchOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  filters: { type: Object, required: true },
  facets: {
    type: Object,
    default: () => ({ byAdapter: {} }),
  },
  isLoading: { type: Boolean, default: false },
  mode: { type: String, default: null },
  shortQuery: { type: Boolean, default: false },
});

const emit = defineEmits(["set-filter", "reset"]);

const placeholderText = computed(() =>
  props.filters.category
    ? `在「${props.filters.category}」类目内搜索…`
    : "搜索关键词（如：支付宝、罗技、Kotlin）…"
);

const adapterOptions = computed(() => {
  // List adapters present in facets (sorted by count desc), so the dropdown
  // only shows adapters with actual data — no empty choices.
  const entries = Object.entries(props.facets.byAdapter || {}).sort(
    (a, b) => b[1] - a[1]
  );
  return entries.map(([adapter, count]) => ({
    value: adapter,
    label: `${adapter} (${count})`,
  }));
});

const dateRangeValue = computed(() => {
  if (!props.filters.since && !props.filters.until) return null;
  // ant-design-vue range picker wants dayjs values; passing raw ms works in v4
  return [
    props.filters.since ? new Date(props.filters.since) : null,
    props.filters.until ? new Date(props.filters.until) : null,
  ];
});

const hasActiveFilters = computed(
  () =>
    !!(
      props.filters.q ||
      props.filters.adapter ||
      props.filters.subtype ||
      props.filters.since ||
      props.filters.until
    )
);

function onQInput(value) {
  emit("set-filter", "q", value || "");
}

function onSearch(value) {
  // The text already streamed via @update:value → debounced search. The
  // enter-button also triggers immediate search; piggyback on set-filter so
  // the store sees the latest value before the debounce expires.
  emit("set-filter", "q", value || "");
}

function onDateChange(range) {
  if (!range || range.length === 0) {
    emit("set-filter", "since", null);
    emit("set-filter", "until", null);
    return;
  }
  const [start, end] = range;
  emit("set-filter", "since", start ? +start : null);
  emit("set-filter", "until", end ? +end : null);
}
</script>

<style scoped>
.pdh-filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: #fff;
  border-radius: 8px;
  border: 1px solid #f0f0f0;
  flex-wrap: wrap;
}
.hint {
  font-size: 12px;
  color: #999;
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
