<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ $t('workflow.title') }}</h2>
        <p class="page-sub">{{ $t('workflow.subtitle') }}</p>
      </div>
      <a-space>
        <a-button @click="newWorkflow" type="primary">
          <template #icon><PlusOutlined /></template>
          {{ $t('workflow.new') }}
        </a-button>
        <a-button ghost :loading="store.loading" @click="store.list()">
          <template #icon><ReloadOutlined /></template>
          {{ $t('workflow.refresh') }}
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="16">
      <a-col :span="8">
        <a-card :title="$t('workflow.list.title')" size="small">
          <a-empty v-if="!store.workflows.length" :description="$t('workflow.list.empty')" />
          <a-list v-else :data-source="store.workflows" size="small">
            <template #renderItem="{ item }">
              <a-list-item
                :class="{ active: current?.id === item.id }"
                style="cursor: pointer"
                @click="selectWorkflow(item.id)"
              >
                <div style="flex: 1">
                  <div style="font-weight: 500">{{ item.name || item.id }}</div>
                  <div style="color: #888; font-size: 12px">
                    {{ $t('workflow.list.stepCount', { n: (item.steps || []).length }) }}
                  </div>
                </div>
                <a-button size="small" danger type="text" @click.stop="removeOne(item.id)">{{ $t('workflow.list.delete') }}</a-button>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>

      <a-col :span="16">
        <a-card v-if="current" size="small">
          <template #title>
            {{ $t('workflow.editor.headerPrefix') }} {{ current.name || current.id }}
          </template>
          <template #extra>
            <a-space>
              <a-button size="small" @click="exportJson">{{ $t('workflow.editor.exportJson') }}</a-button>
              <a-button size="small" :loading="running" @click="runCurrent" :disabled="!current.id">
                {{ $t('workflow.editor.run') }}
              </a-button>
              <a-button size="small" type="primary" @click="saveCurrent">{{ $t('workflow.editor.save') }}</a-button>
            </a-space>
          </template>

          <a-form layout="vertical" :model="current">
            <a-form-item :label="$t('workflow.editor.idLabel')">
              <a-input v-model:value="current.id" :placeholder="$t('workflow.editor.idPlaceholder')" />
            </a-form-item>
            <a-form-item :label="$t('workflow.editor.nameLabel')">
              <a-input v-model:value="current.name" :placeholder="$t('workflow.editor.namePlaceholder')" />
            </a-form-item>
            <a-form-item :label="$t('workflow.editor.descLabel')">
              <a-input v-model:value="current.description" :placeholder="$t('workflow.editor.descPlaceholder')" />
            </a-form-item>

            <a-divider>{{ $t('workflow.editor.stepsDivider') }}</a-divider>
            <div v-for="(step, idx) in current.steps" :key="idx" class="step-card">
              <a-space style="width: 100%; margin-bottom: 8px" direction="vertical">
                <a-input-group compact>
                  <a-input v-model:value="step.id" :placeholder="$t('workflow.editor.stepIdPlaceholder')" style="width: 30%" />
                  <a-select v-model:value="step.dependsOn" mode="tags" :placeholder="$t('workflow.editor.dependsOnPlaceholder')" style="width: 70%" />
                </a-input-group>
                <a-textarea v-model:value="step.message" :rows="2" :placeholder="$t('workflow.editor.messagePlaceholder')" />
                <a-input v-model:value="step.when" :placeholder="$t('workflow.editor.whenPlaceholder')" />
                <a-space>
                  <a-button size="small" danger @click="removeStep(idx)">{{ $t('workflow.editor.stepDelete') }}</a-button>
                  <span style="color: #888; font-size: 12px">
                    {{ $t('workflow.editor.stepCounter', { idx: idx + 1, total: current.steps.length }) }}
                  </span>
                </a-space>
              </a-space>
            </div>
            <a-button block @click="addStep">{{ $t('workflow.editor.addStep') }}</a-button>
          </a-form>

          <div v-if="validation && !validation.valid" style="margin-top: 12px; color: #d32f2f">
            <div v-for="err in validation.errors" :key="err">• {{ err }}</div>
          </div>
        </a-card>
        <a-card v-else size="small">
          <a-empty :description="$t('workflow.editor.emptyHint')" />
        </a-card>

        <a-card v-if="store.runEvents.length" size="small" :title="$t('workflow.runLog.title')" style="margin-top: 12px">
          <div v-for="(ev, i) in store.runEvents" :key="i" style="font-family: monospace; font-size: 12px; margin-bottom: 4px">
            <span style="color: #1976d2">{{ ev.type }}</span>
            <span v-if="ev.stepId"> [{{ ev.stepId }}]</span>
            <span v-if="ev.status"> → {{ ev.status }}</span>
            <span v-if="ev.summary" style="color: #555"> — {{ ev.summary }}</span>
          </div>
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useWorkflowStore } from '../stores/workflow.js'
import { useFs } from '../composables/useFs.js'
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const store = useWorkflowStore()
const current = ref(null)
const running = ref(false)

