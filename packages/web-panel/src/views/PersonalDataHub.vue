<template>
  <div class="pdh-page">
    <!-- Page header -->
    <div class="pdh-header">
      <div>
        <h2 class="page-title">个人数据中台</h2>
        <p class="page-sub">
          让数据回归个人 — 各 app 数据本地加密落盘，本地 LLM 跨源分析，零云端外传。
        </p>
      </div>
      <a-space>
        <a-button :loading="loading.refresh" @click="refresh">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
        <a-badge :count="resolverStats.reviewQueue" :offset="[0,0]">
          <a-button type="primary" ghost @click="openReviewQueue">
            <template #icon><LinkOutlined /></template>
            待消歧
          </a-button>
        </a-badge>
        <a-button type="primary" ghost @click="auditOpen = true">
          <template #icon><FileSearchOutlined /></template>
          审计日志
        </a-button>
      </a-space>
    </div>

    <!-- Health row -->
    <a-row :gutter="16" style="margin-bottom: 16px;">
      <a-col :xs="24" :sm="12" :md="6">
        <a-card size="small" :title="'Vault'">
          <template #extra>
            <a-tag :color="health?.vault?.ok ? 'green' : 'red'">
              {{ health?.vault?.ok ? '正常' : '未就绪' }}
            </a-tag>
          </template>
          <div class="kv">schema v{{ health?.vault?.schemaVersion ?? '?' }}</div>
          <div class="kv" v-if="stats?.vault">
            事件 {{ stats.vault.events }} · 联系人 {{ stats.vault.persons }}
          </div>
          <div class="kv" v-if="stats?.vault">
            地点 {{ stats.vault.places }} · 商品 {{ stats.vault.items }} · 主题 {{ stats.vault.topics }}
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="12" :md="6">
        <a-card size="small" :title="'本地 LLM'">
          <template #extra>
            <a-tag :color="health?.llm?.ok ? (health.llm.isLocal ? 'green' : 'orange') : 'red'">
              {{ health?.llm?.ok ? (health.llm.isLocal ? '本地' : '非本地') : '未就绪' }}
            </a-tag>
          </template>
          <div class="kv">{{ health?.llm?.name || '—' }}</div>
          <div class="kv hint" v-if="health?.llm?.ok && !health.llm.isLocal">
            ⚠️ 非本地 — ask 会被隐私 gate 拒绝，除非显式 acceptNonLocal
          </div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="12" :md="6">
        <a-card size="small" :title="'KG 索引'">
          <template #extra>
            <a-tag :color="health?.kgSink?.ok ? 'green' : 'default'">
              {{ health?.kgSink?.ok ? '已连接' : '不可用' }}
            </a-tag>
          </template>
          <div class="kv">events / persons → cc knowledge-graph 实体 + 关系</div>
        </a-card>
      </a-col>

      <a-col :xs="24" :sm="12" :md="6">
        <a-card size="small" :title="'RAG 索引'">
          <template #extra>
            <a-tag :color="health?.ragSink?.ok ? 'green' : 'default'">
              {{ health?.ragSink?.ok ? '已连接' : '不可用' }}
            </a-tag>
          </template>
          <div class="kv">文本 → BM25（vector 留待后续 phase）</div>
        </a-card>
      </a-col>
    </a-row>

    <!-- Ask box -->
    <a-card style="margin-bottom: 16px;">
      <template #title>
        <a-space><MessageOutlined /><span>问我数据</span></a-space>
      </template>
      <a-textarea
        v-model:value="askInput"
        :rows="2"
        placeholder="例：上个月在淘宝总共花了多少？／我妈生日那周买了啥送哪儿？"
        @keydown.enter.exact.prevent="ask"
      />
      <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
        <a-checkbox v-model:checked="acceptNonLocal">允许非本地 LLM (volcengine / anthropic 等)</a-checkbox>
        <a-button type="primary" :loading="loading.ask" :disabled="!askInput.trim()" @click="ask">
          <template #icon><SendOutlined /></template>
          提问
        </a-button>
      </div>

      <div v-if="askError" style="margin-top: 12px;">
        <a-alert type="error" show-icon :message="askError" />
      </div>

      <div v-if="askResult" style="margin-top: 12px;">
        <a-alert
          v-if="askResult.warning === 'no-facts'"
          type="warning"
          show-icon
          message="vault 里没找到匹配的事件（'no-facts'）—— 先同步几个 adapter 让数据进 vault"
          style="margin-bottom: 12px;"
        />
        <a-alert
          v-else-if="askResult.warning === 'hallucinated-citations'"
          type="warning"
          show-icon
          :message="`LLM 引用了 ${askResult.hallucinatedCitations?.length || 0} 个不存在的 event id —— 模型在编造`"
          style="margin-bottom: 12px;"
        />
        <div class="answer">{{ askResult.answer }}</div>
        <div style="margin-top: 8px; font-size: 12px; color: var(--text-color-secondary, #888);">
          引用 {{ askResult.citations?.length || 0 }} 条事实 · {{ askResult.facts?.length || 0 }} facts 入 prompt ·
          {{ askResult.durationMs }}ms · {{ askResult.model }}
        </div>
        <div v-if="askResult.citations?.length" style="margin-top: 8px;">
          <span style="font-size: 12px; color: var(--text-color-secondary, #888);">事件链接（点击查看明细 / PDF 解密结果）：</span>
          <a-space style="margin-top: 4px;" wrap>
            <a-tag
              v-for="cid in askResult.citations"
              :key="cid"
              color="blue"
              style="cursor: pointer;"
              @click="showEventDetail(cid)"
            >
              {{ cid }}
            </a-tag>
          </a-space>
        </div>
      </div>
    </a-card>

    <!-- Phase 11 — Analysis Skills cards -->
    <a-card style="margin-bottom: 16px;">
      <template #title>
        <a-space><BulbOutlined /><span>分析 skill (Phase 11)</span></a-space>
      </template>
      <template #extra>
        <a-tag color="purple">5 内置</a-tag>
      </template>
      <a-row :gutter="[12, 12]">
        <a-col :xs="24" :sm="12" :md="8" v-for="s in analysisSkills" :key="s.name">
          <a-card size="small" hoverable @click="runSkill(s.name)">
            <div style="display: flex; align-items: center; gap: 8px;">
              <component :is="s.icon" style="font-size: 18px; color: #722ed1;" />
              <strong>{{ s.label }}</strong>
            </div>
            <div class="hint" style="margin-top: 4px;">{{ s.description }}</div>
          </a-card>
        </a-col>
      </a-row>
      <div v-if="skillResult" style="margin-top: 16px;">
        <a-divider plain orientation="left">{{ skillResult.skill }} 结果</a-divider>
        <a-spin :spinning="loading.skill">
          <pre class="json-pre" style="max-height: 300px; overflow: auto;">{{ JSON.stringify(skillResult, null, 2) }}</pre>
          <div v-if="skillResult.llm_commentary || skillResult.llm_narrative" style="margin-top: 8px;">
            <a-alert type="info" :message="skillResult.llm_commentary || skillResult.llm_narrative" />
          </div>
        </a-spin>
      </div>
    </a-card>

    <!-- Adapters -->
    <a-card style="margin-bottom: 16px;">
      <template #title>
        <a-space><AppstoreOutlined /><span>Adapters</span></a-space>
      </template>
      <template #extra>
        <a-space>
          <a-button @click="emailConfigOpen = true">
            <template #icon><MailOutlined /></template>
            添加邮箱账号
          </a-button>
          <a-button @click="alipayConfigOpen = true">
            <template #icon><WalletOutlined /></template>
            导入支付宝账单
          </a-button>
          <a-button @click="aichatWizardOpen = true">
            <template #icon><RobotOutlined /></template>
            添加 AI 对话账号
          </a-button>
          <a-button @click="wechatWizardOpen = true">
            <template #icon><WechatOutlined /></template>
            添加 WeChat
          </a-button>
          <a-button @click="bilibiliAdbDoctor" :loading="loading.bilibiliAdbDoctor">
            诊断 Bilibili ADB
          </a-button>
          <a-button @click="bilibiliAdbSync" :loading="loading.bilibiliAdbSync">
            通过 PC ADB 同步 Bilibili
          </a-button>
          <a-button @click="weiboAdbSync" :loading="loading.weiboAdbSync">
            通过 PC ADB 同步 Weibo
          </a-button>
          <a-button @click="xhsAdbSync" :loading="loading.xhsAdbSync">
            通过 PC ADB 同步 Xhs
          </a-button>
          <a-button @click="toutiaoAdbSync" :loading="loading.toutiaoAdbSync">
            通过 PC ADB 同步 Toutiao
          </a-button>
          <a-button @click="kuaishouAdbSync" :loading="loading.kuaishouAdbSync">
            通过 PC ADB 同步 Kuaishou
          </a-button>
          <a-button @click="bridgeDoctor" :loading="loading.bridgeDoctor">
            诊断签名 Bridges
          </a-button>
          <a-button @click="douyinAdbSync" :loading="loading.douyinAdbSync">
            通过 PC ADB 同步 Douyin
          </a-button>
          <a-button @click="addMock" :loading="loading.addMock">
            注册 MockAdapter（开发）
          </a-button>
          <a-button type="primary" @click="syncAll" :loading="loading.syncAll" :disabled="!adapters.length">
            同步全部
          </a-button>
        </a-space>
      </template>

      <a-table
        v-if="adapters.length"
        :columns="adapterColumns"
        :data-source="adapters"
        :pagination="false"
        :row-key="(r) => r.name"
        size="middle"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'sensitivity'">
            <a-tag :color="sensitivityColor(record.sensitivity)">{{ record.sensitivity }}</a-tag>
            <a-tag v-if="record.legalGate" color="red" style="margin-left: 4px;">需法律确认</a-tag>
          </template>
          <template v-else-if="column.key === 'capabilities'">
            <a-tag v-for="c in record.capabilities" :key="c" style="margin-right: 4px;">{{ c }}</a-tag>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button size="small" :loading="loading.sync[record.name]" @click="syncOne(record.name)">
                同步
              </a-button>
              <!-- Per-kind include toggles (only adapters with multi-kind
                   bridge output show this — currently just system-data-android).
                   Popover content is a checkbox group writing into
                   syncIncludeOptions[record.name]; changes auto-persist to
                   localStorage so the user's privacy choice survives reloads. -->
              <a-popover
                v-if="adapterHasIncludeToggles(record.name)"
                v-model:open="includePopoverOpen[record.name]"
                trigger="click"
                placement="left"
                :title="`${record.name} 采集范围`"
              >
                <template #content>
                  <div style="min-width: 220px;">
                    <div
                      v-for="kind in INCLUDE_KIND_META[record.name]"
                      :key="kind.key"
                      style="margin: 6px 0;"
                    >
                      <a-checkbox
                        :checked="syncIncludeOptions[record.name][kind.key] !== false"
                        @change="onIncludeKindToggle(record.name, kind.key, $event)"
                      >
                        {{ kind.label }}
                        <span style="color: #999; font-size: 12px; margin-left: 4px;">
                          {{ kind.hint }}
                        </span>
                        <a-tag v-if="kind.sensitive" color="orange" size="small" style="margin-left: 4px;">敏感</a-tag>
                      </a-checkbox>
                    </div>
                    <div style="margin-top: 8px; font-size: 11px; color: #999;">
                      取消勾选的数据本次同步不会拉取入库
                    </div>
                  </div>
                </template>
                <a-button size="small" title="选择采集范围">⚙</a-button>
              </a-popover>
              <a-popconfirm
                :title="`从注册表移除 ${record.name}？（vault 数据不会删除）`"
                @confirm="unregisterAdapter(record.name)"
              >
                <a-button size="small" danger>移除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
      <a-empty v-else description="无已注册 adapter — 点上方按钮注册 MockAdapter 看效果" />

      <!-- Phase 5.7 — live sync progress -->
      <div v-if="syncProgress.active" style="margin-top: 12px;">
        <a-card size="small" :bordered="true">
          <div class="kv" style="margin-bottom: 4px;">
            <strong>同步进行中</strong> · {{ syncProgress.adapter }} · {{ syncProgress.phase || '...' }}
            <span v-if="syncProgress.attempt && syncProgress.attempt > 1" style="color: #faad14;">
              (重试 #{{ syncProgress.attempt }})
            </span>
          </div>
          <a-progress
            v-if="syncProgress.total > 0"
            :percent="Math.round((syncProgress.current / syncProgress.total) * 100)"
            :status="syncProgress.errorMessage ? 'exception' : 'active'"
            size="small"
          />
          <a-progress v-else :percent="0" status="active" size="small" />
          <div class="kv hint" v-if="syncProgress.mailbox">
            邮箱 {{ syncProgress.mailbox }} · {{ syncProgress.current }} / {{ syncProgress.total }}
          </div>
          <div v-if="syncProgress.errorMessage" class="kv hint" style="color: #ff4d4f;">
            {{ syncProgress.errorMessage }}
          </div>
        </a-card>
      </div>

      <!-- Last sync report -->
      <div v-if="lastSync" style="margin-top: 12px;">
        <a-alert
          :type="lastSync.status === 'ok' ? 'success' : 'error'"
          show-icon
          :message="`同步 ${lastSync.adapter}: ${lastSync.status}`"
          :description="syncSummary(lastSync)"
        />
      </div>
    </a-card>

    <!-- Email config drawer (Phase 5.6) -->
    <a-drawer
      v-model:open="emailConfigOpen"
      title="添加邮箱账号"
      placement="right"
      width="560"
      :destroy-on-close="true"
      @close="resetEmailForm"
    >
      <a-alert
        message="数据回归个人 — 凭证落本地加密文件（与 vault 主密钥同目录），同步动作 100% 本地。"
        type="info"
        show-icon
        style="margin-bottom: 16px;"
      />

      <a-form layout="vertical" :model="emailForm">
        <a-form-item label="邮箱服务商" required>
          <a-select v-model:value="emailForm.provider" placeholder="选择服务商">
            <a-select-option value="qq">QQ 邮箱 (imap.qq.com)</a-select-option>
            <a-select-option value="163">网易邮箱 163/126</a-select-option>
            <a-select-option value="189">189 邮箱</a-select-option>
            <a-select-option value="outlook">Outlook / Hotmail</a-select-option>
            <a-select-option value="gmail">Gmail</a-select-option>
            <a-select-option value="custom">自定义 IMAP</a-select-option>
          </a-select>
        </a-form-item>

        <a-form-item label="邮箱地址" required>
          <a-input v-model:value="emailForm.email" placeholder="you@qq.com" autocomplete="off" />
        </a-form-item>

        <a-form-item required>
          <template #label>
            <a-space>
              <span>授权码（非登录密码）</span>
              <a-tooltip :title="providerAuthHint(emailForm.provider)">
                <InfoCircleOutlined style="color: #888;" />
              </a-tooltip>
            </a-space>
          </template>
          <a-input-password
            v-model:value="emailForm.authCode"
            placeholder="例：QQ 邮箱 设置 → 账户 → 开启 IMAP/SMTP → 生成的授权码"
            autocomplete="off"
          />
        </a-form-item>

        <a-form-item v-if="emailForm.provider === 'custom'" label="IMAP host">
          <a-input v-model:value="emailForm.host" placeholder="mail.example.com" />
        </a-form-item>
        <a-form-item v-if="emailForm.provider === 'custom'" label="端口">
          <a-input-number v-model:value="emailForm.port" :min="1" :max="65535" :default-value="993" />
        </a-form-item>

        <a-divider orientation="left" plain>PDF 账单解密提示（可选）</a-divider>
        <p class="hint">银行 PDF 月结大多加密；提供几个常用候选项让 Phase 5.5 自动解锁：</p>
        <a-form-item label="身份证后 6 位">
          <a-input v-model:value="emailForm.pdfPasswordHints.idCardLast6" placeholder="123456" autocomplete="off" />
        </a-form-item>
        <a-form-item label="手机后 6 位">
          <a-input v-model:value="emailForm.pdfPasswordHints.phoneLast6" placeholder="123456" autocomplete="off" />
        </a-form-item>
        <a-form-item label="信用卡尾 6 位">
          <a-input v-model:value="emailForm.pdfPasswordHints.cardLast6" placeholder="123456" autocomplete="off" />
        </a-form-item>

        <div v-if="emailTestResult" style="margin-top: 8px;">
          <a-alert
            :type="emailTestResult.ok ? 'success' : 'error'"
            show-icon
            :message="emailTestResult.ok ? '凭证有效 — 可以保存' : `认证失败: ${emailTestResult.reason || emailTestResult.error}`"
          />
        </div>
      </a-form>

      <template #footer>
        <a-space>
          <a-button @click="emailConfigOpen = false">取消</a-button>
          <a-button :loading="loading.testEmail" :disabled="!emailFormValid" @click="testEmailAuth">
            测试连接
          </a-button>
          <a-button
            type="primary"
            :loading="loading.saveEmail"
            :disabled="!emailFormValid || !emailTestResult?.ok"
            @click="saveEmail"
          >
            保存并注册
          </a-button>
        </a-space>
      </template>
    </a-drawer>

    <!-- Event detail drawer (Phase 5.6) -->
    <a-drawer
      v-model:open="eventDetailOpen"
      :title="eventDetail ? `事件 ${eventDetail.event.id}` : '加载中...'"
      placement="right"
      width="640"
      :destroy-on-close="true"
    >
      <template v-if="eventDetail">
        <a-descriptions :column="1" size="small" bordered>
          <a-descriptions-item label="类型">{{ eventDetail.event.subtype }}</a-descriptions-item>
          <a-descriptions-item label="发生于">
            {{ new Date(eventDetail.event.occurredAt).toLocaleString() }}
          </a-descriptions-item>
          <a-descriptions-item label="actor">{{ eventDetail.event.actor }}</a-descriptions-item>
          <a-descriptions-item v-if="eventDetail.event.content?.title" label="标题">
            {{ eventDetail.event.content.title }}
          </a-descriptions-item>
          <a-descriptions-item v-if="eventDetail.event.source?.adapter" label="来源 adapter">
            {{ eventDetail.event.source.adapter }} @ v{{ eventDetail.event.source.adapterVersion }}
          </a-descriptions-item>
        </a-descriptions>

        <a-divider v-if="eventDetail.classification" orientation="left" plain>分类</a-divider>
        <div v-if="eventDetail.classification">
          <a-tag color="blue">{{ eventDetail.classification.category }}</a-tag>
          <a-tag>{{ eventDetail.classification.layer }}</a-tag>
          <span style="margin-left: 8px;">置信 {{ Math.round((eventDetail.classification.confidence || 0) * 100) }}%</span>
        </div>

        <a-divider v-if="eventDetail.extraction" orientation="left" plain>结构化字段（{{ eventDetail.extraction.template }}）</a-divider>
        <pre v-if="eventDetail.extraction" class="json-pre">{{ JSON.stringify(eventDetail.extraction.fields, null, 2) }}</pre>

        <a-divider v-if="eventDetail.extraction?.pdfExtraction" orientation="left" plain>PDF 解密 / 解析</a-divider>
        <a-list
          v-if="eventDetail.extraction?.pdfExtraction"
          :data-source="eventDetail.extraction.pdfExtraction"
          size="small"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta :title="item.filename">
                <template #description>
                  <div>
                    <a-tag :color="item.decrypted ? 'green' : 'red'">
                      {{ item.decrypted ? '已解密' : '解密失败' }}
                    </a-tag>
                    <span style="margin-left: 6px;">尝试 {{ item.attempted }} 次</span>
                    <span v-if="item.transactionsExtracted != null" style="margin-left: 6px;">
                      · 提取 {{ item.transactionsExtracted }} 条交易
                    </span>
                  </div>
                  <div v-if="item.error" class="hint" style="margin-top: 4px;">
                    {{ item.error }}
                  </div>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>

        <template v-if="eventDetail.extraction?.fields?.transactions?.length">
          <a-divider orientation="left" plain>交易明细</a-divider>
          <a-table
            :columns="transactionColumns"
            :data-source="eventDetail.extraction.fields.transactions"
            :pagination="{ pageSize: 10, size: 'small' }"
            :row-key="(_, i) => i"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'occurredAt'">
                {{ new Date(record.occurredAtMs).toLocaleDateString() }}
              </template>
              <template v-else-if="column.key === 'amount'">
                <span :class="record.amount.direction === 'in' ? 'amount-in' : 'amount-out'">
                  {{ record.amount.direction === 'in' ? '+' : '-' }}{{ record.amount.value.toFixed(2) }}
                  {{ record.amount.currency }}
                </span>
              </template>
            </template>
          </a-table>
        </template>
      </template>
      <a-empty v-else description="无事件数据" />
    </a-drawer>

    <!-- Alipay import drawer (Phase 6) -->
    <a-drawer
      v-model:open="alipayConfigOpen"
      title="导入支付宝账单"
      placement="right"
      width="560"
      :destroy-on-close="true"
      @close="resetAlipayForm"
    >
      <a-alert
        message="支付宝官方导出 CSV — 服务器侧全量、稳定无风控。3 分钟拿到 12 个月流水。"
        type="info"
        show-icon
        style="margin-bottom: 16px;"
      />

      <a-collapse :bordered="false" style="margin-bottom: 12px;">
        <a-collapse-panel header="如何导出账单（首次必看）">
          <ol style="padding-left: 18px; font-size: 13px;">
            <li>支付宝 app → 我的 → 账单 → 右上角 ⋯</li>
            <li>点 "开具交易流水证明"</li>
            <li>选月份范围（最长 12 个月）</li>
            <li>用途选 "个人对账"</li>
            <li>发送到你的绑定邮箱</li>
            <li>从邮箱下载 <code>alipay_record_*.zip</code></li>
            <li>解压密码 = 你的身份证后 6 位</li>
          </ol>
        </a-collapse-panel>
      </a-collapse>

      <a-form layout="vertical" :model="alipayForm">
        <a-form-item label="支付宝绑定邮箱（账户标识）" required>
          <a-input
            v-model:value="alipayForm.email"
            placeholder="alipay-bound@example.com"
            autocomplete="off"
          />
        </a-form-item>

        <a-form-item>
          <template #label>
            <a-space>
              <span>ZIP 密码（身份证后 6 位）</span>
              <a-tooltip title="支付宝 ZIP 默认密码 = 身份证号后 6 位。也支持自定义密码。">
                <InfoCircleOutlined style="color: #888;" />
              </a-tooltip>
            </a-space>
          </template>
          <a-input-password
            v-model:value="alipayForm.zipPassword"
            placeholder="例：123456"
            autocomplete="off"
          />
          <div class="hint" style="margin-top: 4px;">
            空白则解析时再问，或导入的 ZIP 未加密。
          </div>
        </a-form-item>

        <a-divider orientation="left" plain>选择文件</a-divider>
        <a-form-item label="ZIP 或 CSV 文件路径">
          <a-input
            v-model:value="alipayForm.filePath"
            placeholder="C:\\Users\\you\\Downloads\\alipay_record_xxx.zip"
            allow-clear
          />
          <div class="hint" style="margin-top: 4px;">
            桌面版可通过 Electron 文件选择器自动填充；web-shell 复制完整路径。
          </div>
        </a-form-item>

        <div v-if="alipayResult" style="margin-top: 8px;">
          <a-alert
            :type="alipayResult.status === 'ok' ? 'success' : 'error'"
            show-icon
            :message="alipayResult.status === 'ok' ? `导入成功 — ${alipayResult.entityCounts?.events || 0} 笔交易` : `导入失败: ${alipayResult.error || alipayResult.status}`"
            :description="alipayResult.status === 'ok' ? `${alipayResult.entityCounts?.persons || 0} 个交易对方 · ${alipayResult.kgTripleCount || 0} KG triples · ${alipayResult.durationMs || 0}ms` : null"
          />
        </div>
      </a-form>

      <template #footer>
        <a-space>
          <a-button @click="alipayConfigOpen = false">关闭</a-button>
          <a-button
            type="primary"
            :loading="loading.importAlipay"
            :disabled="!alipayFormValid"
            @click="importAlipay"
          >
            注册账户 + 导入
          </a-button>
        </a-space>
      </template>
    </a-drawer>

    <!-- Phase 8.7 — Review queue drawer (待消歧) -->
    <a-drawer
      v-model:open="reviewQueueOpen"
      title="待消歧（EntityResolver 模糊判定）"
      placement="right"
      width="640"
      :destroy-on-close="true"
    >
      <a-alert
        v-if="reviewRows.length === 0 && !loading.reviewQueue"
        type="success"
        show-icon
        message="无待消歧 pair — 所有跨源 Person 已确定。"
        style="margin-bottom: 12px;"
      />
      <div style="margin-bottom: 12px;">
        <a-space>
          <a-button :loading="loading.reviewQueue" @click="loadReviewQueue">
            <template #icon><ReloadOutlined /></template>
            刷新
          </a-button>
          <a-button :loading="loading.resolverDrain" @click="drainResolver">
            手动 drain 队列
          </a-button>
          <span class="hint">
            queue: {{ resolverStats.queue?.pending || 0 }} pending ·
            {{ resolverStats.mergeGroups || 0 }} groups
          </span>
        </a-space>
      </div>
      <a-list
        :data-source="reviewRows"
        :pagination="{ pageSize: 5, size: 'small' }"
        size="small"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-card size="small" style="width: 100%;">
              <div class="kv">
                <strong>Pair #{{ item.id }}</strong>
                <a-tag v-if="item.embed_sim" color="blue" style="margin-left: 8px;">
                  sim {{ Number(item.embed_sim).toFixed(2) }}
                </a-tag>
                <a-tag v-if="item.llm_verdict" :color="item.llm_verdict === 'yes' ? 'green' : item.llm_verdict === 'no' ? 'red' : 'orange'" style="margin-left: 4px;">
                  LLM: {{ item.llm_verdict }}
                </a-tag>
              </div>
              <div class="kv" style="margin-top: 4px;">A: {{ item.a_person_id }}</div>
              <div class="kv">B: {{ item.b_person_id }}</div>
              <div v-if="item.llm_reason" class="hint" style="margin-top: 4px;">
                LLM 理由: {{ item.llm_reason }}
              </div>
              <a-space style="margin-top: 8px;">
                <a-button size="small" type="primary" @click="decideReview(item.id, 'same')">同一人</a-button>
                <a-button size="small" danger @click="decideReview(item.id, 'different')">不同人</a-button>
                <a-button size="small" @click="decideReview(item.id, 'skip')">跳过</a-button>
              </a-space>
            </a-card>
          </a-list-item>
        </template>
      </a-list>
    </a-drawer>

    <!-- Audit drawer -->
    <a-drawer
      v-model:open="auditOpen"
      title="审计日志（数据 lineage）"
      placement="right"
      width="600"
      @after-open-change="loadAudit"
    >
      <a-table
        :columns="auditColumns"
        :data-source="auditRows"
        :pagination="{ pageSize: 20, size: 'small' }"
        :row-key="(r) => r.id"
        size="small"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'at'">
            {{ new Date(record.at).toLocaleString() }}
          </template>
          <template v-else-if="column.key === 'details'">
            <code style="font-size: 11px;">{{ record.details || '—' }}</code>
          </template>
        </template>
      </a-table>
    </a-drawer>

    <!-- Phase 10.3 — AIChat WebView 鉴权向导 -->
    <AIChatWizard
      v-model:open="aichatWizardOpen"
      :existing-accounts="aichatAccounts"
      @registered="onAichatRegistered"
    />

    <!-- Phase 12.6.10 — WeChat env-probe + register 向导 -->
    <WechatWizard
      v-model:open="wechatWizardOpen"
      @registered="onWechatRegistered"
    />
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed } from 'vue'
import { message } from 'ant-design-vue'
import {
  ReloadOutlined, FileSearchOutlined, MessageOutlined, SendOutlined,
  AppstoreOutlined, MailOutlined, InfoCircleOutlined, WalletOutlined, LinkOutlined,
  BulbOutlined, DollarOutlined, TeamOutlined, EnvironmentOutlined, HeartOutlined, ClockCircleOutlined,
  RobotOutlined, WechatOutlined,
} from '@ant-design/icons-vue'
import { usePersonalDataHub } from '../composables/usePersonalDataHub.js'
import AIChatWizard from '../components/AIChatWizard.vue'
import WechatWizard from '../components/WechatWizard.vue'

