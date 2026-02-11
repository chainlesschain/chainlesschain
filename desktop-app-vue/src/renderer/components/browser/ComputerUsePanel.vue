<template>
  <a-card title="Computer Use 控制" :bordered="false" class="computer-use-panel">
    <template #extra>
      <a-space>
        <a-tag :color="isVisionEnabled ? 'green' : 'default'">
          {{ isVisionEnabled ? 'Vision AI 可用' : 'Vision AI 未配置' }}
        </a-tag>
        <a-tag :color="isDesktopEnabled ? 'green' : 'default'">
          {{ isDesktopEnabled ? '桌面控制可用' : '桌面控制未安装' }}
        </a-tag>
      </a-space>
    </template>

    <a-tabs v-model:activeKey="activeTab">
      <!-- 坐标操作 -->
      <a-tab-pane key="coordinate" tab="坐标操作">
        <a-form layout="vertical">
          <a-row :gutter="16">
            <a-col :span="8">
              <a-form-item label="X 坐标">
                <a-input-number v-model:value="coordinateForm.x" :min="0" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="Y 坐标">
                <a-input-number v-model:value="coordinateForm.y" :min="0" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="操作类型">
                <a-select v-model:value="coordinateForm.action" style="width: 100%">
                  <a-select-option value="click">点击</a-select-option>
                  <a-select-option value="doubleClick">双击</a-select-option>
                  <a-select-option value="rightClick">右键</a-select-option>
                  <a-select-option value="move">移动</a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
          </a-row>

          <a-space>
            <a-button type="primary" :loading="loading.coordinate" @click="handleCoordinateAction">
              <template #icon><AimOutlined /></template>
              执行操作
            </a-button>
            <a-button @click="handleGetMousePosition">
              <template #icon><CompassOutlined /></template>
              获取鼠标位置
            </a-button>
          </a-space>

          <a-divider />

          <!-- 拖拽操作 -->
          <h4>拖拽操作</h4>
          <a-row :gutter="16">
            <a-col :span="6">
              <a-form-item label="起始X">
                <a-input-number v-model:value="dragForm.fromX" :min="0" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="6">
              <a-form-item label="起始Y">
                <a-input-number v-model:value="dragForm.fromY" :min="0" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="6">
              <a-form-item label="目标X">
                <a-input-number v-model:value="dragForm.toX" :min="0" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="6">
              <a-form-item label="目标Y">
                <a-input-number v-model:value="dragForm.toY" :min="0" style="width: 100%" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-button :loading="loading.drag" @click="handleDragAction">
            <template #icon><DragOutlined /></template>
            执行拖拽
          </a-button>
        </a-form>
      </a-tab-pane>

      <!-- 视觉操作 -->
      <a-tab-pane key="vision" tab="视觉操作" :disabled="!isVisionEnabled">
        <a-form layout="vertical">
          <a-form-item label="元素描述">
            <a-input
              v-model:value="visionForm.description"
              placeholder="例如：红色的登录按钮、搜索框、提交按钮"
            />
          </a-form-item>

          <a-form-item label="Vision 模型">
            <a-select v-model:value="visionForm.model" style="width: 100%">
              <a-select-option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</a-select-option>
              <a-select-option value="claude-3-opus-20240229">Claude 3 Opus</a-select-option>
              <a-select-option value="gpt-4o">GPT-4o</a-select-option>
              <a-select-option value="llava:13b">LLaVA (本地)</a-select-option>
            </a-select>
          </a-form-item>

          <a-space>
            <a-button type="primary" :loading="loading.visualClick" @click="handleVisualClick">
              <template #icon><EyeOutlined /></template>
              视觉点击
            </a-button>
            <a-button :loading="loading.locate" @click="handleLocateElement">
              <template #icon><SearchOutlined /></template>
              定位元素
            </a-button>
            <a-button :loading="loading.analyze" @click="handleAnalyzePage">
              <template #icon><ScanOutlined /></template>
              分析页面
            </a-button>
          </a-space>

          <!-- 定位结果 -->
          <a-alert
            v-if="locateResult"
            :type="locateResult.found ? 'success' : 'warning'"
            :message="locateResult.found ? '元素已定位' : '未找到元素'"
            :description="locateResultDescription"
            style="margin-top: 16px"
            closable
            @close="locateResult = null"
          />

          <a-divider />

          <!-- 自然语言任务 -->
          <h4>自然语言任务</h4>
          <a-form-item label="任务描述">
            <a-textarea
              v-model:value="visionForm.task"
              placeholder="例如：在搜索框中输入'人工智能'并点击搜索按钮"
              :rows="3"
            />
          </a-form-item>
          <a-button type="primary" :loading="loading.task" @click="handleExecuteTask">
            <template #icon><RocketOutlined /></template>
            执行任务
          </a-button>

          <!-- 任务执行结果 -->
          <a-collapse v-if="taskResult" style="margin-top: 16px">
            <a-collapse-panel key="1" :header="`任务结果 (${taskResult.totalSteps} 步)`">
              <a-timeline>
                <a-timeline-item
                  v-for="(step, index) in taskResult.steps"
                  :key="index"
                  :color="step.completed || step.action === 'done' ? 'green' : 'blue'"
                >
                  <p><strong>{{ step.action }}</strong></p>
                  <p v-if="step.target">目标: {{ step.target }}</p>
                  <p v-if="step.reasoning" class="text-secondary">{{ step.reasoning }}</p>
                </a-timeline-item>
              </a-timeline>
            </a-collapse-panel>
          </a-collapse>
        </a-form>
      </a-tab-pane>

      <!-- 网络拦截 -->
      <a-tab-pane key="network" tab="网络拦截">
        <a-form layout="vertical">
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="拦截状态">
                <a-switch
                  v-model:checked="networkEnabled"
                  :loading="loading.networkToggle"
                  checked-children="已启用"
                  un-checked-children="已禁用"
                  @change="handleToggleNetwork"
                />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="网络条件">
                <a-select
                  v-model:value="networkCondition"
                  style="width: 100%"
                  @change="handleSetNetworkCondition"
                >
                  <a-select-option value="NO_THROTTLE">不限速</a-select-option>
                  <a-select-option value="WIFI">WiFi</a-select-option>
                  <a-select-option value="FAST_4G">4G (快)</a-select-option>
                  <a-select-option value="SLOW_4G">4G (慢)</a-select-option>
                  <a-select-option value="FAST_3G">3G (快)</a-select-option>
                  <a-select-option value="SLOW_3G">3G (慢)</a-select-option>
                  <a-select-option value="OFFLINE">离线</a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
          </a-row>

          <a-divider />

          <!-- Mock API -->
          <h4>Mock API</h4>
          <a-row :gutter="16">
            <a-col :span="12">
              <a-form-item label="URL 模式">
                <a-input v-model:value="mockForm.urlPattern" placeholder="**/api/users" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="状态码">
                <a-input-number v-model:value="mockForm.status" :min="100" :max="599" style="width: 100%" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-form-item label="响应体 (JSON)">
            <a-textarea v-model:value="mockForm.body" :rows="3" placeholder='{"success": true}' />
          </a-form-item>
          <a-button :loading="loading.mock" @click="handleAddMock">
            <template #icon><PlusOutlined /></template>
            添加 Mock 规则
          </a-button>

          <!-- 规则列表 -->
          <a-table
            v-if="mockRules.length > 0"
            :columns="mockColumns"
            :data-source="mockRules"
            :pagination="false"
            size="small"
            style="margin-top: 16px"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'action'">
                <a-button type="link" danger size="small" @click="handleRemoveMock(record.id)">
                  删除
                </a-button>
              </template>
            </template>
          </a-table>
        </a-form>
      </a-tab-pane>

      <!-- 桌面控制 -->
      <a-tab-pane key="desktop" tab="桌面控制" :disabled="!isDesktopEnabled">
        <a-form layout="vertical">
          <a-row :gutter="16">
            <a-col :span="12">
              <a-button type="primary" block :loading="loading.desktopCapture" @click="handleDesktopCapture">
                <template #icon><DesktopOutlined /></template>
                桌面截图
              </a-button>
            </a-col>
            <a-col :span="12">
              <a-button block @click="handleGetScreenInfo">
                <template #icon><InfoCircleOutlined /></template>
                屏幕信息
              </a-button>
            </a-col>
          </a-row>

          <a-divider />

          <!-- 桌面点击 -->
          <h4>桌面点击</h4>
          <a-row :gutter="16">
            <a-col :span="8">
              <a-form-item label="X 坐标">
                <a-input-number v-model:value="desktopForm.x" :min="0" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="Y 坐标">
                <a-input-number v-model:value="desktopForm.y" :min="0" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="8">
              <a-form-item label="按钮">
                <a-select v-model:value="desktopForm.button" style="width: 100%">
                  <a-select-option value="left">左键</a-select-option>
                  <a-select-option value="right">右键</a-select-option>
                  <a-select-option value="middle">中键</a-select-option>
                </a-select>
              </a-form-item>
            </a-col>
          </a-row>
          <a-button :loading="loading.desktopClick" @click="handleDesktopClick">
            <template #icon><AimOutlined /></template>
            桌面点击
          </a-button>

          <a-divider />

          <!-- 桌面输入 -->
          <h4>桌面输入</h4>
          <a-form-item label="文本内容">
            <a-input v-model:value="desktopForm.text" placeholder="要输入的文本" />
          </a-form-item>
          <a-space>
            <a-button :loading="loading.desktopType" @click="handleDesktopType">
              <template #icon><EditOutlined /></template>
              输入文本
            </a-button>
            <a-button @click="handleDesktopPaste">
              <template #icon><SnippetsOutlined /></template>
              粘贴剪贴板
            </a-button>
          </a-space>

          <a-divider />

          <!-- 快捷键 -->
          <h4>快捷键</h4>
          <a-form-item label="快捷键">
            <a-input v-model:value="desktopForm.shortcut" placeholder="例如: Ctrl+C, Ctrl+Shift+S" />
          </a-form-item>
          <a-button :loading="loading.shortcut" @click="handleDesktopShortcut">
            <template #icon><ThunderboltOutlined /></template>
            执行快捷键
          </a-button>
        </a-form>

        <!-- 桌面截图预览 -->
        <a-modal v-model:open="desktopScreenshot.visible" title="桌面截图" width="80%">
          <img
            v-if="desktopScreenshot.data"
            :src="desktopScreenshot.data"
            style="width: 100%"
            alt="Desktop Screenshot"
          />
        </a-modal>
      </a-tab-pane>
    </a-tabs>

    <!-- 分析结果模态框 -->
    <a-modal v-model:open="analysisModal.visible" title="页面分析结果" width="60%">
      <a-typography-paragraph>
        <pre style="white-space: pre-wrap">{{ analysisModal.content }}</pre>
      </a-typography-paragraph>
    </a-modal>
  </a-card>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import {
  AimOutlined,
  CompassOutlined,
  DragOutlined,
  EyeOutlined,
  SearchOutlined,
  ScanOutlined,
  RocketOutlined,
  PlusOutlined,
  DesktopOutlined,
  InfoCircleOutlined,
  EditOutlined,
  SnippetsOutlined,
  ThunderboltOutlined
} from '@ant-design/icons-vue'

