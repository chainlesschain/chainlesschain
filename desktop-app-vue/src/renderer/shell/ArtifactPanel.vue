<template>
  <div class="artifact-panel">
    <div class="artifact-header">
      <div class="artifact-title">
        <FileOutlined />
        <span>Artifact</span>
      </div>
      <a-button type="text" size="small" @click="$emit('close')">
        <CloseOutlined />
      </a-button>
    </div>

    <div v-if="!currentArtifact" class="artifact-empty">
      <p>暂无 Artifact</p>
      <p class="hint">
        对话产生的文档、签名、交易、P2P 线程、凭证等对象会在这里展示。
      </p>
    </div>

    <div v-else class="artifact-body">
      <div class="artifact-meta">
        <span class="artifact-type">{{
          contribution?.label || currentArtifact.type
        }}</span>
      </div>

      <component
        :is="rendererComponent"
        v-if="rendererComponent"
        :data="currentArtifact"
      />
      <pre v-else class="artifact-fallback">{{
        JSON.stringify(currentArtifact, null, 2)
      }}</pre>

      <div v-if="contribution?.actions?.length" class="artifact-actions">
        <a-button
          v-for="action in contribution.actions"
          :key="action.id"
          size="small"
          @click="onAction(action.id)"
        >
          {{ action.label }}
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { FileOutlined, CloseOutlined } from "@ant-design/icons-vue";
import { storeToRefs } from "pinia";
import { useExtensionRegistryStore } from "../stores/extensionRegistry";
import { useArtifactStore } from "../stores/artifacts";
import { resolveArtifactRenderer } from "./artifacts/resolver";

defineEmits<{ (e: "close"): void }>();

const artifactStore = useArtifactStore();
const { currentArtifact } = storeToRefs(artifactStore);

const registry = useExtensionRegistryStore();

const contribution = computed(() => {
  if (!currentArtifact.value) {
    return null;
  }
  return registry.getArtifactContribution(currentArtifact.value.type);
});

const rendererComponent = computed(() => {
  const rendererKey = contribution.value?.renderer;
  return resolveArtifactRenderer(rendererKey);
});

async function onAction(actionId: string) {
  if (!currentArtifact.value) {
    return;
  }
  await artifactStore.runAction(currentArtifact.value.id, actionId);
}
</script>

<style scoped>
.artifact-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.artifact-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--shell-border, #e8e8e8);
}

.artifact-title {
  display: flex;
  gap: 8px;
  align-items: center;
  font-weight: 500;
}

.artifact-empty {
  padding: 32px 16px;
  text-align: center;
  color: #888;
}

.artifact-empty .hint {
  font-size: 12px;
  color: #aaa;
  line-height: 1.6;
  margin-top: 8px;
}

.artifact-body {
  padding: 16px;
  overflow-y: auto;
  flex: 1;
}

.artifact-meta {
  margin-bottom: 12px;
}

.artifact-type {
  font-size: 11px;
  background: #f0f5ff;
  color: #1677ff;
  padding: 2px 8px;
  border-radius: 10px;
}

.artifact-fallback {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  font-size: 12px;
  overflow: auto;
}

.artifact-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  flex-wrap: wrap;
}
</style>
