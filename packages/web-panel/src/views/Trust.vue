<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ $t('trust.title') }}</h2>
        <p class="page-sub">{{ $t('trust.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ $t('trust.refresh') }}
        </a-button>
        <a-dropdown>
          <a-button type="primary">
            <template #icon><PlusOutlined /></template>
            {{ $t('trust.newDropdown') }}
          </a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item key="attest" @click="showAttestModal = true">{{ $t('trust.actions.attest') }}</a-menu-item>
              <a-menu-item key="interop" @click="showInteropModal = true">{{ $t('trust.actions.interop') }}</a-menu-item>
              <a-menu-item key="sat" @click="showSatModal = true">{{ $t('trust.actions.sat') }}</a-menu-item>
              <a-menu-item key="hsm" @click="showHsmModal = true">{{ $t('trust.actions.hsm') }}</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
    </div>

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('trust.stats.attestations')"
            :value="stats.attestations.total"
            :value-style="{ color: '#1677ff', fontSize: '20px' }"
          >
            <template #prefix><SafetyCertificateOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ $t('trust.stats.validSuffix', { n: stats.attestations.valid }) }}</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('trust.stats.interop')"
            :value="stats.interopTests.total"
            :value-style="{ color: '#722ed1', fontSize: '20px' }"
          >
            <template #prefix><ExperimentOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ $t('trust.stats.interopSub', { compatible: stats.interopTests.compatible, avg: stats.interopTests.avgLatencyMs }) }}</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('trust.stats.satellite')"
            :value="stats.satellite.total"
            :value-style="{ color: '#13c2c2', fontSize: '20px' }"
          >
            <template #prefix><GlobalOutlined /></template>
          </a-statistic>
          <div class="stat-sub">{{ $t('trust.stats.satelliteSub', { queued: stats.satellite.queued, confirmed: stats.satellite.confirmed }) }}</div>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('trust.stats.hsm')"
            :value="stats.hsm.total"
            :value-style="{ color: '#faad14', fontSize: '20px' }"
          >
            <template #prefix><KeyOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('trust.stats.passRate')"
            :value="attestationPassRate"
            suffix="%"
            :precision="0"
            :value-style="{ color: passRateColor(attestationPassRate), fontSize: '20px' }"
          >
            <template #prefix><CheckCircleOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Tabs (4 phases) -->
    <a-tabs v-model:activeKey="activeTab" class="trust-tabs">
      <!-- ── Attestations (Phase 68) ──────────────────────────── -->
      <a-tab-pane key="attestations" :tab="$t('trust.tabs.attestations')">
        <div class="filter-bar">
          <a-radio-group v-model:value="anchorFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ $t('trust.filter.allAnchors') }}</a-radio-button>
            <a-radio-button v-for="a in TRUST_ANCHORS" :key="a" :value="a">{{ anchorLabel(a) }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="attestStatusFilter" size="small">
            <a-radio-button value="">{{ $t('trust.filter.allStatuses') }}</a-radio-button>
            <a-radio-button v-for="s in ATTESTATION_STATUSES" :key="s" :value="s">{{ attestStatusLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="attestColumns"
          :data-source="filteredAttestations"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('trust.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.id.slice(0, 12) }}</span>
            </template>
            <template v-if="column.key === 'anchor'">
              <a-tag :color="anchorColor(record.anchor)" style="font-family: monospace;">{{ anchorLabel(record.anchor) }}</a-tag>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="attestStatusColor(record.status)">{{ attestStatusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'fingerprint'">
              <span v-if="record.deviceFingerprint" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">{{ truncate(record.deviceFingerprint, 24) }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'response'">
              <span v-if="record.response" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">{{ truncate(record.response, 24) }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatTrustTime(record.createdAt) }}</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <SafetyCertificateOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ anchorFilter || attestStatusFilter ? $t('trust.table.emptyAttestFiltered') : $t('trust.table.emptyAttest') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── PQC Interop (Phase 69) ──────────────────────────── -->
      <a-tab-pane key="interop" :tab="$t('trust.tabs.interop')">
        <a-table
          :columns="interopColumns"
          :data-source="interopTests"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('trust.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.id.slice(0, 12) }}</span>
            </template>
            <template v-if="column.key === 'algorithm'">
              <a-tag color="purple" style="font-family: monospace;">{{ record.algorithm }}</a-tag>
            </template>
            <template v-if="column.key === 'compatible'">
              <a-tag :color="record.compatible ? 'green' : 'red'">
                <CheckCircleOutlined v-if="record.compatible" />
                <CloseCircleOutlined v-else />
                {{ record.compatible ? $t('trust.table.compatible') : $t('trust.table.incompatible') }}
              </a-tag>
            </template>
            <template v-if="column.key === 'result'">
              <span v-if="record.result" style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ record.result }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'latencyMs'">
              <a-tag :color="latencyColor(record.latencyMs)">{{ record.latencyMs }}ms</a-tag>
            </template>
            <template v-if="column.key === 'peer'">
              <span v-if="record.peer" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">{{ record.peer }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatTrustTime(record.createdAt) }}</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <ExperimentOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ $t('trust.table.emptyInterop') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Satellite (Phase 70) ────────────────────────────── -->
      <a-tab-pane key="satellite" :tab="$t('trust.tabs.satellite')">
        <div class="filter-bar">
          <a-radio-group v-model:value="providerFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ $t('trust.filter.allProviders') }}</a-radio-button>
            <a-radio-button v-for="p in SATELLITE_PROVIDERS" :key="p" :value="p">{{ p }}</a-radio-button>
          </a-radio-group>
          <a-radio-group v-model:value="satStatusFilter" size="small">
            <a-radio-button value="">{{ $t('trust.filter.allStatuses') }}</a-radio-button>
            <a-radio-button v-for="s in SAT_MESSAGE_STATUSES" :key="s" :value="s">{{ satStatusLabel(s) }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="satColumns"
          :data-source="filteredSatMessages"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('trust.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.id.slice(0, 12) }}</span>
            </template>
            <template v-if="column.key === 'provider'">
              <a-tag :color="providerColor(record.provider)" style="font-family: monospace;">{{ record.provider }}</a-tag>
            </template>
            <template v-if="column.key === 'priority'">
              <a-tag :color="priorityColor(record.priority)">P{{ record.priority }}</a-tag>
            </template>
            <template v-if="column.key === 'status'">
              <a-tag :color="satStatusColor(record.status)">{{ satStatusLabel(record.status) }}</a-tag>
            </template>
            <template v-if="column.key === 'payload'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ truncate(record.payload, 60) }}</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatTrustTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button v-if="record.status === 'queued'" size="small" type="link" @click="updateSatStatus(record, 'sent')">{{ $t('trust.table.satMarkSent') }}</a-button>
              <a-button v-if="record.status === 'sent'" size="small" type="link" style="color: #52c41a;" @click="updateSatStatus(record, 'confirmed')">{{ $t('trust.table.satConfirm') }}</a-button>
              <a-button v-if="['queued','sent'].includes(record.status)" size="small" type="link" danger @click="updateSatStatus(record, 'failed')">{{ $t('trust.table.satFail') }}</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <GlobalOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ providerFilter || satStatusFilter ? $t('trust.table.emptySatFiltered') : $t('trust.table.emptySat') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── HSM (Phase 71) ──────────────────────────────────── -->
      <a-tab-pane key="hsm" :tab="$t('trust.tabs.hsm')">
        <div class="filter-bar">
          <a-radio-group v-model:value="vendorFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ $t('trust.filter.allVendors') }}</a-radio-button>
            <a-radio-button v-for="v in HSM_VENDORS" :key="v" :value="v">{{ v }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="hsmColumns"
          :data-source="filteredHsmDevices"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('trust.table.deviceSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'id'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.id.slice(0, 12) }}</span>
            </template>
            <template v-if="column.key === 'vendor'">
              <a-tag :color="vendorColor(record.vendor)" style="font-family: monospace;">{{ record.vendor }}</a-tag>
            </template>
            <template v-if="column.key === 'model'">
              <span v-if="record.model" style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.model }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'serialNumber'">
              <span v-if="record.serialNumber" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">{{ record.serialNumber }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'complianceLevel'">
              <a-tag v-if="record.complianceLevel" :color="complianceColor(record.complianceLevel)" style="font-family: monospace; font-size: 11px;">{{ record.complianceLevel }}</a-tag>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'firmwareVersion'">
              <span v-if="record.firmwareVersion" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">{{ record.firmwareVersion }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="openSignModal(record)">{{ $t('trust.table.hsmSign') }}</a-button>
              <a-popconfirm
                :title="$t('trust.removeConfirm.title')"
                :ok-text="$t('trust.removeConfirm.ok')"
                ok-type="danger"
                :cancel-text="$t('trust.removeConfirm.cancel')"
                @confirm="removeHsm(record)"
              >
                <a-button size="small" type="link" danger>{{ $t('trust.table.hsmRemove') }}</a-button>
              </a-popconfirm>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <KeyOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ vendorFilter ? $t('trust.table.emptyHsmFiltered') : $t('trust.table.emptyHsm') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Attest modal ───────────────────────────────────────── -->
    <a-modal
      v-model:open="showAttestModal"
      :title="$t('trust.attest_modal.title')"
      :confirm-loading="creating"
      :width="540"
      :ok-text="$t('trust.attest_modal.ok')"
      :cancel-text="$t('trust.attest_modal.cancel')"
      @ok="submitAttest"
      @cancel="resetAttestForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('trust.attest_modal.anchorLabel')" required>
          <a-select v-model:value="attestForm.anchor">
            <a-select-option v-for="a in TRUST_ANCHORS" :key="a" :value="a">{{ anchorLabel(a) }} ({{ a }})</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('trust.attest_modal.challengeLabel')">
          <a-input v-model:value="attestForm.challenge" :placeholder="$t('trust.attest_modal.challengePlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('trust.attest_modal.fingerprintLabel')">
          <a-input v-model:value="attestForm.fingerprint" :placeholder="$t('trust.attest_modal.fingerprintPlaceholder')" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Interop test modal ─────────────────────────────────── -->
    <a-modal
      v-model:open="showInteropModal"
      :title="$t('trust.interop_modal.title')"
      :confirm-loading="creating"
      :width="540"
      :ok-text="$t('trust.interop_modal.ok')"
      :cancel-text="$t('trust.interop_modal.cancel')"
      @ok="submitInterop"
      @cancel="resetInteropForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('trust.interop_modal.algorithmLabel')" required>
          <a-input v-model:value="interopForm.algorithm" :placeholder="$t('trust.interop_modal.algorithmPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('trust.interop_modal.peerLabel')">
          <a-input v-model:value="interopForm.peer" :placeholder="$t('trust.interop_modal.peerPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('trust.interop_modal.latencyLabel')">
          <a-input-number v-model:value="interopForm.latency" :min="0" style="width: 160px;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Sat send modal ────────────────────────────────────── -->
    <a-modal
      v-model:open="showSatModal"
      :title="$t('trust.sat_modal.title')"
      :confirm-loading="creating"
      :width="540"
      :ok-text="$t('trust.sat_modal.ok')"
      :cancel-text="$t('trust.sat_modal.cancel')"
      @ok="submitSat"
      @cancel="resetSatForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('trust.sat_modal.providerLabel')" required>
          <a-select v-model:value="satForm.provider">
            <a-select-option v-for="p in SATELLITE_PROVIDERS" :key="p" :value="p">{{ p }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('trust.sat_modal.priorityLabel')">
          <a-input-number v-model:value="satForm.priority" :min="1" :max="10" style="width: 120px;" />
          <span style="margin-left: 8px; color: var(--text-muted); font-size: 12px;">{{ $t('trust.sat_modal.priorityHint') }}</span>
        </a-form-item>
        <a-form-item :label="$t('trust.sat_modal.payloadLabel')" required>
          <a-textarea
            v-model:value="satForm.payload"
            :placeholder="$t('trust.sat_modal.payloadPlaceholder')"
            :auto-size="{ minRows: 2, maxRows: 5 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── HSM register modal ───────────────────────────────── -->
    <a-modal
      v-model:open="showHsmModal"
      :title="$t('trust.hsm_modal.title')"
      :confirm-loading="creating"
      :width="560"
      :ok-text="$t('trust.hsm_modal.ok')"
      :cancel-text="$t('trust.hsm_modal.cancel')"
      @ok="submitHsm"
      @cancel="resetHsmForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('trust.hsm_modal.vendorLabel')" required>
          <a-select v-model:value="hsmForm.vendor">
            <a-select-option v-for="v in HSM_VENDORS" :key="v" :value="v">{{ v }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('trust.hsm_modal.modelLabel')">
          <a-input v-model:value="hsmForm.model" :placeholder="$t('trust.hsm_modal.modelPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('trust.hsm_modal.serialLabel')">
          <a-input v-model:value="hsmForm.serial" :placeholder="$t('trust.hsm_modal.serialPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('trust.hsm_modal.complianceLabel')">
          <a-select v-model:value="hsmForm.compliance" allow-clear>
            <a-select-option v-for="c in COMPLIANCE_LEVELS" :key="c" :value="c">{{ c }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('trust.hsm_modal.firmwareLabel')">
          <a-input v-model:value="hsmForm.firmware" :placeholder="$t('trust.hsm_modal.firmwarePlaceholder')" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Sign modal ────────────────────────────────────────── -->
    <a-modal
      v-model:open="showSignModal"
      :title="$t('trust.sign_modal.title', { id: currentDevice?.id?.slice(0, 12) || '' })"
      :width="640"
      :footer="null"
    >
      <div v-if="currentDevice" style="padding-top: 8px;">
        <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }">
          <a-form-item :label="$t('trust.sign_modal.deviceLabel')">
            <a-tag :color="vendorColor(currentDevice.vendor)" style="font-family: monospace;">{{ currentDevice.vendor }}</a-tag>
            <span style="margin-left: 8px;">{{ currentDevice.model || '—' }}</span>
          </a-form-item>
          <a-form-item :label="$t('trust.sign_modal.algorithmLabel')">
            <a-input v-model:value="signForm.algorithm" :placeholder="$t('trust.sign_modal.algorithmPlaceholder')" />
          </a-form-item>
          <a-form-item :label="$t('trust.sign_modal.dataLabel')" required>
            <a-textarea
              v-model:value="signForm.data"
              :placeholder="$t('trust.sign_modal.dataPlaceholder')"
              :auto-size="{ minRows: 3, maxRows: 8 }"
            />
          </a-form-item>
          <a-form-item :wrapper-col="{ offset: 5, span: 19 }">
            <a-button type="primary" :loading="signing" @click="submitSign">
              <template #icon><KeyOutlined /></template>
              {{ $t('trust.sign_modal.submit') }}
            </a-button>
          </a-form-item>
        </a-form>

        <a-divider />
        <a-empty v-if="!signResult" :description="$t('trust.sign_modal.notSigned')" :image="EMPTY_IMG" />
        <div v-else>
          <a-descriptions :column="1" size="small" bordered>
            <a-descriptions-item :label="$t('trust.sign_modal.resultAlgorithm')">
              <a-tag color="purple" style="font-family: monospace;">{{ signResult.algorithm }}</a-tag>
            </a-descriptions-item>
            <a-descriptions-item :label="$t('trust.sign_modal.resultSignature')">
              <pre class="sig-pre">{{ signResult.signature }}</pre>
            </a-descriptions-item>
          </a-descriptions>
          <a-alert
            v-if="signResult.reason"
            type="warning"
            show-icon
            :message="$t('trust.sign_modal.failedReason', { reason: signResult.reason })"
            style="margin-top: 12px;"
          />
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  ExperimentOutlined,
  GlobalOutlined,
  KeyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons-vue'
import { message, Empty } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { useWsStore } from '../stores/ws.js'
import {
  parseAttestations,
  parseAttestResult,
  parseInteropTests,
  parseInteropTestResult,
  parseSatMessages,
  parseHsmDevices,
  parseSignResult,
  parseActionResult,
  parseStats,
  formatTrustTime,
  TRUST_ANCHORS,
  ATTESTATION_STATUSES,
  SATELLITE_PROVIDERS,
  SAT_MESSAGE_STATUSES,
  HSM_VENDORS,
  COMPLIANCE_LEVELS,
} from '../utils/trust-parser.js'

const ws = useWsStore()
const { t } = useI18n()

const EMPTY_IMG = Empty.PRESENTED_IMAGE_SIMPLE

const loading = ref(false)
const creating = ref(false)
const signing = ref(false)

const attestations = ref([])
const interopTests = ref([])
const satMessages = ref([])
const hsmDevices = ref([])
const stats = ref({
  attestations: { total: 0, valid: 0, byAnchor: {} },
  interopTests: { total: 0, compatible: 0, avgLatencyMs: 0 },
  satellite: { total: 0, queued: 0, confirmed: 0 },
  hsm: { total: 0, byVendor: {} },
})

const activeTab = ref('attestations')
const anchorFilter = ref('')
const attestStatusFilter = ref('')
const providerFilter = ref('')
const satStatusFilter = ref('')
const vendorFilter = ref('')

const showAttestModal = ref(false)
const showInteropModal = ref(false)
const showSatModal = ref(false)
const showHsmModal = ref(false)
const showSignModal = ref(false)

const attestForm = reactive({ anchor: 'tpm', challenge: '', fingerprint: '' })
const interopForm = reactive({ algorithm: 'ml_kem_768', peer: '', latency: 50 })
const satForm = reactive({ provider: 'iridium', priority: 5, payload: '' })
const hsmForm = reactive({ vendor: 'yubikey', model: '', serial: '', compliance: undefined, firmware: '' })
const signForm = reactive({ data: '', algorithm: '' })

const currentDevice = ref(null)
const signResult = ref(null)

const attestColumns = computed(() => [
  { title: t('trust.attestCols.id'), key: 'id', width: '130px' },
  { title: t('trust.attestCols.anchor'), key: 'anchor', width: '160px' },
  { title: t('trust.attestCols.status'), key: 'status', width: '110px' },
  { title: t('trust.attestCols.fingerprint'), key: 'fingerprint', width: '180px' },
  { title: t('trust.attestCols.response'), key: 'response' },
  { title: t('trust.attestCols.createdAt'), key: 'createdAt', width: '160px' },
])

const interopColumns = computed(() => [
  { title: t('trust.interopCols.id'), key: 'id', width: '130px' },
  { title: t('trust.interopCols.algorithm'), key: 'algorithm', width: '180px' },
  { title: t('trust.interopCols.compatible'), key: 'compatible', width: '110px' },
  { title: t('trust.interopCols.result'), key: 'result', width: '110px' },
  { title: t('trust.interopCols.latency'), key: 'latencyMs', width: '100px' },
  { title: t('trust.interopCols.peer'), key: 'peer', width: '150px' },
  { title: t('trust.interopCols.createdAt'), key: 'createdAt', width: '160px' },
])

const satColumns = computed(() => [
  { title: t('trust.satCols.id'), key: 'id', width: '130px' },
  { title: t('trust.satCols.provider'), key: 'provider', width: '110px' },
  { title: t('trust.satCols.priority'), key: 'priority', width: '90px' },
  { title: t('trust.satCols.status'), key: 'status', width: '110px' },
  { title: t('trust.satCols.payload'), key: 'payload' },
  { title: t('trust.satCols.createdAt'), key: 'createdAt', width: '160px' },
  { title: t('trust.satCols.action'), key: 'action', width: '210px' },
])

const hsmColumns = computed(() => [
  { title: t('trust.hsmCols.id'), key: 'id', width: '130px' },
  { title: t('trust.hsmCols.vendor'), key: 'vendor', width: '110px' },
  { title: t('trust.hsmCols.model'), key: 'model', width: '140px' },
  { title: t('trust.hsmCols.serial'), key: 'serialNumber', width: '180px' },
  { title: t('trust.hsmCols.compliance'), key: 'complianceLevel', width: '140px' },
  { title: t('trust.hsmCols.firmware'), key: 'firmwareVersion', width: '110px' },
  { title: t('trust.hsmCols.action'), key: 'action', width: '160px' },
])

const filteredAttestations = computed(() => {
  let rows = attestations.value
  if (anchorFilter.value) rows = rows.filter(a => a.anchor === anchorFilter.value)
  if (attestStatusFilter.value) rows = rows.filter(a => a.status === attestStatusFilter.value)
  return rows
})

const filteredSatMessages = computed(() => {
  let rows = satMessages.value
  if (providerFilter.value) rows = rows.filter(m => m.provider === providerFilter.value)
  if (satStatusFilter.value) rows = rows.filter(m => m.status === satStatusFilter.value)
  return rows
})

const filteredHsmDevices = computed(() => {
  if (!vendorFilter.value) return hsmDevices.value
  return hsmDevices.value.filter(d => d.vendor === vendorFilter.value)
})

const attestationPassRate = computed(() => {
  if (!stats.value.attestations.total) return 0
  return (stats.value.attestations.valid / stats.value.attestations.total) * 100
})

function anchorLabel(a) {
  const key = `trust.anchorLabels.${a}`
  const v = t(key)
  return v === key ? a : v
}
function anchorColor(a) {
  return { tpm: 'blue', tee: 'purple', secure_element: 'cyan' }[a] || 'default'
}

function attestStatusLabel(s) {
  const key = `trust.attestStatusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function attestStatusColor(s) {
  return { valid: 'green', expired: 'default', failed: 'red', pending: 'processing' }[s] || 'default'
}

function satStatusLabel(s) {
  const key = `trust.satStatusLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function satStatusColor(s) {
  return { queued: 'default', sent: 'blue', confirmed: 'green', failed: 'red' }[s] || 'default'
}

function priorityColor(p) {
  if (p >= 8) return 'red'
  if (p >= 6) return 'orange'
  if (p >= 4) return 'gold'
  return 'default'
}

function providerColor(p) {
  return { iridium: 'blue', starlink: 'purple', beidou: 'red' }[p] || 'default'
}

function vendorColor(v) {
  return { yubikey: 'green', ledger: 'blue', trezor: 'orange', generic: 'default' }[v] || 'default'
}

function complianceColor(c) {
  return { fips_140_2: 'cyan', fips_140_3: 'blue', cc_eal4: 'purple' }[c] || 'default'
}

function latencyColor(ms) {
  if (ms <= 50) return 'green'
  if (ms <= 200) return 'blue'
  if (ms <= 1000) return 'gold'
  return 'red'
}

function passRateColor(pct) {
  if (pct >= 95) return '#52c41a'
  if (pct >= 80) return '#1677ff'
  if (pct >= 60) return '#faad14'
  return '#ff4d4f'
}

function truncate(s, max) {
  if (!s) return ''
  return s.length <= max ? s : s.slice(0, max) + '…'
}

function shellQuote(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`
}

async function loadAll() {
  loading.value = true
  try {
    const [attRes, interRes, satRes, hsmRes, statsRes] = await Promise.all([
      ws.execute('trust attestations --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('trust interop-tests --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('trust sat-messages --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('trust hsm-devices --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('trust stats --json', 8000).catch(() => ({ output: '' })),
    ])
    attestations.value = parseAttestations(attRes.output)
    interopTests.value = parseInteropTests(interRes.output)
    satMessages.value = parseSatMessages(satRes.output)
    hsmDevices.value = parseHsmDevices(hsmRes.output)
    stats.value = parseStats(statsRes.output)
  } catch (e) {
    message.error(t('trust.msg.loadFailed') + ': ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function submitAttest() {
  creating.value = true
  try {
    const parts = [`trust attest ${attestForm.anchor}`]
    if (attestForm.challenge.trim()) parts.push(`-c ${shellQuote(attestForm.challenge.trim())}`)
    if (attestForm.fingerprint.trim()) parts.push(`-f ${shellQuote(attestForm.fingerprint.trim())}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const r = parseAttestResult(output)
    if (!r.ok) {
      message.error(t('trust.msg.attestFailed') + ': ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(t('trust.msg.attestSuccess', { status: r.status }))
    showAttestModal.value = false
    resetAttestForm()
    await loadAll()
  } catch (e) {
    message.error(t('trust.msg.attestFailed') + ': ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function submitInterop() {
  if (!interopForm.algorithm.trim()) {
    message.warning(t('trust.msg.interopAlgEmpty'))
    return
  }
  creating.value = true
  try {
    const parts = [`trust interop-test ${shellQuote(interopForm.algorithm.trim())}`]
    if (interopForm.peer.trim()) parts.push(`-p ${shellQuote(interopForm.peer.trim())}`)
    if (interopForm.latency > 0) parts.push(`-l ${interopForm.latency}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const r = parseInteropTestResult(output)
    if (!r.ok) {
      message.error(t('trust.msg.interopFailed') + ': ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(t('trust.msg.interopSuccess', {
      compat: r.compatible ? t('trust.table.compatible') : t('trust.table.incompatible'),
      latency: r.latencyMs,
    }))
    showInteropModal.value = false
    resetInteropForm()
    await loadAll()
  } catch (e) {
    message.error(t('trust.msg.interopFailed') + ': ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function submitSat() {
  if (!satForm.payload.trim()) {
    message.warning(t('trust.msg.satPayloadEmpty'))
    return
  }
  creating.value = true
  try {
    const parts = [
      `trust sat-send ${shellQuote(satForm.payload.trim())}`,
      `-p ${satForm.provider}`,
      `-r ${satForm.priority}`,
      '--json',
    ]
    const { output } = await ws.execute(parts.join(' '), 10000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error(t('trust.msg.satFailed') + ': ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(t('trust.msg.satSuccess', { id: r.id?.slice(0, 8) }))
    showSatModal.value = false
    resetSatForm()
    await loadAll()
  } catch (e) {
    message.error(t('trust.msg.satFailed') + ': ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function updateSatStatus(record, status) {
  try {
    const { output } = await ws.execute(`trust sat-status ${record.id} ${status} --json`, 8000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error(t('trust.msg.satUpdateFailed') + ': ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(t('trust.msg.satUpdateSuccess'))
    await loadAll()
  } catch (e) {
    message.error(t('trust.msg.satUpdateFailed') + ': ' + (e?.message || e))
  }
}

async function submitHsm() {
  creating.value = true
  try {
    const parts = [`trust hsm-register ${hsmForm.vendor}`]
    if (hsmForm.model.trim()) parts.push(`-m ${shellQuote(hsmForm.model.trim())}`)
    if (hsmForm.serial.trim()) parts.push(`-s ${shellQuote(hsmForm.serial.trim())}`)
    if (hsmForm.compliance) parts.push(`-c ${hsmForm.compliance}`)
    if (hsmForm.firmware.trim()) parts.push(`-f ${shellQuote(hsmForm.firmware.trim())}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error(t('trust.msg.hsmRegisterFailed') + ': ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(t('trust.msg.hsmRegisterSuccess', { id: r.id?.slice(0, 8) }))
    showHsmModal.value = false
    resetHsmForm()
    await loadAll()
  } catch (e) {
    message.error(t('trust.msg.hsmRegisterFailed') + ': ' + (e?.message || e))
  } finally {
    creating.value = false
  }
}

async function removeHsm(record) {
  try {
    const { output } = await ws.execute(`trust hsm-remove ${record.id} --json`, 8000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error(t('trust.msg.hsmRemoveFailed') + ': ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(t('trust.msg.hsmRemoveSuccess'))
    await loadAll()
  } catch (e) {
    message.error(t('trust.msg.hsmRemoveFailed') + ': ' + (e?.message || e))
  }
}

function openSignModal(record) {
  currentDevice.value = record
  signForm.data = ''
  signForm.algorithm = ''
  signResult.value = null
  showSignModal.value = true
}

async function submitSign() {
  if (!signForm.data.trim()) {
    message.warning(t('trust.msg.signEmpty'))
    return
  }
  if (!currentDevice.value) return
  signing.value = true
  signResult.value = null
  try {
    const parts = [`trust hsm-sign ${currentDevice.value.id}`]
    parts.push(`-d ${shellQuote(signForm.data)}`)
    if (signForm.algorithm.trim()) parts.push(`-a ${shellQuote(signForm.algorithm.trim())}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    signResult.value = parseSignResult(output)
    if (signResult.value.ok) {
      message.success(t('trust.msg.signSuccess'))
    }
  } catch (e) {
    message.error(t('trust.msg.signFailed') + ': ' + (e?.message || e))
  } finally {
    signing.value = false
  }
}

function resetAttestForm() {
  attestForm.anchor = 'tpm'
  attestForm.challenge = ''
  attestForm.fingerprint = ''
}
function resetInteropForm() {
  interopForm.algorithm = 'ml_kem_768'
  interopForm.peer = ''
  interopForm.latency = 50
}
function resetSatForm() {
  satForm.provider = 'iridium'
  satForm.priority = 5
  satForm.payload = ''
}
function resetHsmForm() {
  hsmForm.vendor = 'yubikey'
  hsmForm.model = ''
  hsmForm.serial = ''
  hsmForm.compliance = undefined
  hsmForm.firmware = ''
}

onMounted(loadAll)
</script>

<style scoped>
.page-title {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 600;
}
.page-sub {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.trust-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.stat-sub {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 11px;
}

.sig-pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 11px;
  max-height: 200px;
  overflow: auto;
  color: var(--text-primary);
  word-break: break-all;
  white-space: pre-wrap;
}
</style>
