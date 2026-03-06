<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useComplianceStore } from '../../stores/compliance';

const store = useComplianceStore();
const activeTab = ref('overview');
const classifyContent = ref('');
const selectedCriteria = ref('security');

const criteriaOptions = [
  { label: 'Security', value: 'security' },
  { label: 'Availability', value: 'availability' },
  { label: 'Processing Integrity', value: 'processing_integrity' },
  { label: 'Confidentiality', value: 'confidentiality' },
  { label: 'Privacy', value: 'privacy' },
];

async function handleGenerateReport() {
  await store.generateReport();
}

async function handleCollectAll() {
  await store.collectAuditEvidence();
  await store.collectAccessEvidence();
  await store.collectConfigEvidence();
}

async function handleClassify() {
  if (!classifyContent.value.trim()) {return;}
  await store.classifyContent(classifyContent.value);
}

async function handleFetchEvidence() {
  await store.getEvidenceByCriteria(selectedCriteria.value);
}

onMounted(async () => {
  await store.fetchPolicies();
});
</script>

<template>
  <div class="compliance-dashboard-page">
    <a-page-header
      title="Compliance Dashboard"
      sub-title="SOC 2 Type II & Data Classification"
    />

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane
        key="overview"
        tab="SOC 2 Overview"
      >
        <a-space style="margin-bottom: 16px">
          <a-button
            type="primary"
            :loading="store.loading"
            @click="handleCollectAll"
          >
            Collect Evidence
          </a-button>
          <a-button
            :loading="store.loading"
            @click="handleGenerateReport"
          >
            Generate Report
          </a-button>
        </a-space>

        <a-row
          v-if="store.report"
          :gutter="16"
        >
          <a-col :span="8">
            <a-card :bordered="false">
              <a-statistic
                title="Compliance Score"
                :value="store.complianceScore"
                suffix="%"
              />
            </a-card>
          </a-col>
          <a-col :span="8">
            <a-card :bordered="false">
              <a-statistic
                title="Total Evidence"
                :value="store.report.totalEvidence"
              />
            </a-card>
          </a-col>
          <a-col :span="8">
            <a-card :bordered="false">
              <a-statistic
                title="Criteria Covered"
                :value="store.report.summary.coveredCriteria"
                :suffix="`/ ${store.report.summary.totalCriteria}`"
              />
            </a-card>
          </a-col>
        </a-row>

        <a-card
          v-if="store.report"
          title="Recommendations"
          :bordered="false"
          style="margin-top: 16px"
        >
          <a-list
            :data-source="store.report.recommendations"
            size="small"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta :title="item.criteria">
                  <template #description>
                    <a-tag :color="item.priority === 'high' ? 'red' : 'orange'">
                      {{ item.priority }}
                    </a-tag>
                    {{ item.recommendation }}
                  </template>
                </a-list-item-meta>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-tab-pane>

      <a-tab-pane
        key="evidence"
        tab="Evidence"
      >
        <a-space style="margin-bottom: 16px">
          <a-select
            v-model:value="selectedCriteria"
            :options="criteriaOptions"
            style="width: 200px"
          />
          <a-button
            :loading="store.loading"
            @click="handleFetchEvidence"
          >
            Load Evidence
          </a-button>
        </a-space>

        <a-table
          :data-source="store.evidence"
          :columns="[
            { title: 'Title', dataIndex: 'title', key: 'title' },
            { title: 'Type', dataIndex: 'evidence_type', key: 'type' },
            { title: 'Status', dataIndex: 'status', key: 'status' },
            { title: 'Created', dataIndex: 'created_at', key: 'created' },
          ]"
          :loading="store.loading"
          size="small"
          :pagination="{ pageSize: 10 }"
          row-key="id"
        />
      </a-tab-pane>

      <a-tab-pane
        key="classify"
        tab="Data Classification"
      >
        <a-card
          title="Classify Content"
          :bordered="false"
        >
          <a-textarea
            v-model:value="classifyContent"
            placeholder="Paste content to scan for PII/PHI/PCI..."
            :rows="4"
          />
          <a-button
            type="primary"
            :loading="store.loading"
            style="margin-top: 12px"
            @click="handleClassify"
          >
            Scan Content
          </a-button>
        </a-card>

        <a-card
          v-if="store.classificationResult"
          title="Scan Result"
          :bordered="false"
          style="margin-top: 16px"
        >
          <a-descriptions
            :column="2"
            size="small"
          >
            <a-descriptions-item label="Category">
              <a-tag :color="store.classificationResult.category === 'general' ? 'green' : 'red'">
                {{ store.classificationResult.category.toUpperCase() }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="Severity">
              <a-tag :color="store.classificationResult.severity === 'critical' ? 'red' : store.classificationResult.severity === 'high' ? 'orange' : 'blue'">
                {{ store.classificationResult.severity }}
              </a-tag>
            </a-descriptions-item>
            <a-descriptions-item label="Confidence">
              {{ (store.classificationResult.confidence * 100).toFixed(0) }}%
            </a-descriptions-item>
            <a-descriptions-item label="Detections">
              {{ store.classificationResult.detections.length }}
            </a-descriptions-item>
          </a-descriptions>

          <a-table
            v-if="store.classificationResult.detections.length > 0"
            :data-source="store.classificationResult.detections"
            :columns="[
              { title: 'Type', dataIndex: 'type', key: 'type' },
              { title: 'Category', dataIndex: 'category', key: 'category' },
              { title: 'Count', dataIndex: 'count', key: 'count' },
              { title: 'Severity', dataIndex: 'severity', key: 'severity' },
            ]"
            size="small"
            :pagination="false"
            style="margin-top: 12px"
          />
        </a-card>
      </a-tab-pane>

      <a-tab-pane
        key="policies"
        tab="Policies"
      >
        <a-list
          :data-source="store.policies"
          size="small"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-list-item-meta
                :title="item.name"
                :description="item.description"
              >
                <template #avatar>
                  <a-tag :color="item.level === 'top_secret' ? 'red' : item.level === 'confidential' ? 'orange' : 'blue'">
                    {{ item.level }}
                  </a-tag>
                </template>
              </a-list-item-meta>
            </a-list-item>
          </template>
        </a-list>
      </a-tab-pane>
    </a-tabs>

    <a-alert
      v-if="store.error"
      :message="store.error"
      type="error"
      closable
      style="margin-top: 16px"
      @close="store.error = null"
    />
  </div>
</template>

<style lang="less" scoped>
.compliance-dashboard-page {
  padding: 24px;
}
</style>