const props = defineProps({
  targetId: {
    type: String,
    required: true
  }
})

// 状态
const activeTab = ref('coordinate')
const isVisionEnabled = ref(false)
const isDesktopEnabled = ref(false)

const loading = reactive({
  coordinate: false,
  drag: false,
  visualClick: false,
  locate: false,
  analyze: false,
  task: false,
  networkToggle: false,
  mock: false,
  desktopCapture: false,
  desktopClick: false,
  desktopType: false,
  shortcut: false
})

// 表单数据
const coordinateForm = reactive({
  x: 500,
  y: 300,
  action: 'click'
})

const dragForm = reactive({
  fromX: 100,
  fromY: 100,
  toX: 500,
  toY: 500
})

const visionForm = reactive({
  description: '',
  model: 'claude-3-5-sonnet-20241022',
  task: ''
})

const networkEnabled = ref(false)
const networkCondition = ref('NO_THROTTLE')

const mockForm = reactive({
  urlPattern: '',
  status: 200,
  body: '{}'
})

const mockRules = ref([])
const mockColumns = [
  { title: 'URL 模式', dataIndex: 'urlPattern', key: 'urlPattern' },
  { title: '状态码', dataIndex: 'status', key: 'status', width: 100 },
  { title: '操作', key: 'action', width: 80 }
]

