<template>
  <a-drawer
    :open="open"
    title="添加 WeChat 账号"
    placement="right"
    :width="640"
    :destroy-on-close="true"
    @update:open="(v) => emit('update:open', v)"
    @close="resetWizard"
  >
    <a-alert
      :message="`第 ${step} / 3 步`"
      :description="stepDescription"
      type="info"
      show-icon
      style="margin-bottom: 16px;"
    />

    <!-- ─── Step 1 — Env probe ──────────────────────────────────────── -->
    <div v-if="step === 1">
      <p class="hint">
        请用 USB 连接 Android 设备（开启 USB 调试）。WeChat ≥ 8.0 需要 root + frida-server。
        探测仅读取 <code>adb shell</code> 命令输出，不写入任何东西。
      </p>

      <a-button type="primary" :loading="loading.probe" @click="runProbe" style="margin-bottom: 12px;">
        🔍 探测环境
      </a-button>

      <div v-if="probe" class="probe-result">
        <a-descriptions :column="1" size="small" bordered>
          <a-descriptions-item label="suggestedKeyProvider">
            <a-tag :color="probe.suggestedKeyProvider === 'unsupported' ? 'red' : 'green'">
              {{ probe.suggestedKeyProvider }}
            </a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="adb 设备">
            <a-tag :color="probe.device.reachable ? 'green' : 'red'">
              {{ probe.device.reachable ? '已连接' : '未连接' }}
            </a-tag>
            <span v-if="probe.device.serial" class="kv"> {{ probe.device.serial }} · abi={{ probe.device.abi || '?' }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="root">
            <a-tag :color="probe.root.detected ? 'green' : 'default'">
              {{ probe.root.detected ? '已 root' : '未 root' }}
            </a-tag>
            <a-tag v-if="probe.root.magiskInstalled" color="blue">Magisk</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="frida-server">
            <a-tag :color="probe.frida.serverRunning ? 'green' : 'default'">
              {{ probe.frida.serverRunning ? '运行中' : '未运行' }}
            </a-tag>
            <span v-if="probe.frida.port" class="kv"> :{{ probe.frida.port }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="WeChat">
            <a-tag :color="probe.wechat.installed ? 'green' : 'red'">
              {{ probe.wechat.installed ? probe.wechat.versionName : '未安装' }}
            </a-tag>
          </a-descriptions-item>
        </a-descriptions>
        <a-alert
          v-for="reason in probe.reasons || []"
          :key="reason"
          :message="reason"
          type="info"
          show-icon
          style="margin-top: 8px;"
        />
        <a-alert
          v-for="w in probe.warnings || []"
          :key="w"
          :message="w"
          type="warning"
          show-icon
          style="margin-top: 8px;"
        />
      </div>
    </div>

    <!-- ─── Step 2 — Account form ────────────────────────────────────── -->
    <div v-if="step === 2">
      <p class="hint">
        填写从 adb pull 拉下来的本地路径。MD5 路径（7.x）需要 <code>wechatDataPath</code>；
        Frida 路径（8.0+）需要设备运行 frida-server。
      </p>
      <a-form layout="vertical">
        <a-form-item label="UIN / wxid" required>
          <a-input v-model:value="form.uin" placeholder="WeChat 数字 UIN 或 wxid" />
        </a-form-item>
        <a-form-item label="dbPath（已拉下的 EnMicroMsg.db 本地路径）">
          <a-input v-model:value="form.dbPath" placeholder="C:\\users\\me\\pull\\EnMicroMsg.db" />
        </a-form-item>
        <a-form-item label="wechatDataPath（已拉下的 /data/data/com.tencent.mm/ 目录）">
          <a-input v-model:value="form.wechatDataPath" placeholder="C:\\users\\me\\pull\\com.tencent.mm" />
          <div class="hint">MD5 路径必填；Frida 路径可空</div>
        </a-form-item>
        <a-form-item label="强制 keyProvider（覆盖 env-probe 建议）">
          <a-radio-group v-model:value="form.forceProvider">
            <a-radio :value="null">自动（推荐）</a-radio>
            <a-radio value="md5">md5</a-radio>
            <a-radio value="frida">frida</a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </div>

    <!-- ─── Step 3 — Result ────────────────────────────────────────── -->
    <div v-if="step === 3">
      <a-result
        v-if="registerResult?.ok"
        status="success"
        :title="`WeChat 已接入 (uin=${form.uin})`"
        :sub-title="`provider=${registerResult.chosenKeyProvider} · sensitivity=${registerResult.sensitivity}`"
      >
        <template #extra>
          <a-button type="primary" @click="resetWizard">完成</a-button>
          <a-button @click="restartFlow">再加一个</a-button>
        </template>
      </a-result>
      <a-result
        v-else
        status="error"
        :title="`接入失败`"
        :sub-title="registerFailMessage"
      >
        <template v-if="registerResult?.probe?.reasons?.length" #extra>
          <a-button @click="step = 1">返回检查环境</a-button>
          <a-button @click="step = 2">返回修改路径</a-button>
        </template>
      </a-result>
      <div v-if="registerResult?.probe?.reasons?.length" style="margin-top: 12px;">
        <a-alert
          v-for="reason in registerResult.probe.reasons"
          :key="reason"
          :message="reason"
          type="warning"
          show-icon
          style="margin-bottom: 4px;"
        />
      </div>
    </div>

    <template #footer>
      <a-space style="float: right;">
        <a-button v-if="step > 1 && step < 3" @click="step = step - 1">上一步</a-button>
        <a-button @click="resetWizard">取消</a-button>

        <a-button
          v-if="step === 1"
          type="primary"
          :disabled="!probe || probe.suggestedKeyProvider === 'unsupported'"
          @click="step = 2"
        >
          下一步
        </a-button>

        <a-button
          v-if="step === 2"
          type="primary"
          :loading="loading.register"
          :disabled="!form.uin || (probe?.suggestedKeyProvider === 'md5' && !form.wechatDataPath)"
          @click="runRegister"
        >
          注册
        </a-button>
      </a-space>
    </template>
  </a-drawer>
</template>

<script setup>
import { ref, reactive, computed, watch } from "vue";
import { usePersonalDataHub } from "../composables/usePersonalDataHub.js";

const props = defineProps({
  open: { type: Boolean, default: false },
});

const emit = defineEmits(["update:open", "registered"]);

const hub = usePersonalDataHub();

const step = ref(1);
const probe = ref(null);
const form = reactive({
  uin: "",
  dbPath: "",
  wechatDataPath: "",
  forceProvider: null,
});
const registerResult = ref(null);
const loading = reactive({ probe: false, register: false });

const stepDescription = computed(() => {
  if (step.value === 1) return "探测设备 + WeChat 版本，确认可用的 keyProvider";
  if (step.value === 2) return "填 UIN 与已 adb-pull 的本地路径";
  return "bootstrap 注册 + 持久化 wechat-accounts.json";
});

const registerFailMessage = computed(() => {
  const r = registerResult.value;
  if (!r) return "未知错误";
  if (r.reason === "ENV_UNSUPPORTED") return r.message || "env-probe 拒绝 — 请回到第 1 步看 reasons";
  if (r.reason === "MD5_NEEDS_WECHAT_DATA_PATH") return "MD5 路径需要 wechatDataPath";
  if (r.reason === "FRIDA_NEEDS_WXID") return "Frida 路径需要 account.uin / wxid";
  if (r.reason === "ADAPTER_CTOR_FAILED") return `Adapter ctor 抛错: ${r.message || ''}`;
  if (r.reason === "BOOTSTRAP_THREW") return `Bootstrap 抛错: ${r.message || ''}`;
  if (r.reason === "UIN_REQUIRED") return "UIN 不能为空";
  return r.message || r.reason || "注册失败";
});

async function runProbe() {
  loading.probe = true;
  try {
    probe.value = await hub.probeWechatEnv();
  } catch (err) {
    probe.value = {
      ok: false,
      suggestedKeyProvider: "unsupported",
      reasons: [err?.message || "probe failed"],
      device: { reachable: false },
      root: { detected: false, magiskInstalled: false },
      frida: { serverRunning: false, port: null },
      wechat: { installed: false, versionName: null, majorVersion: null },
      warnings: [],
    };
  } finally {
    loading.probe = false;
  }
}

async function runRegister() {
  loading.register = true;
  try {
    registerResult.value = await hub.registerWechat({
      account: { uin: form.uin },
      dbPath: form.dbPath || null,
      wechatDataPath: form.wechatDataPath || null,
      keyProviderOverride: form.forceProvider,
    });
    step.value = 3;
    if (registerResult.value?.ok) {
      emit("registered", { uin: form.uin, chosenKeyProvider: registerResult.value.chosenKeyProvider });
    }
  } catch (err) {
    registerResult.value = { ok: false, reason: "BOOTSTRAP_THREW", message: err?.message || "RPC failed" };
    step.value = 3;
  } finally {
    loading.register = false;
  }
}

function restartFlow() {
  step.value = 1;
  probe.value = null;
  form.uin = "";
  form.dbPath = "";
  form.wechatDataPath = "";
  form.forceProvider = null;
  registerResult.value = null;
}

function resetWizard() {
  restartFlow();
  emit("update:open", false);
}

watch(
  () => props.open,
  (v) => {
    if (v) restartFlow();
  },
);
</script>

<style scoped>
.hint {
  font-size: 12px;
  color: var(--text-color-secondary, #888);
}
.kv {
  font-size: 12px;
  color: var(--text-color-secondary, #888);
}
.probe-result {
  margin-top: 8px;
}
code {
  background: #f0f0f0;
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 12px;
}
</style>
