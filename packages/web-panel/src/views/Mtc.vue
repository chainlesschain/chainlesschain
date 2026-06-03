<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ t('mtc.title') }}</h2>
        <p class="page-sub">
          {{ t('mtc.subtitle') }}
        </p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadStatus">
          <template #icon><ReloadOutlined /></template>
          {{ t('mtc.refresh') }}
        </a-button>
      </a-space>
    </div>

    <a-tabs v-model:activeKey="activeTab" class="mtc-tabs">
      <!-- ── Tab 1: Audit MTC status ────────────────────────────── -->
      <a-tab-pane key="status" :tab="t('mtc.tabs.status')">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px;">
          <a-col :xs="24" :sm="12" :lg="6">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                :title="t('mtc.status.enabledLabel')"
                :value="status.config.enabled ? t('mtc.status.enabled') : t('mtc.status.disabled')"
                :value-style="{ color: status.config.enabled ? '#52c41a' : '#888', fontSize: '20px' }"
              >
                <template #prefix>
                  <component :is="status.config.enabled ? CheckCircleOutlined : InfoCircleOutlined" />
                </template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                :title="t('mtc.status.intervalLabel')"
                :value="formatBatchInterval(status.config.batch_interval_seconds)"
                :value-style="{ color: '#1677ff', fontSize: '20px' }"
              >
                <template #prefix><ClockCircleOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                :title="t('mtc.status.stagingLabel')"
                :value="status.staging.count"
                :value-style="{ color: status.staging.count > 0 ? '#faad14' : '#888', fontSize: '20px' }"
              >
                <template #prefix><InboxOutlined /></template>
                <template v-if="status.staging.malformed > 0" #suffix>
                  <a-tag color="red" style="margin-left: 8px;">{{ t('mtc.status.stagingMalformed', { count: status.staging.malformed }) }}</a-tag>
                </template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="6">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                :title="t('mtc.status.totalBatches')"
                :value="status.batches.count"
                :value-style="{ color: '#13c2c2', fontSize: '20px' }"
              >
                <template #prefix><DatabaseOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>

        <a-card :title="t('mtc.status.configCard')" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-descriptions :column="{ xs: 1, sm: 2 }" size="small">
            <a-descriptions-item label="namespace">
              <span style="font-family: monospace;">{{ status.config.namespace_prefix || '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="issuer">
              <span style="font-family: monospace;">{{ status.config.issuer || '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="oldest queued">
              {{ formatTimestamp(status.staging.oldest_queued_at) }}
            </a-descriptions-item>
            <a-descriptions-item label="last batch">
              <template v-if="status.batches.last_batch_id">
                <a-tag color="cyan" style="font-family: monospace;">#{{ status.batches.last_batch_id }}</a-tag>
                <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px;">
                  {{ t('mtc.status.lastBatchSize', { size: status.batches.last_tree_size, time: formatRelative(status.batches.last_closed_at) }) }}
                </span>
              </template>
              <span v-else style="color: var(--text-muted);">{{ t('mtc.status.noBatches') }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="last tree_head_id" :span="2">
              <span v-if="status.batches.last_tree_head_id" style="font-family: monospace; font-size: 11px; word-break: break-all;">
                {{ status.batches.last_tree_head_id }}
              </span>
              <span v-else style="color: var(--text-muted);">—</span>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <a-alert
          v-if="!status.ok && !loading"
          type="info"
          show-icon
          :message="t('mtc.status.loadFailMessage')"
          :description="t('mtc.status.loadFailDescription')"
        />
        <a-alert
          v-else-if="!status.config.enabled"
          type="info"
          show-icon
          :message="t('mtc.status.notEnabledMessage')"
          :description="t('mtc.status.notEnabledDescription')"
        />
      </a-tab-pane>

      <!-- ── Tab 2: Marketplace publisher history ───────────────── -->
      <a-tab-pane key="publisher" :tab="t('mtc.tabs.publisher')">
        <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-form layout="inline" @submit.prevent="loadPublishState">
            <a-form-item :label="t('mtc.publisher.stateFileLabel')">
              <a-input
                v-model:value="publishStateFile"
                :placeholder="t('mtc.publisher.stateFilePlaceholder')"
                style="min-width: 360px;"
                allow-clear
              />
            </a-form-item>
            <a-form-item>
              <a-button :loading="publishLoading" type="primary" html-type="submit">
                {{ t('mtc.publisher.queryButton') }}
              </a-button>
            </a-form-item>
          </a-form>
        </a-card>

        <a-alert
          v-if="publish.ok && !publish.exists"
          type="info"
          show-icon
          :message="t('mtc.publisher.missingMessage')"
          :description="t('mtc.publisher.missingDescription', { path: publish.stateFile })"
          style="margin-bottom: 16px;"
        />

        <a-row v-if="publish.exists" :gutter="[16, 16]" style="margin-bottom: 16px;">
          <a-col :xs="24" :sm="12" :lg="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic :title="t('mtc.publisher.lastSeq')" :value="publish.lastSeq" :value-style="{ color: '#1677ff', fontSize: '20px' }">
                <template #prefix><NumberOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic :title="t('mtc.publisher.historyEntries')" :value="publish.historyCount" :value-style="{ color: '#13c2c2', fontSize: '20px' }">
                <template #prefix><HistoryOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="12" :lg="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                :title="t('mtc.publisher.lastPublished')"
                :value="formatRelative(publish.lastPublishedAt)"
                :value-style="{ color: '#52c41a', fontSize: '16px' }"
              >
                <template #prefix><ClockCircleOutlined /></template>
              </a-statistic>
            </a-card>
          </a-col>
        </a-row>

        <a-table
          v-if="publish.exists && publish.history.length > 0"
          :data-source="publish.history"
          :columns="historyColumns"
          :pagination="{ pageSize: 10 }"
          size="small"
          row-key="key"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'seq'">
              <a-tag color="cyan" style="font-family: monospace;">#{{ record.seq }}</a-tag>
            </template>
            <template v-else-if="column.key === 'treeHeadId'">
              <span style="font-family: monospace; font-size: 11px;">{{ truncate(record.treeHeadId, 22) }}</span>
            </template>
            <template v-else-if="column.key === 'publishedAt'">
              <span :title="record.publishedAt">{{ formatRelative(record.publishedAt) }}</span>
            </template>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Tab 3: Verify tool ─────────────────────────────────── -->
      <a-tab-pane key="verify" :tab="t('mtc.tabs.verify')">
        <a-card style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-alert
            type="info"
            show-icon
            :message="t('mtc.verify.infoMessage')"
            :description="t('mtc.verify.infoDescription')"
            style="margin-bottom: 16px;"
          />
          <a-form layout="vertical" @submit.prevent="runVerify">
            <a-form-item :label="t('mtc.verify.envelopeLabel')">
              <a-input
                v-model:value="verifyEnvelopePath"
                :placeholder="t('mtc.verify.envelopePlaceholder')"
                allow-clear
              />
            </a-form-item>
            <a-form-item :label="t('mtc.verify.landmarkLabel')">
              <a-input
                v-model:value="verifyLandmarkPath"
                :placeholder="t('mtc.verify.landmarkPlaceholder')"
                allow-clear
              />
            </a-form-item>
            <a-form-item>
              <a-button
                :loading="verifyLoading"
                type="primary"
                :disabled="!verifyEnvelopePath || !verifyLandmarkPath"
                @click="runVerify"
              >
                <template #icon><SafetyOutlined /></template>
                {{ t('mtc.verify.runButton') }}
              </a-button>
            </a-form-item>
          </a-form>
        </a-card>

        <a-card v-if="verifyResult" :title="verifyResult.ok ? t('mtc.verify.passTitle') : t('mtc.verify.failTitle')" size="small" :style="{ background: 'var(--bg-card)', borderColor: verifyResult.ok ? '#52c41a' : '#ff4d4f' }">
          <a-descriptions :column="1" size="small" bordered>
            <a-descriptions-item :label="t('mtc.verify.resultLabel')">
              <a-tag :color="verifyResult.ok ? 'green' : 'red'">
                {{ verifyResult.ok ? 'PASS' : 'FAIL' }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item v-if="!verifyResult.ok" :label="t('mtc.verify.errorCodeLabel')">
              <span style="font-family: monospace;">{{ verifyResult.code || t('mtc.verify.errorCodeNone') }}</span>
              <a-tag v-if="verifyResult.recoverable" color="orange" style="margin-left: 8px;">{{ t('mtc.verify.recoverable') }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.leaf" :label="t('mtc.verify.subjectLabel')">
              <span style="font-family: monospace; font-size: 12px;">{{ verifyResult.leaf.subject || '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.leaf" :label="t('mtc.verify.kindLabel')">
              <a-tag>{{ verifyResult.leaf.kind || '—' }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.treeHead" :label="t('mtc.verify.treeSizeLabel')">
              {{ verifyResult.treeHead.tree_size }}
            </a-descriptions-item>
            <a-descriptions-item v-if="verifyResult.treeHead" :label="t('mtc.verify.issuerLabel')">
              <span style="font-family: monospace; font-size: 12px;">{{ verifyResult.treeHead.issuer || '—' }}</span>
            </a-descriptions-item>
          </a-descriptions>
          <a-collapse v-if="verifyResult.raw" ghost style="margin-top: 12px;">
            <a-collapse-panel key="raw" :header="t('mtc.verify.rawHeader')">
              <pre class="raw-pre">{{ JSON.stringify(verifyResult.raw, null, 2) }}</pre>
            </a-collapse-panel>
          </a-collapse>
        </a-card>
      </a-tab-pane>

      <!-- ── Tab 4: Cross-chain bridge MTC (v0.6) ────────── -->
      <a-tab-pane key="bridge" tab="跨链桥 MTC">
        <a-row :gutter="[16, 16]" style="margin-bottom: 16px;">
          <a-col :xs="24" :sm="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                title="桥 MTC 集成"
                :value="bridgeStatus.config.enabled ? '已启用' : '未启用'"
                :value-style="{ color: bridgeStatus.config.enabled ? '#52c41a' : '#888', fontSize: '20px' }"
              />
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                title="互信模式"
                :value="bridgeModeLabel"
                :value-style="{ color: '#1677ff', fontSize: '20px' }"
              />
            </a-card>
          </a-col>
          <a-col :xs="24" :sm="8">
            <a-card style="background: var(--bg-card); border-color: var(--border-color);">
              <a-statistic
                title="待批次关闭"
                :value="bridgeStatus.staging.pending"
                :value-style="{ color: bridgeStatus.staging.pending > 0 ? '#faad14' : '#888', fontSize: '20px' }"
              />
            </a-card>
          </a-col>
        </a-row>

        <a-card title="配置" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-descriptions :column="{ xs: 1, sm: 2 }" size="small" bordered>
            <a-descriptions-item label="算法">
              <a-tag :color="bridgeStatus.config.alg === 'slh-dsa-128f' ? 'purple' : 'blue'">{{ bridgeStatus.config.alg || '—' }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="batch interval">
              {{ formatBatchInterval(bridgeStatus.config.batch_interval_seconds) }}
            </a-descriptions-item>
            <a-descriptions-item label="issuer">
              <span style="font-family: monospace;">{{ bridgeStatus.config.issuer || '—' }}</span>
            </a-descriptions-item>
            <a-descriptions-item label="batches 总数">
              {{ bridgeStatus.batches.total }}
              <span v-if="bridgeStatus.batches.latest" style="font-family: monospace; font-size: 11px; color: var(--text-tertiary); margin-left: 8px;">
                latest: {{ bridgeStatus.batches.latest }}
              </span>
            </a-descriptions-item>
          </a-descriptions>
        </a-card>

        <a-card title="信任锚 (Independent 模式)" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-empty v-if="bridgeStatus.trust_anchors.total === 0" description="未配置信任锚" />
          <a-table
            v-else
            :data-source="bridgeAnchorsTable"
            :columns="bridgeAnchorColumns"
            :pagination="false"
            size="small"
            row-key="key"
          />
          <p style="margin-top: 8px; font-size: 12px; color: var(--text-tertiary);">
            添加：<code>cc crosschain mtc-trust-anchor add &lt;chain&gt; &lt;pubkey-id&gt; --alg --issuer</code>
          </p>
        </a-card>

        <!-- v0.2: SLA / monitoring metrics from cc crosschain mtc-sla -->
        <a-card title="SLA / Monitoring (v0.2)" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
          <a-row :gutter="[12, 12]">
            <a-col :xs="24" :sm="12" :lg="6">
              <a-statistic
                title="SLA Status"
                :value="bridgeSla.sla_status || '—'"
                :value-style="{ color: slaStatusColor(bridgeSla.sla_status), fontSize: '18px' }"
              />
            </a-col>
            <a-col :xs="24" :sm="12" :lg="6">
              <a-statistic
                title="Staged pending"
                :value="bridgeSla.staged_pending_count ?? 0"
                :value-style="{ fontSize: '18px' }"
              />
            </a-col>
            <a-col :xs="24" :sm="12" :lg="6">
              <a-statistic
                title="Batches / hour"
                :value="bridgeSla.batches_last_hour ?? 0"
                :value-style="{ fontSize: '18px' }"
              />
            </a-col>
            <a-col :xs="24" :sm="12" :lg="6">
              <a-statistic
                title="Last batch"
                :value="bridgeSla.seconds_since_last_batch !== null && bridgeSla.seconds_since_last_batch !== undefined ? `${bridgeSla.seconds_since_last_batch}s ago` : '—'"
                :value-style="{ fontSize: '14px' }"
              />
            </a-col>
          </a-row>
          <p style="margin-top: 8px; font-size: 12px; color: var(--text-tertiary);">
            通过 <code>cc crosschain mtc-sla --json</code> 实时刷新（30s 自动 poll）。可纳入外部 Prometheus / Grafana。
          </p>
        </a-card>

        <a-alert
          type="info"
          show-icon
          message="桥 MTC 仍 opt-in"
          description="启用后 cc crosschain bridge|swap|send 加 --mtc 才会写 envelope；定期 cc crosschain mtc-batch 关 staging 为批次。完整指南见 docs.chainlesschain.com/guide/mtc-merkle-tree-certs。"
        />
      </a-tab-pane>

      <!-- ── Tab 5: Federation governance (v0.7+v0.8) ───── -->
      <a-tab-pane key="governance" tab="联邦治理">
        <a-form layout="inline" style="margin-bottom: 16px;">
          <a-form-item label="联邦 ID">
            <a-input
              v-model:value="govFederationId"
              placeholder="e.g. fed-test"
              style="width: 240px;"
              allow-clear
            />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" :loading="govLoading" @click="loadGovernanceLog">
              加载 governance.log
            </a-button>
          </a-form-item>
        </a-form>

        <div v-if="govResult">
          <a-row :gutter="[16, 16]" style="margin-bottom: 16px;">
            <a-col :xs="24" :sm="8">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                <a-statistic title="状态" :value="govResult.state.status || '—'" :value-style="{ fontSize: '20px' }" />
              </a-card>
            </a-col>
            <a-col :xs="24" :sm="8">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                <a-statistic title="Threshold" :value="govResult.state.threshold || 1" :value-style="{ fontSize: '20px' }" />
              </a-card>
            </a-col>
            <a-col :xs="24" :sm="8">
              <a-card style="background: var(--bg-card); border-color: var(--border-color);">
                <a-statistic title="事件总数" :value="(govResult.events || []).length" :value-style="{ fontSize: '20px' }" />
              </a-card>
            </a-col>
          </a-row>

          <a-card title="成员" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
            <a-table
              :data-source="govResult.state.members || []"
              :columns="memberColumns"
              :pagination="false"
              size="small"
              row-key="member_id"
            />
          </a-card>

          <a-card v-if="(govResult.state.pending_invites || []).length" title="待投票邀请" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
            <a-list :data-source="govResult.state.pending_invites" size="small">
              <template #renderItem="{ item }">
                <a-list-item>
                  <span style="font-family: monospace;">{{ item.member_id }}</span>
                  <a-tag color="blue">approve {{ item.votes.approve.length }}/{{ item.required }}</a-tag>
                  <a-tag v-if="item.votes.reject.length" color="red">reject {{ item.votes.reject.length }}</a-tag>
                </a-list-item>
              </template>
            </a-list>
          </a-card>

          <a-card title="事件时间线" size="small" style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;">
            <a-timeline>
              <a-timeline-item v-for="e in (govResult.events || [])" :key="e.event_id">
                <span style="font-family: monospace; color: var(--text-secondary); font-size: 11px;">{{ e.issued_at }}</span>
                <a-tag :color="eventTypeColor(e.event_type)" style="margin-left: 8px;">{{ e.event_type }}</a-tag>
                actor: <span style="font-family: monospace;">{{ e.actor_member_id }}</span>
              </a-timeline-item>
            </a-timeline>
          </a-card>

          <!-- ── v0.10: Pending threshold proposals (multi-proposal CRDT) ─── -->
          <a-card
            v-if="pendingThresholdsList.length > 0"
            title="待批 threshold proposals"
            size="small"
            style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;"
          >
            <a-alert
              v-if="pendingThresholdsList.length > 1"
              type="warning"
              show-icon
              message="多 proposal 并发"
              description="同一联邦同时存在多个待批 threshold proposal。下方每行可独立确认（CRDT-style 选择）；不指定时 CLI 默认确认最新一条。"
              style="margin-bottom: 12px;"
            />
            <a-list :data-source="pendingThresholdsList" size="small">
              <template #renderItem="{ item }">
                <a-list-item>
                  <a-space wrap>
                    <a-tag color="orange">target M = {{ item.target }}</a-tag>
                    <span style="font-size: 11px; color: var(--text-secondary);">by</span>
                    <span style="font-family: monospace;">{{ item.proposer || '—' }}</span>
                    <span style="font-size: 11px; color: var(--text-secondary);">at</span>
                    <span style="font-family: monospace; font-size: 11px;">{{ formatTimestamp(item.proposed_at) }}</span>
                    <a-tag color="cyan" style="font-family: monospace;">{{ truncateEventId(item.event_id) }}</a-tag>
                  </a-space>
                  <template #actions>
                    <a-button
                      size="small"
                      type="primary"
                      :loading="actionLoading"
                      @click="runConfirmThresholdById(item.event_id)"
                    >
                      确认这个
                    </a-button>
                  </template>
                </a-list-item>
              </template>
            </a-list>
          </a-card>

          <!-- ── v0.10: Live sync stats (governance-sync daemon counters) ─── -->
          <a-card
            v-if="govSyncStats"
            title="实时同步状态"
            size="small"
            style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 16px;"
          >
            <a-row :gutter="[12, 12]">
              <a-col :xs="24" :sm="8">
                <a-statistic
                  title="模式"
                  :value="govSyncStats.mode || '—'"
                  :value-style="{ fontSize: '16px', color: '#1677ff' }"
                />
              </a-col>
              <a-col :xs="24" :sm="8">
                <a-statistic
                  title="最近 tick"
                  :value="formatRelative(govSyncStats.last_tick_at) || '—'"
                  :value-style="{ fontSize: '16px' }"
                />
              </a-col>
              <a-col :xs="24" :sm="8">
                <a-statistic
                  title="下次轮询"
                  :value="govSyncRefreshHint"
                  :value-style="{ fontSize: '14px', color: 'var(--text-secondary)' }"
                />
              </a-col>
            </a-row>
            <a-descriptions
              v-if="govSyncStats.publish || govSyncStats.pull || govSyncStats.libp2p"
              :column="{ xs: 1, sm: 2 }"
              size="small"
              style="margin-top: 12px;"
            >
              <a-descriptions-item v-if="govSyncStats.publish" label="Publish">
                last {{ govSyncStats.publish.last_published || 0 }} / total {{ govSyncStats.publish.total_published || 0 }}
              </a-descriptions-item>
              <a-descriptions-item v-if="govSyncStats.pull" label="Pull">
                last {{ govSyncStats.pull.last_appended || 0 }} / total {{ govSyncStats.pull.total_appended || 0 }}
                <span
                  v-if="(govSyncStats.pull.last_invalid || 0) || (govSyncStats.pull.last_unknown || 0)"
                  style="color: #cf1322; margin-left: 8px;"
                >
                  · invalid {{ govSyncStats.pull.last_invalid || 0 }} / unknown {{ govSyncStats.pull.last_unknown || 0 }}
                </span>
              </a-descriptions-item>
              <a-descriptions-item v-if="govSyncStats.libp2p" label="libp2p wire" :span="2">
                recv {{ govSyncStats.libp2p.wire_received || 0 }} · appended {{ govSyncStats.libp2p.wire_appended || 0 }}
                <span v-if="govSyncStats.libp2p.topic" style="font-family: monospace; font-size: 11px; color: var(--text-secondary); margin-left: 8px;">
                  ({{ govSyncStats.libp2p.topic }})
                </span>
              </a-descriptions-item>
            </a-descriptions>
            <a-empty v-else description="daemon 还没写过 tick — 启动 governance-sync-serve 或 governance-sync-libp2p 后再加载" />
          </a-card>

          <!-- ── Operational governance actions (v0.9) ─────── -->
          <a-card title="操作型治理 (签名密钥仍 CLI-only)" size="small" style="background: var(--bg-card); border-color: var(--border-color);">
            <a-alert
              type="warning"
              show-icon
              message="安全设计"
              description="所有操作通过本机 CLI 子进程执行。私钥永远不进入 web 渲染进程 — 这里只是给 cc mtc federation * 命令拼参数。"
              style="margin-bottom: 12px;"
            />

            <a-tabs size="small">
              <a-tab-pane key="invite" tab="邀请">
                <a-form layout="inline" @submit.prevent="runInvite">
                  <a-form-item label="actor"><a-input v-model:value="inviteForm.actor" placeholder="alice" style="width: 120px;" /></a-form-item>
                  <a-form-item label="candidate"><a-input v-model:value="inviteForm.candidate" placeholder="bob" style="width: 120px;" /></a-form-item>
                  <a-form-item label="pubkey-id"><a-input v-model:value="inviteForm.pubkeyId" placeholder="sha256:..." style="width: 200px;" /></a-form-item>
                  <a-form-item><a-button type="primary" :loading="actionLoading" @click="runInvite">invite</a-button></a-form-item>
                </a-form>
              </a-tab-pane>
              <a-tab-pane key="vote" tab="投票">
                <a-form layout="inline" @submit.prevent="runVote">
                  <a-form-item label="actor"><a-input v-model:value="voteForm.actor" placeholder="alice" style="width: 120px;" /></a-form-item>
                  <a-form-item label="candidate"><a-input v-model:value="voteForm.candidate" placeholder="bob" style="width: 120px;" /></a-form-item>
                  <a-form-item label="decision">
                    <a-select v-model:value="voteForm.decision" style="width: 110px;">
                      <a-select-option value="approve">approve</a-select-option>
                      <a-select-option value="reject">reject</a-select-option>
                    </a-select>
                  </a-form-item>
                  <a-form-item><a-button type="primary" :loading="actionLoading" @click="runVote">vote</a-button></a-form-item>
                </a-form>
              </a-tab-pane>
              <a-tab-pane key="threshold" tab="改 threshold">
                <a-form layout="inline" @submit.prevent="runProposeThreshold">
                  <a-form-item label="actor"><a-input v-model:value="thresholdForm.actor" placeholder="alice" style="width: 120px;" /></a-form-item>
                  <a-form-item label="新 M"><a-input-number v-model:value="thresholdForm.newM" :min="1" style="width: 90px;" /></a-form-item>
                  <a-form-item><a-button :loading="actionLoading" @click="runProposeThreshold">propose</a-button></a-form-item>
                  <a-form-item><a-button type="primary" :loading="actionLoading" @click="runConfirmThreshold">confirm</a-button></a-form-item>
                </a-form>
              </a-tab-pane>
              <a-tab-pane key="revoke" tab="撤销">
                <a-form layout="inline" @submit.prevent="runProposeRevoke">
                  <a-form-item label="actor"><a-input v-model:value="revokeForm.actor" placeholder="alice" style="width: 120px;" /></a-form-item>
                  <a-form-item label="target"><a-input v-model:value="revokeForm.target" placeholder="bob" style="width: 120px;" /></a-form-item>
                  <a-form-item label="reason"><a-input v-model:value="revokeForm.reason" placeholder="inactive" style="width: 160px;" /></a-form-item>
                  <a-form-item><a-button :loading="actionLoading" @click="runProposeRevoke">propose-revoke</a-button></a-form-item>
                  <a-form-item><a-button type="primary" :loading="actionLoading" @click="runConfirmRevoke">confirm-revoke</a-button></a-form-item>
                </a-form>
              </a-tab-pane>
              <a-tab-pane key="sync" tab="跨成员同步">
                <a-form layout="inline">
                  <a-form-item label="drop-zone"><a-input v-model:value="syncForm.dropZone" placeholder="/path/to/shared/dir" style="width: 220px;" /></a-form-item>
                  <a-form-item><a-checkbox v-model:checked="syncForm.verify">--verify</a-checkbox></a-form-item>
                  <a-form-item><a-button :loading="actionLoading" @click="runGovPublish">publish</a-button></a-form-item>
                  <a-form-item><a-button type="primary" :loading="actionLoading" @click="runGovPull">pull</a-button></a-form-item>
                  <a-form-item><a-button :loading="actionLoading" @click="runGovSyncOnce">sync-once</a-button></a-form-item>
                </a-form>
              </a-tab-pane>
            </a-tabs>

            <a-card v-if="lastActionResult" size="small" style="margin-top: 12px; background: var(--bg-hover);">
              <pre class="raw-pre" style="margin: 0;">{{ JSON.stringify(lastActionResult, null, 2) }}</pre>
            </a-card>
          </a-card>
        </div>

        <a-empty v-else description="输入联邦 ID 加载 governance.log" />

        <a-alert
          style="margin-top: 16px;"
          type="info"
          show-icon
          message="跨成员同步"
          description="cc mtc federation governance-publish/pull --drop-zone 文件系统通道；governance-sync-libp2p --listen 走 libp2p gossipsub 通道；governance-sync-serve 自动 daemon 化。事件签名 + dedupe by event_id 保证幂等。"
        />
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ReloadOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  InboxOutlined,
  DatabaseOutlined,
  NumberOutlined,
  HistoryOutlined,
  SafetyOutlined,
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { useWsStore } from '../stores/ws.js'
import { useShellMode } from '../composables/useShellMode.js'
import {
  parseAuditMtcStatus,
  parsePublishStatus,
  parseVerifyResult,
  formatBatchInterval,
  formatTimestamp,
  formatRelative,
} from '../utils/mtc-parser.js'

const { t } = useI18n()
const ws = useWsStore()

const activeTab = ref('status')
const loading = ref(false)
const status = ref(parseAuditMtcStatus(''))

const publishStateFile = ref('')
const publishLoading = ref(false)
const publish = ref(parsePublishStatus(''))

const verifyEnvelopePath = ref('')
const verifyLandmarkPath = ref('')
const verifyLoading = ref(false)
const verifyResult = ref(null)

const historyColumns = computed(() => [
  { title: t('mtc.historyColumns.seq'), key: 'seq', dataIndex: 'seq', width: '90px' },
  { title: t('mtc.historyColumns.namespace'), key: 'namespace', dataIndex: 'namespace' },
  { title: t('mtc.historyColumns.treeSize'), key: 'treeSize', dataIndex: 'treeSize', width: '100px' },
  { title: t('mtc.historyColumns.treeHeadId'), key: 'treeHeadId', dataIndex: 'treeHeadId', width: '180px' },
  { title: t('mtc.historyColumns.publishedAt'), key: 'publishedAt', dataIndex: 'publishedAt', width: '140px' },
])

function truncate(s, max) {
  if (!s) return ''
  return s.length <= max ? s : s.slice(0, max) + '…'
}

async function loadStatus() {
  loading.value = true
  try {
    if (useShellMode().isEmbedded) {
      const reply = await ws.sendRaw({ type: 'mtc.audit-status' }, 30000)
      const r = reply?.result
      if (!reply?.ok || !r?.success) {
        throw new Error(r?.error || reply?.error || 'mtc.audit-status failed')
      }
      status.value = parseAuditMtcStatus(r.status)
    } else {
      const { output } = await ws.execute('audit mtc status --json', 30000)
      status.value = parseAuditMtcStatus(output)
    }
  } catch (e) {
    message.error(t('mtc.messages.loadStatusFailed', { err: e?.message || e }))
  } finally {
    loading.value = false
  }
}

async function loadPublishState() {
  if (!publishStateFile.value.trim()) {
    message.warning(t('mtc.messages.stateFileRequired'))
    return
  }
  publishLoading.value = true
  try {
    const path = publishStateFile.value.trim().replace(/"/g, '\\"')
    const { output } = await ws.execute(`mtc publish-status "${path}" --json`, 8000)
    publish.value = parsePublishStatus(output)
  } catch (e) {
    message.error(t('mtc.messages.loadPublishFailed', { err: e?.message || e }))
  } finally {
    publishLoading.value = false
  }
}

async function runVerify() {
  if (!verifyEnvelopePath.value.trim() || !verifyLandmarkPath.value.trim()) {
    message.warning(t('mtc.messages.verifyPathsRequired'))
    return
  }
  verifyLoading.value = true
  verifyResult.value = null
  try {
    const env = verifyEnvelopePath.value.trim().replace(/"/g, '\\"')
    const lm = verifyLandmarkPath.value.trim().replace(/"/g, '\\"')
    const { output } = await ws.execute(`mtc verify "${env}" --landmark "${lm}" --json`, 12000)
    verifyResult.value = parseVerifyResult(output)
    if (!verifyResult.value.raw) {
      message.error(t('mtc.messages.verifyNoJson'))
    }
  } catch (e) {
    message.error(t('mtc.messages.verifyFailed', { err: e?.message || e }))
  } finally {
    verifyLoading.value = false
  }
}

// ─── Bridge MTC tab (v0.6) ────────────────────────────────────
const bridgeStatus = ref({
  config: { enabled: false, mode: 'independent', alg: 'ed25519', batch_interval_seconds: 60, issuer: '' },
  trust_anchors: { chain_count: 0, total: 0, by_chain: {} },
  staging: { pending: 0 },
  batches: { total: 0, latest: null },
})
const bridgeModeLabel = computed(() => {
  switch (bridgeStatus.value.config.mode) {
    case 'federated': return 'Federated'
    case 'light-client': return 'Light Client'
    default: return 'Independent'
  }
})
const bridgeAnchorColumns = [
  { title: 'chain', key: 'chain', dataIndex: 'chain', width: '120px' },
  { title: '锚数', key: 'count', dataIndex: 'count', width: '80px' },
]
const bridgeAnchorsTable = computed(() => {
  const by = bridgeStatus.value.trust_anchors.by_chain || {}
  return Object.entries(by).map(([chain, count]) => ({ key: chain, chain, count }))
})

function mergeBridgeStatus(obj) {
  // CLI may legitimately omit sub-objects when bridge MTC is disabled; the
  // template addresses bridgeStatus.staging.pending / batches.latest etc.
  // unconditionally, so guarantee the full schema regardless of CLI shape.
  return {
    config: { enabled: false, mode: 'independent', alg: 'ed25519', batch_interval_seconds: 60, issuer: '', ...(obj?.config || {}) },
    trust_anchors: { chain_count: 0, total: 0, by_chain: {}, ...(obj?.trust_anchors || {}) },
    staging: { pending: 0, ...(obj?.staging || {}) },
    batches: { total: 0, latest: null, ...(obj?.batches || {}) },
  }
}

// v0.2: SLA / monitoring metrics (auto-polled)
const bridgeSla = ref({})
let slaPollHandle = null

function slaStatusColor(s) {
  if (s === 'ok') return '#52c41a'
  if (s === 'degraded') return '#faad14'
  if (s === 'down') return '#ff4d4f'
  return '#888'
}

async function loadBridgeSla() {
  try {
    if (useShellMode().isEmbedded) {
      const reply = await ws.sendRaw({ type: 'mtc.bridge-sla' }, 30000)
      const r = reply?.result
      if (reply?.ok && r?.success && r.metrics && typeof r.metrics.sla_status === 'string') {
        bridgeSla.value = r.metrics
      }
      return
    }
    const { output } = await ws.execute('crosschain mtc-sla --json', 30000)
    const lines = output.split(/\r?\n/)
    for (let s = 0; s < lines.length; s++) {
      if (lines[s].trimStart().startsWith('{')) {
        for (let e = lines.length; e > s; e--) {
          try {
            const obj = JSON.parse(lines.slice(s, e).join('\n'))
            if (obj && typeof obj.sla_status === 'string') {
              bridgeSla.value = obj
              return
            }
          } catch (_err) { /* keep trying */ }
        }
      }
    }
  } catch (_e) {
    /* keep last value */
  }
}

async function loadBridgeStatus() {
  try {
    if (useShellMode().isEmbedded) {
      const reply = await ws.sendRaw({ type: 'mtc.bridge-status' }, 30000)
      const r = reply?.result
      if (!reply?.ok || !r?.success || !r.status) {
        throw new Error(r?.error || reply?.error || 'mtc.bridge-status failed')
      }
      // Lib returns config fields flat (enabled / mode / alg / …); SPA template
      // addresses bridgeStatus.config.* — adapt the shape here so mergeBridgeStatus
      // sees the data instead of dropping into defaults.
      const s = r.status
      bridgeStatus.value = mergeBridgeStatus({
        config: {
          enabled: s.enabled,
          mode: s.mode,
          alg: s.alg,
          batch_interval_seconds: s.batch_interval_seconds,
          issuer: s.issuer,
        },
        trust_anchors: s.trust_anchors,
        staging: s.staging,
        batches: s.batches,
      })
      return
    }
    const { output } = await ws.execute('crosschain mtc-status --json', 30000)
    const lines = output.split(/\r?\n/)
    for (let s = 0; s < lines.length; s++) {
      if (lines[s].trimStart().startsWith('{')) {
        for (let e = lines.length; e > s; e--) {
          try {
            const obj = JSON.parse(lines.slice(s, e).join('\n'))
            if (obj && obj.config) {
              bridgeStatus.value = mergeBridgeStatus(obj)
              return
            }
          } catch (_err) { /* keep trying */ }
        }
      }
    }
  } catch (e) {
    message.error('加载桥 MTC 状态失败: ' + (e?.message || e))
  }
}

// ─── Federation governance tab (v0.7+v0.8) ───────────────────
const govFederationId = ref('')
const govLoading = ref(false)
const govResult = ref(null)
// v0.10: Live sync stats from governance-sync daemons (file-polled)
const govSyncStats = ref(null)
const govSyncRefreshHint = ref('随 governance-log 加载刷新')
// v0.10: Multi-proposal CRDT — list of all open propose-threshold events
const pendingThresholdsList = computed(() => {
  const s = govResult.value?.state
  if (!s) return []
  // Prefer pending_thresholds[] (v0.10); fall back to pending_threshold (single, pre-v0.10)
  if (Array.isArray(s.pending_thresholds) && s.pending_thresholds.length > 0) {
    return s.pending_thresholds
  }
  if (s.pending_threshold && Number.isInteger(s.pending_threshold.target)) {
    return [s.pending_threshold]
  }
  return []
})
const memberColumns = [
  { title: 'member_id', key: 'member_id', dataIndex: 'member_id' },
  { title: 'status', key: 'status', dataIndex: 'status', width: '110px' },
  { title: 'weight', key: 'weight', dataIndex: 'weight', width: '80px' },
  { title: 'alg', key: 'alg', dataIndex: 'alg', width: '120px' },
]

function eventTypeColor(eventType) {
  switch (eventType) {
    case 'create': return 'cyan'
    case 'invite': case 'vote': return 'blue'
    case 'leave': case 'rotate-key': return 'default'
    case 'propose-revoke': case 'propose-threshold': return 'orange'
    case 'confirm-revoke': case 'confirm-threshold': return 'gold'
    case 'fork': case 'merge': return 'purple'
    case 'dispute': case 'wind-down': return 'red'
    default: return 'default'
  }
}

// ─── Operational governance actions (v0.9 — shells out to CLI via ws) ───
const actionLoading = ref(false)
const lastActionResult = ref(null)
const inviteForm = ref({ actor: '', candidate: '', pubkeyId: '' })
const voteForm = ref({ actor: '', candidate: '', decision: 'approve' })
const thresholdForm = ref({ actor: '', newM: 2 })
const revokeForm = ref({ actor: '', target: '', reason: 'inactive' })
const syncForm = ref({ dropZone: '', verify: false })

function shellSafe(s) {
  return String(s || '').replace(/"/g, '').replace(/[`$]/g, '')
}

async function runGovAction(cmdSuffix, refresh = true) {
  if (!govFederationId.value.trim()) {
    message.warning('请先输入联邦 ID')
    return
  }
  actionLoading.value = true
  lastActionResult.value = null
  try {
    const fed = shellSafe(govFederationId.value.trim())
    const fullCmd = `mtc federation ${cmdSuffix.replace('<FED>', `"${fed}"`)} --json`
    const { output } = await ws.execute(fullCmd, 12000)
    const lines = output.split(/\r?\n/)
    let parsed = null
    for (let s = 0; s < lines.length; s++) {
      if (lines[s].trimStart().startsWith('{')) {
        for (let e = lines.length; e > s; e--) {
          try { parsed = JSON.parse(lines.slice(s, e).join('\n')); break } catch (_err) { /* keep trying */ }
        }
        if (parsed) break
      }
    }
    lastActionResult.value = parsed || { raw: output }
    message.success('命令执行完成')
    if (refresh) await loadGovernanceLog()
  } catch (e) {
    message.error('CLI 执行失败: ' + (e?.message || e))
    lastActionResult.value = { error: e?.message || String(e) }
  } finally {
    actionLoading.value = false
  }
}

function runInvite() {
  const f = inviteForm.value
  if (!f.actor || !f.candidate || !f.pubkeyId) {
    message.warning('actor / candidate / pubkey-id 都必填')
    return
  }
  return runGovAction(`invite <FED> "${shellSafe(f.candidate)}" --actor "${shellSafe(f.actor)}" --candidate-pubkey-id "${shellSafe(f.pubkeyId)}"`)
}

function runVote() {
  const f = voteForm.value
  if (!f.actor || !f.candidate) { message.warning('actor / candidate 必填'); return }
  return runGovAction(`vote <FED> "${shellSafe(f.candidate)}" --actor "${shellSafe(f.actor)}" --decision ${f.decision}`)
}

function runProposeThreshold() {
  const f = thresholdForm.value
  if (!f.actor) { message.warning('actor 必填'); return }
  return runGovAction(`propose-threshold <FED> ${parseInt(f.newM)} --actor "${shellSafe(f.actor)}"`)
}

function runConfirmThreshold() {
  const f = thresholdForm.value
  if (!f.actor) { message.warning('actor 必填'); return }
  return runGovAction(`confirm-threshold <FED> --actor "${shellSafe(f.actor)}"`)
}

// v0.10: Multi-proposal CRDT — confirm a SPECIFIC proposal by event_id.
// Reuses thresholdForm.actor for the actor field; if blank, prompts.
function runConfirmThresholdById(eventId) {
  const actor = (thresholdForm.value.actor || '').trim()
  if (!actor) { message.warning('请先在"改 threshold"子 tab 填 actor'); return }
  if (!eventId) { message.warning('proposal event_id 缺失'); return }
  return runGovAction(
    `confirm-threshold <FED> --actor "${shellSafe(actor)}" --proposal-event-id "${shellSafe(eventId)}"`,
  )
}

function truncateEventId(id) {
  if (!id) return '—'
  return id.length <= 16 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`
}

function runProposeRevoke() {
  const f = revokeForm.value
  if (!f.actor || !f.target) { message.warning('actor / target 必填'); return }
  return runGovAction(`propose-revoke <FED> "${shellSafe(f.target)}" --actor "${shellSafe(f.actor)}" --reason "${shellSafe(f.reason)}"`)
}

function runConfirmRevoke() {
  const f = revokeForm.value
  if (!f.actor || !f.target) { message.warning('actor / target 必填'); return }
  return runGovAction(`confirm-revoke <FED> "${shellSafe(f.target)}" --actor "${shellSafe(f.actor)}"`)
}

function runGovPublish() {
  if (!syncForm.value.dropZone) { message.warning('drop-zone 必填'); return }
  return runGovAction(`governance-publish <FED> --drop-zone "${shellSafe(syncForm.value.dropZone)}"`, false)
}

function runGovPull() {
  if (!syncForm.value.dropZone) { message.warning('drop-zone 必填'); return }
  const verifyFlag = syncForm.value.verify ? ' --verify' : ''
  return runGovAction(`governance-pull <FED> --drop-zone "${shellSafe(syncForm.value.dropZone)}"${verifyFlag}`)
}

function runGovSyncOnce() {
  if (!syncForm.value.dropZone) { message.warning('drop-zone 必填'); return }
  const verifyFlag = syncForm.value.verify ? ' --verify' : ''
  return runGovAction(`governance-sync-serve <FED> --drop-zone "${shellSafe(syncForm.value.dropZone)}" --once${verifyFlag}`)
}

async function loadGovernanceLog() {
  if (!govFederationId.value.trim()) {
    message.warning('请输入联邦 ID')
    return
  }
  govLoading.value = true
  try {
    const safeId = govFederationId.value.trim().replace(/"/g, '')
    const { output } = await ws.execute(`mtc federation governance-log "${safeId}" --json`, 8000)
    const lines = output.split(/\r?\n/)
    let parsed = false
    for (let s = 0; s < lines.length; s++) {
      if (lines[s].trimStart().startsWith('{')) {
        for (let e = lines.length; e > s; e--) {
          try {
            const obj = JSON.parse(lines.slice(s, e).join('\n'))
            if (obj && obj.state) {
              govResult.value = obj
              parsed = true
              break
            }
          } catch (_err) { /* keep trying */ }
        }
        if (parsed) break
      }
    }
    if (!parsed) {
      message.error('未能解析 governance-log 输出')
      return
    }
    // v0.10: also pull live sync-stats for this federation. Best-effort —
    // if no daemon is running the CLI returns available=false and we render
    // an empty-state hint instead of an error toast.
    await loadGovSyncStats(safeId)
  } catch (e) {
    message.error('加载 governance.log 失败: ' + (e?.message || e))
  } finally {
    govLoading.value = false
  }
}

// v0.10: pull live sync-stats from `cc mtc federation governance-sync-stats <fed> --json`.
// CLI returns { fed_id, available, mode, last_tick_at, publish?, pull?, libp2p? }.
// available=false means no daemon has written the sync-stats.json yet — render empty.
async function loadGovSyncStats(fedId) {
  govSyncStats.value = null
  govSyncRefreshHint.value = '随 governance-log 加载刷新'
  if (!fedId) return
  try {
    const safeId = String(fedId).replace(/"/g, '')
    const { output } = await ws.execute(
      `mtc federation governance-sync-stats "${safeId}" --json`,
      8000,
    )
    const lines = output.split(/\r?\n/)
    for (let s = 0; s < lines.length; s++) {
      if (lines[s].trimStart().startsWith('{')) {
        for (let e = lines.length; e > s; e--) {
          try {
            const obj = JSON.parse(lines.slice(s, e).join('\n'))
            if (obj && (obj.available !== undefined || obj.mode !== undefined)) {
              govSyncStats.value = obj.available === false ? null : obj
              return
            }
          } catch (_err) { /* keep trying */ }
        }
      }
    }
  } catch (_e) {
    // CLI missing or daemon not running — silent (button still works manually)
    govSyncStats.value = null
  }
}

onMounted(() => {
  loadStatus()
  loadBridgeStatus()
  loadBridgeSla()
  // v0.2 — auto-poll SLA every 30s for live monitoring view
  slaPollHandle = setInterval(loadBridgeSla, 30_000)
})

import { onUnmounted } from 'vue'
onUnmounted(() => {
  if (slaPollHandle) clearInterval(slaPollHandle)
})
</script>

<style scoped>
.page-title {
  margin: 0;
  font-size: 22px;
  color: var(--text-primary);
}
.page-sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.mtc-tabs :deep(.ant-tabs-tab) {
  font-size: 13px;
}
.raw-pre {
  margin: 0;
  padding: 8px 12px;
  background: var(--bg-hover);
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  line-height: 1.5;
  max-height: 320px;
  overflow: auto;
}
</style>
