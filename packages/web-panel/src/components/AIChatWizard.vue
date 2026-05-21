<template>
  <a-drawer
    :open="open"
    title="添加 AI 对话账号"
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

    <!-- ─── Step 1 — Vendor picker ─────────────────────────────────── -->
    <div v-if="step === 1">
      <p class="hint">
        选择要接入的 AI 服务商。登录后将本地读取 cookie 同步对话历史；cookie 仅落本机加密文件，不上传任何云端。
      </p>
      <a-row :gutter="[12, 12]">
        <a-col :xs="24" :sm="12" :md="8" v-for="v in vendors" :key="v.vendor">
          <a-card
            size="small"
            hoverable
            :class="['vendor-card', { selected: selectedVendor === v.vendor }]"
            @click="pickVendor(v.vendor)"
          >
            <div class="vendor-head">
              <strong>{{ v.displayName }}</strong>
              <a-tag v-if="isRegistered(v.vendor)" color="green">已接入</a-tag>
            </div>
            <div class="hint">{{ v.notes }}</div>
            <div class="hint" style="margin-top: 4px;">
              <a-tag color="default">{{ v.requiredCookies.length }} 必需 cookie</a-tag>
              <a-tag color="default">过期约 {{ v.cookieMaxAgeHintDays }} 天</a-tag>
            </div>
          </a-card>
        </a-col>
      </a-row>
    </div>

    <!-- ─── Step 2 — Cookie capture ───────────────────────────────── -->
    <div v-if="step === 2 && openResult">
      <p class="hint">
        <strong>{{ currentVendorMeta.displayName }}</strong> ·
        <a :href="openResult.loginUrl" target="_blank" rel="noopener noreferrer">{{ openResult.loginUrl }}</a>
      </p>

      <a-alert
        v-if="openResult.fallbackMode === 'paste'"
        :message="openResult.helpText || '请在外部浏览器登录后从开发者工具复制全部 cookie 字符串粘贴到下方。'"
        type="warning"
        show-icon
        style="margin-bottom: 12px;"
      />
      <a-alert
        v-else
        message="桌面端：请在弹出的内嵌浏览器窗口登录后点击 “检测 cookie”。"
        type="info"
        show-icon
        style="margin-bottom: 12px;"
      />

      <a-collapse v-if="openResult.fallbackMode === 'paste'" :bordered="false" style="margin-bottom: 12px;">
        <a-collapse-panel key="howto" header="如何获取 cookie 字符串？">
          <ol class="howto">
            <li>用 Chrome / Edge 打开 <a :href="openResult.loginUrl" target="_blank">{{ openResult.loginUrl }}</a></li>
            <li>完成登录，进入对话页</li>
            <li>按 <kbd>F12</kbd> 打开开发者工具 → <strong>Application</strong> → <strong>Cookies</strong></li>
            <li>选中域名 → 全选所有 cookie 行 → 用扩展（如 EditThisCookie）导出 “name=value; …” 串</li>
            <li>或在 Console 执行 <code>document.cookie</code> 复制结果（注意：HTTP-Only cookie 取不到，仍需 Application 面板）</li>
            <li>粘贴到下方文本框，点 “检测 cookie”</li>
          </ol>
        </a-collapse-panel>
      </a-collapse>

      <a-form layout="vertical">
        <a-form-item label="Cookie 字符串">
          <a-textarea
            v-model:value="cookieHeader"
            :rows="6"
            placeholder="name1=value1; name2=value2; name3=value3 …"
            autocomplete="off"
          />
        </a-form-item>
      </a-form>

      <div v-if="probeResult" style="margin-top: 8px;">
        <a-alert
          v-if="probeResult.ok"
          type="success"
          show-icon
          :message="`已识别 ${probeResult.foundRequired.length} 个必需 cookie + ${probeResult.foundOptional.length} 个可选 cookie`"
        />
        <a-alert
          v-else
          type="error"
          show-icon
          :message="probeFailMessage"
        />
        <div v-if="probeResult.foundRequired?.length" class="kv" style="margin-top: 4px;">
          ✓ {{ probeResult.foundRequired.join(', ') }}
        </div>
        <div v-if="probeResult.missingRequired?.length" class="kv" style="margin-top: 4px; color: #ff4d4f;">
          缺失: {{ probeResult.missingRequired.join(', ') }}
        </div>
      </div>
    </div>

    <!-- ─── Step 3 — Result ───────────────────────────────────────── -->
    <div v-if="step === 3">
      <a-result
        v-if="registerResult?.ok"
        status="success"
        :title="`${currentVendorMeta.displayName} 已接入`"
        :sub-title="`accountId: ${registerResult.accountId} · userId: ${registerResult.validation?.userId || '匿名'}`"
      >
        <template #extra>
          <a-button type="primary" @click="resetWizard">完成</a-button>
          <a-button @click="restartFlow">再加一家</a-button>
        </template>
      </a-result>
      <a-result
        v-else
        status="error"
        :title="`接入失败`"
        :sub-title="registerFailMessage"
      >
        <template #extra>
          <a-button type="primary" @click="step = 2">返回粘贴 cookie</a-button>
          <a-button @click="restartFlow">选其他厂商</a-button>
        </template>
      </a-result>
    </div>

    <template #footer>
      <a-space style="float: right;">
        <a-button v-if="step > 1 && step < 3" @click="step = step - 1">上一步</a-button>
        <a-button @click="resetWizard">取消</a-button>

        <a-button
          v-if="step === 1"
          type="primary"
          :disabled="!selectedVendor"
          :loading="loading.open"
          @click="startLoginFlow"
        >
          下一步
        </a-button>

        <a-button
          v-if="step === 2 && openResult?.fallbackMode === 'paste'"
          :loading="loading.probe"
          :disabled="!cookieHeader.trim()"
          @click="runProbe"
        >
          检测 cookie
        </a-button>
        <a-button
          v-if="step === 2 && openResult?.fallbackMode !== 'paste'"
          :loading="loading.probe"
          @click="runProbe"
        >
          检测 cookie
        </a-button>

        <a-button
          v-if="step === 2"
          type="primary"
          :loading="loading.register"
          :disabled="!probeResult?.ok"
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
  // Caller passes `existingAccounts` so vendor cards can flag 已接入
  existingAccounts: { type: Array, default: () => [] },
});

