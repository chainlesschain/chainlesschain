<template>
  <div>
    <div class="page-head">
      <div>
        <h2 class="page-title">Skill 自进化配置</h2>
        <p class="page-sub">统一配置受治理部署；CLI、IDE 插件与 cc ui 共享。</p>
      </div>
      <a-button :loading="loading" @click="loadStatus">
        <template #icon><ReloadOutlined /></template>刷新
      </a-button>
    </div>

    <a-alert
      message="不会开启自动发布"
      description="此开关只启用经过签名的 Skill 自进化运行时。候选项进入 active 前仍需人工审核，自动发布始终保持 HOLD。"
      type="warning"
      show-icon
      class="notice"
    />

    <a-row :gutter="16">
      <a-col :xs="24" :xl="15">
        <a-card title="签名部署" class="panel-card">
          <a-form layout="vertical">
            <a-form-item label="签名部署描述符">
              <a-input
                v-model:value="descriptorPath"
                :disabled="busy"
                placeholder="deployment descriptor JSON 的服务器绝对路径"
              />
              <template #extra
                >Web 页面不能读取本机文件选择器，请填写运行 cc ui
                的机器上的绝对路径。</template
              >
            </a-form-item>
            <a-form-item label="Ed25519 信任根公钥">
              <a-input
                v-model:value="trustRootPath"
                :disabled="busy"
                placeholder="信任根 public key 的服务器绝对路径"
              />
            </a-form-item>
            <a-space>
              <a-button type="primary" :loading="saving" @click="save"
                >校验、保存并启用</a-button
              >
              <a-button
                :danger="status.profileEnabled"
                :disabled="!status.descriptorPath"
                :loading="toggling"
                @click="toggle"
              >
                {{ status.profileEnabled ? "停用" : "启用" }}
              </a-button>
            </a-space>
          </a-form>
        </a-card>
      </a-col>
      <a-col :xs="24" :xl="9">
        <a-card title="治理状态" class="panel-card status-card">
          <a-descriptions :column="1" size="small">
            <a-descriptions-item label="生效状态"
              ><a-tag :color="status.effectiveEnabled ? 'green' : 'default'">{{
                status.effectiveEnabled ? "已启用" : "未启用"
              }}</a-tag></a-descriptions-item
            >
            <a-descriptions-item label="生效来源">{{
              status.source || "none"
            }}</a-descriptions-item>
            <a-descriptions-item label="签名校验"
              ><a-tag :color="status.verified ? 'green' : 'red'">{{
                status.verified ? "已通过" : "未通过"
              }}</a-tag></a-descriptions-item
            >
            <a-descriptions-item label="自动发布"
              ><a-tag color="orange">HOLD</a-tag></a-descriptions-item
            >
            <a-descriptions-item label="配置文件"
              ><span class="mono">{{
                status.profilePath || "—"
              }}</span></a-descriptions-item
            >
            <a-descriptions-item label="允许命令"
              ><span class="mono">{{
                (status.commands || []).join(", ") || "—"
              }}</span></a-descriptions-item
            >
          </a-descriptions>
          <section class="admission-status" aria-live="polite">
            <h3>模型命令部署准入</h3>
            <p>这里只检查部署准入，实际任务运行尚未验证。</p>
            <div
              v-for="row in readinessRows"
              :key="row.command"
              :data-admission-command="row.command"
            >
              <strong>{{ row.command }}：{{ row.summary }}</strong>
              <p class="mono">{{ row.detail }}</p>
              <p v-if="row.remediation" class="mono">{{ row.remediation }}</p>
            </div>
          </section>
          <a-alert
            v-if="status.error"
            :message="status.error"
            type="error"
            show-icon
            class="error"
          />
        </a-card>
      </a-col>
    </a-row>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ReloadOutlined } from "@ant-design/icons-vue";
import { message } from "ant-design-vue";
import { useWsStore } from "../stores/ws.js";
import {
  deploymentReadinessRows,
  replaceDeploymentStatus,
} from "../utils/evolution-deployment-readiness.js";

const ws = useWsStore();
const loading = ref(false);
const saving = ref(false);
const toggling = ref(false);
const descriptorPath = ref("");
const trustRootPath = ref("");
const status = reactive({
  source: "none",
  effectiveEnabled: false,
  profileEnabled: false,
  verified: false,
  commands: [],
});
const busy = computed(() => loading.value || saving.value || toggling.value);
const readinessRows = computed(() => deploymentReadinessRows(status));

function apply(value) {
  replaceDeploymentStatus(status, value);
  descriptorPath.value = status.descriptorPath || "";
  trustRootPath.value = status.trustRootPath || "";
}

async function request(frame, timeout = 30000) {
  await ws.waitConnected(8000);
  const reply = await ws.sendRaw(frame, timeout);
  return reply.result;
}

async function loadStatus() {
  loading.value = true;
  try {
    apply(await request({ type: "evolution.deployment.status" }));
  } catch (error) {
    message.error("读取配置失败：" + error.message);
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!descriptorPath.value.trim() || !trustRootPath.value.trim()) {
    message.warning("请填写描述符和信任根公钥的绝对路径");
    return;
  }
  saving.value = true;
  try {
    apply(
      await request(
        {
          type: "evolution.deployment.configure",
          descriptorPath: descriptorPath.value.trim(),
          trustRootPath: trustRootPath.value.trim(),
        },
        60000,
      ),
    );
    message.success("签名校验通过，配置已保存并启用；自动发布仍为 HOLD");
  } catch (error) {
    message.error("配置失败：" + error.message);
  } finally {
    saving.value = false;
  }
}

async function toggle() {
  toggling.value = true;
  try {
    apply(
      await request({
        type: "evolution.deployment.set-enabled",
        enabled: !status.profileEnabled,
      }),
    );
    message.success(status.profileEnabled ? "已启用" : "已停用");
  } catch (error) {
    message.error("更新失败：" + error.message);
  } finally {
    toggling.value = false;
  }
}

onMounted(loadStatus);
</script>

<style scoped>
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.notice {
  margin-bottom: 16px;
}
.panel-card {
  height: 100%;
  background: var(--bg-card);
  border-color: var(--border-color);
}
.status-card {
  min-height: 318px;
}
.mono {
  font-family: var(--font-mono, monospace);
  overflow-wrap: anywhere;
}
.error {
  margin-top: 16px;
}
</style>
