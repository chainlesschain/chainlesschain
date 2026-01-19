<template>
  <div v-if="!loading">
    <!-- 如果有权限，显示内容 -->
    <slot v-if="hasPermission" />

    <!-- 如果没有权限，显示提示 -->
    <div
      v-else
      class="permission-denied"
    >
      <a-empty
        v-if="showEmpty"
        :description="emptyDescription || defaultEmptyDescription"
      >
        <template #image>
          <LockOutlined style="font-size: 48px; color: #ff4d4f;" />
        </template>
        <a-button
          v-if="showContactButton"
          type="primary"
          @click="handleContactAdmin"
        >
          联系管理员
        </a-button>
      </a-empty>

      <a-alert
        v-else-if="showAlert"
        :message="alertMessage || '权限不足'"
        :description="alertDescription || defaultAlertDescription"
        type="warning"
        show-icon
        closable
      >
        <template #icon>
          <LockOutlined />
        </template>
      </a-alert>

      <!-- 自定义无权限内容 -->
      <slot
        v-else-if="$slots.denied"
        name="denied"
      />
    </div>
  </div>

  <!-- 加载中状态 -->
  <div
    v-else
    class="permission-loading"
  >
    <a-spin tip="检查权限中..." />
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { LockOutlined } from '@ant-design/icons-vue';
import { useIdentityStore } from '../stores/identity';
import { message } from 'ant-design-vue';

const props = defineProps({
  // 需要的权限
  permission: {
    type: String,
    required: true
  },
  // 显示模式：empty（空状态）、alert（警告框）、custom（自定义）
  mode: {
    type: String,
    default: 'empty',
    validator: (value) => ['empty', 'alert', 'custom'].includes(value)
  },
  // 空状态描述
  emptyDescription: {
    type: String,
    default: ''
  },
  // 警告框标题
  alertMessage: {
    type: String,
    default: ''
  },
  // 警告框描述
  alertDescription: {
    type: String,
    default: ''
  },
  // 是否显示"联系管理员"按钮
  showContactButton: {
    type: Boolean,
    default: true
  },
  // 权限检查失败时的回调
  onDenied: {
    type: Function,
    default: null
  }
});

const emit = defineEmits(['permission-checked', 'permission-denied']);

const identityStore = useIdentityStore();

const loading = ref(true);
const hasPermission = ref(false);

// 计算属性
const showEmpty = computed(() => props.mode === 'empty');
const showAlert = computed(() => props.mode === 'alert');

const defaultEmptyDescription = computed(() => {
  const role = identityStore.currentContext?.role || 'member';
  return `您当前的角色（${getRoleDisplayName(role)}）没有执行此操作的权限。请联系组织管理员获取权限。`;
});

const defaultAlertDescription = computed(() => {
  const role = identityStore.currentContext?.role || 'member';
  return `您需要 ${props.permission} 权限才能执行此操作。当前角色：${getRoleDisplayName(role)}`;
});

/**
 * 获取角色显示名称
 */
function getRoleDisplayName(role) {
  const roleNames = {
    owner: '所有者',
    admin: '管理员',
    member: '成员',
    viewer: '访客'
  };
  return roleNames[role] || role;
}

/**
 * 检查权限
 */
async function checkPermission() {
  loading.value = true;

  try {
    // 如果不在组织上下文中，默认有权限
    if (!identityStore.isOrganizationContext) {
      hasPermission.value = true;
      emit('permission-checked', true);
      return;
    }

    // 检查权限
    const result = await identityStore.checkPermission(props.permission);
    hasPermission.value = result;

    emit('permission-checked', result);

    if (!result) {
      emit('permission-denied', {
        permission: props.permission,
        role: identityStore.currentContext?.role
      });

      if (props.onDenied) {
        props.onDenied({
          permission: props.permission,
          role: identityStore.currentContext?.role
        });
      }
    }
  } catch (error) {
    console.error('权限检查失败:', error);
    hasPermission.value = false;
    emit('permission-checked', false);
    emit('permission-denied', {
      permission: props.permission,
      error: error.message
    });
  } finally {
    loading.value = false;
  }
}

/**
 * 联系管理员
 */
function handleContactAdmin() {
  const orgName = identityStore.currentContext?.name || '组织';
  message.info(`请联系 ${orgName} 的管理员申请权限`);
}

// 监听权限变化
watch(
  () => props.permission,
  () => {
    checkPermission();
  }
);

// 监听身份上下文变化
watch(
  () => identityStore.currentContext,
  () => {
    checkPermission();
  },
  { deep: true }
);

onMounted(() => {
  checkPermission();
});
</script>

<style scoped>
.permission-denied {
  padding: 24px;
  text-align: center;
}

.permission-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 200px;
}
</style>
