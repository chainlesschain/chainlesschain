<template>
  <div class="admin-settings">
    <div class="page-header">
      <h1>系统设置</h1>
    </div>

    <el-tabs v-model="activeTab" tab-position="left" class="settings-tabs">
      <!-- 基本设置 -->
      <el-tab-pane label="基本设置" name="basic">
        <el-card>
          <template #header>
            <span>基本设置</span>
          </template>
          <el-form :model="basicForm" label-width="150px">
            <el-form-item label="网站名称">
              <el-input v-model="basicForm.siteName" placeholder="请输入网站名称" />
            </el-form-item>
            <el-form-item label="网站描述">
              <el-input
                v-model="basicForm.siteDescription"
                type="textarea"
                :rows="3"
                placeholder="请输入网站描述"
              />
            </el-form-item>
            <el-form-item label="网站Logo">
              <el-upload
                class="logo-uploader"
                action="#"
                :show-file-list="false"
                :on-success="handleLogoUpload"
              >
                <img v-if="basicForm.siteLogo" :src="basicForm.siteLogo" class="logo" />
                <el-icon v-else class="logo-uploader-icon"><Plus /></el-icon>
              </el-upload>
            </el-form-item>
            <el-form-item label="网站域名">
              <el-input v-model="basicForm.siteDomain" placeholder="https://chainlesschain.com" />
            </el-form-item>
            <el-form-item label="联系邮箱">
              <el-input v-model="basicForm.contactEmail" placeholder="admin@chainlesschain.com" />
            </el-form-item>
            <el-form-item label="ICP备案号">
              <el-input v-model="basicForm.icpNumber" placeholder="京ICP备xxxxx号" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveBasicSettings">保存设置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- 用户设置 -->
      <el-tab-pane label="用户设置" name="user">
        <el-card>
          <template #header>
            <span>用户设置</span>
          </template>
          <el-form :model="userForm" label-width="200px">
            <el-form-item label="允许新用户注册">
              <el-switch v-model="userForm.allowRegister" />
            </el-form-item>
            <el-form-item label="新用户需要审核">
              <el-switch v-model="userForm.requireApproval" />
            </el-form-item>
            <el-form-item label="默认用户角色">
              <el-radio-group v-model="userForm.defaultRole">
                <el-radio label="USER">普通用户</el-radio>
                <el-radio label="ADMIN">管理员</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="用户名最小长度">
              <el-input-number v-model="userForm.usernameMinLength" :min="2" :max="20" />
            </el-form-item>
            <el-form-item label="用户名最大长度">
              <el-input-number v-model="userForm.usernameMaxLength" :min="2" :max="50" />
            </el-form-item>
            <el-form-item label="每日发帖限制">
              <el-input-number v-model="userForm.dailyPostLimit" :min="0" :max="100" />
              <span style="margin-left: 12px; font-size: 12px; color: var(--el-text-color-secondary)">
                0表示不限制
              </span>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveUserSettings">保存设置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- 内容设置 -->
      <el-tab-pane label="内容设置" name="content">
        <el-card>
          <template #header>
            <span>内容设置</span>
          </template>
          <el-form :model="contentForm" label-width="200px">
            <el-form-item label="新帖子需要审核">
              <el-switch v-model="contentForm.requirePostApproval" />
            </el-form-item>
            <el-form-item label="新回复需要审核">
              <el-switch v-model="contentForm.requireReplyApproval" />
            </el-form-item>
            <el-form-item label="标题最小长度">
              <el-input-number v-model="contentForm.titleMinLength" :min="5" :max="100" />
            </el-form-item>
            <el-form-item label="标题最大长度">
              <el-input-number v-model="contentForm.titleMaxLength" :min="10" :max="200" />
            </el-form-item>
            <el-form-item label="内容最小长度">
              <el-input-number v-model="contentForm.contentMinLength" :min="10" :max="1000" />
            </el-form-item>
            <el-form-item label="允许匿名发帖">
              <el-switch v-model="contentForm.allowAnonymous" />
            </el-form-item>
            <el-form-item label="允许上传图片">
              <el-switch v-model="contentForm.allowImageUpload" />
            </el-form-item>
            <el-form-item label="图片大小限制（MB）">
              <el-input-number v-model="contentForm.imageMaxSize" :min="1" :max="10" />
            </el-form-item>
            <el-form-item label="敏感词过滤">
              <el-input
                v-model="contentForm.sensitiveWords"
                type="textarea"
                :rows="4"
                placeholder="一行一个敏感词"
              />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveContentSettings">保存设置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- 邮件设置 -->
      <el-tab-pane label="邮件设置" name="email">
        <el-card>
          <template #header>
            <span>邮件设置</span>
          </template>
          <el-form :model="emailForm" label-width="150px">
            <el-form-item label="启用邮件">
              <el-switch v-model="emailForm.enabled" />
            </el-form-item>
            <el-form-item label="SMTP服务器">
              <el-input v-model="emailForm.smtpHost" placeholder="smtp.example.com" />
            </el-form-item>
            <el-form-item label="SMTP端口">
              <el-input-number v-model="emailForm.smtpPort" :min="1" :max="65535" />
            </el-form-item>
            <el-form-item label="发件人邮箱">
              <el-input v-model="emailForm.fromEmail" placeholder="noreply@chainlesschain.com" />
            </el-form-item>
            <el-form-item label="发件人名称">
              <el-input v-model="emailForm.fromName" placeholder="ChainlessChain社区" />
            </el-form-item>
            <el-form-item label="邮箱用户名">
              <el-input v-model="emailForm.username" />
            </el-form-item>
            <el-form-item label="邮箱密码">
              <el-input v-model="emailForm.password" type="password" show-password />
            </el-form-item>
            <el-form-item label="使用SSL">
              <el-switch v-model="emailForm.useSSL" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveEmailSettings">保存设置</el-button>
              <el-button @click="testEmail">发送测试邮件</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- 安全设置 -->
      <el-tab-pane label="安全设置" name="security">
        <el-card>
          <template #header>
            <span>安全设置</span>
          </template>
          <el-form :model="securityForm" label-width="200px">
            <el-form-item label="启用验证码">
              <el-switch v-model="securityForm.enableCaptcha" />
            </el-form-item>
            <el-form-item label="登录失败次数限制">
              <el-input-number v-model="securityForm.maxLoginAttempts" :min="3" :max="10" />
            </el-form-item>
            <el-form-item label="锁定时长（分钟）">
              <el-input-number v-model="securityForm.lockoutDuration" :min="5" :max="60" />
            </el-form-item>
            <el-form-item label="会话超时（分钟）">
              <el-input-number v-model="securityForm.sessionTimeout" :min="10" :max="1440" />
            </el-form-item>
            <el-form-item label="启用IP黑名单">
              <el-switch v-model="securityForm.enableIpBlacklist" />
            </el-form-item>
            <el-form-item label="IP黑名单">
              <el-input
                v-model="securityForm.ipBlacklist"
                type="textarea"
                :rows="4"
                placeholder="一行一个IP地址"
              />
            </el-form-item>
            <el-form-item label="启用防SQL注入">
              <el-switch v-model="securityForm.enableSqlInjectionProtection" />
            </el-form-item>
            <el-form-item label="启用防XSS攻击">
              <el-switch v-model="securityForm.enableXssProtection" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveSecuritySettings">保存设置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <!-- 缓存设置 -->
      <el-tab-pane label="缓存设置" name="cache">
        <el-card>
          <template #header>
            <span>缓存设置</span>
          </template>
          <el-form :model="cacheForm" label-width="200px">
            <el-form-item label="启用缓存">
              <el-switch v-model="cacheForm.enabled" />
            </el-form-item>
            <el-form-item label="缓存类型">
              <el-radio-group v-model="cacheForm.type">
                <el-radio label="memory">内存缓存</el-radio>
                <el-radio label="redis">Redis</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item v-if="cacheForm.type === 'redis'" label="Redis地址">
              <el-input v-model="cacheForm.redisHost" placeholder="localhost:6379" />
            </el-form-item>
            <el-form-item v-if="cacheForm.type === 'redis'" label="Redis密码">
              <el-input v-model="cacheForm.redisPassword" type="password" show-password />
            </el-form-item>
            <el-form-item label="缓存过期时间（秒）">
              <el-input-number v-model="cacheForm.ttl" :min="60" :max="86400" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveCacheSettings">保存设置</el-button>
              <el-button type="danger" @click="clearCache">清空缓存</el-button>
            </el-form-item>
          </el-form>

          <el-divider />

          <div class="cache-stats">
            <h4>缓存统计</h4>
            <el-descriptions :column="2" border>
              <el-descriptions-item label="缓存命中率">85.6%</el-descriptions-item>
              <el-descriptions-item label="缓存大小">128 MB</el-descriptions-item>
              <el-descriptions-item label="缓存条目">1,234</el-descriptions-item>
              <el-descriptions-item label="最后清理时间">2 小时前</el-descriptions-item>
            </el-descriptions>
          </div>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'

