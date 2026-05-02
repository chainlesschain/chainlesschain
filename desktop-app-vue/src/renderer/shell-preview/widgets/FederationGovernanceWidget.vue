<template>
  <div class="cc-preview-widget">
    <section class="cc-preview-widget__hero">
      <TeamOutlined class="cc-preview-widget__icon" />
      <h3>联邦治理</h3>
      <p>
        signed governance.log replay — 成员名单 / threshold / 候选 / 待批
        proposals。事件操作仍走 <code>cc mtc federation</code> CLI。
      </p>
    </section>

    <section v-if="federations.length === 0" class="cc-preview-widget__empty">
      <a-empty description="尚无联邦 governance.log" />
      <p class="cc-preview-widget__hint">
        新建：<code
          >cc mtc federation join &lt;fed-id&gt; --member-id &lt;m&gt;</code
        >
      </p>
    </section>

    <section v-else class="cc-preview-widget__feds">
      <div
        v-for="fed in federations"
        :key="fed.fed_id"
        class="cc-preview-widget__fed"
      >
        <header>
          <span class="cc-preview-widget__fed-id">{{ fed.fed_id }}</span>
          <span
            class="cc-preview-widget__badge"
            :class="statusBadgeClass(fed.state.status)"
          >
            {{ fed.state.status || "—" }}
          </span>
        </header>
        <dl class="cc-preview-widget__kv">
          <div>
            <dt>事件总数</dt>
            <dd>{{ fed.events_count }}</dd>
          </div>
          <div>
            <dt>Threshold</dt>
            <dd>
              {{ fed.state.threshold }}
              <span
                v-if="fed.state.pending_threshold"
                class="cc-preview-widget__pending"
              >
                → {{ fed.state.pending_threshold.target }}
              </span>
            </dd>
          </div>
          <div>
            <dt>成员</dt>
            <dd>{{ memberSummary(fed.state.members) }}</dd>
          </div>
          <div
            v-if="fed.state.pending_invites && fed.state.pending_invites.length"
          >
            <dt>待投票</dt>
            <dd>{{ fed.state.pending_invites.length }}</dd>
          </div>
          <div
            v-if="fed.state.pending_revokes && fed.state.pending_revokes.length"
          >
            <dt>待撤销</dt>
            <dd>{{ fed.state.pending_revokes.length }}</dd>
          </div>
          <div v-if="fed.state.archived_keys && fed.state.archived_keys.length">
            <dt>归档密钥</dt>
            <dd>{{ fed.state.archived_keys.length }}</dd>
          </div>
          <div
            v-if="
              fed.state.compromised_keys && fed.state.compromised_keys.length
            "
          >
            <dt>泄漏密钥</dt>
            <dd class="cc-preview-widget__danger">
              {{ fed.state.compromised_keys.length }}
            </dd>
          </div>
        </dl>

        <!-- v0.10: live sync stats per federation (when daemon is running) -->
        <div
          v-if="syncStatsByFedId[fed.fed_id]"
          class="cc-preview-widget__sync"
        >
          <header>
            <span class="cc-preview-widget__sync-label">
              Sync · {{ syncStatsByFedId[fed.fed_id].mode || "—" }}
            </span>
            <span class="cc-preview-widget__sync-stale">
              {{ relativeAge(syncStatsByFedId[fed.fed_id].last_tick_at) }}
            </span>
          </header>
          <dl class="cc-preview-widget__kv cc-preview-widget__kv--sub">
            <div v-if="syncStatsByFedId[fed.fed_id].publish">
              <dt>Publish</dt>
              <dd>
                last
                {{ syncStatsByFedId[fed.fed_id].publish.last_published || 0 }}
                / total
                {{ syncStatsByFedId[fed.fed_id].publish.total_published || 0 }}
              </dd>
            </div>
            <div v-if="syncStatsByFedId[fed.fed_id].pull">
              <dt>Pull</dt>
              <dd>
                last
                {{ syncStatsByFedId[fed.fed_id].pull.last_appended || 0 }}
                / total
                {{ syncStatsByFedId[fed.fed_id].pull.total_appended || 0 }}
                <span
                  v-if="
                    syncStatsByFedId[fed.fed_id].pull.last_invalid ||
                    syncStatsByFedId[fed.fed_id].pull.last_unknown
                  "
                  class="cc-preview-widget__danger"
                >
                  · invalid
                  {{ syncStatsByFedId[fed.fed_id].pull.last_invalid || 0 }}
                  unknown
                  {{ syncStatsByFedId[fed.fed_id].pull.last_unknown || 0 }}
                </span>
              </dd>
            </div>
            <div v-if="syncStatsByFedId[fed.fed_id].libp2p">
              <dt>libp2p wire</dt>
              <dd>
                recv
                {{ syncStatsByFedId[fed.fed_id].libp2p.wire_received || 0 }}
                · appended
                {{ syncStatsByFedId[fed.fed_id].libp2p.wire_appended || 0 }}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </section>

    <div class="cc-preview-widget__actions">
      <a-button type="primary" block @click="openCliHelp">
        查看治理 CLI
      </a-button>
      <a-button block @click="openDocs"> 打开治理设计文档 </a-button>
    </div>

    <p class="cc-preview-widget__hint">
      跨成员同步：<code
        >cc mtc federation governance-publish/pull --drop-zone &lt;dir&gt;</code
      >
    </p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { TeamOutlined } from "@ant-design/icons-vue";

