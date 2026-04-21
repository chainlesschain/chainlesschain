<template>
  <a-layout class="app-shell">
    <a-layout-sider
      v-model:collapsed="sidebarCollapsed"
      :width="260"
      :collapsed-width="60"
      :collapsible="true"
      :trigger="null"
      class="shell-sider"
    >
      <ShellSidebar :collapsed="sidebarCollapsed" @toggle="toggleSidebar" />
    </a-layout-sider>

    <a-layout class="shell-main">
      <a-layout-content class="shell-content">
        <div class="conversation-region">
          <ConversationStream @open-artifact="artifactOpen = true" />
          <ShellComposer />
        </div>
        <div v-if="artifactOpen" class="artifact-region">
          <ArtifactPanel @close="closeArtifact" />
        </div>
      </a-layout-content>

      <a-layout-footer class="shell-footer">
        <ShellStatusBar />
      </a-layout-footer>
    </a-layout>

    <CommandPalette v-model:open="paletteOpen" />
    <AdminConsole v-model:open="adminOpen" />
  </a-layout>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useExtensionRegistryStore } from "../stores/extensionRegistry";
import { useArtifactStore } from "../stores/artifacts";
import { applyBrandTheme, clearBrandTheme } from "./theme-applier";
import { registerSlashHandler } from "./slash-dispatch";
import { message as antMessage } from "ant-design-vue";
import "./widgets";
import ShellSidebar from "./ShellSidebar.vue";
import ConversationStream from "./ConversationStream.vue";
import ShellComposer from "./ShellComposer.vue";
import ArtifactPanel from "./ArtifactPanel.vue";
import ShellStatusBar from "./ShellStatusBar.vue";
import CommandPalette from "./CommandPalette.vue";
import AdminConsole from "./AdminConsole.vue";

const sidebarCollapsed = ref(false);
const artifactOpen = ref(false);
const paletteOpen = ref(false);
const adminOpen = ref(false);

const registry = useExtensionRegistryStore();
const artifactStore = useArtifactStore();

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function closeArtifact() {
  artifactOpen.value = false;
  artifactStore.close();
}

function handleKeydown(e: KeyboardEvent) {
  const isMod = e.ctrlKey || e.metaKey;
  if (isMod && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    paletteOpen.value = !paletteOpen.value;
    return;
  }
  if (isMod && e.shiftKey && (e.key === "a" || e.key === "A")) {
    e.preventDefault();
    adminOpen.value = !adminOpen.value;
  }
}

let appliedThemeVars: string[] = [];
let unregisterAdminHandler: (() => void) | null = null;
let unregisterPromptsHandler: (() => void) | null = null;
let unregisterGitHooksHandler: (() => void) | null = null;

onMounted(async () => {
  window.addEventListener("keydown", handleKeydown);
  unregisterAdminHandler = registerSlashHandler(
    "builtin:openAdminConsole",
    () => {
      adminOpen.value = true;
    },
  );
  unregisterPromptsHandler = registerSlashHandler(
    "builtin:openPromptsPanel",
    ({ args }) => {
      if (args) {
        antMessage.info(
          `已预填充提示：${args.slice(0, 40)}${args.length > 40 ? "…" : ""}`,
        );
      } else {
        antMessage.info("AI 提示面板（完整面板将在后续迭代接入）");
      }
    },
  );
  unregisterGitHooksHandler = registerSlashHandler(
    "builtin:openGitHooksPanel",
    ({ args }) => {
      if (args) {
        antMessage.info(`Git Hooks：${args}（完整面板将在后续迭代接入）`);
      } else {
        antMessage.info("Git Hooks 管理面板（完整面板将在后续迭代接入）");
      }
    },
  );
  await registry.refreshAll();
  appliedThemeVars = applyBrandTheme(registry.brandTheme);
  artifactStore.seedIfEmpty();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  clearBrandTheme(appliedThemeVars);
  unregisterAdminHandler?.();
  unregisterAdminHandler = null;
  unregisterPromptsHandler?.();
  unregisterPromptsHandler = null;
  unregisterGitHooksHandler?.();
  unregisterGitHooksHandler = null;
});
</script>

<style scoped>
.app-shell {
  height: 100vh;
  overflow: hidden;
}

.shell-sider {
  background: var(--shell-sider-bg, #fafafa);
  border-right: 1px solid var(--shell-border, #e8e8e8);
}

.shell-main {
  display: flex;
  flex-direction: column;
}

.shell-content {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  overflow: hidden;
}

.conversation-region {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--shell-bg, #ffffff);
}

.artifact-region {
  width: 420px;
  flex-shrink: 0;
  border-left: 1px solid var(--shell-border, #e8e8e8);
  background: var(--shell-artifact-bg, #fcfcfc);
  overflow-y: auto;
}

.shell-footer {
  height: 28px;
  line-height: 28px;
  padding: 0 12px;
  font-size: 12px;
  background: var(--shell-footer-bg, #f5f5f5);
  border-top: 1px solid var(--shell-border, #e8e8e8);
}
</style>