const emit = defineEmits(["update:open", "registered"]);

// Vendor matrix is sourced from the backend cookie-capture-spec; we
// hard-code a minimal subset here so the picker renders before the WS
// connection is up. (The backend remains the source of truth for
// loginUrl / requiredCookies — fetched fresh during openAichatLogin.)
const vendors = [
  { vendor: "deepseek", displayName: "DeepSeek", notes: "手机号 + 验证码登录", requiredCookies: ["userToken"], cookieMaxAgeHintDays: 30 },
  { vendor: "kimi", displayName: "Kimi", notes: "手机号验证码登录", requiredCookies: ["access_token"], cookieMaxAgeHintDays: 30 },
  { vendor: "tongyi", displayName: "通义千问", notes: "阿里云账号 SSO（过期较快）", requiredCookies: ["login_aliyunid"], cookieMaxAgeHintDays: 7 },
  { vendor: "zhipu", displayName: "智谱清言", notes: "手机号 + 验证码", requiredCookies: ["chatglm_token"], cookieMaxAgeHintDays: 30 },
  { vendor: "hunyuan", displayName: "腾讯混元", notes: "QQ / 微信 / 手机号", requiredCookies: ["hy_token"], cookieMaxAgeHintDays: 14 },
  { vendor: "qianfan", displayName: "百度文心", notes: "百度账号", requiredCookies: ["BDUSS"], cookieMaxAgeHintDays: 7 },
  { vendor: "coze", displayName: "字节扣子 Coze", notes: "字节统一 passport", requiredCookies: ["sessionid"], cookieMaxAgeHintDays: 14 },
  { vendor: "dreamina", displayName: "即梦 Dreamina", notes: "字节图像生成", requiredCookies: ["sessionid"], cookieMaxAgeHintDays: 14 },
  { vendor: "doubao", displayName: "豆包 Doubao", notes: "字节文本 AI", requiredCookies: ["sessionid"], cookieMaxAgeHintDays: 14 },
];

const hub = usePersonalDataHub();

const step = ref(1);
const selectedVendor = ref(null);
const cookieHeader = ref("");
const openResult = ref(null);
const probeResult = ref(null);
const registerResult = ref(null);
const loading = reactive({ open: false, probe: false, register: false });

