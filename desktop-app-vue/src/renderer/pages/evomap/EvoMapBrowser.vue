<template>
  <div class="evomap-browser-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h2>EvoMap Browser</h2>
        <span class="subtitle">Discover community-validated AI strategies</span>
      </div>
      <div class="header-right">
        <a-radio-group v-model:value="viewMode" size="small">
          <a-radio-button value="search"> Search </a-radio-button>
          <a-radio-button value="trending"> Trending </a-radio-button>
          <a-radio-button value="ranked"> Top Ranked </a-radio-button>
        </a-radio-group>
      </div>
    </div>

    <!-- 搜索栏 -->
    <div v-if="viewMode === 'search'" class="search-bar">
      <a-input-search
        v-model:value="searchKeyword"
        placeholder="Search by keywords (e.g. javascript, error-fix, testing)"
        enter-button="Search"
        :loading="store.loading"
        style="max-width: 600px"
        @search="handleSearch"
      />
      <a-select
        v-model:value="searchType"
        placeholder="Type"
        style="width: 150px; margin-left: 8px"
        allow-clear
      >
        <a-select-option value="Gene"> Gene </a-select-option>
        <a-select-option value="Capsule"> Capsule </a-select-option>
      </a-select>
    </div>

    <!-- 资产列表 -->
    <div class="asset-list">
      <a-spin :spinning="store.loading">
        <a-list
          :data-source="displayAssets"
          :grid="{ gutter: 16, xs: 1, sm: 1, md: 2, lg: 2, xl: 3 }"
        >
          <template #renderItem="{ item }">
            <a-list-item>
              <a-card
                :class="[
                  'asset-card',
                  `type-${(item.type || 'gene').toLowerCase()}`,
                ]"
                hoverable
              >
                <template #title>
                  <div class="card-title">
                    <a-tag
                      :color="item.type === 'Gene' ? 'blue' : 'purple'"
                      size="small"
                    >
                      {{ item.type || "Gene" }}
                    </a-tag>
                    <a-tag
                      v-if="item.category"
                      :color="categoryColor(item.category)"
                      size="small"
                    >
                      {{ item.category }}
                    </a-tag>
                  </div>
                </template>
                <template #extra>
                  <a-tooltip
                    v-if="item.gdi_score"
                    :title="`GDI Score: ${item.gdi_score}`"
                  >
                    <span class="gdi-score">{{
                      (item.gdi_score || 0).toFixed(1)
                    }}</span>
                  </a-tooltip>
                </template>

                <p class="asset-summary">
                  {{ item.summary || truncateContent(item) }}
                </p>

                <div class="card-meta">
                  <span class="asset-id" :title="item.asset_id">
                    {{ (item.asset_id || "").substring(0, 20) }}...
                  </span>
                </div>

                <template #actions>
                  <a-button
                    type="link"
                    size="small"
                    @click="handleImportAsSkill(item)"
                  >
                    Import as Skill
                  </a-button>
                  <a-button
                    type="link"
                    size="small"
                    @click="handleImportAsInstinct(item)"
                  >
                    Import as Instinct
                  </a-button>
                </template>
              </a-card>
            </a-list-item>
          </template>

          <template #empty>
            <a-empty
              :description="
                viewMode === 'search'
                  ? 'Enter keywords to search community assets'
                  : 'No assets found'
              "
            />
          </template>
        </a-list>
      </a-spin>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { message } from "ant-design-vue";
import { useEvoMapStore } from "../../stores/evomap";

const store = useEvoMapStore();
const viewMode = ref<"search" | "trending" | "ranked">("search");
const searchKeyword = ref("");
const searchType = ref("");

const displayAssets = computed(() => {
  if (viewMode.value === "trending") {
    return store.trendingAssets;
  }
  return store.searchResults;
});

function categoryColor(category) {
  const colors = {
    repair: "red",
    optimize: "blue",
    innovate: "green",
  };
  return colors[category] || "default";
}

function truncateContent(item) {
  try {
    if (item.content) {
      const parsed = JSON.parse(item.content);
      return (parsed.strategy?.description || parsed.summary || "").substring(
        0,
        150,
      );
    }
  } catch {
    // ignore
  }
  return item.summary || "";
}

async function handleSearch() {
  if (!searchKeyword.value.trim()) {
    return;
  }

  const signals = searchKeyword.value
    .trim()
    .split(/[,\s]+/)
    .filter((s) => s.length > 0);

  await store.searchAssets(signals, searchType.value || undefined);
}

async function handleImportAsSkill(item) {
  const assetId = item.asset_id;
  if (!assetId) {
    return;
  }

  // First fetch to local cache if needed
  if (item.direction !== "fetched") {
    await store.fetchRelevant([item.summary || ""], item.type);
  }

  const result = await store.importAsSkill(assetId);
  if (result.success) {
    message.success(`Imported as skill: ${result.data?.skillName || assetId}`);
  } else {
    message.error(result.error || "Import failed");
  }
}

async function handleImportAsInstinct(item) {
  const assetId = item.asset_id;
  if (!assetId) {
    return;
  }

  const result = await store.importAsInstinct(assetId);
  if (result.success) {
    message.success("Imported as instinct");
  } else {
    message.error(result.error || "Import failed");
  }
}

watch(viewMode, async (mode) => {
  if (mode === "trending") {
    await store.fetchTrending();
  } else if (mode === "ranked") {
    const result = await window.electronAPI.invoke(
      "evomap:get-ranked",
      null,
      20,
    );
    if (result.success && result.data) {
      store.searchResults = result.data.assets || result.data || [];
    }
  }
});

onMounted(() => {
  store.getStatus();
});
</script>

<style lang="less" scoped>
.evomap-browser-page {
  padding: 24px;

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;

    .header-left {
      h2 {
        margin: 0;
        font-size: 20px;
      }
      .subtitle {
        font-size: 12px;
        color: #999;
      }
    }
  }

  .search-bar {
    display: flex;
    align-items: center;
    margin-bottom: 24px;
  }

  .asset-card {
    .card-title {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .asset-summary {
      font-size: 13px;
      color: #555;
      margin: 8px 0;
      min-height: 40px;
      line-height: 1.5;
    }

    .card-meta {
      font-size: 11px;
      color: #bbb;
    }

    .gdi-score {
      font-weight: bold;
      color: #fa8c16;
      font-size: 14px;
    }

    &.type-gene {
      border-top: 2px solid #1890ff;
    }
    &.type-capsule {
      border-top: 2px solid #722ed1;
    }
  }
}

@media (max-width: 767px) {
  .evomap-browser-page {
    padding: 12px;

    .search-bar {
      flex-direction: column;
      gap: 8px;

      .ant-input-search {
        max-width: 100% !important;
      }

      .ant-select {
        width: 100% !important;
        margin-left: 0 !important;
      }
    }
  }
}
</style>
