<template>
  <a-modal
    v-model:open="dialogVisible"
    title="文件访问授权"
    :width="700"
    :confirm-loading="confirming"
    @ok="handleGrant"
    @cancel="handleDeny"
    ok-text="授予权限"
    cancel-text="拒绝访问"
  >
    <!-- 请求信息 -->
    <a-alert
      message="文件访问请求"
      :description="`团队 '${requestData.teamName || requestData.teamId}' 请求访问以下路径`"
      type="info"
      show-icon
      style="margin-bottom: 16px;"
    />

    <!-- 路径信息 -->
    <a-descriptions :column="1" bordered size="small" class="path-info">
      <a-descriptions-item label="团队 ID">
        <a-typography-text copyable>{{ requestData.teamId }}</a-typography-text>
      </a-descriptions-item>
      <a-descriptions-item label="团队名称">
        {{ requestData.teamName || "-" }}
      </a-descriptions-item>
      <a-descriptions-item label="请求路径">
        <a-typography-text copyable>{{ requestData.folderPath }}</a-typography-text>
      </a-descriptions-item>
    </a-descriptions>

    <!-- 安全警告 -->
    <a-alert
      v-if="isSensitivePath"
      message="安全警告"
      :description="sensitiveWarningMessage"
      type="warning"
      show-icon
      style="margin-top: 16px; margin-bottom: 16px;"
    />

    <!-- 权限选择 -->
    <div class="permission-section">
      <h4>请选择授予的权限：</h4>
      <a-checkbox-group
        v-model:value="selectedPermissions"
        style="display: flex; flex-direction: column; gap: 12px;"
      >
        <a-checkbox value="READ">
          <span class="permission-label">
            <EyeOutlined />
            读取权限
          </span>
          <span class="permission-desc">允许读取文件内容和列出目录</span>
        </a-checkbox>
        <a-checkbox value="WRITE">
          <span class="permission-label">
            <EditOutlined />
            写入权限
          </span>
          <span class="permission-desc">允许创建、修改和删除文件</span>
        </a-checkbox>
        <a-checkbox value="EXECUTE">
          <span class="permission-label">
            <ThunderboltOutlined />
            执行权限
          </span>
          <span class="permission-desc">允许执行文件和脚本</span>
        </a-checkbox>
      </a-checkbox-group>
    </div>

    <!-- 记住选择 -->
    <div class="remember-section">
      <a-checkbox v-model:checked="rememberChoice">
        记住此选择（下次不再询问）
      </a-checkbox>
      <div class="remember-hint">
        如果勾选，相同团队访问此路径时将自动授予相同权限
      </div>
    </div>

    <!-- 历史访问记录 -->
    <div v-if="auditLogs.length > 0" class="audit-section">
      <a-divider>历史访问记录</a-divider>

      <a-timeline size="small">
        <a-timeline-item
          v-for="(log, index) in auditLogs.slice(0, 5)"
          :key="index"
          :color="log.success ? 'green' : 'red'"
        >
          <div class="audit-item">
            <div class="audit-operation">
              {{ getOperationText(log.operation) }}
              <a-tag
                :color="log.success ? 'success' : 'error'"
                size="small"
                style="margin-left: 8px;"
              >
                {{ log.success ? '成功' : '失败' }}
              </a-tag>
            </div>
            <div class="audit-meta">
              {{ log.filePath || log.path }}
              <a-divider type="vertical" />
              {{ formatDate(log.timestamp) }}
            </div>
          </div>
        </a-timeline-item>
      </a-timeline>

      <div v-if="auditLogs.length > 5" class="more-logs">
        还有 {{ auditLogs.length - 5 }} 条记录...
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { message } from "ant-design-vue";
import {
  EyeOutlined,
  EditOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons-vue";
import { formatDistanceToNow } from "date-fns";
import { zhCN } from "date-fns/locale";
import { logger, createLogger } from '@/utils/logger';

const permissionLogger = createLogger('file-permission');

// Props
const props = defineProps({
  visible: {
    type: Boolean,
    default: false,
  },
  requestData: {
    type: Object,
    default: () => ({
      teamId: "",
      teamName: "",
      folderPath: "",
      requestedPermissions: [],
    }),
  },
});

// Emits
const emit = defineEmits(["update:visible", "grant", "deny"]);

const dialogVisible = computed({
  get: () => props.visible,
  set: (value) => emit("update:visible", value),
});

// 状态
const confirming = ref(false);
const selectedPermissions = ref([]);
const rememberChoice = ref(false);
const auditLogs = ref([]);

// 敏感路径检测（简化版，实际应该调用后端 API）
const sensitivePatterns = [
  /\.env$/,
  /\.env\./,
  /credentials?\.json$/i,
  /secrets?\.json$/i,
  /\.ssh\//,
  /id_rsa/,
  /\.pem$/,
  /\.key$/,
  /config\.json$/,
  /\.npmrc$/,
];

const isSensitivePath = computed(() => {
  const path = props.requestData.folderPath || "";
  return sensitivePatterns.some((pattern) => pattern.test(path));
});

const sensitiveWarningMessage = computed(() => {
  if (!isSensitivePath.value) return "";

  return `此路径可能包含敏感信息（如密钥、凭证等）。授予访问权限可能导致安全风险。建议仅授予必要的最小权限，或拒绝访问。`;
});

// ==========================================
// 生命周期
// ==========================================

watch(
  () => props.visible,
  async (newValue) => {
    if (newValue) {
      // 对话框打开时初始化
      initDialog();
    }
  },
);

watch(
  () => props.requestData,
  (newValue) => {
    if (newValue.requestedPermissions && newValue.requestedPermissions.length > 0) {
      selectedPermissions.value = [...newValue.requestedPermissions];
    }
  },
  { immediate: true, deep: true },
);

// ==========================================
// 初始化
// ==========================================

async function initDialog() {
  // 重置状态
  confirming.value = false;
  rememberChoice.value = false;

  // 加载历史访问记录
  await loadAuditLogs();
}

async function loadAuditLogs() {
  try {
    const result = await window.electronAPI.invoke("cowork:get-audit-log", {
      teamId: props.requestData.teamId,
      limit: 10,
    });

    if (result.success) {
      auditLogs.value = result.logs || [];
    }
  } catch (error) {
    permissionLogger.error("加载审计日志失败:", error);
  }
}

// ==========================================
// 操作处理
// ==========================================

async function handleGrant() {
  if (selectedPermissions.value.length === 0) {
    message.error("请至少选择一项权限");
    return;
  }

  confirming.value = true;

  try {
    // 发送授权结果
    emit("grant", {
      teamId: props.requestData.teamId,
      folderPath: props.requestData.folderPath,
      permissions: selectedPermissions.value,
      remember: rememberChoice.value,
    });

    permissionLogger.info(
      `授予权限: ${selectedPermissions.value.join(", ")} -> ${props.requestData.teamId}`,
    );

    // 关闭对话框
    emit("update:visible", false);

    message.success("权限已授予");
  } catch (error) {
    permissionLogger.error("授予权限失败:", error);
    message.error("授予权限失败: " + error.message);
  } finally {
    confirming.value = false;
  }
}

function handleDeny() {
  // 发送拒绝结果
  emit("deny", {
    teamId: props.requestData.teamId,
    folderPath: props.requestData.folderPath,
  });

  permissionLogger.info(`拒绝访问: ${props.requestData.teamId}`);

  // 关闭对话框
  emit("update:visible", false);

  message.info("已拒绝访问");
}

// ==========================================
// 辅助函数
// ==========================================

function getOperationText(operation) {
  const texts = {
    read: "读取文件",
    write: "写入文件",
    delete: "删除文件",
    list: "列出目录",
    execute: "执行文件",
  };
  return texts[operation] || operation;
}

function formatDate(timestamp) {
  if (!timestamp) return "-";

  try {
    return formatDistanceToNow(new Date(timestamp), {
      locale: zhCN,
      addSuffix: true,
    });
  } catch (error) {
    return "-";
  }
}
</script>

<style scoped lang="scss">
.path-info {
  margin-bottom: 16px;
}

.permission-section {
  margin-top: 16px;
  margin-bottom: 16px;

  h4 {
    font-weight: 600;
    margin-bottom: 12px;
  }

  .permission-label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
    margin-right: 8px;

    :deep(.anticon) {
      color: #1890ff;
    }
  }

  .permission-desc {
    color: #8c8c8c;
    font-size: 12px;
    display: block;
    margin-left: 24px;
    margin-top: 4px;
  }
}

.remember-section {
  padding: 12px;
  background: #fafafa;
  border-radius: 4px;
  margin-bottom: 16px;

  .remember-hint {
    margin-top: 6px;
    margin-left: 24px;
    font-size: 12px;
    color: #8c8c8c;
  }
}

.audit-section {
  margin-top: 16px;

  .audit-item {
    .audit-operation {
      display: flex;
      align-items: center;
      margin-bottom: 4px;
      font-weight: 500;
    }

    .audit-meta {
      font-size: 12px;
      color: #8c8c8c;
    }
  }

  .more-logs {
    text-align: center;
    color: #8c8c8c;
    font-size: 12px;
    margin-top: 8px;
  }
}
</style>