const hub = usePersonalDataHub()

// State
const health = ref(null)
const stats = ref(null)
const adapters = ref([])
const askInput = ref('')
const askResult = ref(null)
const askError = ref('')
const acceptNonLocal = ref(false)
const auditOpen = ref(false)
const auditRows = ref([])
const lastSync = ref(null)

// Per-adapter include toggles. Only adapters with multi-kind bridge
// output need this; for now that's just system-data-android.
// Persisted in localStorage so the user's privacy preferences survive
// page reloads. Default: all kinds ON (matches adapter's defaultInclude).
//
// Uses `reactive()` (deep proxy) instead of `ref()` because Ant Design
// Vue's a-checkbox with `:checked` binding wasn't observing nested
// ref-of-object mutations cleanly across popover open/close cycles.
const SYNC_INCLUDE_STORAGE_KEY = 'pdh.syncIncludeOptions.v1'
const DEFAULT_SYNC_INCLUDE = {
  'system-data-android': { contacts: true, apps: true, sms: true, calls: true },
}
function _loadSyncInclude() {
  try {
    const raw = localStorage.getItem(SYNC_INCLUDE_STORAGE_KEY)
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_SYNC_INCLUDE))
    const parsed = JSON.parse(raw)
    return {
      'system-data-android': {
        ...DEFAULT_SYNC_INCLUDE['system-data-android'],
        ...(parsed['system-data-android'] || {}),
      },
    }
  } catch (_e) {
    return JSON.parse(JSON.stringify(DEFAULT_SYNC_INCLUDE))
  }
}
const syncIncludeOptions = reactive(_loadSyncInclude())
function persistSyncInclude() {
  try {
    localStorage.setItem(SYNC_INCLUDE_STORAGE_KEY, JSON.stringify(syncIncludeOptions))
    // eslint-disable-next-line no-console
    console.log('[PDH-include] persisted:', JSON.stringify(syncIncludeOptions))
  } catch (e) { console.warn('[PDH-include] persist failed:', e && e.message) }
}
const includePopoverOpen = ref({}) // per-row popover state, keyed by adapter name
// Metadata for the per-kind UI — order + labels + per-kind sensitivity hint.
const INCLUDE_KIND_META = {
  'system-data-android': [
    { key: 'contacts', label: '联系人', hint: '~767 条' },
    { key: 'apps', label: '已安装应用', hint: '~176 个' },
    { key: 'sms', label: '短信内容', hint: '~2400 条 · 高敏感', sensitive: true },
    { key: 'calls', label: '通话记录', hint: '~18000 条 · 包含号码', sensitive: true },
  ],
}
function adapterHasIncludeToggles(name) {
  return Object.prototype.hasOwnProperty.call(INCLUDE_KIND_META, name)
}
function onIncludeKindToggle(adapterName, kindKey, e) {
  const checked = e && e.target ? !!e.target.checked : !!e
  // eslint-disable-next-line no-console
  console.log('[PDH-include] toggle', adapterName, kindKey, '=>', checked)
  if (!syncIncludeOptions[adapterName]) {
    syncIncludeOptions[adapterName] = {}
  }
  syncIncludeOptions[adapterName][kindKey] = checked
  persistSyncInclude()
}

