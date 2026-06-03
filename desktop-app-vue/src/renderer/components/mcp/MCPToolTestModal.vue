<template>
  <a-modal
    v-model:open="open"
    :title="`测试工具: ${selectedTool?.name || ''}`"
    width="800px"
    :confirm-loading="toolTestLoading"
    ok-text="执行"
    cancel-text="取消"
    @ok="executeToolTest"
  >
    <div v-if="selectedTool">
      <a-alert
        :message="selectedTool.description || '无描述'"
        type="info"
        show-icon
        style="margin-bottom: 16px"
      />

      <a-space wrap style="margin-bottom: 16px">
        <a-tag :color="getToolCategoryColor(selectedTool.category)">
          {{ getToolCategoryLabel(selectedTool.category) }}
        </a-tag>
        <a-tag :color="getToolRiskColor(selectedTool.riskLevel)">
          风险: {{ getToolRiskLabel(selectedTool.riskLevel) }}
        </a-tag>
        <a-tag v-if="selectedTool.isReadOnly" color="green"> 只读 </a-tag>
        <a-tag color="blue"> 参数 {{ toolParameters.length }} </a-tag>
      </a-space>

      <a-form layout="vertical">
        <template v-if="toolParameters.length > 0">
          <a-divider orientation="left"> 参数输入 </a-divider>

          <template v-for="param in toolParameters" :key="param.name">
            <a-form-item
              v-if="param.type === 'string'"
              :label="param.name"
              :required="param.required"
            >
              <a-textarea
                v-if="param.multiline"
                v-model:value="toolTestArgs[param.name]"
                :placeholder="param.description || `请输入 ${param.name}`"
                :rows="4"
              />
              <a-input
                v-else
                v-model:value="toolTestArgs[param.name]"
                :placeholder="param.description || `请输入 ${param.name}`"
              />
              <div v-if="param.description" class="form-hint">
                {{ param.description }}
              </div>
            </a-form-item>

            <a-form-item
              v-else-if="param.type === 'number' || param.type === 'integer'"
              :label="param.name"
              :required="param.required"
            >
              <a-input-number
                v-model:value="toolTestArgs[param.name]"
                :placeholder="param.description || `请输入 ${param.name}`"
                style="width: 100%"
              />
              <div v-if="param.description" class="form-hint">
                {{ param.description }}
              </div>
            </a-form-item>

            <a-form-item
              v-else-if="param.type === 'boolean'"
              :label="param.name"
              :required="param.required"
            >
              <a-switch v-model:checked="toolTestArgs[param.name]" />
              <div v-if="param.description" class="form-hint">
                {{ param.description }}
              </div>
            </a-form-item>

            <a-form-item
              v-else-if="param.enum && param.enum.length > 0"
              :label="param.name"
              :required="param.required"
            >
              <a-select
                v-model:value="toolTestArgs[param.name]"
                :placeholder="param.description || `请选择 ${param.name}`"
                style="width: 100%"
              >
                <a-select-option
                  v-for="opt in param.enum"
                  :key="opt"
                  :value="opt"
                >
                  {{ opt }}
                </a-select-option>
              </a-select>
              <div v-if="param.description" class="form-hint">
                {{ param.description }}
              </div>
            </a-form-item>

            <a-form-item
              v-else-if="param.type === 'array'"
              :label="param.name"
              :required="param.required"
            >
              <a-select
                v-model:value="toolTestArgs[param.name]"
                mode="tags"
                :placeholder="
                  param.description || `请输入 ${param.name} (多个值用回车分隔)`
                "
                style="width: 100%"
              />
              <div v-if="param.description" class="form-hint">
                {{ param.description }}
              </div>
            </a-form-item>

            <a-form-item v-else :label="param.name" :required="param.required">
              <a-textarea
                v-model:value="toolTestArgs[param.name]"
                :placeholder="`请输入 JSON 格式的 ${param.name}`"
                :rows="3"
              />
              <div class="form-hint">
                {{
                  param.description || `类型: ${param.type}，请输入 JSON 格式`
                }}
              </div>
            </a-form-item>
          </template>
        </template>

        <a-empty v-else description="此工具无需参数" style="margin: 16px 0" />

        <a-divider orientation="left">
          <a-switch
            v-model:checked="toolTestJsonMode"
            size="small"
            style="margin-right: 8px"
          />
          JSON 编辑模式
        </a-divider>

        <a-textarea
          v-if="toolTestJsonMode"
          v-model:value="toolTestArgsJson"
          :rows="6"
          placeholder='{"param1": "value1", "param2": "value2"}'
          style="font-family: &quot;Courier New&quot;, monospace"
        />
        <a-alert
          v-if="toolTestJsonError"
          type="error"
          :message="toolTestJsonError"
          style="margin-top: 8px"
          closable
          @close="toolTestJsonError = ''"
        />
      </a-form>

      <template v-if="toolTestResult !== null">
        <a-divider orientation="left"> 执行结果 </a-divider>

        <a-alert
          v-if="toolTestResult.success"
          type="success"
          message="执行成功"
          style="margin-bottom: 12px"
          show-icon
        />
        <a-alert
          v-else
          type="error"
          :message="toolTestResult.error || '执行失败'"
          style="margin-bottom: 12px"
          show-icon
        />

        <div class="tool-result-container">
          <pre class="tool-result">{{ formatToolResult(toolTestResult) }}</pre>
        </div>

        <a-space style="margin-top: 12px">
          <a-button size="small" @click="copyToolResult">
            <copy-outlined /> 复制结果
          </a-button>
          <a-button size="small" @click="clearToolResult">
            <delete-outlined /> 清除结果
          </a-button>
        </a-space>
      </template>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, reactive, computed, watch, defineExpose } from "vue";
