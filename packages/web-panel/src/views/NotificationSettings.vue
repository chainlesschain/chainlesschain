<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">通知设置</h2>
        <p class="page-sub">控制应用通知行为 · 与桌面 V5/V6 设置同源</p>
      </div>
    </div>

    <a-alert
      v-if="!isEmbedded"
      type="info"
      show-icon
      style="margin-bottom: 16px;"
      message="浏览器模式只读"
      description="纯浏览器没有 Electron AppConfig 后端,本页只能展示默认值。请使用桌面壳 (cc desktop) 写入。"
    />

    <a-card style="background: var(--bg-card); border-color: var(--border-color);">
      <a-form layout="horizontal" :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
        <a-form-item label="启用通知">
          <a-switch
            :checked="settings.enabled"
            :disabled="!isEmbedded || saving"
            @change="(val) => onToggle('enabled', val)"
          />
          <span class="hint">关闭后所有通知静默</span>
        </a-form-item>

        <template v-if="settings.enabled">
          <a-form-item label="通知声音">
            <a-switch
              :checked="settings.sound"
              :disabled="!isEmbedded || saving"
              @change="(val) => onToggle('sound', val)"
            />
            <span class="hint">桌面通知伴随系统提示音</span>
          </a-form-item>

          <a-form-item label="角标提示">
            <a-switch
              :checked="settings.badge"
              :disabled="!isEmbedded || saving"
              @change="(val) => onToggle('badge', val)"
            />
            <span class="hint">在应用图标 / 任务栏角标显示未读数</span>
          </a-form-item>

          <a-form-item label="桌面通知">
            <a-switch
              :checked="settings.desktop"
              :disabled="!isEmbedded || saving"
              @change="(val) => onToggle('desktop', val)"
            />
            <span class="hint">系统级 toast (Windows / macOS / Linux 原生通知)</span>
          </a-form-item>
        </template>
      </a-form>

      <a-divider />

      <div class="footer-row">
        <a-button :loading="loading" @click="reload">
          <template #icon><ReloadOutlined /></template>
          重新加载
        </a-button>
        <span v-if="lastSaved" class="last-saved">最近保存: {{ lastSaved }}</span>
      </div>
    </a-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { ReloadOutlined } from '@ant-design/icons-vue'
import { useNotificationSettings } from '../composables/useNotificationSettings.js'

const { settings, isEmbedded, load, update } = useNotificationSettings()

const loading = ref(false)
const saving = ref(false)
const lastSaved = ref('')

async function reload() {
  loading.value = true
  try {
    await load()
  } catch (err) {
    message.error('加载失败: ' + (err?.message || String(err)))
  } finally {
    loading.value = false
  }
}

async function onToggle(key, val) {
  if (!isEmbedded) return
  saving.value = true
  try {
    await update({ [key]: val })
    lastSaved.value = new Date().toLocaleTimeString()
    message.success('已保存')
  } catch (err) {
    message.error('保存失败: ' + (err?.message || String(err)))
    // 回滚 UI: 重新拉一次后端真相
    await load().catch(() => {})
  } finally {
    saving.value = false
  }
}

onMounted(reload)
</script>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
}
.page-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 600;
}
.page-sub {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}
.hint {
  margin-left: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}
.footer-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.last-saved {
  color: var(--text-muted);
  font-size: 12px;
}
</style>