// Phase 5.6 — email config + event detail
const emailConfigOpen = ref(false)
const emailForm = reactive({
  provider: 'qq',
  email: '',
  authCode: '',
  host: '',
  port: 993,
  pdfPasswordHints: {
    idCardLast6: '',
    phoneLast6: '',
    cardLast6: '',
  },
})
const emailTestResult = ref(null)
const eventDetailOpen = ref(false)
const eventDetail = ref(null)
const emailAccounts = ref([])

// Phase 11 — analysis skills state
const skillResult = ref(null)
const analysisSkills = [
  { name: 'analysis.spending', label: '消费分析', icon: DollarOutlined, description: '总支出 / 商家排行 / 月度趋势' },
  { name: 'analysis.relations', label: '人际关系', icon: TeamOutlined, description: '与每个人的互动频率 / 主动比例' },
  { name: 'analysis.footprint', label: '足迹', icon: EnvironmentOutlined, description: '常去地点 / 出行模式' },
  { name: 'analysis.interests', label: '兴趣画像', icon: HeartOutlined, description: '从购买 / 浏览 / 收藏抽兴趣' },
  { name: 'analysis.timeline', label: '时间线', icon: ClockCircleOutlined, description: '跨源事件串成故事' },
]

// Phase 8 — EntityResolver review queue state
const reviewQueueOpen = ref(false)
const reviewRows = ref([])
const resolverStats = reactive({ queue: { pending: 0 }, mergeGroups: 0, reviewQueue: 0 })

