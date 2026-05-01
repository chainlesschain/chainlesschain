<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px;">
      <div>
        <h2 class="page-title">{{ $t('codegen.title') }}</h2>
        <p class="page-sub">{{ $t('codegen.subtitle') }}</p>
      </div>
      <a-space>
        <a-button :loading="loading" @click="loadAll">
          <template #icon><ReloadOutlined /></template>
          {{ $t('codegen.refresh') }}
        </a-button>
        <a-button @click="showReviewModal = true">
          <template #icon><SafetyOutlined /></template>
          {{ $t('codegen.review') }}
        </a-button>
        <a-dropdown>
          <a-button type="primary">
            <template #icon><PlusOutlined /></template>
            {{ $t('codegen.newDropdown') }}
          </a-button>
          <template #overlay>
            <a-menu>
              <a-menu-item key="generate" @click="showGenerateModal = true">{{ $t('codegen.actions.generate') }}</a-menu-item>
              <a-menu-item key="scaffold" @click="showScaffoldModal = true">{{ $t('codegen.actions.scaffold') }}</a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-space>
    </div>

    <!-- Stat cards -->
    <a-row :gutter="[16, 16]" style="margin-bottom: 20px;">
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic :title="$t('codegen.stats.generations')" :value="stats.generations.total" :value-style="{ color: '#1677ff', fontSize: '20px' }">
            <template #prefix><CodeOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('codegen.stats.reviews')"
            :value="stats.reviews.total"
            :value-style="{ color: '#13c2c2', fontSize: '20px' }"
          >
            <template #prefix><AuditOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('codegen.stats.securityIssues')"
            :value="stats.reviews.totalSecurityIssues"
            :value-style="{ color: stats.reviews.totalSecurityIssues > 0 ? '#ff4d4f' : '#52c41a', fontSize: '20px' }"
          >
            <template #prefix><WarningOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="12" :sm="8" :lg="5">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('codegen.stats.scaffolds')"
            :value="stats.scaffolds.total"
            :value-style="{ color: '#722ed1', fontSize: '20px' }"
          >
            <template #prefix><AppstoreAddOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
      <a-col :xs="24" :sm="8" :lg="4">
        <a-card style="background: var(--bg-card); border-color: var(--border-color);">
          <a-statistic
            :title="$t('codegen.stats.languages')"
            :value="stats.generations.uniqueLanguages"
            :value-style="{ color: '#faad14', fontSize: '20px' }"
          >
            <template #prefix><GlobalOutlined /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <!-- Template catalogue -->
    <a-card
      :title="$t('codegen.templatesCard')"
      size="small"
      style="background: var(--bg-card); border-color: var(--border-color); margin-bottom: 20px;"
      :body-style="{ padding: '12px 16px' }"
    >
      <a-row :gutter="[12, 12]">
        <a-col v-for="t in SCAFFOLD_TEMPLATES" :key="t" :xs="12" :sm="8" :lg="4">
          <div class="tmpl-pill" :style="{ borderLeftColor: tmplBarColor(t) }">
            <a-tag :color="tmplColor(t)" style="font-family: monospace;">{{ t }}</a-tag>
            <span class="tmpl-count">{{ stats.scaffolds.byTemplate[t] || 0 }}</span>
          </div>
        </a-col>
      </a-row>
    </a-card>

    <!-- Tabs -->
    <a-tabs v-model:activeKey="activeTab" class="codegen-tabs">
      <!-- ── Generations tab ────────────────────────────────────── -->
      <a-tab-pane key="generations" :tab="$t('codegen.tabs.generations')">
        <div class="filter-bar">
          <a-input
            v-model:value="languageFilter"
            :placeholder="$t('codegen.filter.languagePlaceholder')"
            allow-clear
            size="small"
            style="max-width: 180px;"
          />
          <a-input
            v-model:value="frameworkFilter"
            :placeholder="$t('codegen.filter.frameworkPlaceholder')"
            allow-clear
            size="small"
            style="max-width: 180px;"
          />
        </div>

        <a-table
          :columns="generationColumns"
          :data-source="filteredGenerations"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('codegen.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'prompt'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ truncate(record.prompt, 60) }}</span>
              <div style="color: var(--text-muted); font-size: 11px; font-family: monospace; margin-top: 2px;">
                {{ record.id.slice(0, 16) }}
              </div>
            </template>
            <template v-if="column.key === 'language'">
              <a-tag v-if="record.language" color="blue" style="font-family: monospace;">{{ record.language }}</a-tag>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'framework'">
              <a-tag v-if="record.framework" color="purple" style="font-family: monospace;">{{ record.framework }}</a-tag>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'fileCount'">
              <span style="color: var(--text-secondary);">{{ record.fileCount }}</span>
            </template>
            <template v-if="column.key === 'tokenCount'">
              <span style="color: var(--text-secondary); font-family: monospace; font-size: 12px;">{{ record.tokenCount }}</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatCodegenTime(record.createdAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="viewGenerationDetails(record)">{{ $t('codegen.table.actionDetails') }}</a-button>
              <a-button v-if="record.generatedCode" size="small" type="link" @click="reviewGeneration(record)">{{ $t('codegen.table.actionReview') }}</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <CodeOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ languageFilter || frameworkFilter ? $t('codegen.table.emptyGenerationsFiltered') : $t('codegen.table.emptyGenerations') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Reviews tab ───────────────────────────────────────── -->
      <a-tab-pane key="reviews" :tab="$t('codegen.tabs.reviews')">
        <a-table
          :columns="reviewColumns"
          :data-source="reviews"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('codegen.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'codeHash'">
              <span style="color: var(--text-primary); font-family: monospace; font-size: 12px;">{{ record.codeHash }}</span>
              <div style="color: var(--text-muted); font-size: 11px; font-family: monospace; margin-top: 2px;">
                {{ record.id.slice(0, 16) }}
              </div>
            </template>
            <template v-if="column.key === 'language'">
              <a-tag v-if="record.language" color="blue" style="font-family: monospace;">{{ record.language }}</a-tag>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'issuesFound'">
              <a-tag :color="record.issuesFound === 0 ? 'green' : record.issuesFound > 5 ? 'red' : 'orange'">
                {{ $t('codegen.table.issuesSuffix', { n: record.issuesFound }) }}
              </a-tag>
            </template>
            <template v-if="column.key === 'securityIssues'">
              <a-tag v-if="record.securityIssues > 0" color="red">
                <WarningOutlined /> {{ record.securityIssues }}
              </a-tag>
              <a-tag v-else color="green">
                <CheckCircleOutlined /> 0
              </a-tag>
            </template>
            <template v-if="column.key === 'severityBreak'">
              <span class="sev-mini">
                <span v-if="record.severitySummary.critical > 0" :style="{ color: '#ff4d4f' }">C:{{ record.severitySummary.critical }}</span>
                <span v-if="record.severitySummary.high > 0" :style="{ color: '#fa8c16' }">H:{{ record.severitySummary.high }}</span>
                <span v-if="record.severitySummary.medium > 0" :style="{ color: '#faad14' }">M:{{ record.severitySummary.medium }}</span>
                <span v-if="record.severitySummary.low > 0" :style="{ color: '#888' }">L:{{ record.severitySummary.low }}</span>
                <span v-if="record.severitySummary.info > 0" :style="{ color: '#1677ff' }">I:{{ record.severitySummary.info }}</span>
                <span v-if="record.issuesFound === 0" style="color: #52c41a;">{{ $t('codegen.table.noIssues') }}</span>
              </span>
            </template>
            <template v-if="column.key === 'reviewedAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatCodegenTime(record.reviewedAt) }}</span>
            </template>
            <template v-if="column.key === 'action'">
              <a-button size="small" type="link" @click="viewReviewDetails(record)">{{ $t('codegen.table.actionDetails') }}</a-button>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <SafetyOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ $t('codegen.table.emptyReviews') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>

      <!-- ── Scaffolds tab ─────────────────────────────────────── -->
      <a-tab-pane key="scaffolds" :tab="$t('codegen.tabs.scaffolds')">
        <div class="filter-bar">
          <a-radio-group v-model:value="templateFilter" size="small" button-style="solid">
            <a-radio-button value="">{{ $t('codegen.filter.allTemplates') }}</a-radio-button>
            <a-radio-button v-for="t in SCAFFOLD_TEMPLATES" :key="t" :value="t">{{ t }}</a-radio-button>
          </a-radio-group>
        </div>

        <a-table
          :columns="scaffoldColumns"
          :data-source="filteredScaffolds"
          :pagination="{ pageSize: 20, showTotal: (t) => $t('codegen.table.totalSuffix', { n: t }) }"
          size="small"
          :loading="loading"
          style="background: var(--bg-card);"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'projectName'">
              <span style="color: var(--text-primary); font-weight: 500;">{{ record.projectName || $t('codegen.table.unnamed') }}</span>
              <div style="color: var(--text-muted); font-size: 11px; font-family: monospace; margin-top: 2px;">
                {{ record.id.slice(0, 16) }}
              </div>
            </template>
            <template v-if="column.key === 'template'">
              <a-tag :color="tmplColor(record.template)" style="font-family: monospace;">{{ record.template }}</a-tag>
            </template>
            <template v-if="column.key === 'filesGenerated'">
              <span style="color: var(--text-secondary);">{{ record.filesGenerated }}</span>
            </template>
            <template v-if="column.key === 'outputPath'">
              <span v-if="record.outputPath" style="color: var(--text-secondary); font-family: monospace; font-size: 11px;">{{ truncate(record.outputPath, 40) }}</span>
              <span v-else style="color: var(--text-muted);">—</span>
            </template>
            <template v-if="column.key === 'createdAt'">
              <span style="color: var(--text-secondary); font-size: 11px;">{{ formatCodegenTime(record.createdAt) }}</span>
            </template>
          </template>
          <template #emptyText>
            <div style="padding: 40px; color: var(--text-muted); text-align: center;">
              <AppstoreAddOutlined style="font-size: 36px; margin-bottom: 10px; display: block;" />
              {{ templateFilter ? $t('codegen.table.emptyScaffoldsFiltered') : $t('codegen.table.emptyScaffolds') }}
            </div>
          </template>
        </a-table>
      </a-tab-pane>
    </a-tabs>

    <!-- ── Generate modal ──────────────────────────────────────── -->
    <a-modal
      v-model:open="showGenerateModal"
      :title="$t('codegen.generate_modal.title')"
      :confirm-loading="generating"
      :width="560"
      :ok-text="$t('codegen.generate_modal.ok')"
      :cancel-text="$t('codegen.generate_modal.cancel')"
      @ok="submitGenerate"
      @cancel="resetGenerateForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('codegen.generate_modal.promptLabel')" required>
          <a-textarea
            v-model:value="generateForm.prompt"
            :placeholder="$t('codegen.generate_modal.promptPlaceholder')"
            :auto-size="{ minRows: 2, maxRows: 5 }"
          />
        </a-form-item>
        <a-form-item :label="$t('codegen.generate_modal.languageLabel')">
          <a-input v-model:value="generateForm.language" :placeholder="$t('codegen.generate_modal.languagePlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('codegen.generate_modal.frameworkLabel')">
          <a-input v-model:value="generateForm.framework" :placeholder="$t('codegen.generate_modal.frameworkPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('codegen.generate_modal.codeLabel')">
          <a-textarea
            v-model:value="generateForm.code"
            :placeholder="$t('codegen.generate_modal.codePlaceholder')"
            :auto-size="{ minRows: 3, maxRows: 10 }"
          />
        </a-form-item>
        <a-form-item :label="$t('codegen.generate_modal.filesLabel')">
          <a-input-number v-model:value="generateForm.files" :min="0" style="width: 120px;" />
        </a-form-item>
        <a-form-item :label="$t('codegen.generate_modal.tokensLabel')">
          <a-input-number v-model:value="generateForm.tokens" :min="0" style="width: 160px;" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Review modal ────────────────────────────────────────── -->
    <a-modal
      v-model:open="showReviewModal"
      :title="$t('codegen.review_modal.title')"
      :width="720"
      :footer="null"
    >
      <div style="padding-top: 8px;">
        <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }">
          <a-form-item :label="$t('codegen.review_modal.languageLabel')">
            <a-input v-model:value="reviewForm.language" :placeholder="$t('codegen.review_modal.languagePlaceholder')" />
          </a-form-item>
          <a-form-item :label="$t('codegen.review_modal.generationIdLabel')">
            <a-input v-model:value="reviewForm.generationId" :placeholder="$t('codegen.review_modal.generationIdPlaceholder')" />
          </a-form-item>
          <a-form-item :label="$t('codegen.review_modal.codeLabel')" required>
            <a-textarea
              v-model:value="reviewForm.code"
              :placeholder="$t('codegen.review_modal.codePlaceholder')"
              :auto-size="{ minRows: 6, maxRows: 16 }"
            />
          </a-form-item>
          <a-form-item :wrapper-col="{ offset: 5, span: 19 }">
            <a-button type="primary" :loading="reviewing" @click="submitReview">
              <template #icon><SafetyOutlined /></template>
              {{ $t('codegen.review_modal.submit') }}
            </a-button>
          </a-form-item>
        </a-form>

        <a-divider />

        <a-empty v-if="!reviewResult" :description="$t('codegen.review_modal.notReviewed')" :image="EMPTY_IMG" />
        <div v-else>
          <a-row :gutter="12" style="margin-bottom: 12px;">
            <a-col :span="8">
              <a-statistic :title="$t('codegen.review_modal.issuesStat')" :value="reviewResult.issuesFound" :value-style="{ color: reviewResult.issuesFound > 0 ? '#fa8c16' : '#52c41a', fontSize: '18px' }" />
            </a-col>
            <a-col :span="8">
              <a-statistic :title="$t('codegen.review_modal.securityStat')" :value="reviewResult.securityIssues" :value-style="{ color: reviewResult.securityIssues > 0 ? '#ff4d4f' : '#52c41a', fontSize: '18px' }" />
            </a-col>
            <a-col :span="8">
              <a-statistic :title="$t('codegen.review_modal.reviewIdStat')" :value="reviewResult.reviewId ? reviewResult.reviewId.slice(0, 8) : '—'" :value-style="{ fontSize: '14px', fontFamily: 'monospace' }" />
            </a-col>
          </a-row>
          <h5 style="color: var(--text-primary); font-size: 12px; margin: 12px 0 6px;">{{ $t('codegen.review_modal.bySeverity') }}</h5>
          <a-space>
            <a-tag v-for="s in REVIEW_SEVERITIES" :key="s" :color="severityColor(s)">
              {{ severityLabel(s) }}: {{ reviewResult.severitySummary[s] || 0 }}
            </a-tag>
          </a-space>
          <a-alert
            v-if="reviewResult.reason"
            type="warning"
            show-icon
            :message="$t('codegen.review_modal.failedReason', { reason: reviewResult.reason })"
            style="margin-top: 12px;"
          />
        </div>
      </div>
    </a-modal>

    <!-- ── Scaffold modal ──────────────────────────────────────── -->
    <a-modal
      v-model:open="showScaffoldModal"
      :title="$t('codegen.scaffold_modal.title')"
      :confirm-loading="scaffolding"
      :width="560"
      :ok-text="$t('codegen.scaffold_modal.ok')"
      :cancel-text="$t('codegen.scaffold_modal.cancel')"
      @ok="submitScaffold"
      @cancel="resetScaffoldForm"
    >
      <a-form :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" style="margin-top: 16px;">
        <a-form-item :label="$t('codegen.scaffold_modal.templateLabel')" required>
          <a-select v-model:value="scaffoldForm.template">
            <a-select-option v-for="t in SCAFFOLD_TEMPLATES" :key="t" :value="t">{{ t }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item :label="$t('codegen.scaffold_modal.projectLabel')" required>
          <a-input v-model:value="scaffoldForm.projectName" :placeholder="$t('codegen.scaffold_modal.projectPlaceholder')" />
        </a-form-item>
        <a-form-item :label="$t('codegen.scaffold_modal.optionsLabel')">
          <a-textarea
            v-model:value="scaffoldForm.optionsJson"
            :placeholder="$t('codegen.scaffold_modal.optionsPlaceholder')"
            :auto-size="{ minRows: 2, maxRows: 4 }"
          />
        </a-form-item>
        <a-form-item :label="$t('codegen.scaffold_modal.filesLabel')">
          <a-input-number v-model:value="scaffoldForm.files" :min="0" style="width: 120px;" />
        </a-form-item>
        <a-form-item :label="$t('codegen.scaffold_modal.outputLabel')">
          <a-input v-model:value="scaffoldForm.outputPath" :placeholder="$t('codegen.scaffold_modal.outputPlaceholder')" />
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- ── Generation details modal ───────────────────────────── -->
    <a-modal
      v-model:open="showGenDetailsModal"
      :title="$t('codegen.gen_details.title', { id: currentGen?.id?.slice(0, 12) || '' })"
      :width="780"
      :footer="null"
    >
      <div v-if="currentGen" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item :label="$t('codegen.gen_details.id')" :span="2">
            <span style="font-family: monospace; font-size: 12px;">{{ currentGen.id }}</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('codegen.gen_details.language')">
            <a-tag v-if="currentGen.language" color="blue">{{ currentGen.language }}</a-tag>
            <span v-else style="color: var(--text-muted);">—</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('codegen.gen_details.framework')">
            <a-tag v-if="currentGen.framework" color="purple">{{ currentGen.framework }}</a-tag>
            <span v-else style="color: var(--text-muted);">—</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('codegen.gen_details.fileCount')">{{ currentGen.fileCount }}</a-descriptions-item>
          <a-descriptions-item :label="$t('codegen.gen_details.tokenCount')">{{ currentGen.tokenCount }}</a-descriptions-item>
          <a-descriptions-item :label="$t('codegen.gen_details.createdAt')" :span="2">{{ formatCodegenTime(currentGen.createdAt) }}</a-descriptions-item>
          <a-descriptions-item :label="$t('codegen.gen_details.prompt')" :span="2">
            <pre class="code-pre">{{ currentGen.prompt }}</pre>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentGen.generatedCode" :label="$t('codegen.gen_details.code')" :span="2">
            <pre class="code-pre">{{ truncate(currentGen.generatedCode, 2000) }}</pre>
          </a-descriptions-item>
        </a-descriptions>
      </div>
    </a-modal>

    <!-- ── Review details modal ──────────────────────────────── -->
    <a-modal
      v-model:open="showReviewDetailsModal"
      :title="$t('codegen.review_details.title', { id: currentReview?.id?.slice(0, 12) || '' })"
      :width="720"
      :footer="null"
    >
      <div v-if="currentReview" style="padding-top: 8px;">
        <a-descriptions :column="2" size="small" bordered>
          <a-descriptions-item :label="$t('codegen.review_details.id')" :span="2">
            <span style="font-family: monospace; font-size: 12px;">{{ currentReview.id }}</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('codegen.review_details.codeHash')" :span="2">
            <span style="font-family: monospace; font-size: 12px;">{{ currentReview.codeHash }}</span>
          </a-descriptions-item>
          <a-descriptions-item v-if="currentReview.generationId" :label="$t('codegen.review_details.generationId')" :span="2">
            <span style="font-family: monospace; font-size: 12px;">{{ currentReview.generationId }}</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('codegen.review_details.language')">
            <a-tag v-if="currentReview.language" color="blue">{{ currentReview.language }}</a-tag>
            <span v-else style="color: var(--text-muted);">—</span>
          </a-descriptions-item>
          <a-descriptions-item :label="$t('codegen.review_details.reviewedAt')">{{ formatCodegenTime(currentReview.reviewedAt) }}</a-descriptions-item>
          <a-descriptions-item :label="$t('codegen.review_details.issuesFound')">{{ currentReview.issuesFound }}</a-descriptions-item>
          <a-descriptions-item :label="$t('codegen.review_details.securityIssues')">
            <span :style="{ color: currentReview.securityIssues > 0 ? '#ff4d4f' : '#52c41a' }">{{ currentReview.securityIssues }}</span>
          </a-descriptions-item>
        </a-descriptions>

        <h4 style="color: var(--text-primary); font-size: 13px; margin: 16px 0 8px;">{{ $t('codegen.review_details.bySeverity') }}</h4>
        <div v-for="s in REVIEW_SEVERITIES" :key="s" class="bd-row">
          <a-tag :color="severityColor(s)" style="min-width: 70px; text-align: center;">{{ severityLabel(s) }}</a-tag>
          <a-progress
            :percent="pctOfTotal(currentReview.severitySummary[s] || 0, currentReview.issuesFound)"
            :stroke-color="severityBarColor(s)"
            :format="() => `${currentReview.severitySummary[s] || 0}`"
            size="small"
            style="flex: 1; margin-left: 12px;"
          />
        </div>

        <h4 v-if="currentReview.issuesDetail.length" style="color: var(--text-primary); font-size: 13px; margin: 16px 0 8px;">{{ $t('codegen.review_details.issues') }}</h4>
        <a-list v-if="currentReview.issuesDetail.length" size="small" :data-source="currentReview.issuesDetail" :pagination="{ pageSize: 8 }">
          <template #renderItem="{ item }">
            <a-list-item>
              <a-tag :color="severityColor(item.severity)" style="min-width: 60px; text-align: center;">{{ severityLabel(item.severity) }}</a-tag>
              <span style="margin-left: 8px; font-family: monospace; font-size: 12px;">{{ item.rule }}</span>
              <code style="margin-left: 8px; padding: 1px 6px; background: var(--bg-base); border-radius: 3px; font-size: 11px;">{{ truncate(item.match, 60) }}</code>
            </a-list-item>
          </template>
        </a-list>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue'
import {
  ReloadOutlined,
  PlusOutlined,
  SafetyOutlined,
  CodeOutlined,
  AuditOutlined,
  WarningOutlined,
  CheckCircleOutlined,
  AppstoreAddOutlined,
  GlobalOutlined,
} from '@ant-design/icons-vue'
import { message, Empty } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { useWsStore } from '../stores/ws.js'
import {
  parseGenerations,
  parseReviews,
  parseReviewResult,
  parseScaffolds,
  parseStats,
  parseActionResult,
  formatCodegenTime,
  SCAFFOLD_TEMPLATES,
  REVIEW_SEVERITIES,
} from '../utils/codegen-parser.js'

const ws = useWsStore()
const { t } = useI18n()

const EMPTY_IMG = Empty.PRESENTED_IMAGE_SIMPLE

const loading = ref(false)
const generating = ref(false)
const reviewing = ref(false)
const scaffolding = ref(false)

const generations = ref([])
const reviews = ref([])
const scaffolds = ref([])
const stats = ref({
  generations: { total: 0, totalTokens: 0, totalFiles: 0, uniqueLanguages: 0 },
  reviews: { total: 0, totalIssues: 0, totalSecurityIssues: 0, avgIssuesPerReview: 0 },
  scaffolds: { total: 0, byTemplate: {} },
})

const activeTab = ref('generations')
const languageFilter = ref('')
const frameworkFilter = ref('')
const templateFilter = ref('')

const showGenerateModal = ref(false)
const showReviewModal = ref(false)
const showScaffoldModal = ref(false)
const showGenDetailsModal = ref(false)
const showReviewDetailsModal = ref(false)

const generateForm = reactive({ prompt: '', language: '', framework: '', code: '', files: 0, tokens: 0 })
const reviewForm = reactive({ generationId: '', language: '', code: '' })
const scaffoldForm = reactive({ template: 'react', projectName: '', optionsJson: '', files: 0, outputPath: '' })

const reviewResult = ref(null)
const currentGen = ref(null)
const currentReview = ref(null)

const generationColumns = computed(() => [
  { title: t('codegen.generationCols.prompt'), key: 'prompt' },
  { title: t('codegen.generationCols.language'), key: 'language', width: '110px' },
  { title: t('codegen.generationCols.framework'), key: 'framework', width: '110px' },
  { title: t('codegen.generationCols.fileCount'), key: 'fileCount', width: '70px' },
  { title: t('codegen.generationCols.tokenCount'), key: 'tokenCount', width: '110px' },
  { title: t('codegen.generationCols.createdAt'), key: 'createdAt', width: '160px' },
  { title: t('codegen.generationCols.action'), key: 'action', width: '140px' },
])

const reviewColumns = computed(() => [
  { title: t('codegen.reviewCols.codeHash'), key: 'codeHash', width: '180px' },
  { title: t('codegen.reviewCols.language'), key: 'language', width: '110px' },
  { title: t('codegen.reviewCols.issuesFound'), key: 'issuesFound', width: '90px' },
  { title: t('codegen.reviewCols.securityIssues'), key: 'securityIssues', width: '90px' },
  { title: t('codegen.reviewCols.severityBreak'), key: 'severityBreak' },
  { title: t('codegen.reviewCols.reviewedAt'), key: 'reviewedAt', width: '160px' },
  { title: t('codegen.reviewCols.action'), key: 'action', width: '90px' },
])

const scaffoldColumns = computed(() => [
  { title: t('codegen.scaffoldCols.projectName'), key: 'projectName' },
  { title: t('codegen.scaffoldCols.template'), key: 'template', width: '120px' },
  { title: t('codegen.scaffoldCols.filesGenerated'), key: 'filesGenerated', width: '90px' },
  { title: t('codegen.scaffoldCols.outputPath'), key: 'outputPath', width: '300px' },
  { title: t('codegen.scaffoldCols.createdAt'), key: 'createdAt', width: '160px' },
])

const filteredGenerations = computed(() => {
  let rows = generations.value
  if (languageFilter.value.trim()) {
    const q = languageFilter.value.trim().toLowerCase()
    rows = rows.filter(g => (g.language || '').toLowerCase().includes(q))
  }
  if (frameworkFilter.value.trim()) {
    const q = frameworkFilter.value.trim().toLowerCase()
    rows = rows.filter(g => (g.framework || '').toLowerCase().includes(q))
  }
  return rows
})

const filteredScaffolds = computed(() => {
  if (!templateFilter.value) return scaffolds.value
  return scaffolds.value.filter(s => s.template === templateFilter.value)
})

function tmplColor(t) {
  return {
    react: 'cyan', vue: 'green', express: 'gold',
    fastapi: 'magenta', spring_boot: 'red',
  }[t] || 'default'
}
function tmplBarColor(t) {
  return {
    react: '#13c2c2', vue: '#52c41a', express: '#faad14',
    fastapi: '#eb2f96', spring_boot: '#ff4d4f',
  }[t] || '#888'
}

function severityLabel(s) {
  const key = `codegen.severityLabels.${s}`
  const v = t(key)
  return v === key ? s : v
}
function severityColor(s) {
  return { critical: 'red', high: 'orange', medium: 'gold', low: 'default', info: 'blue' }[s] || 'default'
}
function severityBarColor(s) {
  return { critical: '#ff4d4f', high: '#fa8c16', medium: '#faad14', low: '#888', info: '#1677ff' }[s] || '#888'
}

function pctOfTotal(n, total) {
  if (!total) return 0
  return Math.round((n / total) * 100)
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
    const [gensRes, revsRes, scfsRes, statsRes] = await Promise.all([
      ws.execute('codegen list --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('codegen reviews --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('codegen scaffolds --limit 200 --json', 10000).catch(() => ({ output: '' })),
      ws.execute('codegen stats --json', 8000).catch(() => ({ output: '' })),
    ])
    generations.value = parseGenerations(gensRes.output)
    reviews.value = parseReviews(revsRes.output)
    scaffolds.value = parseScaffolds(scfsRes.output)
    stats.value = parseStats(statsRes.output)
  } catch (e) {
    message.error(t('codegen.msg.loadFailed') + ': ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

async function submitGenerate() {
  if (!generateForm.prompt.trim()) {
    message.warning(t('codegen.msg.promptEmpty'))
    return
  }
  generating.value = true
  try {
    const parts = [
      `codegen generate -p ${shellQuote(generateForm.prompt.trim())}`,
    ]
    if (generateForm.language.trim()) parts.push(`-l ${shellQuote(generateForm.language.trim())}`)
    if (generateForm.framework.trim()) parts.push(`-f ${shellQuote(generateForm.framework.trim())}`)
    if (generateForm.code.trim()) parts.push(`--code ${shellQuote(generateForm.code.trim())}`)
    if (generateForm.files > 0) parts.push(`--files ${generateForm.files}`)
    if (generateForm.tokens > 0) parts.push(`--tokens ${generateForm.tokens}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error(t('codegen.msg.generateFailed') + ': ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(t('codegen.msg.generateSuccess', { id: r.id?.slice(0, 8) }))
    showGenerateModal.value = false
    resetGenerateForm()
    await loadAll()
  } catch (e) {
    message.error(t('codegen.msg.generateFailed') + ': ' + (e?.message || e))
  } finally {
    generating.value = false
  }
}

async function submitReview() {
  if (!reviewForm.code.trim()) {
    message.warning(t('codegen.msg.codeEmpty'))
    return
  }
  reviewing.value = true
  reviewResult.value = null
  try {
    const parts = [`codegen review -c ${shellQuote(reviewForm.code)}`]
    if (reviewForm.language.trim()) parts.push(`-l ${shellQuote(reviewForm.language.trim())}`)
    if (reviewForm.generationId.trim()) parts.push(`-g ${shellQuote(reviewForm.generationId.trim())}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    reviewResult.value = parseReviewResult(output)
    if (!reviewResult.value.ok && reviewResult.value.reason) {
      message.error(t('codegen.msg.reviewFailed') + ': ' + reviewResult.value.reason)
    } else if (reviewResult.value.ok) {
      message.success(t('codegen.msg.reviewSuccess', { n: reviewResult.value.issuesFound, sec: reviewResult.value.securityIssues }))
      await loadAll()
    } else {
      message.error(t('codegen.msg.reviewFailed') + ': ' + output.slice(0, 120))
    }
  } catch (e) {
    message.error(t('codegen.msg.reviewFailed') + ': ' + (e?.message || e))
  } finally {
    reviewing.value = false
  }
}

async function reviewGeneration(record) {
  reviewForm.generationId = record.id
  reviewForm.language = record.language || ''
  reviewForm.code = record.generatedCode || ''
  reviewResult.value = null
  showReviewModal.value = true
}

async function submitScaffold() {
  if (!scaffoldForm.projectName.trim()) {
    message.warning(t('codegen.msg.projectEmpty'))
    return
  }
  if (scaffoldForm.optionsJson.trim()) {
    try { JSON.parse(scaffoldForm.optionsJson) } catch {
      message.warning(t('codegen.msg.optionsBadJson'))
      return
    }
  }
  scaffolding.value = true
  try {
    const parts = [
      `codegen scaffold -t ${scaffoldForm.template}`,
      `-n ${shellQuote(scaffoldForm.projectName.trim())}`,
    ]
    if (scaffoldForm.optionsJson.trim()) parts.push(`-o ${shellQuote(scaffoldForm.optionsJson.trim())}`)
    if (scaffoldForm.files > 0) parts.push(`--files ${scaffoldForm.files}`)
    if (scaffoldForm.outputPath.trim()) parts.push(`--output ${shellQuote(scaffoldForm.outputPath.trim())}`)
    parts.push('--json')
    const { output } = await ws.execute(parts.join(' '), 10000)
    const r = parseActionResult(output)
    if (!r.ok) {
      message.error(t('codegen.msg.scaffoldFailed') + ': ' + (r.reason || output.slice(0, 120)))
      return
    }
    message.success(t('codegen.msg.scaffoldSuccess', { id: r.id?.slice(0, 8) }))
    showScaffoldModal.value = false
    resetScaffoldForm()
    await loadAll()
  } catch (e) {
    message.error(t('codegen.msg.scaffoldFailed') + ': ' + (e?.message || e))
  } finally {
    scaffolding.value = false
  }
}

function viewGenerationDetails(record) {
  currentGen.value = record
  showGenDetailsModal.value = true
}

function viewReviewDetails(record) {
  currentReview.value = record
  showReviewDetailsModal.value = true
}

function resetGenerateForm() {
  generateForm.prompt = ''
  generateForm.language = ''
  generateForm.framework = ''
  generateForm.code = ''
  generateForm.files = 0
  generateForm.tokens = 0
}

function resetScaffoldForm() {
  scaffoldForm.template = 'react'
  scaffoldForm.projectName = ''
  scaffoldForm.optionsJson = ''
  scaffoldForm.files = 0
  scaffoldForm.outputPath = ''
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

.codegen-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.tmpl-pill {
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(22,119,255,.04);
  border: 1px solid var(--border-color);
  border-left: 3px solid #1677ff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
}
.tmpl-count {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 600;
}

.sev-mini {
  display: inline-flex;
  gap: 8px;
  font-family: monospace;
  font-size: 11px;
  font-weight: 500;
}

.bd-row {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.code-pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg-base);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 11px;
  max-height: 240px;
  overflow: auto;
  color: var(--text-primary);
  white-space: pre-wrap;
}
</style>