const activeTab = ref('basic')

// 基本设置
const basicForm = reactive({
  siteName: 'ChainlessChain社区',
  siteDescription: '去中心化AI生态社区',
  siteLogo: '',
  siteDomain: 'https://chainlesschain.com',
  contactEmail: 'admin@chainlesschain.com',
  icpNumber: ''
})

// 用户设置
const userForm = reactive({
  allowRegister: true,
  requireApproval: false,
  defaultRole: 'USER',
  usernameMinLength: 3,
  usernameMaxLength: 20,
  dailyPostLimit: 10
})

// 内容设置
const contentForm = reactive({
  requirePostApproval: false,
  requireReplyApproval: false,
  titleMinLength: 5,
  titleMaxLength: 100,
  contentMinLength: 10,
  allowAnonymous: false,
  allowImageUpload: true,
  imageMaxSize: 5,
  sensitiveWords: ''
})

// 邮件设置
const emailForm = reactive({
  enabled: false,
  smtpHost: '',
  smtpPort: 587,
  fromEmail: '',
  fromName: '',
  username: '',
  password: '',
  useSSL: true
})

// 安全设置
const securityForm = reactive({
  enableCaptcha: true,
  maxLoginAttempts: 5,
  lockoutDuration: 15,
  sessionTimeout: 30,
  enableIpBlacklist: false,
  ipBlacklist: '',
  enableSqlInjectionProtection: true,
  enableXssProtection: true
})

