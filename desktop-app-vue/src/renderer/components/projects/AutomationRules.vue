<template>
  <div class="automation-rules">
    <a-card
      title="项目自动化规则"
      :bordered="false"
    >
      <template #extra>
        <a-button
          type="primary"
          @click="showCreateModal"
        >
          <plus-outlined /> 新建规则
        </a-button>
      </template>

      <!-- 规则列表 -->
      <a-list
        :data-source="rules"
        :loading="loading"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-tooltip title="手动触发">
                <a-button
                  type="link"
                  size="small"
                  @click="manualTrigger(item.id)"
                >
                  <play-circle-outlined />
                </a-button>
              </a-tooltip>
              <a-tooltip title="编辑">
                <a-button
                  type="link"
                  size="small"
                  @click="editRule(item)"
                >
                  <edit-outlined />
                </a-button>
              </a-tooltip>
              <a-popconfirm
                title="确定要删除这个规则吗?"
                @confirm="deleteRule(item.id)"
              >
                <a-button
                  type="link"
                  danger
                  size="small"
                >
                  <delete-outlined />
                </a-button>
              </a-popconfirm>
            </template>

            <a-list-item-meta>
              <template #title>
                <a-space>
                  <span>{{ item.name }}</span>
                  <a-tag :color="item.is_enabled ? 'green' : 'default'">
                    {{ item.is_enabled ? '已启用' : '已禁用' }}
                  </a-tag>
                  <a-tag color="blue">
                    {{ getTriggerTypeText(item.trigger_type) }}
                  </a-tag>
                  <a-tag color="orange">
                    {{ getActionTypeText(item.action_type) }}
                  </a-tag>
                </a-space>
              </template>
              <template #description>
                <div>
                  <p>{{ item.description || '无描述' }}</p>
                  <small v-if="item.last_run_at">
                    最后执行: {{ formatTime(item.last_run_at) }}
                  </small>
                </div>
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>

        <template #header>
          <a-statistic-group>
            <a-row :gutter="16">
              <a-col :span="8">
                <a-statistic
                  title="总规则数"
                  :value="statistics.total"
                />
              </a-col>
              <a-col :span="8">
                <a-statistic
                  title="已启用"
                  :value="statistics.enabled"
                  :value-style="{ color: '#3f8600' }"
                />
              </a-col>
              <a-col :span="8">
                <a-statistic
                  title="已禁用"
                  :value="statistics.disabled"
                />
              </a-col>
            </a-row>
          </a-statistic-group>
        </template>
      </a-list>

      <!-- 创建/编辑规则对话框 -->
      <a-modal
        v-model:open="modalVisible"
        :title="editingRule ? '编辑规则' : '创建规则'"
        width="800px"
        @ok="handleSaveRule"
      >
        <a-form
          :model="ruleForm"
          layout="vertical"
        >
          <a-form-item
            label="规则名称"
            required
          >
            <a-input
              v-model:value="ruleForm.name"
              placeholder="输入规则名称"
            />
          </a-form-item>

          <a-form-item label="描述">
            <a-textarea
              v-model:value="ruleForm.description"
              :rows="2"
              placeholder="输入规则描述"
            />
          </a-form-item>

          <a-divider>触发条件</a-divider>

          <a-form-item
            label="触发类型"
            required
          >
            <a-select v-model:value="ruleForm.triggerType">
              <a-select-option value="schedule">
                定时触发
              </a-select-option>
              <a-select-option value="file_change">
                文件变化
              </a-select-option>
              <a-select-option value="task_complete">
                任务完成
              </a-select-option>
              <a-select-option value="manual">
                手动触发
              </a-select-option>
            </a-select>
          </a-form-item>

          <!-- 定时触发配置 -->
          <a-form-item
            v-if="ruleForm.triggerType === 'schedule'"
            label="Cron表达式"
          >
            <a-input
              v-model:value="ruleForm.triggerConfig.cron"
              placeholder="例如: 0 9 * * * (每天9点)"
            />
            <small>格式: 分 时 日 月 周, <a
              href="https://crontab.guru/"
              target="_blank"
            >参考</a></small>
          </a-form-item>

          <!-- 文件变化配置 -->
          <template v-if="ruleForm.triggerType === 'file_change'">
            <a-form-item label="监听路径">
              <a-input
                v-model:value="ruleForm.triggerConfig.path"
                placeholder="文件或目录路径"
              />
            </a-form-item>
            <a-form-item label="文件模式">
              <a-input
                v-model:value="ruleForm.triggerConfig.pattern"
                placeholder="例如: **/*.js"
              />
            </a-form-item>
            <a-form-item label="监听事件">
              <a-checkbox-group v-model:value="ruleForm.triggerConfig.events">
                <a-checkbox value="add">
                  新增
                </a-checkbox>
                <a-checkbox value="change">
                  修改
                </a-checkbox>
                <a-checkbox value="unlink">
                  删除
                </a-checkbox>
              </a-checkbox-group>
            </a-form-item>
          </template>

          <a-divider>执行动作</a-divider>

          <a-form-item
            label="动作类型"
            required
          >
            <a-select v-model:value="ruleForm.actionType">
              <a-select-option value="run_task">
                运行AI任务
              </a-select-option>
              <a-select-option value="generate_report">
                生成报告
              </a-select-option>
              <a-select-option value="send_notification">
                发送通知
              </a-select-option>
              <a-select-option value="git_commit">
                Git提交
              </a-select-option>
              <a-select-option value="export_file">
                导出文件
              </a-select-option>
              <a-select-option value="run_script">
                运行脚本
              </a-select-option>
            </a-select>
          </a-form-item>

          <!-- 运行AI任务配置 -->
          <a-form-item
            v-if="ruleForm.actionType === 'run_task'"
            label="任务描述"
          >
            <a-textarea
              v-model:value="ruleForm.actionConfig.taskDescription"
              :rows="3"
              placeholder="描述要执行的任务"
            />
          </a-form-item>

          <!-- 发送通知配置 -->
          <template v-if="ruleForm.actionType === 'send_notification'">
            <a-form-item label="通知标题">
              <a-input
                v-model:value="ruleForm.actionConfig.title"
                placeholder="通知标题"
              />
            </a-form-item>
            <a-form-item label="通知内容">
              <a-textarea
                v-model:value="ruleForm.actionConfig.message"
                :rows="3"
                placeholder="通知内容"
              />
            </a-form-item>
            <a-form-item label="通知渠道">
              <a-checkbox-group v-model:value="ruleForm.actionConfig.channels">
                <a-checkbox value="desktop">
                  桌面通知
                </a-checkbox>
                <a-checkbox value="email">
                  邮件
                </a-checkbox>
                <a-checkbox value="webhook">
                  Webhook
                </a-checkbox>
              </a-checkbox-group>
            </a-form-item>
          </template>

          <!-- Git提交配置 -->
          <template v-if="ruleForm.actionType === 'git_commit'">
            <a-form-item label="项目路径">
              <a-input
                v-model:value="ruleForm.actionConfig.projectPath"
                placeholder="项目路径"
              />
            </a-form-item>
            <a-form-item label="提交信息">
              <a-input
                v-model:value="ruleForm.actionConfig.commitMessage"
                placeholder="提交信息"
              />
            </a-form-item>
            <a-form-item>
              <a-checkbox v-model:checked="ruleForm.actionConfig.autoPush">
                自动推送到远程仓库
              </a-checkbox>
            </a-form-item>
          </template>

          <!-- 生成报告配置 -->
          <a-form-item
            v-if="ruleForm.actionType === 'generate_report'"
            label="报告类型"
          >
            <a-select v-model:value="ruleForm.actionConfig.reportType">
              <a-select-option value="daily">
                每日报告
              </a-select-option>
              <a-select-option value="weekly">
                周报
              </a-select-option>
              <a-select-option value="analytics">
                数据分析
              </a-select-option>
            </a-select>
          </a-form-item>

          <!-- 运行脚本配置 -->
          <template v-if="ruleForm.actionType === 'run_script'">
            <a-form-item label="脚本路径">
              <a-input
                v-model:value="ruleForm.actionConfig.scriptPath"
                placeholder="脚本文件路径"
              />
            </a-form-item>
            <a-form-item label="脚本参数">
              <a-input
                v-model:value="ruleForm.actionConfig.argsText"
                placeholder="参数,用空格分隔"
              />
            </a-form-item>
          </template>
        </a-form>
      </a-modal>
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import {
  PlusOutlined,
  PlayCircleOutlined,
  EditOutlined,
  DeleteOutlined
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'

const props = defineProps({
  projectId: {
    type: String,
    required: true
  }
})

const rules = ref([])
const loading = ref(false)
const modalVisible = ref(false)
const editingRule = ref(null)
const statistics = ref({
  total: 0,
  enabled: 0,
  disabled: 0
})

const ruleForm = reactive({
  name: '',
  description: '',
  triggerType: 'schedule',
  triggerConfig: {
    cron: '',
    path: '',
    pattern: '**/*',
    events: ['change']
  },
  actionType: 'run_task',
  actionConfig: {
    taskDescription: '',
    title: '',
    message: '',
    channels: ['desktop'],
    projectPath: '',
    commitMessage: '',
    autoPush: false,
    reportType: 'daily',
    scriptPath: '',
    argsText: ''
  }
})

// 加载规则列表
const loadRules = async () => {
  loading.value = true
  try {
    const result = await window.electron.ipcRenderer.invoke('automation:getRules', props.projectId)
    rules.value = result || []

    // 加载统计信息
    const stats = await window.electron.ipcRenderer.invoke('automation:getStatistics')
    statistics.value = stats
  } catch (error) {
    message.error('加载规则失败: ' + error.message)
  } finally {
    loading.value = false
  }
}

// 显示创建对话框
const showCreateModal = () => {
  editingRule.value = null
  resetForm()
  modalVisible.value = true
}

// 编辑规则
const editRule = (rule) => {
  editingRule.value = rule
  ruleForm.name = rule.name
  ruleForm.description = rule.description || ''
  ruleForm.triggerType = rule.trigger_type
  ruleForm.triggerConfig = JSON.parse(rule.trigger_config)
  ruleForm.actionType = rule.action_type
  ruleForm.actionConfig = JSON.parse(rule.action_config)
  modalVisible.value = true
}

// 保存规则
const handleSaveRule = async () => {
  if (!ruleForm.name.trim()) {
    message.warning('请输入规则名称')
    return
  }

  try {
    // 处理脚本参数
    if (ruleForm.actionType === 'run_script' && ruleForm.actionConfig.argsText) {
      ruleForm.actionConfig.args = ruleForm.actionConfig.argsText.split(' ')
    }

    const ruleData = {
      projectId: props.projectId,
      name: ruleForm.name,
      description: ruleForm.description,
      triggerType: ruleForm.triggerType,
      triggerConfig: ruleForm.triggerConfig,
      actionType: ruleForm.actionType,
      actionConfig: ruleForm.actionConfig
    }

    if (editingRule.value) {
      // 更新规则
      await window.electron.ipcRenderer.invoke('automation:updateRule', editingRule.value.id, ruleData)
      message.success('规则更新成功')
    } else {
      // 创建规则
      await window.electron.ipcRenderer.invoke('automation:createRule', ruleData)
      message.success('规则创建成功')
    }

    modalVisible.value = false
    await loadRules()
  } catch (error) {
    message.error('保存规则失败: ' + error.message)
  }
}

// 删除规则
const deleteRule = async (ruleId) => {
  try {
    await window.electron.ipcRenderer.invoke('automation:deleteRule', ruleId)
    message.success('规则删除成功')
    await loadRules()
  } catch (error) {
    message.error('删除规则失败: ' + error.message)
  }
}

// 手动触发规则
const manualTrigger = async (ruleId) => {
  try {
    await window.electron.ipcRenderer.invoke('automation:manualTrigger', ruleId)
    message.success('规则已触发执行')
  } catch (error) {
    message.error('触发失败: ' + error.message)
  }
}

// 重置表单
const resetForm = () => {
  ruleForm.name = ''
  ruleForm.description = ''
  ruleForm.triggerType = 'schedule'
  ruleForm.triggerConfig = {
    cron: '',
    path: '',
    pattern: '**/*',
    events: ['change']
  }
  ruleForm.actionType = 'run_task'
  ruleForm.actionConfig = {
    taskDescription: '',
    title: '',
    message: '',
    channels: ['desktop'],
    projectPath: '',
    commitMessage: '',
    autoPush: false,
    reportType: 'daily',
    scriptPath: '',
    argsText: ''
  }
}

// 获取触发类型文本
const getTriggerTypeText = (type) => {
  const map = {
    schedule: '定时触发',
    file_change: '文件变化',
    task_complete: '任务完成',
    manual: '手动触发'
  }
  return map[type] || type
}

// 获取动作类型文本
const getActionTypeText = (type) => {
  const map = {
    run_task: 'AI任务',
    generate_report: '生成报告',
    send_notification: '发送通知',
    git_commit: 'Git提交',
    export_file: '导出文件',
    run_script: '运行脚本'
  }
  return map[type] || type
}

// 格式化时间
const formatTime = (timestamp) => {
  if (!timestamp) {return '-'}
  const date = new Date(timestamp)
  return date.toLocaleString('zh-CN')
}

onMounted(() => {
  loadRules()
})
</script>

<style scoped>
.automation-rules {
  padding: 16px;
}
</style>
