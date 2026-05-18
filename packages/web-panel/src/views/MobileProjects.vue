<template>
  <div class="mobile-projects-placeholder">
    <a-card>
      <a-empty :description="false">
        <template #image>
          <MobileOutlined :style="{ fontSize: '64px', color: '#bfbfbf' }" />
        </template>
        <h2 class="title">{{ t('mobileProjects.title') }}</h2>
        <p class="subtitle">{{ t('mobileProjects.subtitle') }}</p>
        <a-alert
          :message="t('mobileProjects.v02Banner')"
          type="info"
          show-icon
          class="banner"
        />
        <div class="explainer">
          <h3>{{ t('mobileProjects.currentDirection') }}</h3>
          <p>{{ t('mobileProjects.currentDirectionBody') }}</p>
          <ul>
            <li>{{ t('mobileProjects.stepPhone') }}</li>
            <li>{{ t('mobileProjects.stepTap') }}</li>
            <li>{{ t('mobileProjects.stepPull') }}</li>
          </ul>
          <h3>{{ t('mobileProjects.reverseDirection') }}</h3>
          <p>{{ t('mobileProjects.reverseDirectionBody') }}</p>
        </div>
        <a-space class="actions">
          <a-button type="primary" @click="goToProjects">
            <FolderOutlined /> {{ t('mobileProjects.viewLocalProjects') }}
          </a-button>
          <a-button @click="goToMobileBridge">
            <MobileOutlined /> {{ t('mobileProjects.checkBridge') }}
          </a-button>
        </a-space>
      </a-empty>
    </a-card>
  </div>
</template>

<script setup>
/**
 * MobileProjects placeholder view — Sub-phase 10 PC web-shell 入口（选项 C v0.1）。
 *
 * v0.1 显占位提示用户当前只支持 Android→PC 方向（手机端 RemoteProjectBrowser 拉 PC
 * 项目）；PC←Android 反向真功能 v0.2 落地后这个 view 重写为实际列表。
 *
 * 详见 docs/design/Android_Project_Remote_Terminal_Entry.md §6.10.4 + trap 7.18。
 */
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MobileOutlined, FolderOutlined } from '@ant-design/icons-vue'

const router = useRouter()
const { t } = useI18n()

function goToProjects() {
  router.push('/projects')
}

function goToMobileBridge() {
  router.push('/mobile-bridge')
}
</script>

<style scoped>
.mobile-projects-placeholder {
  padding: 32px;
  max-width: 720px;
  margin: 0 auto;
}
.title {
  margin-top: 16px;
  font-size: 24px;
  font-weight: 600;
}
.subtitle {
  color: rgba(0, 0, 0, 0.5);
  margin-bottom: 24px;
}
.banner {
  margin: 16px 0 24px;
  text-align: left;
}
.explainer {
  text-align: left;
  background: rgba(0, 0, 0, 0.02);
  padding: 16px;
  border-radius: 8px;
  margin: 16px 0;
}
.explainer h3 {
  font-size: 16px;
  margin: 12px 0 8px;
}
.explainer p {
  color: rgba(0, 0, 0, 0.7);
  margin: 4px 0;
}
.explainer ul {
  margin: 8px 0;
  padding-left: 24px;
}
.actions {
  margin-top: 16px;
}
</style>
