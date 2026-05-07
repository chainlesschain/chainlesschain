<!--
  MtcAudit — web-panel page exposing the full B4 audit-grade suite to the
  default web-shell user. Four tabs:
    1. Envelope query (mtc.envelope.get)
    2. Archive (mtc.archive.{push, restore, list})
    3. Governance multi-sig (mtc.governance-mofn.*)
    4. Cross-fed trust (mtc.cross-fed-trust.*)

  Pure-browser mode (cc serve in plain Chrome): main process is absent, so
  every WS topic returns "not initialized". We surface a single banner
  alert per tab + disable mutations.
-->

<script setup>
import { ref, reactive, computed } from 'vue'
import {
  Tabs,
  TabPane,
  Form,
  FormItem,
  Input,
  InputNumber,
  Textarea,
  Button,
  Alert,
  Tag,
  Card,
  Descriptions,
  DescriptionsItem,
  List,
  ListItem,
  Space,
  Typography,
  Modal,
  message,
} from 'ant-design-vue'

import { useMtcEnvelope } from '../composables/useMtcEnvelope.js'
import { useMtcArchive } from '../composables/useMtcArchive.js'
import { useGovernanceMofn } from '../composables/useGovernanceMofn.js'
import { useCrossFedTrust } from '../composables/useCrossFedTrust.js'

const envelope = useMtcEnvelope()
const archive = useMtcArchive()
const mofn = useGovernanceMofn()
const trust = useCrossFedTrust()

const activeTab = ref('envelope')

// ─── Tab 1: envelope query
const envForm = reactive({ communityId: '', messageId: '' })
async function fetchEnvelope() {
  await envelope.fetch(envForm.communityId, envForm.messageId)
}

const envelopeAdvanced = ref(false)
function copyJson(obj) {
  if (!navigator.clipboard) return
  navigator.clipboard.writeText(JSON.stringify(obj, null, 2))
  message.success('已复制到剪贴板')
}

// ─── Tab 2: archive
const archForm = reactive({
  communityId: '',
  providerKind: 'filesystem',
  rootDir: '',
  baseUrl: '',
  username: '',
  password: '',
  remoteRoot: '',
  sinceBatchId: '',
  archiveName: '',
})

const providerSpec = computed(() => {
  if (archForm.providerKind === 'filesystem') {
    return { kind: 'filesystem', rootDir: archForm.rootDir }
  }
  if (archForm.providerKind === 'webdav') {
    return {
      kind: 'webdav',
      baseUrl: archForm.baseUrl,
      username: archForm.username,
      password: archForm.password,
      remoteRoot: archForm.remoteRoot,
    }
  }
  return null
})

async function archiveList() {
  await archive.listArchives(archForm.communityId, providerSpec.value)
}
async function archivePush() {
  const opts = {}
  if (archForm.sinceBatchId) opts.sinceBatchId = archForm.sinceBatchId
  const r = await archive.pushArchive(archForm.communityId, providerSpec.value, opts)
  if (r) message.success(`归档已推送：${r.name} (${r.bytes} bytes)`)
}
async function archiveRestore() {
  const r = await archive.restoreArchive(
    archForm.communityId,
    archForm.archiveName,
    providerSpec.value,
  )
  if (r) message.success(`恢复完成：${r.restored} 新文件 / ${r.skipped} 跳过`)
}

// ─── Tab 3: governance M-of-N
const propForm = reactive({
  communityId: '',
  proposalId: '',
  payload: '{ "kind": "rule_change", "body": "" }',
  members: '',
  threshold: 2,
})