// 缓存设置
const cacheForm = reactive({
  enabled: true,
  type: 'memory',
  redisHost: 'localhost:6379',
  redisPassword: '',
  ttl: 3600
})

// Logo上传
const handleLogoUpload = (response) => {
  basicForm.siteLogo = response.url
  ElMessage.success('Logo上传成功')
}

// 保存基本设置
const saveBasicSettings = () => {
  // 这里应该调用API
  ElMessage.success('基本设置已保存')
}

// 保存用户设置
const saveUserSettings = () => {
  // 这里应该调用API
  ElMessage.success('用户设置已保存')
}

// 保存内容设置
const saveContentSettings = () => {
  // 这里应该调用API
  ElMessage.success('内容设置已保存')
}

// 保存邮件设置
const saveEmailSettings = () => {
  // 这里应该调用API
  ElMessage.success('邮件设置已保存')
}

// 测试邮件
const testEmail = () => {
  // 这里应该调用API
  ElMessage.success('测试邮件已发送')
}

// 保存安全设置
const saveSecuritySettings = () => {
  // 这里应该调用API
  ElMessage.success('安全设置已保存')
}

// 保存缓存设置
const saveCacheSettings = () => {
  // 这里应该调用API
  ElMessage.success('缓存设置已保存')
}

// 清空缓存
const clearCache = () => {
  // 这里应该调用API
  ElMessage.success('缓存已清空')
}
</script>

<style scoped lang="scss">
.admin-settings {
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
    padding: 0;
  }

  .el-card {
    margin-bottom: 24px;
  }
}

.logo-uploader {
  :deep(.el-upload) {
    border: 1px dashed var(--el-border-color);
    border-radius: 6px;
    cursor: pointer;
    position: relative;
    overflow: hidden;
    transition: var(--el-transition-duration-fast);

    &:hover {
      border-color: var(--el-color-primary);
    }
  }

  .logo {
    width: 178px;
    height: 178px;
    display: block;
  }

  .logo-uploader-icon {
    font-size: 28px;
    color: #8c939d;
    width: 178px;
    height: 178px;
    text-align: center;
    line-height: 178px;
  }
}

.cache-stats {
  padding: 16px 0;

  h4 {
    margin: 0 0 16px;
    font-size: 16px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }
}

@media (max-width: 768px) {
  .admin-settings {
    padding: 16px;
  }

  .page-header {
    h1 {
      font-size: 22px;
    }
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
