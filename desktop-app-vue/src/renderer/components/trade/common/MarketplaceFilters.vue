<template>
  <div class="marketplace-filters">
    <!-- 基础筛选器 -->
    <a-space style="margin-bottom: 16px" wrap>
      <span>订单类型:</span>
      <a-radio-group
        :value="modelValue.orderType"
        button-style="solid"
        @change="
          (e) =>
            emit('update:modelValue', {
              ...modelValue,
              orderType: e.target.value,
            })
        "
      >
        <a-radio-button value=""> 全部 </a-radio-button>
        <a-radio-button value="buy"> 求购 </a-radio-button>
        <a-radio-button value="sell"> 出售 </a-radio-button>
        <a-radio-button value="service"> 服务 </a-radio-button>
        <a-radio-button value="barter"> 以物换物 </a-radio-button>
      </a-radio-group>

      <a-auto-complete
        :value="modelValue.keyword"
        :options="searchSuggestions"
        placeholder="搜索订单..."
        style="width: 200px"
        @search="handleSearchInput"
        @select="handleSuggestionSelect"
        @change="
          (value) =>
            emit('update:modelValue', { ...modelValue, keyword: value })
        "
      >
        <template #option="{ value: optionValue }">
          <div>{{ optionValue }}</div>
        </template>
        <a-input-search placeholder="搜索订单..." @search="emit('search')" />
      </a-auto-complete>

      <a-button @click="showAdvanced = !showAdvanced">
        <template #icon>
          <filter-outlined />
        </template>
        高级筛选
      </a-button>
    </a-space>

    <!-- 高级筛选面板 -->
    <a-card v-if="showAdvanced" size="small" style="margin-bottom: 16px">
      <a-row :gutter="16">
        <a-col :span="6">
          <a-form-item label="价格范围">
            <a-input-group compact>
              <a-input-number
                :value="advancedFilters.priceMin"
                placeholder="最低"
                style="width: 50%"
                :min="0"
                @change="(val) => updateAdvancedFilter('priceMin', val)"
              />
              <a-input-number
                :value="advancedFilters.priceMax"
                placeholder="最高"
                style="width: 50%"
                :min="0"
                @change="(val) => updateAdvancedFilter('priceMax', val)"
              />
            </a-input-group>
          </a-form-item>
        </a-col>
        <a-col :span="8">
          <a-form-item label="创建时间">
            <a-range-picker
              :value="advancedFilters.dateRange"
              style="width: 100%"
              @change="(val) => updateAdvancedFilter('dateRange', val)"
            />
          </a-form-item>
        </a-col>
        <a-col :span="6">
          <a-form-item label="排序">
            <a-select
              :value="advancedFilters.sortBy"
              style="width: 100%"
              @change="(val) => updateAdvancedFilter('sortBy', val)"
            >
              <a-select-option value="created_at"> 创建时间 </a-select-option>
              <a-select-option value="price_amount"> 价格 </a-select-option>
              <a-select-option value="quantity"> 数量 </a-select-option>
            </a-select>
          </a-form-item>
        </a-col>
        <a-col :span="4">
          <a-form-item label="排序方向">
            <a-radio-group
              :value="advancedFilters.sortOrder"
              @change="(e) => updateAdvancedFilter('sortOrder', e.target.value)"
            >
              <a-radio-button value="desc"> 降序 </a-radio-button>
              <a-radio-button value="asc"> 升序 </a-radio-button>
            </a-radio-group>
          </a-form-item>
        </a-col>
      </a-row>
      <a-space>
        <a-button type="primary" @click="emit('apply')"> 应用筛选 </a-button>
        <a-button @click="emit('reset')"> 重置 </a-button>
      </a-space>
    </a-card>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { FilterOutlined } from "@ant-design/icons-vue";

const props = defineProps({
  modelValue: {
    type: Object,
    required: true,
    default: () => ({ orderType: "", keyword: "" }),
  },
  advancedFilters: {
    type: Object,
    required: true,
    default: () => ({
      priceMin: null,
      priceMax: null,
      dateRange: null,
      sortBy: "created_at",
      sortOrder: "desc",
    }),
  },
  searchHistory: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits([
  "update:modelValue",
  "update:advancedFilters",
  "search",
  "apply",
  "reset",
]);

const showAdvanced = ref(false);

// 搜索建议（基于历史记录）
const searchSuggestions = computed(() => {
  if (!props.modelValue.keyword) {
    return props.searchHistory.map((item) => ({ value: item }));
  }
  const keyword = props.modelValue.keyword.toLowerCase();
  return props.searchHistory
    .filter((item) => item.toLowerCase().includes(keyword))
    .map((item) => ({ value: item }));
});

// 处理搜索输入
const handleSearchInput = (value) => {
  emit("update:modelValue", { ...props.modelValue, keyword: value });
};

// 处理建议选择
const handleSuggestionSelect = (value) => {
  emit("update:modelValue", { ...props.modelValue, keyword: value });
  emit("search");
};

// 更新高级筛选
const updateAdvancedFilter = (key, value) => {
  emit("update:advancedFilters", { ...props.advancedFilters, [key]: value });
};
</script>

<style scoped>
.marketplace-filters {
  margin-bottom: 16px;
}
</style>
