<template>
  <div class="note-artifact">
    <h3 class="note-title">
      {{ payload.title || "（未命名笔记）" }}
    </h3>
    <div class="note-tags">
      <a-tag v-for="tag in payload.tags" :key="tag" color="blue">
        {{ tag }}
      </a-tag>
    </div>
    <pre class="note-body">{{ payload.bodyMarkdown }}</pre>
    <div class="note-meta">{{ payload.wordCount }} 字</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { NoteArtifact } from "@/types/artifact";

const props = defineProps<{ data: NoteArtifact }>();
const payload = computed(() => props.data.payload);
</script>

<style scoped>
.note-artifact {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.note-title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
}
.note-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.note-body {
  white-space: pre-wrap;
  line-height: 1.6;
  font-family: inherit;
  font-size: 13px;
  background: #fafafa;
  padding: 10px;
  border-radius: 4px;
  border: 1px solid #eee;
  margin: 0;
}
.note-meta {
  color: #888;
  font-size: 11px;
}
</style>