const validation = computed(() => current.value ? store.validateLocal(current.value) : null)

onMounted(() => store.list().catch(() => {}))

function newWorkflow() {
  current.value = {
    id: '',
    name: '',
    description: '',
    steps: [{ id: 'step1', message: '', dependsOn: [] }],
  }
}

async function selectWorkflow(id) {
  try {
    const wf = await store.get(id)
    if (wf) {
      current.value = JSON.parse(JSON.stringify(wf))
      if (!current.value.steps) current.value.steps = []
    }
  } catch (e) {
    message.error(t('workflow.msg.loadFailed', { err: e.message }))
  }
}

function addStep() {
  if (!current.value.steps) current.value.steps = []
  current.value.steps.push({ id: `step${current.value.steps.length + 1}`, message: '', dependsOn: [] })
}

function removeStep(idx) {
  current.value.steps.splice(idx, 1)
}

async function saveCurrent() {
  const v = store.validateLocal(current.value)
  if (!v.valid) {
    message.error(v.errors[0])
    return
  }
  try {
    await store.save(current.value)
    message.success(t('workflow.msg.saveSuccess'))
  } catch (e) {
    message.error(t('workflow.msg.saveFailed', { err: e.message }))
  }
}

async function removeOne(id) {
  try {
    await store.remove(id)
    if (current.value?.id === id) current.value = null
    message.success(t('workflow.msg.deleteSuccess'))
  } catch (e) {
    message.error(t('workflow.msg.deleteFailed', { err: e.message }))
  }
}

async function runCurrent() {
  running.value = true
  try {
    await store.run(current.value.id)
    message.success(t('workflow.msg.runSuccess', { status: store.runStatus }))
  } catch (e) {
    message.error(t('workflow.msg.runFailed', { err: e.message }))
  } finally {
    running.value = false
  }
}

const fs = useFs()

async function exportJson() {
  // useFs routes through fs.saveDialog (native Electron save dialog) when
  // the SPA is loaded inside the desktop web-shell, and falls back to a
  // blob+<a download> in standalone browser mode — same UX the previous
  // hand-rolled path provided.
  try {
    const r = await fs.saveJson(JSON.parse(store.exportJson(current.value)), {
      defaultPath: `${current.value.id || 'workflow'}.json`,
    })
    if (r.canceled) return
    if (r.path) {
      message.success(t('workflow.msg.exportSuccess', { path: r.path }))
    }
  } catch (e) {
    message.error(t('workflow.msg.exportFailed', { err: e.message }))
  }
}
</script>

<style scoped>
.step-card {
  background: #fafafa;
  border: 1px solid #eee;
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 12px;
}
.active {
  background: #e3f2fd;
}
.page-title {
  margin: 0;
  font-size: 20px;
}
.page-sub {
  margin: 4px 0 0;
  color: #888;
  font-size: 13px;
}
</style>