interface GovMember {
  member_id: string;
  status: string;
  weight: number;
  alg?: string;
}
interface GovState {
  federation_id: string;
  status?: string;
  threshold?: number;
  members?: GovMember[];
  pending_invites?: unknown[];
  pending_revokes?: unknown[];
  pending_threshold?: { target: number } | null;
  archived_keys?: string[];
  compromised_keys?: string[];
  replay_error?: boolean;
}
interface GovFederation {
  fed_id: string;
  events_count: number;
  state: GovState;
}
interface SyncStatsEntry {
  fed_id: string;
  available?: boolean;
  mode?: string | null;
  last_tick_at?: string | null;
  publish?: {
    last_published?: number;
    last_skipped?: number;
    total_published?: number;
  } | null;
  pull?: {
    last_appended?: number;
    last_duplicates?: number;
    last_invalid?: number;
    last_unknown?: number;
    total_appended?: number;
  } | null;
  libp2p?: {
    wire_received?: number;
    wire_appended?: number;
    wire_invalid?: number;
    wire_unknown?: number;
    topic?: string;
  } | null;
}

interface MtcApi {
  getFederationGovernance?: () => Promise<{ federations: GovFederation[] }>;
  getFederationSyncStats?: () => Promise<{ federations: SyncStatsEntry[] }>;
}

const federations = ref<GovFederation[]>([]);
const syncStatsByFedId = ref<Record<string, SyncStatsEntry>>({});

function memberSummary(members: GovMember[] | undefined): string {
  if (!members || members.length === 0) {
    return "0";
  }
  const active = members.filter((m) => m.status === "active").length;
  const candidate = members.filter((m) => m.status === "candidate").length;
  if (candidate === 0) {
    return `${active}`;
  }
  return `${active} 活跃 + ${candidate} 候选`;
}

function relativeAge(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  try {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) {
      return iso;
    }
    const delta = Math.round((Date.now() - t) / 1000);
    if (delta < 60) {
      return `${delta}s 前`;
    }
    if (delta < 3600) {
      return `${Math.round(delta / 60)}min 前`;
    }
    if (delta < 86400) {
      return `${Math.round(delta / 3600)}h 前`;
    }
    return `${Math.round(delta / 86400)}d 前`;
  } catch {
    return iso;
  }
}

function statusBadgeClass(status: string | undefined): string {
  switch (status) {
    case "steady":
      return "cc-preview-widget__badge--ok";
    case "dispute":
    case "wind-down":
      return "cc-preview-widget__badge--danger";
    case "bootstrap":
    default:
      return "cc-preview-widget__badge--pending";
  }
}

function openCliHelp() {
  const text = [
    "cc mtc federation invite <fed> <candidate> --actor --candidate-pubkey-id",
    "cc mtc federation vote <fed> <candidate> --actor --decision approve|reject",
    "cc mtc federation propose-threshold <fed> <new-M> --actor",
    "cc mtc federation governance-log <fed> --json",
    "cc mtc federation governance-publish <fed> --drop-zone <dir>",
    "cc mtc federation governance-pull <fed> --drop-zone <dir> [--verify]",
  ].join("\n");
  // eslint-disable-next-line no-alert
  window.alert?.(`联邦治理 CLI 常用命令：\n\n${text}`);
}

