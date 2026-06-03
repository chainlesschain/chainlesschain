<template>
  <div class="token-incentive-page">
    <a-page-header
      title="Token Incentive"
      sub-title="Contribution rewards and token economy"
    />
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="8">
        <a-statistic
          title="Balance (CCT)"
          :value="store.balance"
          :precision="2"
        />
      </a-col>
      <a-col :span="8">
        <a-statistic title="Transactions" :value="store.transactions.length" />
      </a-col>
      <a-col :span="8">
        <a-statistic title="Rewards" :value="store.rewardTransactions.length" />
      </a-col>
    </a-row>
    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="transactions" tab="Transactions">
        <a-empty
          v-if="store.transactions.length === 0"
          description="No transactions"
        />
        <a-table
          v-else
          :columns="txColumns"
          :data-source="store.transactions"
          row-key="id"
          size="small"
        />
      </a-tab-pane>
      <a-tab-pane key="contribute" tab="Contribute">
        <a-form layout="vertical" style="max-width: 400px">
          <a-form-item label="Type">
            <a-select
              v-model:value="contribForm.type"
              :options="contribTypes"
            />
          </a-form-item>
          <a-form-item label="Description">
            <a-input v-model:value="contribForm.description" />
          </a-form-item>
          <a-button type="primary" @click="handleContribute">
            Submit Contribution
          </a-button>
        </a-form>
      </a-tab-pane>
    </a-tabs>
    <a-alert
      v-if="store.error"
      type="error"
      :message="store.error"
      closable
      style="margin-top: 16px"
      @close="store.error = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useTokenIncentiveStore } from "../../stores/tokenIncentive";

const store = useTokenIncentiveStore();
const activeTab = ref("transactions");
const contribForm = ref({ type: "skill", description: "" });
const contribTypes = [
  { value: "skill", label: "Skill" },
  { value: "gene", label: "Gene" },
  { value: "compute", label: "Compute" },
  { value: "data", label: "Data" },
];
const txColumns = [
  { title: "Type", dataIndex: "type", width: 100 },
  { title: "Amount", dataIndex: "amount", width: 100 },
  { title: "Balance", dataIndex: "balance_after", width: 100 },
  { title: "Description", dataIndex: "description" },
];

async function handleContribute() {
  const r = await store.submitContribution(contribForm.value);
  if (r.success) {
    message.success("Contribution submitted");
    await store.fetchTransactions();
  } else {
    message.error(r.error || "Failed");
  }
}

onMounted(async () => {
  await store.fetchBalance();
  await store.fetchTransactions();
});
</script>

<style lang="less" scoped>
.token-incentive-page {
  padding: 24px;
}
</style>
