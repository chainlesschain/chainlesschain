<template>
  <div class="markdown-content" v-html="rendered"></div>
</template>

<script setup>
import { computed } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value
    }
    return hljs.highlightAuto(code).value
  },
  breaks: true
})

const props = defineProps({ content: { type: String, default: '' } })
const rendered = computed(() => {
  try { return marked(props.content) } catch { return props.content }
})
</script>

<style scoped>
.markdown-content :deep(pre) {
  background: var(--bg-base);
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  font-size: 12px;
}
.markdown-content :deep(code:not(pre code)) {
  background: var(--bg-card-hover);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  color: #f0a500;
}
.markdown-content :deep(p) { margin: 0 0 8px; }
.markdown-content :deep(p:last-child) { margin: 0; }
.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid #333;
  padding: 6px 12px;
}
.markdown-content :deep(th) { background: var(--bg-card-hover); }
</style>
