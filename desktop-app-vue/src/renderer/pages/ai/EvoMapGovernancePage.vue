<template>
  <div class="evomap-governance-page">
    <a-page-header
      title="EvoMap Governance"
      sub-title="IP protection and DAO governance"
    >
      <template #extra>
        <a-button type="primary" @click="showProposalModal = true">
          New Proposal
        </a-button>
      </template>
    </a-page-header>
    <a-row :gutter="16" style="margin-bottom: 16px">
      <a-col :span="6">
        <a-statistic
          title="Proposals"
          :value="store.dashboard?.totalProposals || 0"
        />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Active" :value="store.dashboard?.active || 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic title="Passed" :value="store.dashboard?.passed || 0" />
      </a-col>
      <a-col :span="6">
        <a-statistic
          title="Ownerships"
          :value="store.dashboard?.ownerships || 0"
        />
      </a-col>
    </a-row>
    <a-modal
      v-model:open="showProposalModal"
      title="Create Proposal"
      @ok="handleCreateProposal"
    >
      <a-form layout="vertical">
        <a-form-item label="Title">
          <a-input v-model:value="form.title" />
        </a-form-item>
        <a-form-item label="Description">
          <a-textarea v-model:value="form.description" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useEvoMapGovernanceStore } from "../../stores/evoMapGovernance";

const store = useEvoMapGovernanceStore();
const showProposalModal = ref(false);
const form = ref({ title: "", description: "" });

async function handleCreateProposal() {
  if (!form.value.title) {
    message.warning("Title is required");
    return;
  }
  const r = await store.createProposal(form.value);
  if (r.success) {
    message.success("Proposal created");
    showProposalModal.value = false;
    await store.fetchDashboard();
  } else {
    message.error(r.error || "Failed");
  }
}

onMounted(() => store.fetchDashboard());
</script>

<style lang="less" scoped>
.evomap-governance-page {
  padding: 24px;
}
</style>
