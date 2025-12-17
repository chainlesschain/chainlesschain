<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-card">
        <!-- Logo和标题 -->
        <div class="login-header">
          <img src="@/assets/logo.png" alt="ChainlessChain" class="logo">
          <h1>ChainlessChain 社区</h1>
          <p class="subtitle">使用U盾或SIMKey安全登录</p>
        </div>

        <!-- 登录方式切换 -->
        <el-tabs v-model="loginType" class="login-tabs">
          <el-tab-pane label="U盾登录" name="ukey">
            <el-form
              ref="ukeyFormRef"
              :model="ukeyForm"
              :rules="ukeyRules"
              label-position="top"
              @submit.prevent="handleUKeyLogin"
            >
              <el-form-item label="设备ID" prop="deviceId">
                <el-input
                  v-model="ukeyForm.deviceId"
                  placeholder="请输入U盾设备ID"
                  :prefix-icon="Key"
                  size="large"
                />
              </el-form-item>

              <el-form-item label="PIN码" prop="pin">
                <el-input
                  v-model="ukeyForm.pin"
                  type="password"
                  placeholder="请输入PIN码"
                  :prefix-icon="Lock"
                  size="large"
                  show-password
                  @keyup.enter="handleUKeyLogin"
                />
              </el-form-item>

              <el-form-item>
                <el-button
                  type="primary"
                  size="large"
                  :loading="loading"
                  style="width: 100%"
                  native-type="submit"
                >
                  {{ loading ? '登录中...' : 'U盾登录' }}
                </el-button>
              </el-form-item>
            </el-form>

            <div class="help-text">
              <el-icon><QuestionFilled /></el-icon>
              <span>请确保U盾已插入电脑并正确安装驱动</span>
            </div>
          </el-tab-pane>

          <el-tab-pane label="SIMKey登录" name="simkey">
            <el-form
              ref="simkeyFormRef"
              :model="simkeyForm"
              :rules="simkeyRules"
              label-position="top"
              @submit.prevent="handleSIMKeyLogin"
            >
              <el-form-item label="SIM卡ID" prop="simId">
                <el-input
                  v-model="simkeyForm.simId"
                  placeholder="请输入SIM卡ID"
                  :prefix-icon="CreditCard"
                  size="large"
                />
              </el-form-item>

              <el-form-item label="PIN码" prop="pin">
                <el-input
                  v-model="simkeyForm.pin"
                  type="password"
                  placeholder="请输入PIN码"
                  :prefix-icon="Lock"
                  size="large"
                  show-password
                  @keyup.enter="handleSIMKeyLogin"
                />
              </el-form-item>

              <el-form-item>
                <el-button
                  type="primary"
                  size="large"
                  :loading="loading"
                  style="width: 100%"
                  native-type="submit"
                >
                  {{ loading ? '登录中...' : 'SIMKey登录' }}
                </el-button>
              </el-form-item>
            </el-form>

            <div class="help-text">
              <el-icon><QuestionFilled /></el-icon>
              <span>请确保SIM卡已正确插入设备</span>
            </div>
          </el-tab-pane>
        </el-tabs>

        <!-- 底部链接 -->
        <div class="login-footer">
          <el-divider>或</el-divider>
          <div class="footer-links">
            <a href="https://chainlesschain.com" target="_blank">了解ChainlessChain</a>
            <span class="divider">·</span>
            <a href="https://docs.chainlesschain.com" target="_blank">获取帮助</a>
            <span class="divider">·</span>
            <a href="https://chainlesschain.com/download" target="_blank">获取U盾/SIMKey</a>
          </div>
        </div>
      </div>

      <!-- 特性展示 -->
      <div class="features">
        <div class="feature-item">
          <el-icon :size="32" color="#409eff"><Lock /></el-icon>
          <h3>硬件级安全</h3>
          <p>基于U盾/SIMKey的硬件认证，私钥永不离开设备</p>
        </div>
        <div class="feature-item">
          <el-icon :size="32" color="#67c23a"><Shield /></el-icon>
          <h3>去中心化身份</h3>
          <p>DID身份系统，完全掌控自己的数字身份</p>
        </div>
        <div class="feature-item">
          <el-icon :size="32" color="#e6a23c"><Connection /></el-icon>
          <h3>社区交流</h3>
          <p>与全球用户分享经验，共建去中心化生态</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage } from 'element-plus'
