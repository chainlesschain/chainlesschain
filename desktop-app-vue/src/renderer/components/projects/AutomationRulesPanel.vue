<template>
  <div class="automation-rules-panel">
    <a-card :bordered="false">
      <template #title>
        <a-space>
          <ClockCircleOutlined />
          自动化规则管理
        </a-space>
      </template>

      <template #extra>
        <a-space>
          <a-button
            type="primary"
            :icon="h(PlusOutlined)"
            @click="showCreateModal"
          >
            新建规则
          </a-button>
          <a-button :icon="h(ReloadOutlined)" @click="loadRules">
            刷新
          </a-button>
        </a-space>
      </template>

      <!-- 统计信息 -->
      <a-row :gutter="16" class="stats-row">
        <a-col :span="6">
          <a-statistic
            title="总规则数"
            :value="statistics.total"
            :prefix="h(AppstoreOutlined)"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="已启用"
            :value="statistics.enabled"
            :value-style="{ color: '#3f8600' }"
            :prefix="h(CheckCircleOutlined)"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="运行中任务"
            :value="statistics.activeScheduledTasks"
            :value-style="{ color: '#1890ff' }"
            :prefix="h(ClockCircleOutlined)"
          />
        </a-col>
        <a-col :span="6">
          <a-statistic
            title="文件监听"
            :value="statistics.activeFileWatchers"
            :value-style="{ color: '#722ed1' }"
            :prefix="h(FolderOpenOutlined)"
          />
        </a-col>
      </a-row>

      <a-divider />

      <!-- 规则列表 -->
      <a-list :data-source="rules" :loading="loading">
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-space>
                <a-tooltip title="手动触发">
                  <a-button
                    size="small"
                    :icon="h(PlayCircleOutlined)"
                    @click="handleTrigger(item.id)"
                  />
                </a-tooltip>
                <a-tooltip title="编辑">
                  <a-button
                    size="small"
                    :icon="h(EditOutlined)"
                    @click="handleEdit(item)"
                  />
                </a-tooltip>
                <a-popconfirm
                  title="确定要删除这条规则吗？"
                  @confirm="handleDelete(item.id)"
                >
                  <a-tooltip title="删除">
                    <a-button size="small" danger :icon="h(DeleteOutlined)" />
                  </a-tooltip>
                </a-popconfirm>
              </a-space>
            </template>

            <a-list-item-meta>
              <template #title>
                <a-space>
                  <a-tag :color="getTriggerTypeColor(item.trigger_type)">
                    {{ getTriggerTypeName(item.trigger_type) }}
                  </a-tag>
                  <span>{{ item.name }}</span>
                  <a-switch
                    v-model:checked="item.is_enabled"
                    :checked-value="1"
                    :un-checked-value="0"
                    @change="handleToggle(item)"
                  />
                </a-space>
              </template>

              <template #description>
                <p>{{ item.description }}</p>
                <a-space size="large">
                  <span>
                    <strong>动作:</strong>
                    <a-tag>{{ getActionTypeName(item.action_type) }}</a-tag>
                  </span>
                  <span v-if="item.last_run_at">
                    <strong>最后执行:</strong>
                    {{ formatTime(item.last_run_at) }}
                  </span>
                  <span>
                    <strong>创建时间:</strong> {{ formatTime(item.created_at) }}
                  </span>
                </a-space>
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>

        <template #empty>
          <a-empty description="暂无自动化规则">
            <a-button type="primary" @click="showCreateModal">
              创建第一条规则
            </a-button>
          </a-empty>
        </template>
      </a-list>
    </a-card>

    <!-- 创建/编辑规则模态框 -->
    <a-modal
      v-model:open="modalVisible"
      :title="editingRule ? '编辑规则' : '新建规则'"
      width="800px"
      @ok="handleSubmit"
      @cancel="handleCancel"
    >
      <a-form :model="ruleForm" layout="vertical">
        <a-form-item label="规则名称" required>
          <a-input
            v-model:value="ruleForm.name"
            placeholder="例如：每日报告生成"
          />
        </a-form-item>

        <a-form-item label="描述">
          <a-textarea
            v-model:value="ruleForm.description"
            placeholder="简要描述这条规则的用途"
            :rows="2"
          />
        </a-form-item>

        <a-row :gutter="16">
          <a-col :span="12">
            <a-form-item label="触发类型" required>
              <a-select v-model:value="ruleForm.triggerType">
                <a-select-option value="schedule"> 定时任务 </a-select-option>
                <a-select-option value="file_change">
                  文件变化
                </a-select-option>
                <a-select-option value="task_complete">
                  任务完成
                </a-select-option>
                <a-select-option value="manual"> 手动触发 </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>

          <a-col :span="12">
            <a-form-item label="动作类型" required>
              <a-select v-model:value="ruleForm.actionType">
                <a-select-option value="run_task"> 执行AI任务 </a-select-option>
                <a-select-option value="generate_report">
                  生成报告
                </a-select-option>
                <a-select-option value="send_notification">
                  发送通知
                </a-select-option>
                <a-select-option value="git_commit"> Git提交 </a-select-option>
                <a-select-option value="export_file">
                  导出文件
                </a-select-option>
                <a-select-option value="run_script"> 运行脚本 </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>

        <!-- 触发配置 -->
        <a-card title="触发配置" size="small" style="margin-bottom: 16px">
          <!-- 定时任务配置 -->
          <div v-if="ruleForm.triggerType === 'schedule'">
            <a-form-item label="Cron表达式" required>
              <a-input
                v-model:value="ruleForm.triggerConfig.cron"
                placeholder="例如：0 21 * * * (每天21:00)"
              />
              <span class="form-hint">
                快捷设置:
                <a @click="ruleForm.triggerConfig.cron = '0 21 * * *'"
                  >每天21:00</a
                >
                |
                <a @click="ruleForm.triggerConfig.cron = '0 */1 * * *'"
                  >每小时</a
                >
                |
                <a @click="ruleForm.triggerConfig.cron = '0 9 * * 1'"
                  >每周一9:00</a
                >
              </span>
            </a-form-item>
          </div>

          <!-- 文件变化配置 -->
          <div v-if="ruleForm.triggerType === 'file_change'">
            <a-form-item label="监听路径" required>
              <a-input
                v-model:value="ruleForm.triggerConfig.path"
                placeholder="/path/to/watch"
              />
            </a-form-item>

            <a-form-item label="文件模式">
              <a-input
                v-model:value="ruleForm.triggerConfig.pattern"
                placeholder="**/*.{js,ts,vue}"
              />
            </a-form-item>

            <a-form-item label="监听事件">
              <a-checkbox-group v-model:value="ruleForm.triggerConfig.events">
                <a-checkbox value="add"> 新增 </a-checkbox>
                <a-checkbox value="change"> 修改 </a-checkbox>
                <a-checkbox value="unlink"> 删除 </a-checkbox>
              </a-checkbox-group>
            </a-form-item>
          </div>
        </a-card>

        <!-- 动作配置 -->
        <a-card title="动作配置" size="small">
          <!-- 执行AI任务 -->
          <div v-if="ruleForm.actionType === 'run_task'">
            <a-form-item label="任务描述" required>
              <a-textarea
                v-model:value="ruleForm.actionConfig.taskDescription"
                placeholder="描述要执行的AI任务"
                :rows="3"
              />
            </a-form-item>
          </div>

          <!-- 生成报告 -->
          <div v-if="ruleForm.actionType === 'generate_report'">
            <a-form-item label="报告类型">
              <a-select v-model:value="ruleForm.actionConfig.reportType">
                <a-select-option value="daily"> 每日报告 </a-select-option>
                <a-select-option value="weekly"> 每周报告 </a-select-option>
                <a-select-option value="analytics"> 数据分析 </a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item label="输出路径">
              <a-input
                v-model:value="ruleForm.actionConfig.outputPath"
                placeholder="/reports/"
              />
            </a-form-item>
          </div>

          <!-- 发送通知 -->
          <div v-if="ruleForm.actionType === 'send_notification'">
            <a-form-item label="通知标题" required>
              <a-input v-model:value="ruleForm.actionConfig.title" />
            </a-form-item>

            <a-form-item label="通知内容" required>
              <a-textarea
                v-model:value="ruleForm.actionConfig.message"
                :rows="3"
              />
            </a-form-item>

            <a-form-item label="通知渠道">
              <a-checkbox-group v-model:value="ruleForm.actionConfig.channels">
                <a-checkbox value="desktop"> 桌面通知 </a-checkbox>
                <a-checkbox value="email"> 邮件 </a-checkbox>
                <a-checkbox value="webhook"> Webhook </a-checkbox>
              </a-checkbox-group>
            </a-form-item>
          </div>

          <!-- Git提交 -->
          <div v-if="ruleForm.actionType === 'git_commit'">
            <a-form-item label="项目路径" required>
              <a-input v-model:value="ruleForm.actionConfig.projectPath" />
            </a-form-item>

            <a-form-item label="提交消息" required>
              <a-input v-model:value="ruleForm.actionConfig.commitMessage" />
            </a-form-item>

            <a-form-item>
              <a-checkbox v-model:checked="ruleForm.actionConfig.autoPush">
                自动推送到远程
              </a-checkbox>
            </a-form-item>
          </div>
        </a-card>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, onMounted, h } from "vue";