function openDocs() {
  const url =
    "https://design.chainlesschain.com/mtc-federation-governance-v1.html";
  if (typeof window !== "undefined" && window.open) {
    window.open(url, "_blank", "noopener");
  }
}

onMounted(async () => {
  if (typeof window === "undefined") {
    return;
  }
  const api = (window as unknown as { electronAPI?: { mtc?: MtcApi } })
    .electronAPI?.mtc;
  if (!api?.getFederationGovernance) {
    return;
  }
  try {
    const r = await api.getFederationGovernance();
    if (Array.isArray(r?.federations)) {
      federations.value = r.federations;
    }
  } catch {
    /* keep defaults */
  }
  // v0.10: also pull sync-stats so live publish/pull/wire counters render
  // alongside each federation. IPC missing → render without stats sub-panel.
  if (api.getFederationSyncStats) {
    try {
      const r = await api.getFederationSyncStats();
      const map: Record<string, SyncStatsEntry> = {};
      for (const s of r?.federations || []) {
        if (s && s.fed_id && s.available !== false) {
          map[s.fed_id] = s;
        }
      }
      syncStatsByFedId.value = map;
    } catch {
      /* keep defaults */
    }
  }
});
</script>

<style scoped>
.cc-preview-widget {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cc-preview-widget__hero {
  text-align: center;
  padding: 16px 8px 4px;
}

.cc-preview-widget__icon {
  font-size: 32px;
  color: var(--cc-preview-accent);
  margin-bottom: 8px;
}

.cc-preview-widget__hero h3 {
  margin: 0 0 6px;
  font-size: 15px;
  color: var(--cc-preview-text-primary);
}

.cc-preview-widget__hero p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--cc-preview-text-secondary);
}

.cc-preview-widget__hero p code,
.cc-preview-widget__hint code {
  background: var(--cc-preview-bg-hover);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: var(--cc-preview-font-mono, monospace);
  font-size: 11px;
}

.cc-preview-widget__empty {
  text-align: center;
  padding: 8px;
}

.cc-preview-widget__feds {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 420px;
  overflow-y: auto;
}

.cc-preview-widget__fed {
  background: var(--cc-preview-bg-hover);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cc-preview-widget__fed header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}

.cc-preview-widget__fed-id {
  font-family: var(--cc-preview-font-mono, monospace);
  font-weight: 500;
  color: var(--cc-preview-text-primary);
  word-break: break-all;
}

.cc-preview-widget__kv {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cc-preview-widget__kv > div {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  gap: 8px;
}

.cc-preview-widget__kv dt {
  color: var(--cc-preview-text-secondary);
  margin: 0;
}

.cc-preview-widget__kv dd {
  margin: 0;
  color: var(--cc-preview-text-primary);
  font-weight: 500;
  text-align: right;
  word-break: break-all;
}

.cc-preview-widget__pending {
  color: #d48806;
  font-weight: 400;
  margin-left: 4px;
}

.cc-preview-widget__sync {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--cc-preview-border, rgba(0, 0, 0, 0.1));
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cc-preview-widget__sync header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.cc-preview-widget__sync-label {
  color: var(--cc-preview-accent);
  font-weight: 500;
}

.cc-preview-widget__sync-stale {
  color: var(--cc-preview-text-secondary);
  font-family: var(--cc-preview-font-mono, monospace);
}

.cc-preview-widget__kv--sub {
  font-size: 11px;
  gap: 4px;
}

.cc-preview-widget__danger {
  color: #cf1322;
}

.cc-preview-widget__badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}

.cc-preview-widget__badge--ok {
  background: rgba(82, 196, 26, 0.15);
  color: #389e0d;
}

.cc-preview-widget__badge--pending {
  background: rgba(250, 173, 20, 0.15);
  color: #d48806;
}

.cc-preview-widget__badge--danger {
  background: rgba(245, 34, 45, 0.15);
  color: #cf1322;
}

.cc-preview-widget__actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cc-preview-widget__hint {
  margin: 0;
  font-size: 11px;
  color: var(--cc-preview-text-secondary);
  text-align: center;
}
</style>
