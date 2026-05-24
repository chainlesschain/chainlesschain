<template>
  <div class="pdh-sidebar">
    <div class="sidebar-title">数据类型</div>
    <div
      class="cat-item"
      :class="{ active: selected === null }"
      @click="$emit('select', null)"
    >
      <AppstoreOutlined class="icon" />
      <span class="label">全部</span>
      <a-badge
        v-if="total > 0"
        :count="total"
        :number-style="badgeStyle(selected === null)"
        :overflow-count="9999"
      />
    </div>
    <div
      v-for="cat in CATEGORIES"
      :key="cat"
      class="cat-item"
      :class="{ active: selected === cat, dim: !facets.byCategory[cat] }"
      @click="$emit('select', cat)"
    >
      <component :is="iconFor(cat)" class="icon" />
      <span class="label">{{ categoryLabel(cat) }}</span>
      <a-badge
        v-if="facets.byCategory[cat]"
        :count="facets.byCategory[cat]"
        :number-style="badgeStyle(selected === cat)"
        :overflow-count="9999"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  AppstoreOutlined,
  MessageOutlined,
  PlayCircleOutlined,
  MailOutlined,
  ShoppingOutlined,
  CarOutlined,
  MobileOutlined,
  RobotOutlined,
} from "@ant-design/icons-vue";
import { CATEGORIES, categoryLabel } from "../../utils/pdhCategories.js";

const props = defineProps({
  selected: { type: String, default: null },
  facets: {
    type: Object,
    default: () => ({ byCategory: {}, total: 0 }),
  },
});

defineEmits(["select"]);

const total = computed(() => props.facets.total || 0);

const ICONS = {
  chat: MessageOutlined,
  social: PlayCircleOutlined,
  email: MailOutlined,
  shopping: ShoppingOutlined,
  travel: CarOutlined,
  system: MobileOutlined,
  "ai-chat": RobotOutlined,
  other: AppstoreOutlined,
};
function iconFor(cat) {
  return ICONS[cat] || AppstoreOutlined;
}

function badgeStyle(isActive) {
  return isActive
    ? { backgroundColor: "#fff", color: "#1677ff" }
    : { backgroundColor: "#f0f0f0", color: "#666" };
}
</script>

<style scoped>
.pdh-sidebar {
  background: #fff;
  border-radius: 8px;
  padding: 12px 8px;
  border: 1px solid #f0f0f0;
}
.sidebar-title {
  font-size: 12px;
  color: #999;
  padding: 4px 8px 8px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.cat-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  margin-bottom: 2px;
}
.cat-item:hover {
  background: #f5f5f5;
}
.cat-item.active {
  background: #1677ff;
  color: #fff;
}
.cat-item.dim {
  opacity: 0.45;
}
.cat-item .icon {
  font-size: 16px;
}
.cat-item .label {
  flex: 1;
  font-size: 14px;
}
</style>
