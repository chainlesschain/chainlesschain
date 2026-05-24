<template>
  <div class="pdh-browser-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">数据浏览器</h2>
        <p class="page-sub">
          Vault 里所有已采集的数据，按类目浏览 / 全文检索 / 时间窗口筛选。
          完全离线，不外传。
        </p>
      </div>
      <a-space>
        <a-tag v-if="store.mode === 'fts5'" color="green">FTS5 trigram</a-tag>
        <a-tag v-else-if="store.mode === 'like'" color="orange">LIKE 兜底</a-tag>
        <a-button @click="store.search()" :loading="store.isLoading">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="16" class="browser-layout">
      <a-col :xs="24" :sm="24" :md="6" :lg="5" :xl="4">
        <CategorySidebar
          :selected="store.filters.category"
          :facets="store.facets"
          @select="onCategorySelect"
        />
      </a-col>

      <a-col :xs="24" :sm="24" :md="18" :lg="19" :xl="20">
        <div class="main-pane">
          <SearchFilterBar
            :filters="store.filters"
            :facets="store.facets"
            :is-loading="store.isLoading"
            :mode="store.mode"
            :short-query="store.shortQuery"
            @set-filter="onSetFilter"
            @reset="store.reset(); store.search()"
          />

          <div class="results-summary">
            <span v-if="store.isLoading && store.results.length === 0">
              <a-spin size="small" /> 载入中…
            </span>
            <template v-else>
              <strong>{{ store.facets.total }}</strong> 条事件
              <span v-if="store.filters.category">
                / 当前类目 <strong>{{ categoryLabel(store.filters.category) }}</strong>
                <strong> {{ store.facets.byCategory[store.filters.category] || 0 }}</strong>
              </span>
              <span v-if="store.filters.q"> / 关键词 "<em>{{ store.filters.q }}</em>"</span>
              <span class="loaded-of">
                / 已显示 {{ store.results.length }}
              </span>
            </template>
          </div>

          <a-alert
            v-if="store.error"
            type="error"
            show-icon
            :message="store.error"
            closable
            style="margin: 12px 0;"
          />

          <a-empty
            v-if="!store.isLoading && store.results.length === 0 && !store.error"
            :description="emptyHint"
            style="margin-top: 40px;"
          />

          <div class="results-list">
            <RendererDispatcher
              v-for="(ev, idx) in store.results"
              :key="`r-${idx}-${ev.id}`"
              :event="ev"
            />
          </div>

          <div v-if="store.canLoadMore" class="load-more">
            <a-button
              :loading="store.isAppending"
              @click="store.loadMore()"
              block
            >
              加载下一页 (50 条)
            </a-button>
          </div>
        </div>
      </a-col>
    </a-row>
  </div>
</template>

<script setup>
import { onMounted, computed } from "vue";
import { ReloadOutlined } from "@ant-design/icons-vue";
import { usePdhBrowserStore } from "../stores/pdhBrowser.js";
import { categoryLabel } from "../utils/pdhCategories.js";
import CategorySidebar from "../components/pdh/CategorySidebar.vue";
import SearchFilterBar from "../components/pdh/SearchFilterBar.vue";
import RendererDispatcher from "../components/pdh/renderers/RendererDispatcher.vue";

const store = usePdhBrowserStore();

const emptyHint = computed(() => {
  if (store.filters.q) {
    return `没有匹配 "${store.filters.q}" 的事件 — 试试更短的关键词或换个类目`;
  }
  if (store.filters.category) {
    return `「${categoryLabel(store.filters.category)}」类目下还没有数据 — 去采集页同步对应 adapter`;
  }
  return "Vault 里还没有数据 — 去「个人数据中台」页面同步任意 adapter";
});

function onCategorySelect(cat) {
  // setFilter triggers debounced search; for explicit clicks we want immediate
  store.filters.category = cat;
  store.search();
}

function onSetFilter(key, value) {
  store.setFilter(key, value);
}

onMounted(() => {
  if (!store.hasResults && !store.isLoading) {
    store.search();
  }
});
</script>

<style scoped>
.pdh-browser-page {
  padding: 16px;
  height: 100%;
  background: #f5f5f5;
  overflow-y: auto;
}
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}
.page-title {
  margin: 0 0 4px;
  font-size: 18px;
}
.page-sub {
  margin: 0;
  color: #999;
  font-size: 13px;
}
.browser-layout {
  align-items: flex-start;
}
.main-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.results-summary {
  font-size: 13px;
  color: #666;
  padding: 4px 4px 8px;
}
.results-summary .loaded-of {
  margin-left: 8px;
  color: #999;
}
.results-list {
  /* GenericCardRenderer owns its own margin */
}
.load-more {
  margin-top: 12px;
}
</style>
