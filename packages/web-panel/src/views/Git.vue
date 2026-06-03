<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('git.title') }}</h2>
        <p class="page-sub">{{ t('git.subtitle') }}</p>
      </div>
    </div>

    <a-tabs v-model:activeKey="activeTab" type="card">
      <!-- Git Tab -->
      <a-tab-pane key="git">
        <template #tab>
          <BranchesOutlined /> {{ t('git.tabs.git') }}
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" :loading="statusLoading" @click="refreshStatus">
            <template #icon><ReloadOutlined /></template>
            {{ t('git.actions.refresh') }}
          </a-button>
          <a-button :loading="commitLoading" @click="confirmAutoCommit">
            <template #icon><CheckOutlined /></template>
            {{ t('git.actions.autoCommit') }}
          </a-button>
        </a-space>

        <!-- Branch & Stats -->
        <div v-if="gitBranch || changedCount > 0" style="margin-bottom: 16px;">
          <a-space>
            <a-tag v-if="gitBranch" color="blue">
              <BranchesOutlined /> {{ gitBranch }}
            </a-tag>
            <a-tag v-if="changedCount > 0" color="orange">{{ t('git.status.changedCount', { count: changedCount }) }}</a-tag>
            <a-tag v-else-if="statusOutput && changedCount === 0" color="green">{{ t('git.status.clean') }}</a-tag>
          </a-space>
        </div>

        <!-- Status Output -->
        <a-card v-if="statusOutput" :bordered="false" style="background: var(--bg-base); border: 1px solid var(--border-color);">
          <pre style="white-space: pre-wrap; word-break: break-all; color: var(--text-primary); font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; font-size: 13px; line-height: 1.7; margin: 0;">{{ statusOutput }}</pre>
        </a-card>

        <a-empty v-else-if="!statusLoading" :description="t('git.status.emptyHint')" style="padding: 60px 0;" />

        <!-- Commit Result -->
        <a-alert
          v-if="commitResult"
          :message="commitSuccess ? t('git.status.commitSuccessAlert') : t('git.status.commitResultAlert')"
          :description="commitResult"
          :type="commitSuccess ? 'success' : 'info'"
          show-icon
          closable
          style="margin-top: 16px;"
          @close="commitResult = ''"
        />
      </a-tab-pane>

      <!-- Import/Export Tab -->
      <a-tab-pane key="io">
        <template #tab>
          <ImportOutlined /> {{ t('git.tabs.io') }}
        </template>

        <!-- Import Section -->
        <a-card :title="t('git.import.cardTitle')" :bordered="false" style="background: var(--bg-card); border: 1px solid var(--border-color); margin-bottom: 16px;">
          <div style="display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px;">
              <label style="display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: 13px;">{{ t('git.import.pathLabel') }}</label>
              <a-input v-model:value="importPath" :placeholder="t('git.import.pathPlaceholder')" allow-clear />
            </div>
            <div style="min-width: 140px;">
              <label style="display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: 13px;">{{ t('git.import.formatLabel') }}</label>
              <a-select v-model:value="importFormat" style="width: 140px;">
                <a-select-option value="markdown">Markdown</a-select-option>
                <a-select-option value="pdf">PDF</a-select-option>
                <a-select-option value="evernote">Evernote</a-select-option>
              </a-select>
            </div>
            <a-button type="primary" :loading="importLoading" :disabled="!importPath.trim()" @click="doImport">
              <template #icon><ImportOutlined /></template>
              {{ t('git.import.submit') }}
            </a-button>
          </div>
        </a-card>

        <!-- Export Section -->
        <a-card :title="t('git.export.cardTitle')" :bordered="false" style="background: var(--bg-card); border: 1px solid var(--border-color); margin-bottom: 16px;">
          <div style="display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px;">
              <label style="display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: 13px;">{{ t('git.export.pathLabel') }}</label>
              <a-input v-model:value="exportPath" :placeholder="t('git.export.pathPlaceholder')" allow-clear />
            </div>
            <a-button type="primary" :loading="exportLoading" :disabled="!exportPath.trim()" @click="doExport">
              <template #icon><ExportOutlined /></template>
              {{ t('git.export.submit') }}
            </a-button>
          </div>
        </a-card>

        <!-- IO Result -->
        <a-alert
          v-if="ioResult"
          :message="ioSuccess ? t('git.io.successAlert') : t('git.io.resultAlert')"
          :description="ioResult"
          :type="ioSuccess ? 'success' : 'info'"
          show-icon
          closable
          style="margin-top: 16px;"
          @close="ioResult = ''"
        />

        <!-- IO Output -->
        <a-card
          v-if="ioOutput"
          :title="t('git.io.outputCardTitle')"
          :bordered="false"
          style="background: var(--bg-base); border: 1px solid var(--border-color); margin-top: 16px;"
        >
          <pre style="white-space: pre-wrap; word-break: break-all; color: var(--text-primary); font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; font-size: 13px; line-height: 1.7; margin: 0;">{{ ioOutput }}</pre>
        </a-card>
      </a-tab-pane>
    </a-tabs>

    <!-- Auto Commit Confirmation Modal -->
    <a-modal
      v-model:open="showCommitConfirm"
      :title="t('git.confirm.title')"
      :ok-text="t('git.confirm.ok')"
      :cancel-text="t('common.cancel')"
      :confirm-loading="commitLoading"
      @ok="doAutoCommit"
    >
      <p style="color: var(--text-secondary);">
        {{ t('git.confirm.intro1') }} <code>git auto-commit</code> {{ t('git.confirm.intro2') }}
      </p>
    </a-modal>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { BranchesOutlined, ImportOutlined, ExportOutlined, ReloadOutlined, CheckOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

const { t } = useI18n()
const ws = useWsStore()

// Tab
const activeTab = ref('git')

// Git state
const statusLoading = ref(false)
const statusOutput = ref('')
const gitBranch = ref('')
const changedCount = ref(0)
const commitLoading = ref(false)
const commitResult = ref('')
const commitSuccess = ref(false)
const showCommitConfirm = ref(false)

// Import/Export state
const importPath = ref('')
const importFormat = ref('markdown')
const importLoading = ref(false)
const exportPath = ref('./site')
const exportLoading = ref(false)
const ioResult = ref('')
const ioSuccess = ref(false)
const ioOutput = ref('')

function parseGitStatus(output) {
  const lines = output.split('\n')
  let branch = ''
  let changed = 0
  for (const line of lines) {
    const branchMatch = line.match(/On branch\s+(.+)/) || line.match(/分支\s+(.+)/)
    if (branchMatch) {
      branch = branchMatch[1].trim()
    }
    const trimmed = line.trim()
    if (/^(M|A|D|R|C|U|\?\?|MM|AM|AD)\s/.test(trimmed)) {
      changed++
    }
    if (/^(modified|new file|deleted|renamed):/i.test(trimmed)) {
      changed++
    }
  }
  return { branch, changed }
}

async function refreshStatus() {
  statusLoading.value = true
  try {
    const { output } = await ws.execute('git status', 15000)
    statusOutput.value = output
    const parsed = parseGitStatus(output)
    gitBranch.value = parsed.branch
    changedCount.value = parsed.changed
  } catch (e) {
    message.error(t('git.messages.statusFailed', { err: e.message }))
    statusOutput.value = ''
  } finally {
    statusLoading.value = false
  }
}

function confirmAutoCommit() {
  showCommitConfirm.value = true
}

async function doAutoCommit() {
  showCommitConfirm.value = false
  commitLoading.value = true
  commitResult.value = ''
  try {
    const { output } = await ws.execute('git auto-commit', 30000)
    commitResult.value = output
    commitSuccess.value = !output.includes('✖') && !output.toLowerCase().includes('error')
    if (commitSuccess.value) {
      message.success(t('git.messages.commitOk'))
    }
    await refreshStatus()
  } catch (e) {
    commitResult.value = t('git.messages.commitFailedDetail', { err: e.message })
    commitSuccess.value = false
    message.error(t('git.messages.commitFailedToast'))
  } finally {
    commitLoading.value = false
  }
}

async function doImport() {
  const pathVal = importPath.value.trim()
  if (!pathVal) { message.warning(t('git.messages.importPathRequired')); return }
  importLoading.value = true
  ioResult.value = ''
  ioOutput.value = ''
  try {
    const cmd = `import ${importFormat.value} ${pathVal}`
    const { output } = await ws.execute(cmd, 60000)
    ioOutput.value = output
    const hasError = output.includes('✖') || output.toLowerCase().includes('error')
    ioSuccess.value = !hasError
    ioResult.value = hasError ? t('git.io.importIssue') : t('git.io.importDone')
    if (!hasError) message.success(t('git.messages.importOk'))
  } catch (e) {
    ioResult.value = t('git.messages.importFailedDetail', { err: e.message })
    ioSuccess.value = false
    message.error(t('git.messages.importFailed'))
  } finally {
    importLoading.value = false
  }
}

async function doExport() {
  const pathVal = exportPath.value.trim()
  if (!pathVal) { message.warning(t('git.messages.exportPathRequired')); return }
  exportLoading.value = true
  ioResult.value = ''
  ioOutput.value = ''
  try {
    const cmd = `export site -o ${pathVal}`
    const { output } = await ws.execute(cmd, 60000)
    ioOutput.value = output
    const hasError = output.includes('✖') || output.toLowerCase().includes('error')
    ioSuccess.value = !hasError
    ioResult.value = hasError ? t('git.io.exportIssue') : t('git.io.exportDone')
    if (!hasError) message.success(t('git.messages.exportOk'))
  } catch (e) {
    ioResult.value = t('git.messages.exportFailedDetail', { err: e.message })
    ioSuccess.value = false
    message.error(t('git.messages.exportFailed'))
  } finally {
    exportLoading.value = false
  }
}
</script>

<style scoped>
:deep(.ant-tabs-card > .ant-tabs-nav .ant-tabs-tab) {
  background: var(--bg-card);
  border-color: var(--border-color);
  color: var(--text-secondary);
}
:deep(.ant-tabs-card > .ant-tabs-nav .ant-tabs-tab-active) {
  background: var(--bg-base);
  border-bottom-color: var(--bg-base);
  color: var(--text-primary);
}
:deep(.ant-card-head) {
  color: var(--text-primary);
  border-bottom-color: var(--border-color);
}
</style>
