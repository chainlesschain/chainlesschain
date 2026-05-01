<template>
  <div v-if="error" class="error-boundary">
    <a-result
      status="error"
      :title="$t('error.boundary.title')"
      :sub-title="error.message || ''"
    >
      <template #extra>
        <a-space direction="vertical" style="width: 100%; align-items: center;">
          <a-space>
            <a-button type="primary" @click="retry">
              <template #icon><ReloadOutlined /></template>
              {{ $t('error.boundary.retry') }}
            </a-button>
            <a-button @click="goHome">{{ $t('error.boundary.goHome') }}</a-button>
          </a-space>
          <a-collapse v-if="showStack" ghost style="max-width: 720px;">
            <a-collapse-panel key="stack" :header="$t('error.boundary.stack')">
              <pre class="stack">{{ error.stack || String(error) }}</pre>
            </a-collapse-panel>
          </a-collapse>
        </a-space>
      </template>
    </a-result>
  </div>
  <slot v-else />
</template>

<script setup>
import { ref, onErrorCaptured, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ReloadOutlined } from '@ant-design/icons-vue'

const error = ref(null)
const route = useRoute()
const router = useRouter()
const showStack = import.meta.env.DEV

// Capture any error thrown during render / lifecycle / event handlers
// of descendant components. Returning false stops propagation so the
// app-level errorHandler doesn't double-log it.
onErrorCaptured((err, _instance, info) => {
  error.value = err
  // eslint-disable-next-line no-console
  console.error('[ErrorBoundary]', info, err)
  return false
})

// Auto-reset when the user navigates to a different route — they
// should be able to leave the broken page without clicking "重试".
watch(
  () => route.fullPath,
  (newPath, oldPath) => {
    if (error.value && newPath !== oldPath) error.value = null
  },
)

async function retry() {
  const path = route.fullPath
  error.value = null
  // Trip the router so <router-view> fully remounts. A simple replace
  // to the same path is a no-op, so detour through a query stamp.
  await router.replace({ path, query: { ...route.query, _retry: Date.now() } })
  await router.replace({ path, query: { ...route.query, _retry: undefined } })
}

function goHome() {
  error.value = null
  if (route.path !== '/dashboard') router.push('/dashboard')
}
</script>

<style scoped>
.error-boundary {
  padding: 60px 24px;
  min-height: 400px;
}
.stack {
  font-size: 11px;
  color: #ff4d4f;
  background: var(--bg-base, #1a1a1a);
  padding: 12px;
  border-radius: 4px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow: auto;
  text-align: left;
}
</style>
