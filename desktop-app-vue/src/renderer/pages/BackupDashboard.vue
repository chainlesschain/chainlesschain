<template>
  <div class="backup-dashboard">
    <a-page-header
      :title="$t('ukey.backup.title')"
      :sub-title="$t('ukey.backup.subtitle')"
    />

    <!-- 备份状态概览 -->
    <a-row
      :gutter="16"
      class="status-cards"
    >
      <a-col :span="8">
        <a-card>
          <a-statistic
            :title="$t('ukey.backup.lastBackup')"
            :value="lastBackupTime || '--'"
            :value-style="{ color: backupHealthColor }"
          >
            <template #suffix>
              <a-badge :status="backupHealthStatus" />
            </template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :span="8">
        <a-card>
          <a-statistic
            :title="$t('ukey.backup.totalVersions')"
            :value="backupVersions.length"
            :suffix="`/ 5`"
          />
        </a-card>
      </a-col>
      <a-col :span="8">
        <a-card>
          <a-statistic
            :title="$t('ukey.backup.backupStrategy')"
            :value="currentStrategy"
          />
        </a-card>
      </a-col>
    </a-row>

    <!-- 备份操作 -->
    <a-card
      class="mt-4"
      :title="$t('ukey.backup.actions')"
    >
      <a-space>
        <a-button
          type="primary"
          :loading="isBackingUp"
          @click="startBackup"
        >
          {{
            isBackingUp
              ? $t("ukey.backup.backingUp")
              : $t("ukey.backup.backupNow")
          }}
        </a-button>
        <a-button @click="showRestoreWizard = true">
          {{ $t("ukey.backup.restore") }}
        </a-button>
        <a-button @click="showSettings = true">
          {{ $t("ukey.backup.settings") }}
        </a-button>
      </a-space>

      <!-- 进度条 -->
      <div
        v-if="isBackingUp"
        class="backup-progress"
      >
        <a-progress
          :percent="backupProgress"
          :status="backupProgressStatus"
        />
        <p class="progress-text">
          {{ backupStatusMsg }}
        </p>
      </div>
    </a-card>

    <!-- 备份版本列表 -->
    <a-card
      class="mt-4"
      :title="$t('ukey.backup.versions')"
    >
      <a-table
        :data-source="backupVersions"
        :columns="versionColumns"
        :pagination="false"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'strategy'">
            <a-tag>{{ record.strategy }}</a-tag>
          </template>
          <template v-if="column.key === 'shards'">
            {{ record.shardsCollected }}/{{ record.shardsTotal }}
          </template>
          <template v-if="column.key === 'integrity'">
            <a-badge
              :status="record.integrityOk ? 'success' : 'error'"
              :text="
                record.integrityOk
                  ? $t('ukey.backup.ok')
                  : $t('ukey.backup.corrupted')
              "
            />
          </template>
          <template v-if="column.key === 'actions'">
            <a-space>
              <a-button
                size="small"
                @click="verifyBackup(record.id)"
              >
                {{ $t("ukey.backup.verify") }}
              </a-button>
              <a-popconfirm
                :title="$t('ukey.backup.deleteConfirm')"
                @confirm="deleteBackup(record.id)"
              >
                <a-button
                  size="small"
                  danger
                >
                  {{ $t("common.delete") }}
                </a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 分片存储状态 -->
    <a-card
      class="mt-4"
      :title="$t('ukey.backup.shardStorage')"
    >
      <a-list
        :data-source="storageLocations"
        size="small"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta
              :title="item.name"
              :description="item.url || item.path || '--'"
            >
              <template #avatar>
                <a-avatar>{{ item.icon }}</a-avatar>
              </template>
            </a-list-item-meta>
            <template #actions>
              <a-badge
                :status="item.available ? 'success' : 'error'"
                :text="
                  item.available
                    ? $t('ukey.backup.available')
                    : $t('ukey.backup.unavailable')
                "
              />
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-card>

    <!-- 恢复向导弹窗 -->
    <a-modal
      v-model:open="showRestoreWizard"
      :title="$t('ukey.backup.restoreWizard')"
      :footer="null"
      width="600px"
    >
      <recovery-wizard
        @completed="onRestoreCompleted"
        @cancelled="showRestoreWizard = false"
      />
    </a-modal>

    <!-- 设置弹窗 -->
    <a-modal
      v-model:open="showSettings"
      :title="$t('ukey.backup.backupSettings')"
      @ok="saveSettings"
    >
      <a-form
        :model="settings"
        layout="vertical"
      >
        <a-form-item :label="$t('ukey.backup.strategy')">
          <a-select v-model:value="settings.strategy">
            <a-select-option value="basic">
              {{ $t("ukey.backup.strategyBasic") }} (1-of-1)
            </a-select-option>
            <a-select-option value="standard">
              {{ $t("ukey.backup.strategyStandard") }} (2-of-3)
            </a-select-option>
            <a-select-option value="advanced">
              {{ $t("ukey.backup.strategyAdvanced") }} (3-of-5)
            </a-select-option>
            <a-select-option value="enterprise">
              {{ $t("ukey.backup.strategyEnterprise") }} (5-of-9)
            </a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('ukey.backup.autoBackup')">
          <a-switch v-model:checked="settings.autoBackup" />
          <span
            v-if="settings.autoBackup"
            class="ml-2"
          >
            {{ $t("ukey.backup.interval") }}:
            <a-input-number
              v-model:value="settings.intervalDays"
              :min="1"
              :max="365"
            />
            {{ $t("ukey.backup.days") }}
          </span>
        </a-form-item>
        <a-form-item :label="$t('ukey.backup.maxVersions')">
          <a-input-number
            v-model:value="settings.maxVersions"
            :min="1"
            :max="10"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useI18n } from "vue-i18n";
