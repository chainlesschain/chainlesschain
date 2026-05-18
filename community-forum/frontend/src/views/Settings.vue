<template>
  <div class="settings-page">
    <div class="page-header">
      <h1>设置</h1>
    </div>

    <el-card>
      <el-tabs v-model="activeTab" tab-position="left" class="settings-tabs">
        <el-tab-pane label="账户设置" name="account">
          <h2>账户设置</h2>
          <el-form :model="accountForm" label-width="120px">
            <el-form-item label="用户名">
              <el-input v-model="accountForm.username" disabled />
            </el-form-item>
            <el-form-item label="认证设备">
              <el-tag>{{ accountForm.deviceType }}</el-tag>
            </el-form-item>
            <el-form-item label="注册时间">
              <span>{{ formatDate(accountForm.createdAt) }}</span>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="隐私设置" name="privacy">
          <h2>隐私设置</h2>
          <el-form :model="privacyForm" label-width="150px">
            <el-form-item label="个人主页可见性">
              <el-radio-group v-model="privacyForm.profileVisibility">
                <el-radio label="public">公开</el-radio>
                <el-radio label="friends">仅关注的人</el-radio>
                <el-radio label="private">私密</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="显示在线状态">
              <el-switch v-model="privacyForm.showOnlineStatus" />
            </el-form-item>
            <el-form-item label="允许私信">
              <el-switch v-model="privacyForm.allowMessages" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="savePrivacy">保存设置</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="通知设置" name="notifications">
          <h2>通知设置</h2>
          <el-form :model="notificationForm" label-width="150px">
            <el-form-item label="新回复通知">
              <el-switch v-model="notificationForm.newReply" />
            </el-form-item>
            <el-form-item label="点赞通知">
              <el-switch v-model="notificationForm.newLike" />
            </el-form-item>
            <el-form-item label="新粉丝通知">
              <el-switch v-model="notificationForm.newFollower" />
            </el-form-item>
            <el-form-item label="提及通知">
              <el-switch v-model="notificationForm.mention" />
            </el-form-item>
            <el-form-item label="系统公告">
              <el-switch v-model="notificationForm.systemAnnouncement" />
            </el-form-item>
            <el-form-item label="邮件通知">
              <el-switch v-model="notificationForm.emailNotification" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveNotifications">保存设置</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="外观设置" name="appearance">
          <h2>外观设置</h2>
          <el-form :model="appearanceForm" label-width="120px">
            <el-form-item label="主题">
              <el-radio-group v-model="appearanceForm.theme">
                <el-radio label="light">浅色</el-radio>
                <el-radio label="dark">深色</el-radio>
                <el-radio label="auto">跟随系统</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="语言">
              <el-select v-model="appearanceForm.language">
                <el-option label="简体中文" value="zh-CN" />
                <el-option label="English" value="en-US" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveAppearance">保存设置</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="安全设置" name="security">
          <h2>安全设置</h2>
          <el-form label-width="150px">
            <el-form-item label="设备认证">
              <div class="security-item">
                <span>当前认证设备: {{ accountForm.deviceType }}</span>
                <el-button size="small" type="primary">更换设备</el-button>
              </div>
            </el-form-item>
            <el-form-item label="登录历史">
              <el-button size="small" @click="viewLoginHistory">查看登录记录</el-button>
            </el-form-item>
            <el-form-item label="账户操作">
              <div class="danger-zone">
                <el-button type="danger" plain @click="showDeleteDialog = true">注销账户</el-button>
              </div>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog v-model="showDeleteDialog" title="注销账户" width="500px">
      <el-alert
        title="警告"
        type="error"
        description="注销账户后，您的所有数据将被永久删除且无法恢复！"
        :closable="false"
        style="margin-bottom: 20px"
      />
      <p>请输入您的用户名以确认：</p>
      <el-input v-model="deleteConfirm" placeholder="输入用户名" />
      <template #footer>
        <el-button @click="showDeleteDialog = false">取消</el-button>
        <el-button
          type="danger"
          :disabled="deleteConfirm !== accountForm.username"
          @click="deleteAccount"
        >
          确认注销
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage, ElMessageBox } from 'element-plus'
import dayjs from 'dayjs'

const router = useRouter()
const userStore = useUserStore()

const activeTab = ref('account')
const showDeleteDialog = ref(false)
const deleteConfirm = ref('')

const accountForm = reactive({
  username: '',
  deviceType: 'U盾',
  createdAt: ''
})

const privacyForm = reactive({
  profileVisibility: 'public',
  showOnlineStatus: true,
  allowMessages: true
})

const notificationForm = reactive({
  newReply: true,
  newLike: true,
  newFollower: true,
  mention: true,
  systemAnnouncement: true,
  emailNotification: false
})

const appearanceForm = reactive({
  theme: 'light',
  language: 'zh-CN'
})

const formatDate = (date) => {
  return dayjs(date).format('YYYY年MM月DD日')
}

const savePrivacy = () => {
  ElMessage.success('隐私设置已保存')
}

const saveNotifications = () => {
  ElMessage.success('通知设置已保存')
}

const saveAppearance = () => {
  ElMessage.success('外观设置已保存')
}

const viewLoginHistory = () => {
  ElMessage.info('登录历史功能开发中...')
}

const deleteAccount = async () => {
  try {
    await ElMessageBox.confirm('此操作不可逆，确定要注销账户吗？', '最后确认', {
      confirmButtonText: '确定注销',
      cancelButtonText: '取消',
      type: 'error'
    })

    ElMessage.success('账户注销请求已提交')
    showDeleteDialog.value = false
    deleteConfirm.value = ''
  } catch {
    //  取消
  }
}

onMounted(() => {
  if (!userStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    router.push('/login')
    return
  }

  accountForm.username = userStore.user?.nickname || '用户'
  accountForm.createdAt = '2024-06-15T10:00:00'
})
</script>

<style scoped lang="scss">
.settings-page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 24px;
}

.page-header {
  margin-bottom: 24px;

  h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 700;
    color: var(--el-text-color-primary);
  }
}

.settings-tabs {
  :deep(.el-tabs__content) {
    padding: 24px;
  }

  h2 {
    margin: 0 0 24px;
    font-size: 20px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }
}

.security-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.danger-zone {
  padding: 16px;
  background: var(--el-color-error-light-9);
  border: 1px solid var(--el-color-error-light-7);
  border-radius: 8px;
}

@media (max-width: 768px) {
  .settings-page {
    padding: 16px;
  }

  .settings-tabs {
    :deep(.el-tabs__header) {
      width: 100%;
    }

    :deep(.el-tabs__nav) {
      float: none;
    }
  }
}
</style>