const currentVendorMeta = computed(
  () => vendors.find((v) => v.vendor === selectedVendor.value) || {},
);

const stepDescription = computed(() => {
  if (step.value === 1) return "选择一家 AI 服务商";
  if (step.value === 2) {
    return openResult.value?.fallbackMode === "paste"
      ? "在外部浏览器登录，把 cookie 粘贴到下面"
      : "在内嵌浏览器登录，主进程自动读取 cookie";
  }
  return "校验并写入本地加密 vault";
});

const probeFailMessage = computed(() => {
  const r = probeResult.value;
  if (!r) return "";
  if (r.reason === "UNKNOWN_VENDOR") return "未知厂商 — 请刷新页面或重选";
  if (r.reason === "PASTE_REQUIRED") return "请先粘贴 cookie 字符串";
  if (r.missingRequired?.length) return `缺关键 cookie: ${r.missingRequired.join(', ')}`;
  return r.reason || "cookie 校验失败";
});

const registerFailMessage = computed(() => {
  const r = registerResult.value;
  if (!r) return "未知错误";
  if (r.reason === "REQUIRED_COOKIES_MISSING") return `缺关键 cookie: ${(r.missingRequired || []).join(', ')}`;
  if (r.reason === "VALIDATE_COOKIE_FAILED") return "厂商拒绝该 cookie（可能已过期或被风控）";
  if (r.reason === "ADAPTER_THREW") return `Adapter 抛错: ${r.error || '网络错误'}`;
  if (r.reason === "UNKNOWN_VENDOR") return "未知厂商";
  return r.reason || "注册失败";
});

function isRegistered(vendor) {
  return props.existingAccounts.some((a) => a && a.vendor === vendor);
}

function pickVendor(vendor) {
  selectedVendor.value = vendor;
}

async function startLoginFlow() {
  if (!selectedVendor.value) return;
  loading.open = true;
  openResult.value = null;
  probeResult.value = null;
  cookieHeader.value = "";
  try {
    openResult.value = await hub.openAichatLogin(selectedVendor.value);
    if (!openResult.value?.ok) {
      // Show on Step 1 since we never reached Step 2 successfully
      return;
    }
    step.value = 2;
  } catch (err) {
    openResult.value = { ok: false, reason: err?.message || "OPEN_FAILED" };
  } finally {
    loading.open = false;
  }
}

async function runProbe() {
  loading.probe = true;
  probeResult.value = null;
  try {
    const trimmed = cookieHeader.value.trim();
    const arg = trimmed ? trimmed : undefined; // paste vs browser-view
    probeResult.value = await hub.probeAichatCookies(selectedVendor.value, arg);
  } catch (err) {
    probeResult.value = { ok: false, reason: err?.message || "PROBE_FAILED" };
  } finally {
    loading.probe = false;
  }
}

async function runRegister() {
  if (!probeResult.value?.ok) return;
  loading.register = true;
  try {
    registerResult.value = await hub.registerAichatVendor(
      selectedVendor.value,
      probeResult.value.cookies,
    );
    step.value = 3;
    if (registerResult.value?.ok) {
      emit("registered", { vendor: selectedVendor.value, accountId: registerResult.value.accountId });
    }
  } catch (err) {
    registerResult.value = { ok: false, reason: err?.message || "REGISTER_FAILED" };
    step.value = 3;
  } finally {
    loading.register = false;
  }
}

function restartFlow() {
  step.value = 1;
  selectedVendor.value = null;
  cookieHeader.value = "";
  openResult.value = null;
  probeResult.value = null;
  registerResult.value = null;
}

function resetWizard() {
  restartFlow();
  emit("update:open", false);
}

// Reset state when the drawer is reopened by the parent.
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
.vendor-card {
  cursor: pointer;
  border: 1px solid transparent;
  transition: border-color 0.15s;
}
.vendor-card.selected {
  border-color: #1677ff;
}
.vendor-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.kv {
  font-size: 12px;
}
.howto {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
}
.howto li {
  margin-bottom: 4px;
}
kbd {
  background: #f0f0f0;
  border: 1px solid #d9d9d9;
  border-radius: 3px;
  padding: 0 4px;
  font-family: monospace;
  font-size: 12px;
}
</style>