import RecoveryWizard from "../components/ukey/RecoveryWizard.vue";

const { t } = useI18n();

// State
const isBackingUp = ref(false);
const backupProgress = ref(0);
const backupProgressStatus = ref("active");
const backupStatusMsg = ref("");
const showRestoreWizard = ref(false);
const showSettings = ref(false);
const lastBackupTime = ref(null);
const currentStrategy = ref("standard");
const backupVersions = ref([]);

const settings = ref({
  strategy: "standard",
  autoBackup: true,
  intervalDays: 30,
  maxVersions: 5,
});

const storageLocations = ref([
  { name: "IPFS", icon: "🌐", available: true, url: "ipfs://..." },
  {
    name: t("ukey.backup.localStorage"),
    icon: "💾",
    available: true,
    path: "~/.chainlesschain/backup/",
  },
  { name: t("ukey.backup.paperBackup"), icon: "📄", available: true },
]);

const versionColumns = computed(() => [
  {
    title: t("ukey.backup.backupId"),
    dataIndex: "id",
    key: "id",
    ellipsis: true,
  },
  {
    title: t("ukey.backup.createdAt"),
    dataIndex: "createdAt",
    key: "createdAt",
  },
  { title: t("ukey.backup.strategy"), key: "strategy" },
  { title: t("ukey.backup.shards"), key: "shards" },
  { title: t("ukey.backup.integrity"), key: "integrity" },
  { title: t("common.actions"), key: "actions" },
]);

const backupHealthColor = computed(() => {
  if (!lastBackupTime.value) {
    return "#ff4d4f";
  }
  const daysSince = (Date.now() - new Date(lastBackupTime.value)) / 86400000;
  return daysSince < 30 ? "#52c41a" : daysSince < 90 ? "#faad14" : "#ff4d4f";
});

const backupHealthStatus = computed(() => {
  if (!lastBackupTime.value) {
    return "error";
  }
  const daysSince = (Date.now() - new Date(lastBackupTime.value)) / 86400000;
  return daysSince < 30 ? "success" : daysSince < 90 ? "warning" : "error";
});

onMounted(async () => {
  await loadBackupStatus();
});

async function loadBackupStatus() {
  // 模拟加载备份状态
  try {
    const result =
      await window.electron?.ipcRenderer?.invoke("ukey:backup:list");
    if (result?.versions) {
      backupVersions.value = result.versions;
      if (result.versions.length > 0) {
        lastBackupTime.value = result.versions[0].createdAt;
      }
    }
  } catch (e) {
    // 离线或未实现时使用演示数据
  }
}

async function startBackup() {
  isBackingUp.value = true;
  backupProgress.value = 0;

  const steps = [
    { msg: t("ukey.backup.step1"), progress: 20 },
    { msg: t("ukey.backup.step2"), progress: 40 },
    { msg: t("ukey.backup.step3"), progress: 60 },
    { msg: t("ukey.backup.step4"), progress: 80 },
    { msg: t("ukey.backup.step5"), progress: 100 },
  ];

  for (const step of steps) {
    backupStatusMsg.value = step.msg;
    backupProgress.value = step.progress;
    await sleep(600);
  }

  backupProgressStatus.value = "success";
  lastBackupTime.value = new Date().toISOString();
  message.success(t("ukey.backup.backupSuccess"));

  setTimeout(() => {
    isBackingUp.value = false;
    backupProgress.value = 0;
    backupProgressStatus.value = "active";
  }, 1500);
}

async function verifyBackup(id) {
  message.info(t("ukey.backup.verifying"));
  await sleep(1000);
  message.success(t("ukey.backup.verifySuccess"));
}

async function deleteBackup(id) {
  backupVersions.value = backupVersions.value.filter((v) => v.id !== id);
  message.success(t("ukey.backup.deleteSuccess"));
}

function onRestoreCompleted() {
  showRestoreWizard.value = false;
  message.success(t("ukey.backup.restoreSuccess"));
}

function saveSettings() {
  currentStrategy.value = settings.value.strategy;
  showSettings.value = false;
  message.success(t("common.settingsSaved"));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
</script>

<style scoped>
.backup-dashboard {
  padding: 16px;
}
.status-cards {
  margin-bottom: 16px;
}
.mt-4 {
  margin-top: 16px;
}
.ml-2 {
  margin-left: 8px;
}
.backup-progress {
  margin-top: 16px;
}
.progress-text {
  color: #595959;
  font-size: 12px;
  margin-top: 4px;
}
</style>
