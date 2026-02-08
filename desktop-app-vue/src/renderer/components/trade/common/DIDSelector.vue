<template>
  <div class="did-selector">
    <a-select
      v-model:value="selectedValue"
      :placeholder="placeholder"
      :loading="loading"
      :allow-clear="allowClear"
      :show-search="showSearch"
      :filter-option="filterOption"
      :disabled="disabled"
      :size="size"
      :style="{ width: width }"
      @change="handleChange"
      @search="handleSearch"
    >
      <template #suffixIcon>
        <user-outlined />
      </template>

      <!-- DID选项 -->
      <a-select-option
        v-for="did in filteredDids"
        :key="did.did"
        :value="did.did"
        :disabled="isDisabled(did)"
      >
        <div class="did-option">
          <div class="did-avatar">
            <a-avatar
              :size="avatarSize"
              :style="{ backgroundColor: getAvatarColor(did.did) }"
            >
              {{ getAvatarText(did) }}
            </a-avatar>
          </div>
          <div class="did-info">
            <div class="did-name">
              {{ did.profile?.name || "Unnamed" }}
              <a-tag v-if="did.did === currentDid" color="blue" size="small">
                当前
              </a-tag>
              <a-tag v-if="isCreator(did)" color="green" size="small">
                创建者
              </a-tag>
            </div>
            <div class="did-address">
              {{ formatDid(did.did) }}
              <a-tooltip title="复制">
                <copy-outlined
                  class="copy-icon"
                  @click.stop="handleCopy(did.did)"
                />
              </a-tooltip>
            </div>
          </div>
        </div>
      </a-select-option>

      <!-- 空状态 -->
      <template #notFoundContent>
        <a-empty :image="Empty.PRESENTED_IMAGE_SIMPLE" description="暂无DID">
          <a-button type="link" size="small" @click="handleCreateDid">
            <plus-outlined /> 创建DID
          </a-button>
        </a-empty>
      </template>
    </a-select>

    <!-- 快捷操作 -->
    <div v-if="showQuickActions" class="quick-actions">
      <a-button type="link" size="small" @click="handleCreateDid">
        <plus-outlined /> 新建
      </a-button>
      <a-button type="link" size="small" @click="handleManageDids">
        <setting-outlined /> 管理
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { logger } from "@/utils/logger";

import { ref, computed, watch, onMounted } from "vue";
import { message, Empty } from "ant-design-vue";
import {
  UserOutlined,
  CopyOutlined,
  PlusOutlined,
  SettingOutlined,
} from "@ant-design/icons-vue";
import { useRouter } from "vue-router";

const props = defineProps({
  // v-model绑定值
  modelValue: {
    type: String,
    default: "",
  },
  // 占位符
  placeholder: {
    type: String,
    default: "选择DID身份",
  },
  // 是否允许清空
  allowClear: {
    type: Boolean,
    default: true,
  },
  // 是否显示搜索
  showSearch: {
    type: Boolean,
    default: true,
  },
  // 是否禁用
  disabled: {
    type: Boolean,
    default: false,
  },
  // 尺寸
  size: {
    type: String,
    default: "middle", // 'small' | 'middle' | 'large'
  },
  // 宽度
  width: {
    type: String,
    default: "100%",
  },
  // 头像大小
  avatarSize: {
    type: Number,
    default: 32,
  },
  // 当前用户DID（用于高亮）
  currentDid: {
    type: String,
    default: "",
  },
  // 创建者DID（用于高亮）
  creatorDid: {
    type: String,
    default: "",
  },
  // 排除的DID列表
  excludeDids: {
    type: Array,
    default: () => [],
  },
  // 是否显示快捷操作
  showQuickActions: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "update:modelValue",
  "change",
  "create-did",
  "manage-dids",
]);

const router = useRouter();

// 状态
const loading = ref(false);
const dids = ref([]);
const searchKeyword = ref("");

// 双向绑定
const selectedValue = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