const desktopForm = reactive({
  x: 500,
  y: 300,
  button: 'left',
  text: '',
  shortcut: 'Ctrl+C'
})

const desktopScreenshot = reactive({
  visible: false,
  data: null
})

// 结果
const locateResult = ref(null)
const taskResult = ref(null)
const analysisModal = reactive({
  visible: false,
  content: ''
})

const locateResultDescription = computed(() => {
  if (!locateResult.value) return ''
  if (!locateResult.value.found) return '未能在页面中找到匹配的元素'
  const el = locateResult.value.element
  return `位置: (${el.x}, ${el.y}), 大小: ${el.width}x${el.height}, 置信度: ${(locateResult.value.confidence * 100).toFixed(1)}%`
})

// 方法
const handleCoordinateAction = async () => {
  loading.coordinate = true
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'browser:action:coordinate',
      props.targetId,
      {
        action: coordinateForm.action,
        x: coordinateForm.x,
        y: coordinateForm.y
      }
    )
    if (result.success) {
      message.success(`${coordinateForm.action} 操作成功`)
    }
  } catch (error) {
    message.error('操作失败: ' + error.message)
  } finally {
    loading.coordinate = false
  }
}

const handleGetMousePosition = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('browser:desktop', {
      action: 'getMousePosition'
    })
    if (result.success) {
      coordinateForm.x = result.x
      coordinateForm.y = result.y
      message.success(`鼠标位置: (${result.x}, ${result.y})`)
    }
  } catch (error) {
    message.error('获取失败: ' + error.message)
  }
}