import {
  Key, Lock, CreditCard, QuestionFilled, Shield, Connection
} from '@element-plus/icons-vue'

const router = useRouter()
const route = useRoute()
const userStore = useUserStore()

const loginType = ref('ukey')
const loading = ref(false)

// U盾登录表单
const ukeyFormRef = ref()
const ukeyForm = reactive({
  deviceId: '',
  pin: ''
})

const ukeyRules = {
  deviceId: [
    { required: true, message: '请输入U盾设备ID', trigger: 'blur' }
  ],
  pin: [
    { required: true, message: '请输入PIN码', trigger: 'blur' },
    { min: 4, max: 16, message: 'PIN码长度为4-16位', trigger: 'blur' }
  ]
}

// SIMKey登录表单
const simkeyFormRef = ref()
const simkeyForm = reactive({
  simId: '',
  pin: ''
})

const simkeyRules = {
  simId: [
    { required: true, message: '请输入SIM卡ID', trigger: 'blur' }
  ],
  pin: [
    { required: true, message: '请输入PIN码', trigger: 'blur' },
    { min: 4, max: 16, message: 'PIN码长度为4-16位', trigger: 'blur' }
  ]
}

// U盾登录
const handleUKeyLogin = async () => {
  if (!ukeyFormRef.value) return

  await ukeyFormRef.value.validate(async (valid) => {
    if (!valid) return

    loading.value = true
    try {
      await userStore.loginUKey(ukeyForm.deviceId, ukeyForm.pin)
      ElMessage.success('登录成功')

      // 重定向到之前的页面或首页
      const redirect = route.query.redirect || '/'
      router.push(redirect)
    } catch (error) {
      ElMessage.error(error.message || '登录失败，请检查设备ID和PIN码')
    } finally {
      loading.value = false
    }
  })
}

// SIMKey登录
const handleSIMKeyLogin = async () => {
  if (!simkeyFormRef.value) return

  await simkeyFormRef.value.validate(async (valid) => {
    if (!valid) return

    loading.value = true
    try {
      await userStore.loginSIMKey(simkeyForm.simId, simkeyForm.pin)
      ElMessage.success('登录成功')

      // 重定向到之前的页面或首页
      const redirect = route.query.redirect || '/'
      router.push(redirect)
    } catch (error) {
      ElMessage.error(error.message || '登录失败，请检查SIM卡ID和PIN码')
    } finally {
      loading.value = false
    }
  })
}
</script>

<style scoped lang="scss">
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 20px;
}

.login-container {
  width: 100%;
  max-width: 1000px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40px;
  align-items: start;
}

.login-card {
  background: var(--el-bg-color);
  border-radius: 16px;
  padding: 40px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;

  .logo {
    width: 64px;
    height: 64px;
    margin-bottom: 16px;
  }

  h1 {
    margin: 0 0 8px;
    font-size: 28px;
    color: var(--el-text-color-primary);
  }

  .subtitle {
    margin: 0;
    color: var(--el-text-color-secondary);
    font-size: 14px;
  }
}

.login-tabs {
  :deep(.el-tabs__nav-wrap::after) {
    display: none;
  }

  :deep(.el-tabs__header) {
    margin-bottom: 32px;
  }

  :deep(.el-tabs__item) {
    font-size: 16px;
    font-weight: 500;
  }
}

.help-text {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px;
  background: var(--el-color-info-light-9);
  border-radius: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;

  .el-icon {
    flex-shrink: 0;
  }
}

.login-footer {
  margin-top: 32px;

  .el-divider {
    margin: 24px 0;
  }

  .footer-links {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    font-size: 13px;

    a {
      color: var(--el-color-primary);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }

    .divider {
      color: var(--el-text-color-disabled);
    }
  }
}

.features {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-top: 40px;
}

.feature-item {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 24px;
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.2);

  .el-icon {
    margin-bottom: 12px;
  }

  h3 {
    margin: 0 0 8px;
    font-size: 18px;
    font-weight: 600;
  }

  p {
    margin: 0;
    opacity: 0.9;
    font-size: 14px;
    line-height: 1.6;
  }
}

@media (max-width: 768px) {
  .login-container {
    grid-template-columns: 1fr;
  }

  .login-card {
    padding: 24px;
  }

  .features {
    order: -1;
    padding-top: 0;
  }
}
</style>