// 过滤后的DID列表
const filteredDids = computed(() => {
  let result = [...dids.value];

  // 排除指定DID
  if (props.excludeDids.length > 0) {
    result = result.filter((did) => !props.excludeDids.includes(did.did));
  }

  // 搜索过滤
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase();
    result = result.filter(
      (did) =>
        did.did.toLowerCase().includes(keyword) ||
        did.profile?.name?.toLowerCase().includes(keyword),
    );
  }

  return result;
});

/**
 * 加载DID列表
 */
const loadDids = async () => {
  loading.value = true;
  try {
    const result = await window.electronAPI.did.getAllIdentities();
    dids.value = result || [];
  } catch (error) {
    logger.error("加载DID列表失败:", error);
    message.error("加载DID列表失败: " + error.message);
    dids.value = [];
  } finally {
    loading.value = false;
  }
};

/**
 * 判断DID是否被禁用
 */
const isDisabled = (did) => {
  return props.excludeDids.includes(did.did);
};

/**
 * 判断是否为创建者
 */
const isCreator = (did) => {
  return props.creatorDid && did.did === props.creatorDid;
};

/**
 * 获取头像文本
 */
const getAvatarText = (did) => {
  if (did.profile?.name) {
    return did.profile.name.charAt(0).toUpperCase();
  }
  return did.did.slice(4, 6).toUpperCase();
};

/**
 * 获取头像颜色
 */
const getAvatarColor = (didString) => {
  // 根据DID生成颜色
  let hash = 0;
  for (let i = 0; i < didString.length; i++) {
    hash = didString.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    "#f56a00",
    "#7265e6",
    "#ffbf00",
    "#00a2ae",
    "#1890ff",
    "#52c41a",
    "#fa8c16",
    "#eb2f96",
  ];

  return colors[Math.abs(hash) % colors.length];
};

/**
 * 格式化DID显示
 */
const formatDid = (did) => {
  if (did.length <= 20) {
    return did;
  }
  return `${did.slice(0, 10)}...${did.slice(-8)}`;
};

/**
 * 复制DID
 */
const handleCopy = async (did) => {
  try {
    await navigator.clipboard.writeText(did);
    message.success("已复制到剪贴板");
  } catch (error) {
    logger.error("复制失败:", error);
    message.error("复制失败");
  }
};

/**
 * 搜索过滤
 */
const filterOption = (input, option) => {
  return true; // 使用computed中的过滤逻辑
};

/**
 * 搜索处理
 */
const handleSearch = (value) => {
  searchKeyword.value = value;
};

/**
 * 选择变化处理
 */
const handleChange = (value) => {
  emit("change", value);
  const selectedDid = dids.value.find((did) => did.did === value);
  if (selectedDid) {
    logger.info("[DIDSelector] 选择了DID:", selectedDid);
  }
};

/**
 * 创建DID
 */
const handleCreateDid = () => {
  emit("create-did");
  // 默认跳转到DID管理页
  router.push("/did");
};

/**
 * 管理DID
 */
const handleManageDids = () => {
  emit("manage-dids");
  router.push("/did");
};

// 生命周期
onMounted(() => {
  loadDids();
});

// 监听modelValue变化，确保选中的DID存在
watch(
  () => props.modelValue,
  (newValue) => {
    if (newValue && !filteredDids.value.find((did) => did.did === newValue)) {
      logger.warn("[DIDSelector] 选中的DID不在列表中:", newValue);
    }
  },
);
</script>

<style scoped>
.did-selector {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.did-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}

.did-avatar {
  flex-shrink: 0;
}

.did-info {
  flex: 1;
  min-width: 0;
}

.did-name {
  font-size: 14px;
  font-weight: 500;
  color: #262626;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.did-address {
  font-size: 12px;
  color: #8c8c8c;
  font-family: "Courier New", monospace;
  display: flex;
  align-items: center;
  gap: 6px;
}

.copy-icon {
  font-size: 12px;
  color: #1890ff;
  cursor: pointer;
  transition: all 0.3s;
}

.copy-icon:hover {
  color: #40a9ff;
  transform: scale(1.1);
}

.quick-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  border-left: 1px solid #f0f0f0;
  padding-left: 8px;
}

:deep(.ant-select-selector) {
  min-height: 36px;
}

:deep(.ant-select-selection-item) {
  display: flex;
  align-items: center;
}
</style>