import { message } from "ant-design-vue";
import { CopyOutlined, DeleteOutlined } from "@ant-design/icons-vue";
import { logger } from "@/utils/logger";
import {
  normalizeToolSchema,
  normalizeToolDescriptor,
  getToolCategoryColor,
  getToolCategoryLabel,
  getToolRiskColor,
  getToolRiskLabel,
  formatToolResult,
} from "./mcpToolUtils";

const open = defineModel("open", { type: Boolean, default: false });

const selectedTool = ref(null);
const currentServerId = ref(null);
const toolTestLoading = ref(false);
const toolTestArgs = reactive({});
const toolTestArgsJson = ref("{}");
const toolTestJsonMode = ref(false);
const toolTestJsonError = ref("");
const toolTestResult = ref(null);

const toolParameters = computed(() => {
  const schema = normalizeToolSchema(selectedTool.value);
  if (!schema?.properties) {
    return [];
  }
  const required = schema.required || [];
  return Object.entries(schema.properties).map(([name, prop]) => ({
    name,
    type: prop.type || "string",
    description: prop.description || "",
    required: required.includes(name),
    enum: prop.enum || null,
    default: prop.default,
    multiline: prop.format === "multiline" || name.includes("content"),
  }));
});

watch(toolTestJsonMode, (newMode) => {
  if (newMode) {
    const cleanArgs = {};
    for (const [key, value] of Object.entries(toolTestArgs)) {
      if (value !== "" && value !== undefined && value !== null) {
        cleanArgs[key] = value;
      }
    }
    toolTestArgsJson.value = JSON.stringify(cleanArgs, null, 2);
  } else {
    try {
      const parsed = JSON.parse(toolTestArgsJson.value);
      Object.keys(toolTestArgs).forEach((key) => delete toolTestArgs[key]);
      Object.assign(toolTestArgs, parsed);
      toolTestJsonError.value = "";
    } catch (error) {
      toolTestJsonError.value = "JSON格式错误: " + error.message;
    }
  }
});

const executeToolTest = async () => {
  toolTestLoading.value = true;
  toolTestResult.value = null;

  try {
    let args;

    if (toolTestJsonMode.value) {
      try {
        args = JSON.parse(toolTestArgsJson.value);
        toolTestJsonError.value = "";
      } catch (error) {
        toolTestJsonError.value = "JSON 格式错误: " + error.message;
        toolTestLoading.value = false;
        return;
      }
    } else {
      args = {};
      const schema = normalizeToolSchema(selectedTool.value);
      const properties = schema.properties || {};

      for (const [key, value] of Object.entries(toolTestArgs)) {
        if (value === "" || value === undefined || value === null) {
          continue;
        }

        const propSchema = properties[key] || {};
        if (propSchema.type === "object" && typeof value === "string") {
          try {
            args[key] = JSON.parse(value);
          } catch {
            args[key] = value;
          }
        } else {
          args[key] = value;
        }
      }
    }

    const schema = normalizeToolSchema(selectedTool.value);
    const required = schema.required || [];
    for (const reqParam of required) {
      if (args[reqParam] === undefined || args[reqParam] === "") {
        message.error(`参数 "${reqParam}" 是必填项`);
        toolTestLoading.value = false;
        return;
      }
    }

    logger.info(`[MCP Test] Executing tool: ${selectedTool.value.name}`, args);

    const result = await window.electronAPI.invoke("mcp:call-tool", {
      serverName: currentServerId.value,
      toolName: selectedTool.value.name,
      arguments: args,
    });

    toolTestResult.value = result;

    if (result.success) {
      message.success("工具执行成功");
    } else {
      message.error("工具执行失败: " + result.error);
    }
  } catch (error) {
    logger.error("[MCP Test] Tool execution failed:", error);
    toolTestResult.value = {
      success: false,
      error: error.message,
    };
    message.error("工具执行失败: " + error.message);
  } finally {
    toolTestLoading.value = false;
  }
};

const copyToolResult = async () => {
  try {
    const text = formatToolResult(toolTestResult.value);
    await navigator.clipboard.writeText(text);
    message.success("已复制到剪贴板");
  } catch (error) {
    message.error("复制失败: " + error.message);
  }
};

const clearToolResult = () => {
  toolTestResult.value = null;
};

// Imperative API: parent calls testModalRef.openFor(tool, serverId) to launch
defineExpose({
  openFor(tool, serverId) {
    selectedTool.value = normalizeToolDescriptor(tool);
    currentServerId.value = serverId;

    Object.keys(toolTestArgs).forEach((key) => delete toolTestArgs[key]);
    toolTestArgsJson.value = "{}";
    toolTestJsonMode.value = false;
    toolTestJsonError.value = "";
    toolTestResult.value = null;

    const schema = normalizeToolSchema(tool);
    if (schema?.properties) {
      Object.entries(schema.properties).forEach(([name, prop]) => {
        if (prop.default !== undefined) {
          toolTestArgs[name] = prop.default;
        } else if (prop.type === "boolean") {
          toolTestArgs[name] = false;
        } else if (prop.type === "array") {
          toolTestArgs[name] = [];
        } else if (prop.type === "number" || prop.type === "integer") {
          toolTestArgs[name] = undefined;
        } else {
          toolTestArgs[name] = "";
        }
      });
    }

    open.value = true;
  },
});
</script>

<style scoped>
.form-hint {
  font-size: 12px;
  color: #8c8c8c;
  margin-top: 4px;
}

.tool-result-container {
  max-height: 400px;
  overflow-y: auto;
  background: #f5f5f5;
  border-radius: 4px;
  padding: 12px;
}

.tool-result {
  margin: 0;
  font-family: "Courier New", monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