// Phase 10.3 — AIChat WebView wizard state
const aichatWizardOpen = ref(false)
const aichatAccounts = ref([])
function onAichatRegistered(payload) {
  if (payload?.unregistered) {
    message.success(`已注销 ${payload.vendor}`)
  } else {
    message.success(`已接入 ${payload.vendor}`)
  }
  // The drawer auto-closes via emit('update:open', false) in resetWizard;
  // refresh adapters list so the new aichat-history adapter shows up.
  refresh()
}

// Phase 12.6.10 — WeChat env-probe + register wizard state
const wechatWizardOpen = ref(false)
function onWechatRegistered(payload) {
  message.success(`WeChat 已接入 (uin=${payload.uin}, provider=${payload.chosenKeyProvider})`)
  refresh()
}

// Phase 6 — Alipay import state
const alipayConfigOpen = ref(false)
const alipayForm = reactive({
  email: '',
  zipPassword: '',
  filePath: '',
})
const alipayResult = ref(null)

// Phase 5.7 — live sync progress state
const syncProgress = reactive({
  active: false,
  adapter: '',
  phase: '',
  mailbox: '',
  current: 0,
  total: 0,
  attempt: 1,
  errorMessage: '',
})

const loading = reactive({
  refresh: false,
  ask: false,
  addMock: false,
  syncAll: false,
  sync: {},      // per-adapter
  audit: false,
  testEmail: false,
  saveEmail: false,
  eventDetail: false,
  importAlipay: false,
  reviewQueue: false,
  resolverDrain: false,
  skill: false,
  bilibiliAdbSync: false,
  bilibiliAdbDoctor: false,
  douyinAdbSync: false,
  weiboAdbSync: false,
  xhsAdbSync: false,
  toutiaoAdbSync: false,
  kuaishouAdbSync: false,
  bridgeDoctor: false,
})

// Phase 6e — last bridge-doctor report kept for inspection (raw JSON)
const bridgeDoctorReport = ref(null)

/**
 * Phase 1d — UI surface for the `cc hub bilibili-adb-sync` flow.
 *
 * Trigger: user clicks "通过 PC ADB 同步 Bilibili" in the extra-bar.
 * Backend: WS topic `personal-data-hub.bilibili-adb-sync` → hub method
 * `bilibiliAdbSync()` → BilibiliAdbCollector.collectAndSync → registry
 * snapshot ingest. Round-trip is ~10-30s on a healthy rooted device.
 *
 * The hub returns 9 typed reason codes on failure. Each gets its own
 * actionable banner so the user can fix the root cause without digging
 * into logs:
 *
 *   BRIDGE_UNAVAILABLE   → "Install Android Platform Tools; set ADB_PATH"
 *   MODULE_LOAD_FAILED   → "PDH adapter package missing — reinstall cc"
 *   BILIBILI_NO_ROOT     → "Phone isn't rooted; Bilibili release APK
 *                          needs Magisk root to read its Cookies DB"
 *   BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN
 *                        → "Install Bilibili App + log in once on the phone"
 *   BILIBILI_COOKIES_INCOMPLETE
 *                        → "Logged out on phone — relog the Bilibili App"
 *   BILIBILI_COOKIES_TRUNCATED / BILIBILI_NOT_SQLITE
 *                        → "ADB stream corrupted; try unplug + replug USB"
 *   BILIBILI_INVALID_UID → "Cookie file is malformed — relog"
 *   SYNC_FAILED          → generic; surfaces the underlying message
 *
 * Partial-result paths (Ok: true + lastErrorCode != 0) emit a warning
 * notification noting which endpoint hit anti-spider, so the user knows
 * the sync ran but data is incomplete.
 */
function bilibiliReasonMessage(reason) {
  switch (reason) {
    case 'BRIDGE_UNAVAILABLE':
      return 'adb 未安装或不在 PATH — 请安装 Android Platform Tools 或设置 ADB_PATH 环境变量'
    case 'MODULE_LOAD_FAILED':
      return 'PDH adapter 模块缺失 — 请重装 cc'
    case 'BILIBILI_NO_ROOT':
      return '手机未 root — Bilibili 正式版 APK 不是 debuggable，需 Magisk root 才能读 Cookies DB'
    case 'BILIBILI_NOT_INSTALLED_OR_NEVER_LOGGED_IN':
      return '请在手机上安装 Bilibili App 并登录一次，然后重试'
    case 'BILIBILI_COOKIES_INCOMPLETE':
      return 'Cookie 缺关键字段 — 请在手机 Bilibili App 上重新登录'
    case 'BILIBILI_COOKIES_TRUNCATED':
      return 'ADB 流被截断 — 拔插 USB 重试，或检查 `adb logcat` 是否有 MIUI ROM 干扰'
    case 'BILIBILI_NOT_SQLITE':
      return 'ADB 拉回的文件不是 sqlite — 可能 base64 stream 被 MIUI/HyperOS 干扰，拔插 USB 重试'
    case 'BILIBILI_INVALID_UID':
      return 'Cookie 中 DedeUserID 不是正整数 — 请重新登录'
    case 'SYNC_FAILED':
    default:
      return '同步失败 — 详见 message 字段'
  }
}

/**
 * Phase 2a — Douyin C 路径 (PC + ADB) UI handler.
 *
 * Pipeline: `cc serve` WS topic personal-data-hub.douyin-adb-sync → hub
 * method douyinAdbSync → DouyinAdbCollector.collectAndSync → pull
 * <uid>_im.db cohort → parseImDb msg + SIMPLE_USER → snapshot → ingest.
 *
 * 9 typed reason codes mapped to Chinese banners. Partial-result
 * diagnostic (parserDiagnostic.hadMsgTable / hadSimpleUserTable false)
 * renders a warning so user knows which table was empty.
 */
function douyinReasonMessage(reason) {
  switch (reason) {
    case 'BRIDGE_UNAVAILABLE':
      return 'adb 未安装或不在 PATH — 请安装 Android Platform Tools 或设置 ADB_PATH 环境变量'
    case 'MODULE_LOAD_FAILED':
      return 'PDH adapter 模块缺失 — 请重装 cc'
    case 'DOUYIN_NO_ROOT':
      return '手机未 root — 抖音正式版 APK 不是 debuggable，需 Magisk root 才能读 IM 数据库'
    case 'DOUYIN_NOT_INSTALLED':
      return '请在手机上安装抖音 App，然后重试'
    case 'DOUYIN_NO_IM_DB':
      return '抖音 App 已装但未生成 IM 数据库 — 请登录抖音并打开任一聊天会话后重试'
    case 'DOUYIN_MULTIPLE_USERS':
      return '此手机登录了多个抖音账号 — 请加 --uid <19位数字> 选一个'
    case 'DOUYIN_UID_NOT_FOUND':
      return '指定的 uid 不在设备上的抖音账号列表里'
    case 'DOUYIN_PULL_FAILED':
      return 'ADB 流传输失败 — 拔插 USB 重试，或检查 `adb logcat` 是否有 MIUI ROM 干扰'
    case 'DOUYIN_NOT_SQLITE':
      return '拉回的文件不是 sqlite — 可能 base64 stream 被 MIUI/HyperOS 干扰，拔插 USB 重试'
    case 'SYNC_FAILED':
    default:
      return '同步失败 — 详见 message 字段'
  }
}