import { message } from "ant-design-vue";
import {
  PlusOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  PlayCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  AppstoreOutlined,
  CheckCircleOutlined,
  FolderOpenOutlined,
} from "@ant-design/icons-vue";

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
});

// 状态
const loading = ref(false);
const rules = ref([]);
const statistics = ref({
  total: 0,
  enabled: 0,
  disabled: 0,
  activeScheduledTasks: 0,
  activeFileWatchers: 0,
});

// 模态框
const modalVisible = ref(false);
const editingRule = ref(null);

// 规则表单
const ruleForm = ref({
  name: "",
  description: "",
  triggerType: "schedule",
  triggerConfig: {
    cron: "0 21 * * *",
    path: "",
    pattern: "**/*",
    events: ["change"],
  },
  actionType: "run_task",
  actionConfig: {
    taskDescription: "",
    reportType: "daily",
    outputPath: "/reports/",
    title: "",
    message: "",
    channels: ["desktop"],
    projectPath: "",
    commitMessage: "Auto commit",
    autoPush: false,
  },
});

/**
 * 加载规则列表
 */
async function loadRules() {
  loading.value = true;

  try {
    rules.value = await window.electronAPI.automation.getRules(props.projectId);

    // 加载统计信息
    const stats = await window.electronAPI.automation.getStatistics();
    statistics.value = stats;
  } catch (error) {
    logger.error("加载规则失败:", error);
    message.error("加载规则失败");
  } finally {
    loading.value = false;
  }
}

