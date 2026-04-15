<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">工作流编辑器</h2>
        <p class="page-sub">创建、编辑、运行 Cowork 工作流（N1 — 初版：表单编辑，画布视图规划中）</p>
      </div>
      <a-space>
        <a-button @click="newWorkflow" type="primary">
          <template #icon><PlusOutlined /></template>
          新建
        </a-button>
        <a-button ghost :loading="store.loading" @click="store.list()">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="16">
      <a-col :span="8">
        <a-card title="工作流列表" size="small">
          <a-empty v-if="!store.workflows.length" description="暂无工作流" />
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
                    {{ (item.steps || []).length }} 步骤
                  </div>
                </div>
                <a-button size="small" danger type="text" @click.stop="removeOne(item.id)">删除</a-button>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>

      <a-col :span="16">
        <a-card v-if="current" size="small">
          <template #title>
            编辑: {{ current.name || current.id }}
          </template>
          <template #extra>
            <a-space>
              <a-button size="small" @click="exportJson">导出 JSON</a-button>
              <a-button size="small" :loading="running" @click="runCurrent" :disabled="!current.id">
                运行
              </a-button>
              <a-button size="small" type="primary" @click="saveCurrent">保存</a-button>
            </a-space>
          </template>

          <a-form layout="vertical" :model="current">
            <a-form-item label="ID (唯一标识)">
              <a-input v-model:value="current.id" placeholder="my-workflow" />
            </a-form-item>
            <a-form-item label="名称">
              <a-input v-model:value="current.name" placeholder="我的工作流" />
            </a-form-item>
            <a-form-item label="描述">
              <a-input v-model:value="current.description" placeholder="（可选）" />
            </a-form-item>

            <a-divider>步骤</a-divider>
            <div v-for="(step, idx) in current.steps" :key="idx" class="step-card">
              <a-space style="width: 100%; margin-bottom: 8px" direction="vertical">
                <a-input-group compact>
                  <a-input v-model:value="step.id" placeholder="step-id" style="width: 30%" />
                  <a-select v-model:value="step.dependsOn" mode="tags" placeholder="dependsOn" style="width: 70%" />
                </a-input-group>
                <a-textarea v-model:value="step.message" :rows="2" placeholder="任务 prompt（支持 \${step.<id>.summary} 占位）" />
                <a-input v-model:value="step.when" placeholder="when 条件（可选，如 step.s1.status === 'completed'）" />
                <a-space>
                  <a-button size="small" danger @click="removeStep(idx)">删除</a-button>
                  <span style="color: #888; font-size: 12px">
                    step {{ idx + 1 }} / {{ current.steps.length }}
                  </span>
                </a-space>
              </a-space>
            </div>
            <a-button block @click="addStep">+ 添加步骤</a-button>
          </a-form>

          <div v-if="validation && !validation.valid" style="margin-top: 12px; color: #d32f2f">
            <div v-for="err in validation.errors" :key="err">• {{ err }}</div>
          </div>
        </a-card>
        <a-card v-else size="small">
          <a-empty description="从左侧选择工作流或新建一个" />
        </a-card>

        <a-card v-if="store.runEvents.length" size="small" title="运行日志" style="margin-top: 12px">
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
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'

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
    message.error(`加载失败: ${e.message}`)
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
    message.success('保存成功')
  } catch (e) {
    message.error(`保存失败: ${e.message}`)
  }
}

async function removeOne(id) {
  try {
    await store.remove(id)
    if (current.value?.id === id) current.value = null
    message.success('已删除')
  } catch (e) {
    message.error(`删除失败: ${e.message}`)
  }
}

async function runCurrent() {
  running.value = true
  try {
    await store.run(current.value.id)
    message.success(`运行完成：${store.runStatus}`)
  } catch (e) {
    message.error(`运行失败: ${e.message}`)
  } finally {
    running.value = false
  }
}

function exportJson() {
  const json = store.exportJson(current.value)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${current.value.id || 'workflow'}.json`
  a.click()
  URL.revokeObjectURL(url)
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