/**
 * Phase 3b — Weibo C 路径 (PC + ADB) UI handler.
 *
 * Pipeline: WS topic personal-data-hub.weibo-adb-sync → hub method
 * weiboAdbSync → WeiboAdbCollector.collectAndSync → pull m.weibo.cn
 * Chromium cookies → fetchUid (/api/config) → 3 endpoints parallel
 * (posts/favourites/follows) → snapshot → ingest.
 *
 * 10 typed reason codes mapped to Chinese banners. uidFetchFailed
 * (cookie expired or anti-bot HTML redirect) shows a dedicated warning
 * notification distinct from empty-result.
 */
function weiboReasonMessage(reason) {
  switch (reason) {
    case 'BRIDGE_UNAVAILABLE':
      return 'adb 未安装或不在 PATH — 请安装 Android Platform Tools 或设置 ADB_PATH 环境变量'
    case 'MODULE_LOAD_FAILED':
      return 'PDH adapter 模块缺失 — 请重装 cc'
    case 'WEIBO_NO_ROOT':
      return '手机未 root — 微博正式版 APK 不是 debuggable，需 Magisk root 才能读 Cookies DB'
    case 'WEIBO_NOT_INSTALLED':
      return '请在手机上安装微博 App 并登录一次，然后重试 (或微博使用了非默认 WebView 数据目录)'
    case 'WEIBO_COOKIES_EMPTY':
      return 'ADB 流返 0 字节 — MIUI/HyperOS silent 失败？拔插 USB 重试'
    case 'WEIBO_COOKIES_TRUNCATED':
      return 'ADB 流被截断 — 拔插 USB 重试，或检查 `adb logcat` 是否有 MIUI ROM 干扰'
    case 'WEIBO_NOT_SQLITE':
      return '拉回的文件不是 sqlite — 可能 base64 stream 被 MIUI 干扰，拔插 USB 重试'
    case 'WEIBO_BASE64_PARSE':
      return 'base64 解码失败 — adb 终端编码问题，请检查 `chcp 65001`'
    case 'WEIBO_COOKIES_INCOMPLETE':
      return 'SUB cookie 缺失 — 请在手机微博 App 上重新登录'
    case 'SYNC_FAILED':
    default:
      return '同步失败 — 详见 message 字段'
  }
}

/**
 * Phase 3c — Xhs C 路径 (PC + ADB + X-S signing) UI handler.
 *
 * X-S signing is best-effort (~60% GET hit rate); UI surfaces 461
 * partial-result reasonably rather than treating it as failure.
 */
function xhsReasonMessage(reason) {
  switch (reason) {
    case 'BRIDGE_UNAVAILABLE':
      return 'adb 未安装或不在 PATH — 请安装 Android Platform Tools 或设置 ADB_PATH 环境变量'
    case 'MODULE_LOAD_FAILED':
      return 'PDH adapter 模块缺失 — 请重装 cc'
    case 'XHS_NO_ROOT':
      return '手机未 root — 小红书正式版 APK 不是 debuggable，需 Magisk root 才能读 Cookies DB'
    case 'XHS_NOT_INSTALLED':
      return '请在手机上安装小红书 App 并登录一次，然后重试'
    case 'XHS_COOKIES_EMPTY':
      return 'ADB 流返 0 字节 — MIUI/HyperOS silent 失败？拔插 USB 重试'
    case 'XHS_COOKIES_TRUNCATED':
      return 'ADB 流被截断 — 拔插 USB 重试，或检查 `adb logcat` 是否有 MIUI ROM 干扰'
    case 'XHS_NOT_SQLITE':
      return '拉回的文件不是 sqlite — 可能 base64 stream 被 MIUI 干扰，拔插 USB 重试'
    case 'XHS_BASE64_PARSE':
      return 'base64 解码失败 — adb 终端编码问题，请检查 `chcp 65001`'
    case 'XHS_COOKIES_INCOMPLETE':
      return 'a1 或 web_session cookie 缺失 — 请在手机小红书 App 上重新登录 (X-S 签名需要 a1 字段)'
    case 'SYNC_FAILED':
    default:
      return '同步失败 — 详见 message 字段'
  }
}

async function xhsAdbSync() {
  if (loading.xhsAdbSync) return
  loading.xhsAdbSync = true
  try {
    const result = await hub.xhsAdbSync({})
    if (!result || !result.ok) {
      const reason = (result && result.reason) || 'SYNC_FAILED'
      const human = xhsReasonMessage(reason)
      const detail = (result && result.message) || ''
      message.error({
        content: `Xhs ADB 同步失败：${human}`,
        description: detail,
        duration: 8,
      })
      return
    }
    const report = result.report || {}
    const xhs = report.xhs || {}
    const counts = xhs.eventCounts || {}
    if (xhs.meFetchFailed) {
      message.warning({
        content: `Xhs 同步未拉到 user_id — /user/me 返空 data`,
        description: `lastErrorCode=${xhs.lastErrorCode}, ${xhs.lastErrorMessage || ''}。可能 cookie 已过期或 web_session 缺失，请在手机重新登录。`,
        duration: 10,
      })
    } else if (xhs.lastErrorCode === 461) {
      message.warning({
        content: `Xhs X-S 签名被拒 (461) — 部分接口未抓到`,
        description: `命中 ${counts.total || 0} events。我们的 X-S 算法 best-effort (~60% GET / <30% POST hit)，461 在 POST 较常见。稍后重试 (X-S 算法可能 4-8 周 rotate)。`,
        duration: 10,
      })
    } else if (xhs.lastErrorCode) {
      message.warning({
        content: `Xhs 同步部分完成 (${counts.total || 0} events)`,
        description: `lastErrorCode=${xhs.lastErrorCode}, ${xhs.lastErrorMessage || ''}`,
        duration: 8,
      })
    } else {
      message.success(
        `Xhs 同步成功：notes=${counts.note || 0} / liked=${counts.liked || 0} / follow=${counts.follow || 0} (total=${counts.total || 0})${xhs.nickname ? ' [' + xhs.nickname + ']' : ''}`,
      )
    }
    lastSync.value = report
    refresh()
  } catch (err) {
    message.error({
      content: 'Xhs ADB 同步异常',
      description: err && err.message ? err.message : String(err),
      duration: 8,
    })
  } finally {
    loading.xhsAdbSync = false
  }
}

/**
 * Phase 6c — Toutiao C 路径 (PC + ADB + acrawler.js _signature) UI handler.
 *
 * Desktop context: ToutiaoSignBridge (Electron WebContentsView running
 * acrawler.js) → ~100% hit rate on 3 signed endpoints. Web/CLI context
 * has no bridge → 3 signed endpoints short-circuit (no HTTP traffic) —
 * banner directs user to open from desktop app.
 */
function toutiaoReasonMessage(reason) {
  switch (reason) {
    case 'BRIDGE_UNAVAILABLE':
      return 'adb 未安装或不在 PATH — 请安装 Android Platform Tools 或设置 ADB_PATH 环境变量'
    case 'MODULE_LOAD_FAILED':
      return 'PDH adapter 模块缺失 — 请重装 cc'
    case 'TOUTIAO_NO_ROOT':
      return '手机未 root — 头条正式版 APK 不是 debuggable，需 Magisk root 才能读 Cookies DB'
    case 'TOUTIAO_NOT_INSTALLED':
      return '请在手机上安装今日头条 App（com.ss.android.article.news，不是极速版）并登录后随便点开一篇文章（让 WebView 写入 cookies），再重试'
    case 'TOUTIAO_COOKIES_EMPTY':
      return 'ADB 流返 0 字节 — MIUI/HyperOS silent 失败？拔插 USB 重试'
    case 'TOUTIAO_COOKIES_TRUNCATED':
      return 'ADB 流被截断 — 拔插 USB 重试，或检查 `adb logcat` 是否有 MIUI ROM 干扰'
    case 'TOUTIAO_NOT_SQLITE':
      return '拉回的文件不是 sqlite — 可能 base64 stream 被 MIUI 干扰，拔插 USB 重试'
    case 'TOUTIAO_BASE64_PARSE':
      return 'base64 解码失败 — adb 终端编码问题，请检查 `chcp 65001`'
    case 'TOUTIAO_COOKIES_INCOMPLETE':
      return 'sessionid / sessionid_ss cookie 缺失 — 请在手机头条 App 上重新登录'
    case 'SYNC_FAILED':
    default:
      return '同步失败 — 详见 message 字段'
  }
}