/**
 * 显示创建模态框
 */
function showCreateModal() {
  editingRule.value = null;
  resetForm();
  modalVisible.value = true;
}

/**
 * 编辑规则
 */
function handleEdit(rule) {
  editingRule.value = rule;

  ruleForm.value = {
    name: rule.name,
    description: rule.description || "",
    triggerType: rule.trigger_type,
    triggerConfig: JSON.parse(rule.trigger_config),
    actionType: rule.action_type,
    actionConfig: JSON.parse(rule.action_config),
  };

  modalVisible.value = true;
}

/**
 * 提交表单
 */
async function handleSubmit() {
  if (!ruleForm.value.name.trim()) {
    message.warning("请输入规则名称");
    return;
  }

  try {
    const data = {
      projectId: props.projectId,
      name: ruleForm.value.name,
      description: ruleForm.value.description,
      triggerType: ruleForm.value.triggerType,
      triggerConfig: ruleForm.value.triggerConfig,
      actionType: ruleForm.value.actionType,
      actionConfig: ruleForm.value.actionConfig,
    };

    if (editingRule.value) {
      // 更新
      await window.electronAPI.automation.updateRule(
        editingRule.value.id,
        data,
      );
      message.success("规则更新成功");
    } else {
      // 创建
      await window.electronAPI.automation.createRule(data);
      message.success("规则创建成功");
    }

    modalVisible.value = false;
    await loadRules();
  } catch (error) {
    logger.error("保存规则失败:", error);
    message.error("保存规则失败: " + error.message);
  }
}