const handleDragAction = async () => {
  loading.drag = true
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'browser:action:coordinate',
      props.targetId,
      {
        action: 'drag',
        fromX: dragForm.fromX,
        fromY: dragForm.fromY,
        toX: dragForm.toX,
        toY: dragForm.toY,
        smooth: true
      }
    )
    if (result.success) {
      message.success('拖拽操作成功')
    }
  } catch (error) {
    message.error('拖拽失败: ' + error.message)
  } finally {
    loading.drag = false
  }
}

const handleVisualClick = async () => {
  if (!visionForm.description) {
    message.warning('请输入元素描述')
    return
  }

  loading.visualClick = true
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'browser:visualClick',
      props.targetId,
      visionForm.description,
      { model: visionForm.model }
    )
    if (result.success) {
      message.success(`已点击: ${visionForm.description}`)
    } else {
      message.warning(result.error || '未找到元素')
    }
  } catch (error) {
    message.error('视觉点击失败: ' + error.message)
  } finally {
    loading.visualClick = false
  }
}

const handleLocateElement = async () => {
  if (!visionForm.description) {
    message.warning('请输入元素描述')
    return
  }

  loading.locate = true
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'browser:action:vision',
      props.targetId,
      {
        task: 'locate',
        description: visionForm.description,
        model: visionForm.model
      }
    )
    locateResult.value = result
  } catch (error) {
    message.error('定位失败: ' + error.message)
  } finally {
    loading.locate = false
  }
}

const handleAnalyzePage = async () => {
  loading.analyze = true
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'browser:action:vision',
      props.targetId,
      {
        task: 'describe',
        model: visionForm.model
      }
    )
    if (result.success) {
      analysisModal.content = result.analysis
      analysisModal.visible = true
    }
  } catch (error) {
    message.error('分析失败: ' + error.message)
  } finally {
    loading.analyze = false
  }
}

const handleExecuteTask = async () => {
  if (!visionForm.task) {
    message.warning('请输入任务描述')
    return
  }

  loading.task = true
  taskResult.value = null
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'browser:action:vision',
      props.targetId,
      {
        task: visionForm.task,
        model: visionForm.model,
        maxSteps: 10
      }
    )
    taskResult.value = result
    if (result.success) {
      message.success('任务执行完成')
    } else {
      message.warning('任务未完成')
    }
  } catch (error) {
    message.error('任务执行失败: ' + error.message)
  } finally {
    loading.task = false
  }
}

const handleToggleNetwork = async (checked) => {
  loading.networkToggle = true
  try {
    await window.electron.ipcRenderer.invoke(
      'browser:network',
      props.targetId,
      { action: checked ? 'enable' : 'disable' }
    )
    message.success(checked ? '网络拦截已启用' : '网络拦截已禁用')
  } catch (error) {
    message.error('操作失败: ' + error.message)
    networkEnabled.value = !checked
  } finally {
    loading.networkToggle = false
  }
}

const handleSetNetworkCondition = async (condition) => {
  try {
    await window.electron.ipcRenderer.invoke(
      'browser:network',
      props.targetId,
      { action: 'setCondition', condition }
    )
    message.success(`网络条件已设置为: ${condition}`)
  } catch (error) {
    message.error('设置失败: ' + error.message)
  }
}