async function toutiaoAdbSync() {
  if (loading.toutiaoAdbSync) return
  loading.toutiaoAdbSync = true
  try {
    const result = await hub.toutiaoAdbSync({})
    if (!result || !result.ok) {
      const reason = (result && result.reason) || 'SYNC_FAILED'
      const human = toutiaoReasonMessage(reason)
      const detail = (result && result.message) || ''
      message.error({
        content: `Toutiao ADB 同步失败：${human}`,
        description: detail,
        duration: 8,
      })
      return
    }
    const report = result.report || {}
    const toutiao = report.toutiao || {}
    const counts = toutiao.eventCounts || {}
    if (toutiao.profileFetchFailed) {
      message.warning({
        content: `Toutiao 同步未拉到 user_id — passport/info/v2 返失败`,
        description: `lastErrorCode=${toutiao.lastErrorCode}, ${toutiao.lastErrorMessage || ''}。可能 cookie 已过期或 sessionid 缺失，请在手机重新登录。`,
        duration: 10,
      })
    } else if (
      toutiao.signProviderUsed === 'none' &&
      (counts.feed === 0 && counts.collection === 0 && counts.search === 0)
    ) {
      // Phase 6c — web-shell context lacks ToutiaoSignBridge (Electron
      // only). 3 signed endpoints short-circuit silently to save
      // bandwidth — UI must explain WHY.
      message.warning({
        content: `Toutiao 同步仅获取了 profile (${counts.profile || 0} event)`,
        description: `当前 web-shell 上下文不支持 _signature 签名（仅 desktop app 提供 ToutiaoSignBridge）。打开桌面 app 同步可获取 feed / collection / search。`,
        duration: 12,
      })
    } else if (toutiao.lastErrorCode) {
      message.warning({
        content: `Toutiao 同步部分完成 (${counts.total || 0} events)`,
        description: `lastErrorCode=${toutiao.lastErrorCode}, ${toutiao.lastErrorMessage || ''}`,
        duration: 8,
      })
    } else {
      message.success(
        `Toutiao 同步成功：profile=${counts.profile || 0} / feed=${counts.feed || 0} / collection=${counts.collection || 0} / search=${counts.search || 0} (total=${counts.total || 0})${toutiao.nickname ? ' [' + toutiao.nickname + ']' : ''}`,
      )
    }
    lastSync.value = report
    refresh()
  } catch (err) {
    message.error({
      content: 'Toutiao ADB 同步异常',
      description: err && err.message ? err.message : String(err),
      duration: 8,
    })
  } finally {
    loading.toutiaoAdbSync = false
  }
}

/**
 * Phase 6d — Kuaishou C 路径 (PC + ADB + GraphQL + NS_sig3) UI handler.
 *
 * Desktop context: KuaishouSignBridge (Electron WebContentsView running
 * NS_sig3 SDK) → ~100% hit on 3 GraphQL endpoints + valid kpf/kpn
 * headers. Web/CLI context: signed endpoints short-circuit (no HTTP).
 * Profile comes from cookie's api_ph payload — works in both contexts.
 */
function kuaishouReasonMessage(reason) {
  switch (reason) {
    case 'BRIDGE_UNAVAILABLE':
      return 'adb 未安装或不在 PATH — 请安装 Android Platform Tools 或设置 ADB_PATH 环境变量'
    case 'MODULE_LOAD_FAILED':
      return 'PDH adapter 模块缺失 — 请重装 cc'
    case 'KUAISHOU_NO_ROOT':
      return '手机未 root — 快手正式版 APK 不是 debuggable，需 Magisk root 才能读 Cookies DB'
    case 'KUAISHOU_NOT_INSTALLED':
      return '请在手机上安装快手 App（com.smile.gifmaker，不是极速版 com.kuaishou.nebula）并登录后随便看一个视频（让 WebView 写入 cookies），再重试'
    case 'KUAISHOU_COOKIES_EMPTY':
      return 'ADB 流返 0 字节 — MIUI/HyperOS silent 失败？拔插 USB 重试'
    case 'KUAISHOU_COOKIES_TRUNCATED':
      return 'ADB 流被截断 — 拔插 USB 重试，或检查 `adb logcat` 是否有 MIUI ROM 干扰'
    case 'KUAISHOU_NOT_SQLITE':
      return '拉回的文件不是 sqlite — 可能 base64 stream 被 MIUI 干扰，拔插 USB 重试'
    case 'KUAISHOU_BASE64_PARSE':
      return 'base64 解码失败 — adb 终端编码问题，请检查 `chcp 65001`'
    case 'KUAISHOU_COOKIES_INCOMPLETE':
      return 'userId / kuaishou.web.cp.api_ph cookie 缺失 — 请在手机快手 App 上重新登录'
    case 'SYNC_FAILED':
    default:
      return '同步失败 — 详见 message 字段'
  }
}

async function kuaishouAdbSync() {
  if (loading.kuaishouAdbSync) return
  loading.kuaishouAdbSync = true
  try {
    const result = await hub.kuaishouAdbSync({})
    if (!result || !result.ok) {
      const reason = (result && result.reason) || 'SYNC_FAILED'
      const human = kuaishouReasonMessage(reason)
      const detail = (result && result.message) || ''
      message.error({
        content: `Kuaishou ADB 同步失败：${human}`,
        description: detail,
        duration: 8,
      })
      return
    }
    const report = result.report || {}
    const kuaishou = report.kuaishou || {}
    const counts = kuaishou.eventCounts || {}
    if (kuaishou.profileFetchFailed) {
      message.warning({
        content: `Kuaishou 同步 cookie 缺 api_ph payload`,
        description: `lastErrorCode=${kuaishou.lastErrorCode}, ${kuaishou.lastErrorMessage || ''}。可能 cookie 已过期或登录态不完整（仅有 userId 但没有 api_ph），请在手机重新登录。`,
        duration: 10,
      })
    } else if (
      kuaishou.signProviderUsed === 'none' &&
      counts.watch === 0 && counts.collect === 0 && counts.search === 0
    ) {
      // Phase 6d — web-shell context lacks KuaishouSignBridge (Electron only)
      message.warning({
        content: `Kuaishou 同步仅获取了 profile (${counts.profile || 0} event)`,
        description: `当前 web-shell 上下文不支持 __NS_sig3 签名（仅 desktop app 提供 KuaishouSignBridge）。打开桌面 app 同步可获取 watch / collect / search。`,
        duration: 12,
      })
    } else if (kuaishou.lastErrorCode) {
      message.warning({
        content: `Kuaishou 同步部分完成 (${counts.total || 0} events)`,
        description: `lastErrorCode=${kuaishou.lastErrorCode}, ${kuaishou.lastErrorMessage || ''}`,
        duration: 8,
      })
    } else {
      message.success(
        `Kuaishou 同步成功：profile=${counts.profile || 0} / watch=${counts.watch || 0} / collect=${counts.collect || 0} / search=${counts.search || 0} (total=${counts.total || 0})${kuaishou.nickname ? ' [' + kuaishou.nickname + ']' : ''}`,
      )
    }
    lastSync.value = report
    refresh()
  } catch (err) {
    message.error({
      content: 'Kuaishou ADB 同步异常',
      description: err && err.message ? err.message : String(err),
      duration: 8,
    })
  } finally {
    loading.kuaishouAdbSync = false
  }
}

/**
 * Phase 6e — Bridge dry-run doctor.
 *
 * Spins up Xhs / Toutiao / Kuaishou sign bridges with empty cookie,
 * probes for candidate signing globals, reports per-bridge health.
 * Lets users detect SDK rotation BEFORE starting a real sync.
 *
 * Desktop-only (Electron WebContentsView). Web-shell without desktop
 * returns MODULE_LOAD_FAILED — banner explains.
 */
async function bridgeDoctor() {
  if (loading.bridgeDoctor) return
  loading.bridgeDoctor = true
  try {
    const result = await hub.bridgeDoctor()
    if (!result || !result.ok) {
      const reason = (result && result.reason) || 'BRIDGE_DOCTOR_FAILED'
      const detail = (result && result.message) || ''
      if (reason === 'MODULE_LOAD_FAILED') {
        message.error({
          content: 'Bridge doctor 不可用',
          description:
            '当前上下文不是 Electron desktop app（cli / web-shell-only 无 sign-bridge 模块）。请从桌面 app 运行此诊断。',
          duration: 10,
        })
      } else {
        message.error({
          content: `Bridge doctor 失败：${reason}`,
          description: detail,
          duration: 8,
        })
      }
      return
    }
    const r = result.results || {}
    const platforms = ['xhs', 'toutiao', 'kuaishou']
    const okCount = platforms.filter((p) => r[p] && r[p].anyCandidatePresent).length
    const totalCount = platforms.length
    const lines = []
    for (const p of platforms) {
      const entry = r[p]
      if (!entry || !entry.ok) {
        lines.push(`${p}: ✗ ${entry && entry.error ? entry.error : 'unknown error'}`)
        continue
      }
      const cands = entry.candidates || {}
      const presentNames = Object.keys(cands).filter((k) => cands[k] === true)
      const totalCandidates = Object.keys(cands).length
      const tag = entry.anyCandidatePresent ? '✓' : '⚠'
      const desc = entry.anyCandidatePresent
        ? `${presentNames.length}/${totalCandidates} candidate(s): ${presentNames.join(', ')}`
        : `0/${totalCandidates} candidates (rotation? 需更新 buildSignScript)`
      lines.push(
        `${p}: ${tag} ${desc} (warmUp=${entry.warmUpMs}ms, probe=${entry.probeMs}ms)`,
      )
    }
    const overall =
      okCount === totalCount
        ? message.success
        : okCount === 0
          ? message.error
          : message.warning
    overall({
      content: `Bridge doctor: ${okCount}/${totalCount} 平台签名可用`,
      description: lines.join('\n'),
      duration: 15,
    })
    bridgeDoctorReport.value = result
  } catch (err) {
    message.error({
      content: 'Bridge doctor 异常',
      description: err && err.message ? err.message : String(err),
      duration: 8,
    })
  } finally {
    loading.bridgeDoctor = false
  }
}