async function mofnList() {
  await mofn.listProposals(propForm.communityId)
}
async function mofnCreate() {
  let parsedPayload
  try {
    parsedPayload = JSON.parse(propForm.payload)
  } catch (err) {
    message.error('payload 必须是合法 JSON: ' + err.message)
    return
  }
  const memberList = propForm.members
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const r = await mofn.createProposal({
    communityId: propForm.communityId,
    proposalId: propForm.proposalId,
    payload: parsedPayload,
    members: memberList,
    threshold: propForm.threshold,
  })
  if (r) {
    message.success(`提案已创建：${r.proposalId} (${r.threshold}-of-${r.members.length})`)
    await mofnList()
  }
}
async function mofnFinalize(proposalId) {
  const r = await mofn.finalize(propForm.communityId, proposalId)
  if (r) {
    message.success(`提案已 finalize: ${r.treeHeadId.slice(0, 24)}...`)
    await mofnList()
  }
}
async function mofnStatus(proposalId) {
  await mofn.getStatus(propForm.communityId, proposalId)
}
async function mofnSignAsSelf(proposalId) {
  // B4-mofn-sign v2 — main process resolves current DID identity and
  // signs locally; renderer never sees the private key. UI just sends
  // (communityId, proposalId).
  const r = await mofn.signAsSelf(propForm.communityId, proposalId)
  if (r) {
    message.success(
      `已用本人身份 (${(r.signerDID || '').slice(-8)}) 代签 — 已收集 ${r.collected}/${r.threshold}`,
    )
    await mofnList()
  }
}

// ─── Tab 4: cross-fed trust
const trustForm = reactive({
  localCommunityId: '',
  remoteCommunityId: '',
  remoteMembers: '',
  expiresAt: '',
  note: '',
})
async function trustList() {
  await trust.listTrust(trustForm.localCommunityId)
}
async function trustEstablish() {
  const memberList = trustForm.remoteMembers
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const r = await trust.establishTrust({
    localCommunityId: trustForm.localCommunityId,
    remoteCommunityId: trustForm.remoteCommunityId,
    remoteMembers: memberList,
    expiresAt: trustForm.expiresAt,
    note: trustForm.note,
  })
  if (r) {
    message.success(`信任已建立: ${trustForm.localCommunityId} ↔ ${trustForm.remoteCommunityId}`)
    await trustList()
  }
}
async function trustRevoke(remoteCommunityId) {
  Modal.confirm({
    title: '确认撤销跨联邦信任？',
    content: `${trustForm.localCommunityId} → ${remoteCommunityId} 将不再被 inbound landmark 校验接受`,
    onOk: async () => {
      const r = await trust.revokeTrust(trustForm.localCommunityId, remoteCommunityId)
      if (r) {
        message.success('已撤销')
        await trustList()
      }
    },
  })
}
async function trustDids() {
  await trust.getTrustedDids(trustForm.localCommunityId)
}
</script>