const handleAddMock = async () => {
  if (!mockForm.urlPattern) {
    message.warning('请输入 URL 模式')
    return
  }

  loading.mock = true
  try {
    let body
    try {
      body = JSON.parse(mockForm.body)
    } catch {
      body = mockForm.body
    }

    const result = await window.electron.ipcRenderer.invoke(
      'browser:network',
      props.targetId,
      {
        action: 'mockAPI',
        urlPattern: mockForm.urlPattern,
        response: {
          status: mockForm.status,
          body
        }
      }
    )

    if (result.success) {
      mockRules.value.push({
        id: result.ruleId,
        urlPattern: mockForm.urlPattern,
        status: mockForm.status
      })
      mockForm.urlPattern = ''
      mockForm.body = '{}'
      message.success('Mock 规则已添加')
    }
  } catch (error) {
    message.error('添加失败: ' + error.message)
  } finally {
    loading.mock = false
  }
}

const handleRemoveMock = async (ruleId) => {
  try {
    await window.electron.ipcRenderer.invoke(
      'browser:network',
      props.targetId,
      { action: 'removeRule', ruleId }
    )
    mockRules.value = mockRules.value.filter(r => r.id !== ruleId)
    message.success('规则已删除')
  } catch (error) {
    message.error('删除失败: ' + error.message)
  }
}

const handleDesktopCapture = async () => {
  loading.desktopCapture = true
  try {
    const result = await window.electron.ipcRenderer.invoke('browser:desktop:capture')
    if (result.success) {
      desktopScreenshot.data = result.image
      desktopScreenshot.visible = true
    }
  } catch (error) {
    message.error('截图失败: ' + error.message)
  } finally {
    loading.desktopCapture = false
  }
}

const handleGetScreenInfo = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('browser:desktop', {
      action: 'getScreenInfo'
    })
    if (result.success) {
      message.info(`主屏幕: ${result.primary.size.width}x${result.primary.size.height}, 缩放: ${result.primary.scaleFactor}`)
    }
  } catch (error) {
    message.error('获取失败: ' + error.message)
  }
}

const handleDesktopClick = async () => {
  loading.desktopClick = true
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'browser:desktop:click',
      desktopForm.x,
      desktopForm.y,
      { button: desktopForm.button }
    )
    if (result.success) {
      message.success(`已点击 (${desktopForm.x}, ${desktopForm.y})`)
    }
  } catch (error) {
    message.error('点击失败: ' + error.message)
  } finally {
    loading.desktopClick = false
  }
}

const handleDesktopType = async () => {
  if (!desktopForm.text) {
    message.warning('请输入文本')
    return
  }

  loading.desktopType = true
  try {
    const result = await window.electron.ipcRenderer.invoke(
      'browser:desktop:type',
      desktopForm.text
    )
    if (result.success) {
      message.success('文本已输入')
    }
  } catch (error) {
    message.error('输入失败: ' + error.message)
  } finally {
    loading.desktopType = false
  }
}

const handleDesktopPaste = async () => {
  try {
    await window.electron.ipcRenderer.invoke('browser:desktop:key', 'v', ['control'])
    message.success('已粘贴')
  } catch (error) {
    message.error('粘贴失败: ' + error.message)
  }
}

const handleDesktopShortcut = async () => {
  if (!desktopForm.shortcut) {
    message.warning('请输入快捷键')
    return
  }

  loading.shortcut = true
  try {
    const parts = desktopForm.shortcut.split('+').map(p => p.trim())
    const key = parts.pop().toLowerCase()
    const modifiers = parts.map(p => p.toLowerCase())

    await window.electron.ipcRenderer.invoke('browser:desktop:key', key, modifiers)
    message.success(`已执行: ${desktopForm.shortcut}`)
  } catch (error) {
    message.error('执行失败: ' + error.message)
  } finally {
    loading.shortcut = false
  }
}

// 检查功能可用性
const checkCapabilities = async () => {
  // 检查 Vision AI
  try {
    // 简单检查 LLM 服务是否可用
    isVisionEnabled.value = true // 假设可用，实际需要检查
  } catch {
    isVisionEnabled.value = false
  }

  // 检查桌面控制
  try {
    await window.electron.ipcRenderer.invoke('browser:desktop', { action: 'getScreenInfo' })
    isDesktopEnabled.value = true
  } catch {
    isDesktopEnabled.value = false
  }
}

onMounted(() => {
  checkCapabilities()
})
</script>

<style scoped lang="less">
.computer-use-panel {
  margin-top: 16px;

  h4 {
    margin: 16px 0 12px;
    font-weight: 600;
  }

  .text-secondary {
    color: #666;
    font-size: 12px;
  }
}
</style>