async function weiboAdbSync() {
  if (loading.weiboAdbSync) return
  loading.weiboAdbSync = true
  try {
    const result = await hub.weiboAdbSync({})
    if (!result || !result.ok) {
      const reason = (result && result.reason) || 'SYNC_FAILED'
      const human = weiboReasonMessage(reason)
      const detail = (result && result.message) || ''
      message.error({
        content: `Weibo ADB 同步失败：${human}`,
        description: detail,
        duration: 8,
      })
      return
    }
    const report = result.report || {}
    const wb = report.weibo || {}
    const counts = wb.eventCounts || {}
    if (wb.uidFetchFailed) {
      message.warning({
        content: `Weibo 同步未拉到 UID — /api/config 返 login=false`,
        description: `lastErrorCode=${wb.lastErrorCode}, ${wb.lastErrorMessage || ''}。可能 cookie 已过期 (请在手机重新登录) 或微博触发 anti-bot redirect。事件数 0，未入 vault。`,
        duration: 10,
      })
    } else if (wb.lastErrorCode) {
      message.warning({
        content: `Weibo 同步部分完成 (${counts.total || 0} events)`,
        description: `lastErrorCode=${wb.lastErrorCode}, ${wb.lastErrorMessage || ''} — 部分接口受反爬限制，稍后重试可补齐`,
        duration: 8,
      })
    } else {
      message.success(
        `Weibo 同步成功：posts=${counts.post || 0} / fav=${counts.favourite || 0} / follow=${counts.follow || 0} (total=${counts.total || 0})`,
      )
    }
    lastSync.value = report
    refresh()
  } catch (err) {
    message.error({
      content: 'Weibo ADB 同步异常',
      description: err && err.message ? err.message : String(err),
      duration: 8,
    })
  } finally {
    loading.weiboAdbSync = false
  }
}

async function douyinAdbSync() {
  if (loading.douyinAdbSync) return
  loading.douyinAdbSync = true
  try {
    const result = await hub.douyinAdbSync({})
    if (!result || !result.ok) {
      const reason = (result && result.reason) || 'SYNC_FAILED'
      const human = douyinReasonMessage(reason)
      const detail = (result && result.message) || ''
      message.error({
        content: `Douyin ADB 同步失败：${human}`,
        description: detail,
        duration: 8,
      })
      return
    }
    const report = result.report || {}
    const dy = report.douyin || {}
    const counts = dy.eventCounts || {}
    const diag = dy.parserDiagnostic || {}
    if (!diag.hadMsgTable && !diag.hadSimpleUserTable) {
      message.warning({
        content: `Douyin 同步完成但 0 events`,
        description: 'msg 和 SIMPLE_USER 表都未在 IM 数据库中找到 — 抖音 App 版本可能用了不同 schema',
        duration: 10,
      })
    } else if (!diag.hadMsgTable || !diag.hadSimpleUserTable) {
      const missing = []
      if (!diag.hadMsgTable) missing.push('msg (私信)')
      if (!diag.hadSimpleUserTable) missing.push('SIMPLE_USER (联系人)')
      message.warning({
        content: `Douyin 部分同步：msg=${counts.message || 0} contacts=${counts.contact || 0}`,
        description: `${missing.join('、')} 表未找到，未入库部分数据`,
        duration: 8,
      })
    } else {
      message.success(
        `Douyin 同步成功：messages=${counts.message || 0} contacts=${counts.contact || 0} (total=${counts.total || 0})`,
      )
    }
    lastSync.value = report
    refresh()
  } catch (err) {
    message.error({
      content: 'Douyin ADB 同步异常',
      description: err && err.message ? err.message : String(err),
      duration: 8,
    })
  } finally {
    loading.douyinAdbSync = false
  }
}

async function bilibiliAdbDoctor() {
  if (loading.bilibiliAdbDoctor) return
  loading.bilibiliAdbDoctor = true
  try {
    const result = await hub.bilibiliAdbDoctor()
    if (!result || !result.ok) {
      const reason = (result && result.reason) || 'PROBE_FAILED'
      const human = bilibiliReasonMessage(reason)
      const detail = (result && result.message) || ''
      message.error({
        content: `Bilibili 诊断失败：${human}`,
        description: detail,
        duration: 8,
      })
      return
    }
    const diag = result.cookieDiagnostic || {}
    if (diag.hadEncrypted) {
      message.warning({
        content: `Bilibili 环境就绪 (uid=${result.uid}) — 但发现 Keystore 加密 cookie`,
        description: `cookies 数=${diag.cookieCount || '?'}; 部分行使用 Android Keystore 加密 (跳过)。可能是较新 Bilibili App + Android 14+。可继续同步，但可能数据不全。`,
        duration: 10,
      })
    } else {
      message.success(
        `Bilibili 环境就绪 — uid=${result.uid}, 找到 ${diag.cookieCount || '?'} 个 cookie，可以同步`,
      )
    }
  } catch (err) {
    message.error({
      content: 'Bilibili 诊断异常',
      description: err && err.message ? err.message : String(err),
      duration: 8,
    })
  } finally {
    loading.bilibiliAdbDoctor = false
  }
}

async function bilibiliAdbSync() {
  if (loading.bilibiliAdbSync) return
  loading.bilibiliAdbSync = true
  try {
    const result = await hub.bilibiliAdbSync({})
    if (!result || !result.ok) {
      const reason = (result && result.reason) || 'SYNC_FAILED'
      const human = bilibiliReasonMessage(reason)
      const detail = (result && result.message) || ''
      message.error({
        content: `Bilibili ADB 同步失败：${human}`,
        description: detail,
        duration: 8,
      })
      return
    }
    const report = result.report || {}
    const bili = report.bilibili || {}
    const counts = bili.eventCounts || {}
    if (bili.lastErrorCode) {
      message.warning({
        content: `Bilibili 同步部分完成 (${counts.total || 0} events)`,
        description: `lastErrorCode=${bili.lastErrorCode}, ${bili.lastErrorMessage || ''} — 部分接口受反爬限制，稍后重试可补齐`,
        duration: 8,
      })
    } else {
      message.success(
        `Bilibili 同步成功：history=${counts.history || 0} / fav=${counts.favourite || 0} / dyn=${counts.dynamic || 0} / follow=${counts.follow || 0} (total=${counts.total || 0})`,
      )
    }
    // Refresh adapter list + stats so the user sees the new event count.
    lastSync.value = report
    refresh()
  } catch (err) {
    message.error({
      content: 'Bilibili ADB 同步异常',
      description: err && err.message ? err.message : String(err),
      duration: 8,
    })
  } finally {
    loading.bilibiliAdbSync = false
  }
}

// Table columns
const adapterColumns = [
  { title: '名称', dataIndex: 'name', key: 'name', width: 140 },
  { title: '版本', dataIndex: 'version', key: 'version', width: 80 },
  { title: '能力', key: 'capabilities' },
  { title: '敏感度', key: 'sensitivity', width: 140 },
  { title: '操作', key: 'actions', width: 160, align: 'right' },
]
const auditColumns = [
  { title: '时间', key: 'at', dataIndex: 'at', width: 170 },
  { title: '动作', dataIndex: 'action', key: 'action', width: 200 },
  { title: '详情', key: 'details' },
]
const transactionColumns = [
  { title: '日期', key: 'occurredAt', width: 100 },
  { title: '描述', dataIndex: 'description', key: 'description' },
  { title: '金额', key: 'amount', width: 140, align: 'right' },
]

function sensitivityColor(s) {
  return s === 'high' ? 'red' : s === 'medium' ? 'orange' : 'default'
}

function syncSummary(r) {
  if (!r) return ''
  const ec = r.entityCounts || {}
  const stats = `events=${ec.events ?? 0} persons=${ec.persons ?? 0} | raw=${r.rawCount ?? 0} invalid=${r.invalidCount ?? 0} | KG triples=${r.kgTripleCount ?? 0} RAG docs=${r.ragDocCount ?? 0} | ${r.durationMs ?? 0}ms`
  // Surface the adapter-reported error (registry.syncAdapter sets this
  // on the catch path). Without it the user only sees the all-zero
  // stats line and has no way to know WHY a sync failed.
  // Ant Design Alert.description is plain text — `\n` would render as
  // a space. Use a leading separator + 错误 prefix instead so the
  // adapter-reported message reads cleanly inline.
  if (r.error) return `${stats}  ·  错误: ${r.error}`
  return stats
}

// Actions
async function refresh() {
  loading.refresh = true
  try {
    health.value = await hub.health()
    stats.value = await hub.stats()
    adapters.value = await hub.listAdapters()
    // Phase 10.3.5 — also refresh AIChat account list so the wizard's
    // existing-accounts prop is up to date when the drawer is reopened.
    try {
      aichatAccounts.value = await hub.listAichatAccounts()
    } catch (_e) {
      // Non-fatal — older hubs without the topic just keep the previous list.
    }
  } catch (err) {
    message.error('刷新失败: ' + err.message)
  } finally {
    loading.refresh = false
  }
}

async function ask() {
  if (!askInput.value.trim()) return
  loading.ask = true
  askError.value = ''
  askResult.value = null
  try {
    askResult.value = await hub.ask(askInput.value.trim(), { acceptNonLocal: acceptNonLocal.value })
  } catch (err) {
    askError.value = err.message
  } finally {
    loading.ask = false
  }
}

async function addMock() {
  loading.addMock = true
  try {
    await hub.registerMock({ count: 30, seed: Date.now() % 1000 })
    await refresh()
    message.success('MockAdapter 已注册（30 条 mock 数据 ready 同步）')
  } catch (err) {
    message.error('注册失败: ' + err.message)
  } finally {
    loading.addMock = false
  }
}

function resetSyncProgress(adapterName = '') {
  syncProgress.active = true
  syncProgress.adapter = adapterName
  syncProgress.phase = 'starting'
  syncProgress.mailbox = ''
  syncProgress.current = 0
  syncProgress.total = 0
  syncProgress.attempt = 1
  syncProgress.errorMessage = ''
}

function handleSyncEvent(evt) {
  if (!evt) return
  if (evt.adapter) syncProgress.adapter = evt.adapter
  if (evt.phase) syncProgress.phase = evt.phase
  if (typeof evt.current === 'number') syncProgress.current = evt.current
  if (typeof evt.total === 'number') syncProgress.total = evt.total
  if (typeof evt.attempt === 'number') syncProgress.attempt = evt.attempt
  if (evt.mailbox) syncProgress.mailbox = evt.mailbox
  if (evt.phase === 'error') {
    syncProgress.errorMessage = evt.message || 'sync error'
  }
}