<template>
  <div class="mtc-audit-page">
    <Typography.Title :level="3">🔐 MTC 审计套件 (B4)</Typography.Title>
    <Typography.Paragraph type="secondary">
      Merkle envelope 查询 / 外部归档 / M-of-N 治理 / 跨联邦信任锚 — 全套对外暴露。
      默认壳走 WS topic <code>mtc.*</code>，主进程未托管对应 manager 时按钮会返回错误信息。
    </Typography.Paragraph>

    <Alert
      v-if="!envelope.isEmbedded"
      type="warning"
      show-icon
      message="非嵌入式 web-shell"
      description="此页所有功能依赖桌面主进程的 channelEventBatcher / channelEnvelopeArchiver / governanceMultiSig / crossFedTrust 实例 — 请用桌面 Web Shell 访问，纯浏览器模式下按钮会一律失败。"
      style="margin-bottom: 16px"
    />

    <Tabs v-model:active-key="activeTab">
      <!-- ─────────────────────────────────────────── -->
      <TabPane key="envelope" tab="Envelope 查询">
        <Form layout="inline" @submit.prevent="fetchEnvelope">
          <FormItem label="communityId">
            <Input v-model:value="envForm.communityId" placeholder="comm-X" allow-clear />
          </FormItem>
          <FormItem label="messageId">
            <Input v-model:value="envForm.messageId" placeholder="msg-X" allow-clear />
          </FormItem>
          <FormItem>
            <Button
              type="primary"
              html-type="submit"
              :loading="envelope.state.value.phase === 'loading'"
              :disabled="!envelope.isEmbedded"
            >
              查询
            </Button>
          </FormItem>
        </Form>

        <div style="margin-top: 16px">
          <Alert
            v-if="envelope.state.value.phase === 'error'"
            type="error"
            show-icon
            :message="envelope.state.value.message"
          />
          <Alert
            v-else-if="envelope.state.value.phase === 'not-found'"
            type="warning"
            show-icon
            message="未找到密码学证据"
            :description="envelope.state.value.reason || '消息可能尚未被打包到 Merkle 批，或发送方未在线。'"
          />
          <template v-else-if="envelope.state.value.phase === 'found'">
            <Descriptions bordered :column="1" size="small">
              <DescriptionsItem label="来源">
                <Tag :color="envelope.state.value.result.origin === 'local' ? 'green' : 'blue'">
                  {{ envelope.state.value.result.origin === 'local' ? '本机批次' : '远端拉取' }}
                </Tag>
                <Tag v-if="envelope.state.value.result.staging" color="orange">尚未关闭批次</Tag>
              </DescriptionsItem>
              <DescriptionsItem label="Tree Head ID">
                <code>{{ envelope.state.value.result.treeHeadId }}</code>
              </DescriptionsItem>
              <DescriptionsItem v-if="envelope.state.value.result.batchId" label="Batch ID">
                {{ envelope.state.value.result.batchId }}
              </DescriptionsItem>
              <DescriptionsItem v-if="envelope.state.value.result.namespace" label="Namespace">
                <code>{{ envelope.state.value.result.namespace }}</code>
              </DescriptionsItem>
              <DescriptionsItem
                v-if="envelope.state.value.result.leafIndex !== undefined"
                label="Leaf Index"
              >
                {{ envelope.state.value.result.leafIndex }}
              </DescriptionsItem>
            </Descriptions>
            <Button
              type="link"
              size="small"
              style="padding-left: 0; margin-top: 8px"
              @click="envelopeAdvanced = !envelopeAdvanced"
            >
              {{ envelopeAdvanced ? '收起' : '展开' }} raw JSON
            </Button>
            <div v-if="envelopeAdvanced" style="margin-top: 8px">
              <Card size="small">
                <template #title>
                  <Space>
                    <span>Envelope</span>
                    <Button size="small" @click="copyJson(envelope.state.value.result.envelope)">复制</Button>
                  </Space>
                </template>
                <pre style="font-size: 12px; max-height: 240px; overflow: auto">{{
                  JSON.stringify(envelope.state.value.result.envelope, null, 2)
                }}</pre>
              </Card>
              <Card v-if="envelope.state.value.result.landmark" size="small" style="margin-top: 8px">
                <template #title>
                  <Space>
                    <span>Landmark</span>
                    <Button size="small" @click="copyJson(envelope.state.value.result.landmark)">复制</Button>
                  </Space>
                </template>
                <pre style="font-size: 12px; max-height: 240px; overflow: auto">{{
                  JSON.stringify(envelope.state.value.result.landmark, null, 2)
                }}</pre>
              </Card>
            </div>
          </template>
        </div>
      </TabPane>

      <!-- ─────────────────────────────────────────── -->
      <TabPane key="archive" tab="Archive 归档">
        <Form layout="vertical">
          <FormItem label="communityId" required>
            <Input v-model:value="archForm.communityId" placeholder="comm-X" />
          </FormItem>
          <FormItem label="provider 类型">
            <Space>
              <Button
                :type="archForm.providerKind === 'filesystem' ? 'primary' : 'default'"
                @click="archForm.providerKind = 'filesystem'"
              >
                Filesystem
              </Button>
              <Button
                :type="archForm.providerKind === 'webdav' ? 'primary' : 'default'"
                @click="archForm.providerKind = 'webdav'"
              >
                WebDAV
              </Button>
            </Space>
          </FormItem>
          <FormItem v-if="archForm.providerKind === 'filesystem'" label="rootDir 本地路径" required>
            <Input v-model:value="archForm.rootDir" placeholder="/path/to/archive-mirror" />
          </FormItem>
          <template v-else>
            <FormItem label="baseUrl">
              <Input v-model:value="archForm.baseUrl" placeholder="https://nas.example/dav" />
            </FormItem>
            <FormItem label="username">
              <Input v-model:value="archForm.username" />
            </FormItem>
            <FormItem label="password">
              <Input v-model:value="archForm.password" type="password" />
            </FormItem>
            <FormItem label="remoteRoot">
              <Input v-model:value="archForm.remoteRoot" placeholder="/cc-archives" />
            </FormItem>
          </template>
          <FormItem label="(可选) sinceBatchId 增量推">
            <Input v-model:value="archForm.sinceBatchId" placeholder="000005" />
          </FormItem>
          <FormItem label="(restore 用) archiveName">
            <Input v-model:value="archForm.archiveName" placeholder="channel-mtc-...zip" />
          </FormItem>
          <FormItem>
            <Space>
              <Button :loading="archive.loading.value" @click="archiveList">列出归档</Button>
              <Button
                type="primary"
                :loading="archive.loading.value"
                :disabled="!archive.isEmbedded"
                @click="archivePush"
              >
                推送
              </Button>
              <Button
                :loading="archive.loading.value"
                :disabled="!archive.isEmbedded"
                @click="archiveRestore"
              >
                恢复
              </Button>
            </Space>
          </FormItem>
        </Form>

        <Alert v-if="archive.errorMessage.value" type="error" show-icon :message="archive.errorMessage.value" />

        <List
          v-if="archive.archives.value.length"
          size="small"
          bordered
          :data-source="archive.archives.value"
          style="margin-top: 12px"
        >
          <template #header>
            <span>provider 现有归档（{{ archive.archives.value.length }}）</span>
          </template>
          <template #renderItem="{ item }">
            <ListItem>
              <code>{{ item }}</code>
              <Button size="small" type="link" @click="archForm.archiveName = item">填入恢复</Button>
            </ListItem>
          </template>
        </List>

        <Card v-if="archive.lastResult.value" size="small" style="margin-top: 12px">
          <template #title>最近一次操作</template>
          <pre style="font-size: 12px; max-height: 200px; overflow: auto">{{
            JSON.stringify(archive.lastResult.value, null, 2)
          }}</pre>
        </Card>
      </TabPane>

      <!-- ─────────────────────────────────────────── -->
      <TabPane key="mofn" tab="Governance M-of-N">
        <Form layout="vertical">
          <FormItem label="communityId" required>
            <Input v-model:value="propForm.communityId" placeholder="comm-X" />
          </FormItem>
          <FormItem label="proposalId" required>
            <Input v-model:value="propForm.proposalId" placeholder="prop-rule-1" />
          </FormItem>
          <FormItem label="payload (JSON)">
            <Textarea v-model:value="propForm.payload" :rows="3" />
          </FormItem>
          <FormItem label="members（DID 列表，空白分隔）">
            <Textarea v-model:value="propForm.members" :rows="3" placeholder="did:chainlesschain:abc&#10;did:chainlesschain:def" />
          </FormItem>
          <FormItem label="threshold">
            <InputNumber v-model:value="propForm.threshold" :min="1" :max="100" />
          </FormItem>
          <FormItem>
            <Space>
              <Button :loading="mofn.loading.value" @click="mofnList">刷新提案列表</Button>
              <Button
                type="primary"
                :loading="mofn.loading.value"
                :disabled="!mofn.isEmbedded"
                @click="mofnCreate"
              >
                创建提案
              </Button>
            </Space>
          </FormItem>
        </Form>

        <Alert v-if="mofn.errorMessage.value" type="error" show-icon :message="mofn.errorMessage.value" style="margin: 12px 0" />

        <Alert
          type="success"
          show-icon
          message="签名收集 v2 — 主进程代签"
          description="点击提案行的「代我签名」按钮：renderer 只发 (communityId, proposalId)，桌面主进程从 DIDManager 取本人当前身份，在主进程内完成 Ed25519 签名后写入 staging/。私钥永不离开主进程。"
          style="margin-bottom: 12px"
        />

        <List
          v-if="mofn.proposals.value.length"
          size="small"
          bordered
          :data-source="mofn.proposals.value"
        >
          <template #header>
            <span>提案列表（{{ mofn.proposals.value.length }}）</span>
          </template>
          <template #renderItem="{ item }">
            <ListItem>
              <ListItem.Meta>
                <template #title>
                  <Space>
                    <code>{{ item.proposalId }}</code>
                    <Tag :color="item.finalized ? 'green' : 'blue'">
                      {{ item.finalized ? '已最终化' : `${item.collected}/${item.threshold} 收集中` }}
                    </Tag>
                  </Space>
                </template>
                <template #description>
                  members={{ item.members.length }} · created {{ item.createdAt }}
                </template>
              </ListItem.Meta>
              <Space>
                <Button size="small" :loading="mofn.loading.value" @click="mofnStatus(item.proposalId)">详情</Button>
                <Button
                  size="small"
                  :disabled="item.finalized || !mofn.isEmbedded"
                  :loading="mofn.loading.value"
                  @click="mofnSignAsSelf(item.proposalId)"
                >
                  代我签名
                </Button>
                <Button
                  size="small"
                  type="primary"
                  :disabled="item.finalized || item.collected < item.threshold || !mofn.isEmbedded"
                  :loading="mofn.loading.value"
                  @click="mofnFinalize(item.proposalId)"
                >
                  Finalize
                </Button>
              </Space>
            </ListItem>
          </template>
        </List>

        <Card v-if="mofn.currentStatus.value" size="small" style="margin-top: 12px">
          <template #title>当前提案状态</template>
          <pre style="font-size: 12px; max-height: 240px; overflow: auto">{{
            JSON.stringify(mofn.currentStatus.value, null, 2)
          }}</pre>
        </Card>
      </TabPane>

      <!-- ─────────────────────────────────────────── -->
      <TabPane key="trust" tab="Cross-Fed Trust">
        <Form layout="vertical">
          <FormItem label="localCommunityId" required>
            <Input v-model:value="trustForm.localCommunityId" placeholder="comm-engineering" />
          </FormItem>
          <FormItem label="remoteCommunityId">
            <Input v-model:value="trustForm.remoteCommunityId" placeholder="comm-research" />
          </FormItem>
          <FormItem label="remoteMembers（DID 列表，空白分隔）">
            <Textarea v-model:value="trustForm.remoteMembers" :rows="3" />
          </FormItem>
          <FormItem label="expiresAt（ISO 时间，留空表示永久）">
            <Input v-model:value="trustForm.expiresAt" placeholder="2099-01-01T00:00:00Z" />
          </FormItem>
          <FormItem label="note (可选)">
            <Input v-model:value="trustForm.note" />
          </FormItem>
          <FormItem>
            <Space>
              <Button :loading="trust.loading.value" @click="trustList">刷新</Button>
              <Button
                type="primary"
                :loading="trust.loading.value"
                :disabled="!trust.isEmbedded"
                @click="trustEstablish"
              >
                建立信任
              </Button>
              <Button :loading="trust.loading.value" @click="trustDids">查看合并 DID 集</Button>
            </Space>
          </FormItem>
        </Form>

        <Alert v-if="trust.errorMessage.value" type="error" show-icon :message="trust.errorMessage.value" />

        <List
          v-if="trust.records.value.length"
          size="small"
          bordered
          :data-source="trust.records.value"
          style="margin-top: 12px"
        >
          <template #header>
            <span>已建立信任（{{ trust.records.value.length }}）</span>
          </template>
          <template #renderItem="{ item }">
            <ListItem>
              <ListItem.Meta>
                <template #title>
                  <Space>
                    <code>{{ item.remoteCommunityId }}</code>
                    <Tag color="blue">{{ item.remoteMembers.length }} 成员</Tag>
                    <Tag v-if="item.expiresAt" color="orange">expires {{ item.expiresAt }}</Tag>
                    <Tag v-else color="green">永久</Tag>
                  </Space>
                </template>
                <template #description>
                  {{ item.note || '(无备注)' }} · issued {{ item.issuedAt }}
                </template>
              </ListItem.Meta>
              <Button size="small" danger :disabled="!trust.isEmbedded" @click="trustRevoke(item.remoteCommunityId)">
                撤销
              </Button>
            </ListItem>
          </template>
        </List>

        <Card v-if="trust.trustedDids.value.length" size="small" style="margin-top: 12px">
          <template #title>合并 DID 集（{{ trust.trustedDids.value.length }} 个）</template>
          <List size="small" :data-source="trust.trustedDids.value">
            <template #renderItem="{ item }">
              <ListItem>
                <code>{{ item }}</code>
              </ListItem>
            </template>
          </List>
        </Card>
      </TabPane>
    </Tabs>
  </div>
</template>

<style scoped>
.mtc-audit-page {
  padding: 16px;
  max-width: 1200px;
}
.mtc-audit-page :deep(.ant-card-head-title) {
  font-size: 13px;
}
.mtc-audit-page pre {
  background: var(--ant-color-fill-alter, #fafafa);
  padding: 8px;
  border-radius: 4px;
  margin: 0;
}
</style>
