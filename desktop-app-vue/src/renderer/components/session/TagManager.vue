<template>
  <div class="tag-manager">
    <!-- 搜索/创建输入框 -->
    <div class="input-section">
      <a-input-search
        v-model:value="searchText"
        placeholder="搜索或创建标签..."
        allow-clear
        @search="handleCreateTag"
        enter-button="创建"
      />
    </div>

    <!-- 已选标签 -->
    <div class="selected-section" v-if="selectedTags.length > 0">
      <div class="section-label">已选择:</div>
      <div class="tags-wrap">
        <a-tag
          v-for="tag in selectedTags"
          :key="tag"
          closable
          color="blue"
          @close="removeTag(tag)"
        >
          {{ tag }}
        </a-tag>
      </div>
    </div>

    <!-- 可选标签 -->
    <div class="available-section">
      <div class="section-label">可选标签:</div>
      <div class="tags-wrap">
        <a-tag
          v-for="tag in filteredTags"
          :key="tag.tag"
          :color="isSelected(tag.tag) ? 'blue' : 'default'"
          class="selectable-tag"
          @click="toggleTag(tag.tag)"
        >
          <template #icon>
            <CheckOutlined v-if="isSelected(tag.tag)" />
          </template>
          {{ tag.tag }}
          <span class="tag-count">({{ tag.count }})</span>
        </a-tag>
        <a-empty
          v-if="filteredTags.length === 0 && searchText"
          description="未找到匹配的标签"
          :image="null"
        >
          <template #default>
            <a-button
              type="primary"
              size="small"
              @click="handleCreateTag(searchText)"
            >
              创建 "{{ searchText }}"
            </a-button>
          </template>
        </a-empty>
        <a-empty
          v-if="allTags.length === 0 && !searchText"
          description="暂无可用标签"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from "vue";
import { CheckOutlined } from "@ant-design/icons-vue";

const props = defineProps({
  selectedTags: {
    type: Array,
    default: () => [],
  },
  allTags: {
    type: Array,
    default: () => [],
  },
  mode: {
    type: String,
    default: "select", // 'select' | 'manage'
  },
  excludeTags: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["update:selectedTags", "create-tag"]);

// 状态
const searchText = ref("");

// 过滤后的标签
const filteredTags = computed(() => {
  let tags = props.allTags.filter((t) => !props.excludeTags.includes(t.tag));

  if (searchText.value) {
    const query = searchText.value.toLowerCase();
    tags = tags.filter((t) => t.tag.toLowerCase().includes(query));
  }

  return tags;
});

// 检查标签是否已选中
const isSelected = (tag) => {
  return props.selectedTags.includes(tag);
};

// 切换标签选择
const toggleTag = (tag) => {
  if (isSelected(tag)) {
    removeTag(tag);
  } else {
    addTag(tag);
  }
};

// 添加标签
const addTag = (tag) => {
  if (!isSelected(tag)) {
    emit("update:selectedTags", [...props.selectedTags, tag]);
  }
};

// 移除标签
const removeTag = (tag) => {
  emit(
    "update:selectedTags",
    props.selectedTags.filter((t) => t !== tag),
  );
};

// 创建新标签
const handleCreateTag = (text) => {
  const tag = (text || searchText.value).trim();
  if (!tag) return;

  // 检查是否已存在
  const exists = props.allTags.some(
    (t) => t.tag.toLowerCase() === tag.toLowerCase(),
  );

  if (!exists) {
    emit("create-tag", tag);
  }

  // 添加到选中列表
  addTag(tag);
  searchText.value = "";
};
</script>

<style lang="less" scoped>
.tag-manager {
  .input-section {
    margin-bottom: 16px;
  }

  .section-label {
    font-size: 12px;
    color: #8c8c8c;
    margin-bottom: 8px;
  }

  .selected-section {
    margin-bottom: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid #f0f0f0;
  }

  .available-section {
    max-height: 200px;
    overflow-y: auto;
  }

  .tags-wrap {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .selectable-tag {
    cursor: pointer;
    transition: all 0.2s;

    &:hover {
      transform: scale(1.05);
    }

    .tag-count {
      font-size: 10px;
      color: #8c8c8c;
      margin-left: 2px;
    }
  }
}
</style>