/**
 * 取消
 */
function handleCancel() {
  modalVisible.value = false;
  resetForm();
}

/**
 * 手动触发规则
 */
async function handleTrigger(ruleId) {
  try {
    await window.electronAPI.automation.manualTrigger(ruleId);
    message.success("规则已触发");
  } catch (error) {
    logger.error("触发规则失败:", error);
    message.error("触发规则失败: " + error.message);
  }
}

/**
 * 删除规则
 */
async function handleDelete(ruleId) {
  try {
    await window.electronAPI.automation.deleteRule(ruleId);
    message.success("规则已删除");
    await loadRules();
  } catch (error) {
    logger.error("删除规则失败:", error);
    message.error("删除规则失败");
  }
}

/**
 * 切换规则启用状态
 */
async function handleToggle(rule) {
  try {
    await window.electronAPI.automation.updateRule(rule.id, {
      is_enabled: rule.is_enabled,
    });

    message.success(rule.is_enabled ? "规则已启用" : "规则已禁用");
  } catch (error) {
    logger.error("切换规则状态失败:", error);
    message.error("操作失败");
    // 恢复原状态
    rule.is_enabled = rule.is_enabled === 1 ? 0 : 1;
  }
}

/**
 * 重置表单
 */
function resetForm() {
  ruleForm.value = {
    name: "",
    description: "",
    triggerType: "schedule",
    triggerConfig: {
      cron: "0 21 * * *",
      path: "",
      pattern: "**/*",
      events: ["change"],
    },
    actionType: "run_task",
    actionConfig: {
      taskDescription: "",
      reportType: "daily",
      outputPath: "/reports/",
      title: "",
      message: "",
      channels: ["desktop"],
      projectPath: "",
      commitMessage: "Auto commit",
      autoPush: false,
    },
  };
}

/**
 * 获取触发类型名称
 */
function getTriggerTypeName(type) {
  const names = {
    schedule: "定时任务",
    file_change: "文件变化",
    task_complete: "任务完成",
    manual: "手动触发",
  };
  return names[type] || type;
}

/**
 * 获取触发类型颜色
 */
function getTriggerTypeColor(type) {
  const colors = {
    schedule: "blue",
    file_change: "green",
    task_complete: "orange",
    manual: "default",
  };
  return colors[type] || "default";
}

/**
 * 获取动作类型名称
 */
function getActionTypeName(type) {
  const names = {
    run_task: "AI任务",
    generate_report: "生成报告",
    send_notification: "发送通知",
    git_commit: "Git提交",
    export_file: "导出文件",
    run_script: "运行脚本",
  };
  return names[type] || type;
}

/**
 * 格式化时间
 */
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString("zh-CN");
}

// 初始化
onMounted(() => {
  loadRules();
});
</script>

<style scoped>
.automation-rules-panel {
  padding: 16px;
}

.stats-row {
  margin-bottom: 24px;
}

.form-hint {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
  display: block;
}

.form-hint a {
  margin: 0 4px;
  color: #1890ff;
  cursor: pointer;
}

.form-hint a:hover {
  text-decoration: underline;
}
</style>
