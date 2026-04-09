<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">Git 与数据</h2>
        <p class="page-sub">版本控制 / 导入导出</p>
      </div>
    </div>

    <a-tabs v-model:activeKey="activeTab" type="card">
      <!-- Git Tab -->
      <a-tab-pane key="git">
        <template #tab>
          <BranchesOutlined /> Git 仓库
        </template>

        <a-space style="margin-bottom: 16px;">
          <a-button type="primary" :loading="statusLoading" @click="refreshStatus">
            <template #icon><ReloadOutlined /></template>
            刷新状态
          </a-button>
          <a-button :loading="commitLoading" @click="confirmAutoCommit">
            <template #icon><CheckOutlined /></template>
            自动提交
          </a-button>
        </a-space>

        <!-- Branch & Stats -->
        <div v-if="gitBranch || changedCount > 0" style="margin-bottom: 16px;">
          <a-space>
            <a-tag v-if="gitBranch" color="blue">
              <BranchesOutlined /> {{ gitBranch }}
            </a-tag>
            <a-tag v-if="changedCount > 0" color="orange">{{ changedCount }} 个文件变更</a-tag>
            <a-tag v-else-if="statusOutput && changedCount === 0" color="green">工作区干净</a-tag>
          </a-space>
        </div>

        <!-- Status Output -->
        <a-card v-if="statusOutput" :bordered="false" style="background: var(--bg-base); border: 1px solid var(--border-color);">
          <pre style="white-space: pre-wrap; word-break: break-all; color: var(--text-primary); font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace; font-size: 13px; line-height: 1.7; margin: 0;">{{ statusOutput }}</pre>
        </a-card>

        <a-empty v-else-if="!statusLoading" description="点击刷新状态查看 Git 信息" style="padding: 60px 0;" />

        <!-- Commit Result -->
        <a-alert
          v-if="commitResult"
          :message="commitSuccess ? '提交成功' : '提交结果'"
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
          <ImportOutlined /> 导入导出
        </template>

        <!-- Import Section -->
        <a-card title="导入数据" :bordered="false" style="background: var(--bg-card); border: 1px solid var(--border-color); margin-bottom: 16px;">
          <div style="display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px;">
              <label style="display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: 13px;">文件路径</label>
              <a-input v-model:value="importPath" placeholder="输入文件或目录路径，如 ./docs" allow-clear />
            </div>
            <div style="min-width: 140px;">
              <label style="display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: 13px;">格式</label>
              <a-select v-model:value="importFormat" style="width: 140px;">
                <a-select-option value="markdown">Markdown</a-select-option>
                <a-select-option value="pdf">PDF</a-select-option>
                <a-select-option value="evernote">Evernote</a-select-option>
              </a-select>
            </div>
            <a-button type="primary" :loading="importLoading" :disabled="!importPath.trim()" @click="doImport">
              <template #icon><ImportOutlined /></template>
              导入
            </a-button>
          </div>
        </a-card>

        <!-- Export Section -->
        <a-card title="导出站点" :bordered="false" style="background: var(--bg-card); border: 1px solid var(--border-color); margin-bottom: 16px;">
          <div style="display: flex; gap: 12px; align-items: flex-end; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px;">
              <label style="display: block; margin-bottom: 6px; color: var(--text-secondary); font-size: 13px;">输出路径</label>
              <a-input v-model:value="exportPath" placeholder="输出目录，如 ./site" allow-clear />
            </div>
            <a-button type="primary" :loading="exportLoading" :disabled="!exportPath.trim()" @click="doExport">
              <template #icon><ExportOutlined /></template>
              导出为静态站点
            </a-button>
          </div>
        </a-card>

        <!-- IO Result -->
        <a-alert
          v-if="ioResult"
          :message="ioSuccess ? '操作成功' : '操作结果'"
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
          title="命令输出"
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
      title="确认自动提交"
      ok-text="确认提交"
      cancel-text="取消"
      :confirm-loading="commitLoading"
      @ok="doAutoCommit"
    >
      <p style="color: var(--text-secondary);">
        将执行 <code>git auto-commit</code> 自动提交当前所有变更。请确认工作区文件已准备就绪。
      </p>
    </a-modal>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { BranchesOutlined, ImportOutlined, ExportOutlined, ReloadOutlined, CheckOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'

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
    message.error('获取 Git 状态失败: ' + e.message)
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
      message.success('自动提交完成')
    }
    await refreshStatus()
  } catch (e) {
    commitResult.value = '提交失败: ' + e.message
    commitSuccess.value = false
    message.error('自动提交失败')
  } finally {
    commitLoading.value = false
  }
}

async function doImport() {
  const pathVal = importPath.value.trim()
  if (!pathVal) { message.warning('请输入文件路径'); return }
  importLoading.value = true
  ioResult.value = ''
  ioOutput.value = ''
  try {
    const cmd = `import ${importFormat.value} ${pathVal}`
    const { output } = await ws.execute(cmd, 60000)
    ioOutput.value = output
    const hasError = output.includes('✖') || output.toLowerCase().includes('error')
    ioSuccess.value = !hasError
    ioResult.value = hasError ? '导入过程中可能存在问题，请查看输出' : '导入完成'
    if (!hasError) message.success('导入成功')
  } catch (e) {
    ioResult.value = '导入失败: ' + e.message
    ioSuccess.value = false
    message.error('导入失败')
  } finally {
    importLoading.value = false
  }
}

async function doExport() {
  const pathVal = exportPath.value.trim()
  if (!pathVal) { message.warning('请输入输出路径'); return }
  exportLoading.value = true
  ioResult.value = ''
  ioOutput.value = ''
  try {
    const cmd = `export site -o ${pathVal}`
    const { output } = await ws.execute(cmd, 60000)
    ioOutput.value = output
    const hasError = output.includes('✖') || output.toLowerCase().includes('error')
    ioSuccess.value = !hasError
    ioResult.value = hasError ? '导出过程中可能存在问题，请查看输出' : '导出完成'
    if (!hasError) message.success('导出成功')
  } catch (e) {
    ioResult.value = '导出失败: ' + e.message
    ioSuccess.value = false
    message.error('导出失败')
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
