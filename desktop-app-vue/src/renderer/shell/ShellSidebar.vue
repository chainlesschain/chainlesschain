<template>
  <div class="shell-sidebar">
    <div class="sidebar-header">
      <a-button
        type="primary"
        block
        class="new-session-btn"
        @click="onNewSession"
      >
        <template #icon>
          <PlusOutlined />
        </template>
        <span v-if="!collapsed">新会话</span>
      </a-button>
      <a-button
        type="text"
        size="small"
        class="collapse-btn"
        @click="$emit('toggle')"
      >
        <MenuFoldOutlined v-if="!collapsed" />
        <MenuUnfoldOutlined v-else />
      </a-button>
    </div>

    <a-menu
      v-model:selected-keys="selectedKeys"
      v-model:open-keys="openKeys"
      :inline-collapsed="collapsed"
      mode="inline"
      class="sidebar-menu"
    >
      <a-menu-item key="today">
        <template #icon>
          <CalendarOutlined />
        </template>
        今日
      </a-menu-item>

      <a-sub-menu key="spaces">
        <template #icon>
          <AppstoreOutlined />
        </template>
        <template #title> 空间 </template>
        <a-menu-item
          v-for="space in allSpaces"
          :key="space.id"
          @click="onSelectSpace(space.id)"
        >
          {{ space.name }}
        </a-menu-item>
      </a-sub-menu>

      <a-menu-item key="contacts" @click="onOpenContacts">
        <template #icon>
          <TeamOutlined />
        </template>
        联系人
      </a-menu-item>

      <a-menu-item key="conversations" disabled>
        <template #icon>
          <MessageOutlined />
        </template>
        最近会话
      </a-menu-item>
    </a-menu>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import {
  PlusOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  CalendarOutlined,
  AppstoreOutlined,
  TeamOutlined,
  MessageOutlined,
} from "@ant-design/icons-vue";
import { useExtensionRegistryStore } from "../stores/extensionRegistry";
import { dispatchSlash } from "./slash-dispatch";

defineProps<{ collapsed: boolean }>();
defineEmits<{ (e: "toggle"): void }>();

const registry = useExtensionRegistryStore();

const allSpaces = computed(() =>
  [...registry.spaces].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
);

const selectedKeys = ref<string[]>(["today"]);
const openKeys = ref<string[]>(["spaces"]);

function onNewSession() {
  // Open the AI chat panel — that's where a "new session" actually lives.
  // AppShell registers a slash handler for "builtin:openAIChatPanel".
  dispatchSlash("builtin:openAIChatPanel", {
    trigger: "sidebar:new-session",
    args: "",
  });
}

function onOpenContacts() {
  dispatchSlash("builtin:openFriendsPanel", {
    trigger: "sidebar:contacts",
    args: "",
  });
}

function onSelectSpace(id: string) {
  // Spaces are extension-contributed; default install has none. Let plugins
  // wire their own `space:select:<id>` handlers when they register a space.
  dispatchSlash(`space:select:${id}`, {
    trigger: "sidebar:select-space",
    args: id,
  });
}
</script>

<style scoped>
.shell-sidebar {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 12px;
  display: flex;
  gap: 8px;
  align-items: center;
  border-bottom: 1px solid var(--shell-border, #e8e8e8);
}

.new-session-btn {
  flex: 1;
}

.sidebar-menu {
  flex: 1;
  border-right: none !important;
  overflow-y: auto;
}
</style>
