<template>
  <div class="category-selector">
    <!-- 一级分类 -->
    <div class="primary-categories">
      <a-button
        v-for="category in primaryCategories"
        :key="category.id"
        :type="selectedPrimaryId === category.id ? 'primary' : 'default'"
        class="category-btn"
        @click="selectPrimary(category)"
      >
        <span class="category-icon">{{ category.icon }}</span>
        <span class="category-name">{{ category.name }}</span>
      </a-button>
    </div>

    <!-- 二级分类 -->
    <div v-if="secondaryCategories.length > 0" class="secondary-categories">
      <a-button
        v-for="category in secondaryCategories"
        :key="category.id"
        :type="selectedSecondaryId === category.id ? 'primary' : 'default'"
        class="category-btn secondary"
        size="small"
        @click="selectSecondary(category)"
      >
        <span v-if="category.icon" class="category-icon">{{ category.icon }}</span>
        <span class="category-name">{{ category.name }}</span>
      </a-button>
    </div>

    <!-- 管理按钮 -->
    <div v-if="showManage" class="manage-section">
      <a-button type="link" @click="openManageDialog">
        <template #icon>
          <SettingOutlined />
        </template>
        管理分类
      </a-button>
    </div>

    <!-- 分类管理对话框 -->
    <CategoryManageDialog
      v-model:open="manageDialogVisible"
      @refresh="handleRefresh"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useCategoryStore } from '@/stores/category';
import { SettingOutlined } from '@ant-design/icons-vue';
import CategoryManageDialog from './CategoryManageDialog.vue';

const props = defineProps({
  modelValue: {
    type: [String, Object], // 可以是 categoryId 或 category对象
    default: null,
  },
  showManage: {
    type: Boolean,
    default: false,
  },
  // 是否显示"全部模板"选项
  showAll: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['update:modelValue', 'change']);

const categoryStore = useCategoryStore();
const selectedPrimaryId = ref(null);
const selectedSecondaryId = ref(null);
const manageDialogVisible = ref(false);

// 一级分类
const primaryCategories = computed(() => {
  return categoryStore.rootCategories || [];
});

// 二级分类（根据选中的一级分类）
const secondaryCategories = computed(() => {
  if (!selectedPrimaryId.value) {
    return [];
  }

  const primary = primaryCategories.value.find(
    (cat) => cat.id === selectedPrimaryId.value
  );
  return primary?.children || [];
});

// 选择一级分类
const selectPrimary = (category) => {
  if (selectedPrimaryId.value === category.id) {
    // 取消选择
    selectedPrimaryId.value = null;
    selectedSecondaryId.value = null;
    emit('update:modelValue', null);
    emit('change', null);
  } else {
    selectedPrimaryId.value = category.id;
    selectedSecondaryId.value = null; // 清空二级分类选择
    emit('update:modelValue', category.id);
    emit('change', category);
  }
};

// 选择二级分类
const selectSecondary = (category) => {
  if (selectedSecondaryId.value === category.id) {
    // 取消选择二级，回到一级
    selectedSecondaryId.value = null;
    const primaryCategory = primaryCategories.value.find(
      (cat) => cat.id === selectedPrimaryId.value
    );
    emit('update:modelValue', selectedPrimaryId.value);
    emit('change', primaryCategory);
  } else {
    selectedSecondaryId.value = category.id;
    emit('update:modelValue', category.id);
    emit('change', category);
  }
};

// 打开管理对话框
const openManageDialog = () => {
  manageDialogVisible.value = true;
};

// 刷新分类列表
const handleRefresh = async () => {
  await categoryStore.fetchCategories();
};

// 初始化
onMounted(async () => {
  // 初始化默认分类（如果需要）
  if (!categoryStore.initialized) {
    await categoryStore.initializeDefaults();
  }

  // 加载分类列表
  await categoryStore.fetchCategories();

  // 设置初始选中状态
  if (props.modelValue) {
    const categoryId =
      typeof props.modelValue === 'object'
        ? props.modelValue.id
        : props.modelValue;

    const category = categoryStore.getCategoryById(categoryId);
    if (category) {
      if (category.parent_id) {
        // 是二级分类
        selectedPrimaryId.value = category.parent_id;
        selectedSecondaryId.value = category.id;
      } else {
        // 是一级分类
        selectedPrimaryId.value = category.id;
      }
    }
  }
});

// 监听外部 modelValue 变化
watch(
  () => props.modelValue,
  (newValue) => {
    if (!newValue) {
      selectedPrimaryId.value = null;
      selectedSecondaryId.value = null;
      return;
    }

    const categoryId =
      typeof newValue === 'object' ? newValue.id : newValue;

    const category = categoryStore.getCategoryById(categoryId);
    if (category) {
      if (category.parent_id) {
        selectedPrimaryId.value = category.parent_id;
        selectedSecondaryId.value = category.id;
      } else {
        selectedPrimaryId.value = category.id;
        selectedSecondaryId.value = null;
      }
    }
  }
);
</script>

<style scoped lang="scss">
.category-selector {
  padding: 16px;

  .primary-categories {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 16px;

    .category-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 16px;
      border-radius: 18px;
      transition: all 0.3s;

      .category-icon {
        font-size: 16px;
      }

      .category-name {
        font-size: 14px;
      }

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      }
    }
  }

  .secondary-categories {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 16px;
    background: #f5f5f5;
    border-radius: 8px;
    margin-bottom: 16px;

    .category-btn.secondary {
      height: 28px;
      padding: 0 12px;
      border-radius: 14px;
      font-size: 12px;

      .category-icon {
        font-size: 14px;
      }
    }
  }

  .manage-section {
    text-align: center;
    padding-top: 8px;
    border-top: 1px solid #e8e8e8;
  }
}
</style>
