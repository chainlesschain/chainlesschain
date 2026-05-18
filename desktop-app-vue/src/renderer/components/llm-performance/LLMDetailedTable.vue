<template>
  <a-card
    title="详细统计"
    class="details-card"
  >
    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane
        key="provider"
        tab="按提供商"
      >
        <div class="table-wrapper">
          <a-table
            :columns="providerColumns"
            :data-source="providerData"
            :pagination="{ pageSize: 10, showSizeChanger: true }"
            :loading="loading"
            size="small"
            :scroll="{ x: 500 }"
            row-key="provider"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'cost_usd'">
                <a-tag color="green">
                  ${{ record.cost_usd.toFixed(4) }}
                </a-tag>
              </template>
              <template v-else-if="column.key === 'tokens'">
                {{ formatNumber(record.tokens) }}
              </template>
              <template v-else-if="column.key === 'provider'">
                <span class="provider-name">
                  <CloudOutlined v-if="record.provider !== 'ollama'" />
                  <DesktopOutlined v-else />
                  {{ record.provider }}
                </span>
              </template>
            </template>
          </a-table>
        </div>
      </a-tab-pane>

      <a-tab-pane
        key="model"
        tab="按模型"
      >
        <div class="table-wrapper">
          <a-table
            :columns="modelColumns"
            :data-source="modelData"
            :pagination="{ pageSize: 10, showSizeChanger: true }"
            :loading="loading"
            size="small"
            :scroll="{ x: 700 }"
            row-key="model"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'cost_usd'">
                <a-tag color="green">
                  ${{ record.cost_usd.toFixed(4) }}
                </a-tag>
              </template>
              <template v-else-if="column.key === 'tokens'">
                {{ formatNumber(record.tokens) }}
              </template>
              <template v-else-if="column.key === 'model'">
                <a-tooltip :title="record.model">
                  <span class="model-name">{{
                    truncateModel(record.model)
                  }}</span>
                </a-tooltip>
              </template>
            </template>
          </a-table>
        </div>
      </a-tab-pane>
    </a-tabs>
  </a-card>
</template>

<script setup>
import { ref } from "vue";
import { CloudOutlined, DesktopOutlined } from "@ant-design/icons-vue";

defineProps({
  providerData: {
    type: Array,
    default: () => [],
  },
  modelData: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const activeTab = ref("provider");

const providerColumns = [
  {
    title: "提供商",
    dataIndex: "provider",
    key: "provider",
    fixed: "left",
    width: 120,
  },
  {
    title: "调用次数",
    dataIndex: "calls",
    key: "calls",
    sorter: (a, b) => a.calls - b.calls,
    width: 100,
  },
  {
    title: "Tokens",
    dataIndex: "tokens",
    key: "tokens",
    sorter: (a, b) => a.tokens - b.tokens,
    width: 100,
  },
  {
    title: "成本 (USD)",
    dataIndex: "cost_usd",
    key: "cost_usd",
    sorter: (a, b) => a.cost_usd - b.cost_usd,
    width: 120,
  },
];

const modelColumns = [
  {
    title: "提供商",
    dataIndex: "provider",
    key: "provider",
    width: 100,
    fixed: "left",
  },
  {
    title: "模型",
    dataIndex: "model",
    key: "model",
    width: 180,
  },
  {
    title: "调用次数",
    dataIndex: "calls",
    key: "calls",
    width: 100,
    sorter: (a, b) => a.calls - b.calls,
  },
  {
    title: "Tokens",
    dataIndex: "tokens",
    key: "tokens",
    width: 100,
    sorter: (a, b) => a.tokens - b.tokens,
  },
  {
    title: "成本 (USD)",
    dataIndex: "cost_usd",
    key: "cost_usd",
    width: 120,
    sorter: (a, b) => a.cost_usd - b.cost_usd,
  },
];

const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + "M";
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + "K";
  }
  return num.toString();
};

const truncateModel = (model) => {
  if (model.length > 25) {
    return model.substring(0, 22) + "...";
  }
  return model;
};
</script>

<style lang="less" scoped>
.details-card {
  margin-bottom: 16px;

  .table-wrapper {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .provider-name,
  .model-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  :deep(.ant-table) {
    // Sticky first column on mobile
    @media (max-width: 767px) {
      .ant-table-cell-fix-left {
        background: #fff;
        z-index: 1;
      }
    }
  }
}

// Mobile responsiveness
@media (max-width: 767px) {
  .details-card {
    :deep(.ant-table) {
      font-size: 12px;
    }

    :deep(.ant-pagination) {
      flex-wrap: wrap;
      justify-content: center;
    }
  }
}
</style>
