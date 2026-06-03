<template>
  <div class="evomap-federation-page">
    <a-page-header
      title="EvoMap Federation"
      sub-title="Global evolution network"
    />
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic title="Total Hubs" :value="store.hubs.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Online Hubs" :value="store.onlineHubs.length" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Total Genes"
          :value="store.pressureReport?.totalGenes || 0"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Avg Fitness"
          :value="store.pressureReport?.avgFitness || 0"
          :precision="2"
        />
      </a-col>
    </a-row>
    <a-table
      :columns="columns"
      :data-source="store.hubs"
      :loading="store.loading"
      row-key="id"
      size="small"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { useEvoMapFederationStore } from "../../stores/evoMapFederation";

const store = useEvoMapFederationStore();
const columns = [
  { title: "Name", dataIndex: "hub_name", width: 150 },
  { title: "URL", dataIndex: "hub_url", width: 200 },
  { title: "Status", dataIndex: "status", width: 100 },
  { title: "Genes", dataIndex: "gene_count", width: 80 },
  { title: "Trust", dataIndex: "trust_score", width: 80 },
];

onMounted(async () => {
  await store.fetchHubs();
  await store.fetchPressureReport();
});
</script>

<style lang="less" scoped>
.evomap-federation-page {
  padding: 24px;
}
</style>