async function syncOne(name) {
  loading.sync[name] = true
  resetSyncProgress(name)
  try {
    // Per-kind include toggles — only system-data-android currently
    // produces multi-kind output (contacts / apps / sms / calls).
    // For other adapters, options is empty and the server falls through
    // to default behavior (which is auto-pull-from-phone for socials).
    // Persisted in localStorage so the user's choice survives reloads.
    const includeOpts = syncIncludeOptions[name]
    const options = includeOpts ? { include: { ...includeOpts } } : {}

    // Phase 5.7: streaming when supported, falls back to plain syncAdapter
    if (typeof hub.syncAdapterStream === 'function') {
      lastSync.value = await hub.syncAdapterStream(name, options, handleSyncEvent)
    } else {
      lastSync.value = await hub.syncAdapter(name, options)
    }
    await refresh()
  } catch (err) {
    message.error(`同步 ${name} 失败: ${err.message}`)
  } finally {
    loading.sync[name] = false
    syncProgress.active = false
  }
}

async function syncAll() {
  loading.syncAll = true
  resetSyncProgress('(all)')
  try {
    const reports = typeof hub.syncAllStream === 'function'
      ? await hub.syncAllStream({}, handleSyncEvent)
      : await hub.syncAll()
    lastSync.value = reports?.[reports.length - 1] || null
    await refresh()
    message.success(`已同步 ${reports?.length || 0} 个 adapter`)
  } catch (err) {
    message.error('同步失败: ' + err.message)
  } finally {
    loading.syncAll = false
    syncProgress.active = false
  }
}

async function unregisterAdapter(name) {
  try {
    await hub.unregister(name)
    await refresh()
  } catch (err) {
    message.error('移除失败: ' + err.message)
  }
}

async function loadAudit(open) {
  if (!open) return
  loading.audit = true
  try {
    auditRows.value = await hub.recentAudit({ limit: 200 })
  } catch (err) {
    message.error('审计日志加载失败: ' + err.message)
  } finally {
    loading.audit = false
  }
}

// ─── Phase 5.6 — email config handlers ─────────────────────────────────

const emailFormValid = computed(() => {
  if (!emailForm.email || !emailForm.email.includes('@')) return false
  if (!emailForm.authCode || emailForm.authCode.length < 4) return false
  if (emailForm.provider === 'custom' && !emailForm.host) return false
  return true
})

function providerAuthHint(provider) {
  const hints = {
    qq: 'QQ: 邮箱 → 设置 → 账户 → IMAP/SMTP → 开启 → 生成授权码',
    163: '163: 邮箱 → 设置 → POP3/SMTP/IMAP → 开启 IMAP/SMTP 服务 → 授权密码',
    189: '189: 设置 → 第三方客户端授权码',
    outlook: 'Outlook: account.microsoft.com/security → App password',
    gmail: 'Gmail: myaccount.google.com/apppasswords (需开启 2FA)',
    custom: '联系你的邮箱管理员获取 IMAP 端点 + app-password',
  }
  return hints[provider] || '请输入服务商授权码（不是登录密码）'
}

function resetEmailForm() {
  emailForm.provider = 'qq'
  emailForm.email = ''
  emailForm.authCode = ''
  emailForm.host = ''
  emailForm.port = 993
  emailForm.pdfPasswordHints = { idCardLast6: '', phoneLast6: '', cardLast6: '' }
  emailTestResult.value = null
}

function buildEmailAccountPayload() {
  const account = {
    provider: emailForm.provider,
    email: emailForm.email.trim(),
    authCode: emailForm.authCode,
  }
  if (emailForm.provider === 'custom') {
    account.host = emailForm.host.trim()
    account.port = emailForm.port || 993
    account.secure = true
  }
  return account
}

function buildPdfHints() {
  const hints = {}
  for (const k of Object.keys(emailForm.pdfPasswordHints)) {
    const v = emailForm.pdfPasswordHints[k]
    if (typeof v === 'string' && v.trim().length > 0) hints[k] = v.trim()
  }
  return Object.keys(hints).length > 0 ? hints : null
}

async function testEmailAuth() {
  if (!emailFormValid.value) return
  loading.testEmail = true
  emailTestResult.value = null
  try {
    emailTestResult.value = await hub.testEmailAuth(buildEmailAccountPayload())
  } catch (err) {
    emailTestResult.value = { ok: false, error: err.message }
  } finally {
    loading.testEmail = false
  }
}

async function saveEmail() {
  if (!emailFormValid.value || !emailTestResult.value?.ok) return
  loading.saveEmail = true
  try {
    const opts = {}
    const hints = buildPdfHints()
    if (hints) opts.pdfPasswordHints = hints
    await hub.registerEmail(buildEmailAccountPayload(), opts)
    message.success('邮箱账号已注册')
    emailConfigOpen.value = false
    resetEmailForm()
    await refresh()
  } catch (err) {
    message.error('保存失败: ' + err.message)
  } finally {
    loading.saveEmail = false
  }
}

// ─── Phase 6 — Alipay import ───────────────────────────────────────────

const alipayFormValid = computed(() => {
  if (!alipayForm.email || !alipayForm.email.includes('@')) return false
  if (!alipayForm.filePath || alipayForm.filePath.length < 3) return false
  return true
})

function resetAlipayForm() {
  alipayForm.email = ''
  alipayForm.zipPassword = ''
  alipayForm.filePath = ''
  alipayResult.value = null
}

async function importAlipay() {
  if (!alipayFormValid.value) return
  loading.importAlipay = true
  alipayResult.value = null
  try {
    // Register the account (also persists config + auto-registers on next boot)
    await hub.registerAlipay({
      email: alipayForm.email.trim(),
      zipPassword: alipayForm.zipPassword || undefined,
    })
    // Detect zip vs csv from extension
    const isZip = /\.zip$/i.test(alipayForm.filePath)
    const payload = isZip
      ? { zipPath: alipayForm.filePath, zipPassword: alipayForm.zipPassword || undefined }
      : { csvPath: alipayForm.filePath }
    alipayResult.value = await hub.importAlipayBill(payload)
    if (alipayResult.value?.status === 'ok') {
      message.success(`导入成功 — ${alipayResult.value.entityCounts?.events || 0} 笔交易`)
      await refresh()
    } else {
      message.error('导入失败: ' + (alipayResult.value?.error || alipayResult.value?.status))
    }
  } catch (err) {
    alipayResult.value = { status: 'error', error: err.message }
    message.error('导入失败: ' + err.message)
  } finally {
    loading.importAlipay = false
  }
}

// ─── Phase 5.6 — event detail ──────────────────────────────────────────

async function showEventDetail(eventId) {
  if (!eventId) return
  loading.eventDetail = true
  eventDetailOpen.value = true
  try {
    eventDetail.value = await hub.eventDetail(eventId)
  } catch (err) {
    eventDetail.value = null
    message.error('事件详情加载失败: ' + err.message)
  } finally {
    loading.eventDetail = false
  }
}

// Expose for template-level event handlers (e.g. citation click)
defineExpose({ showEventDetail })

// Phase 11 — analysis skills handler
async function runSkill(name) {
  loading.skill = true
  skillResult.value = null
  try {
    skillResult.value = await hub.runSkill(name, {})
  } catch (err) {
    message.error(`${name} 失败: ${err.message}`)
  } finally {
    loading.skill = false
  }
}

// Phase 8 — EntityResolver UI handlers
async function loadReviewQueue() {
  loading.reviewQueue = true
  try {
    reviewRows.value = await hub.reviewQueueList(50)
    const stats = await hub.resolverStats()
    Object.assign(resolverStats, stats)
  } catch (err) {
    message.error('待消歧加载失败: ' + err.message)
  } finally {
    loading.reviewQueue = false
  }
}

async function openReviewQueue() {
  reviewQueueOpen.value = true
  await loadReviewQueue()
}

async function decideReview(reviewId, decision) {
  try {
    await hub.reviewDecision(reviewId, decision)
    message.success(`已记录决策: ${decision}`)
    await loadReviewQueue()
  } catch (err) {
    message.error('决策失败: ' + err.message)
  }
}

async function drainResolver() {
  loading.resolverDrain = true
  try {
    const r = await hub.resolverDrain(20)
    message.success(`drain 完成 — same=${r.same} different=${r.different} review=${r.review}`)
    await loadReviewQueue()
  } catch (err) {
    message.error('drain 失败: ' + err.message)
  } finally {
    loading.resolverDrain = false
  }
}

async function loadResolverStats() {
  try {
    const stats = await hub.resolverStats()
    Object.assign(resolverStats, stats)
  } catch (_e) {
    // Silent — endpoint may not be available
  }
}

onMounted(() => {
  refresh()
  loadResolverStats()
})
</script>

<style scoped>
.pdh-page {
  padding: 16px;
  max-width: 1400px;
  margin: 0 auto;
}
.pdh-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
  gap: 16px;
  flex-wrap: wrap;
}
.page-title {
  margin: 0 0 4px 0;
  font-size: 22px;
  font-weight: 600;
}
.page-sub {
  margin: 0;
  color: var(--text-color-secondary, #888);
  font-size: 13px;
}
.kv {
  font-size: 13px;
  color: var(--text-color, #333);
  line-height: 1.6;
}
.kv.hint {
  color: #faad14;
  font-size: 12px;
  margin-top: 4px;
}
.answer {
  white-space: pre-wrap;
  font-size: 14px;
  line-height: 1.7;
  background: var(--bg-elevated, #fafafa);
  padding: 12px;
  border-radius: 6px;
  border-left: 3px solid #1677ff;
}
.hint {
  color: var(--text-color-secondary, #888);
  font-size: 12px;
}
.json-pre {
  font-size: 12px;
  background: var(--bg-elevated, #fafafa);
  padding: 10px;
  border-radius: 4px;
  max-height: 280px;
  overflow: auto;
}
.amount-in {
  color: #52c41a;
  font-weight: 600;
}
.amount-out {
  color: #ff4d4f;
  font-weight: 600;
}
</style>
