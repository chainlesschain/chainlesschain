<template>
  <div class="suggested-prompts-panel">
    <!-- Info Banner -->
    <div class="info-banner">
      <InfoCircleOutlined />
      <span>功能开发中: 将建议填充到输入框</span>
    </div>

    <!-- Greeting Message -->
    <div class="greeting-section">
      <h1 class="greeting-title">{{ greetingMessage }}</h1>

      <!-- Suggested Prompts Pills -->
      <div v-if="filteredSuggestions.length > 0" class="suggestions-container">
        <a-button
          v-for="suggestion in filteredSuggestions.slice(0, 3)"
          :key="suggestion.id"
          class="suggestion-pill"
          @click="fillSuggestion(suggestion)"
        >
          <BulbOutlined />
          {{ suggestion.display_name || suggestion.name }}
          <RightOutlined />
        </a-button>
      </div>

      <!-- AI Template Badge -->
      <div class="ai-template-badge">
        <a-tag color="blue">AI</a-tag>
        <span>使用AI模板创建项目</span>
      </div>
    </div>

    <!-- Input Area -->
    <div class="input-section">
      <a-textarea
        v-model:value="inputText"
        :placeholder="placeholder"
        :auto-size="{ minRows: 6, maxRows: 12 }"
        class="main-input"
        @keydown.ctrl.enter="handleSend"
      />

      <div class="input-footer">
        <div class="input-actions">
          <a-button type="text" class="action-btn">
            <UserOutlined />
          </a-button>
          <a-button type="text" class="action-btn">
            <PaperClipOutlined />
          </a-button>
          <a-button type="text" class="action-btn">
            <AudioOutlined />
          </a-button>
        </div>

        <div class="send-section">
          <span class="char-count">{{ inputText.length }} / 5000</span>
          <a-button type="primary" @click="handleSend" :disabled="!inputText.trim()">
            发送
          </a-button>
        </div>
      </div>
    </div>

    <!-- Category Filters -->
    <div class="category-filters">
      <div class="main-categories">
        <a-button
          v-for="category in mainCategories"
          :key="category.value"
          :type="selectedCategory === category.value ? 'primary' : 'default'"
          @click="selectCategory(category.value)"
          class="category-btn"
        >
          {{ category.label }}
        </a-button>
      </div>

      <div class="sub-categories">
        <a-button
          v-for="subcat in subCategories"
          :key="subcat.value"
          :type="selectedSubCategory === subcat.value ? 'primary' : 'default'"
          @click="selectSubCategory(subcat.value)"
          class="subcategory-btn"
        >
          {{ subcat.label }}
        </a-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import {
  InfoCircleOutlined,
  BulbOutlined,
  RightOutlined,
  UserOutlined,
  PaperClipOutlined,
  AudioOutlined,
} from '@ant-design/icons-vue';

// Props
const props = defineProps({
  placeholder: {
    type: String,
    default: '给我发消息或描述你的任务...',
  },
});

// Emits
const emit = defineEmits(['send', 'fillInput']);

// State
const inputText = ref('');
const selectedCategory = ref('writing');
const selectedSubCategory = ref('all');
const templates = ref([]);
const loading = ref(false);

// Greeting message based on time of day
const greetingMessage = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了！今天还有什么要完成的？';
  if (hour < 12) return '早上好！今天还有什么要完成的？';
  if (hour < 18) return '下午好！今天还有什么要完成的？';
  return '晚上好！今天还有什么要完成的？';
});

// Main Categories
const mainCategories = [
  { label: '写作', value: 'writing' },
  { label: '营销', value: 'marketing' },
  { label: 'Excel', value: 'excel' },
  { label: '简历', value: 'resume' },
  { label: 'PPT', value: 'ppt' },
  { label: '研究', value: 'research' },
  { label: '教育', value: 'education' },
  { label: '生活', value: 'lifestyle' },
  { label: '播客', value: 'podcast' },
  { label: '设计', value: 'design' },
  { label: '网页', value: 'web' },
];

// Sub Categories
const subCategories = computed(() => {
  const baseSubcats = [
    { label: '全部', value: 'all' },
  ];

  // Add category-specific subcategories
  if (selectedCategory.value === 'writing') {
    return [
      ...baseSubcats,
      { label: '办公写作', value: 'office' },
      { label: '商业计划', value: 'business' },
      { label: '技术文档', value: 'technical' },
    ];
  }

  return baseSubcats;
});

// Filtered suggestions based on category and subcategory
const filteredSuggestions = computed(() => {
  if (!templates.value || templates.value.length === 0) {
    return [];
  }

  return templates.value.filter(template => {
    // Filter by main category
    if (template.category !== selectedCategory.value) {
      return false;
    }

    // Filter by subcategory
    if (selectedSubCategory.value !== 'all' &&
        template.subcategory !== selectedSubCategory.value) {
      return false;
    }

    return true;
  });
});

// Load templates from backend
const loadTemplates = async () => {
  try {
    loading.value = true;
    const allTemplates = await window.electronAPI.promptTemplate.getAll();
    templates.value = allTemplates || [];
  } catch (error) {
    console.error('Failed to load templates:', error);
    templates.value = [];
  } finally {
    loading.value = false;
  }
};

// Fill suggestion into input
const fillSuggestion = (suggestion) => {
  // Use the description or prompt template as the suggestion text
  const suggestionText = suggestion.description ||
                         suggestion.display_name ||
                         suggestion.name;

  inputText.value = suggestionText;
  emit('fillInput', suggestionText);
};

// Handle category selection
const selectCategory = (category) => {
  selectedCategory.value = category;
  selectedSubCategory.value = 'all'; // Reset subcategory
};

// Handle subcategory selection
const selectSubCategory = (subcat) => {
  selectedSubCategory.value = subcat;
};

// Handle send
const handleSend = () => {
  if (inputText.value.trim()) {
    emit('send', inputText.value);
    inputText.value = '';
  }
};

// Lifecycle
onMounted(() => {
  loadTemplates();
});

// Expose methods
defineExpose({
  fillInput: (text) => {
    inputText.value = text;
  },
  clearInput: () => {
    inputText.value = '';
  },
});
</script>

<style lang="scss" scoped>
.suggested-prompts-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px;
  background: #f5f5f5;
}

.info-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #e6f7ff;
  border: 1px solid #91d5ff;
  border-radius: 8px;
  color: #1890ff;
  margin-bottom: 20px;
  font-size: 14px;

  .anticon {
    font-size: 16px;
  }
}

.greeting-section {
  text-align: center;
  margin-bottom: 30px;
}

.greeting-title {
  font-size: 32px;
  font-weight: 500;
  color: #262626;
  margin-bottom: 24px;
}

.suggestions-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}

.suggestion-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  height: auto;
  border-radius: 24px;
  background: white;
  border: 1px solid #d9d9d9;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: all 0.3s;
  font-size: 14px;

  &:hover {
    border-color: #1890ff;
    color: #1890ff;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(24, 144, 255, 0.2);
  }

  .anticon-bulb {
    color: #faad14;
  }

  .anticon-right {
    font-size: 12px;
  }
}

.ai-template-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: white;
  border-radius: 20px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  font-size: 14px;
  color: #595959;
}

.input-section {
  background: white;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.main-input {
  border: none;
  resize: none;
  font-size: 15px;

  &:focus {
    box-shadow: none;
  }
}

.input-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.input-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  color: #8c8c8c;

  &:hover {
    color: #1890ff;
  }
}

.send-section {
  display: flex;
  align-items: center;
  gap: 12px;
}

.char-count {
  color: #8c8c8c;
  font-size: 13px;
}

.category-filters {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.main-categories,
.sub-categories {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
}

.category-btn,
.subcategory-btn {
  border-radius: 20px;
  padding: 6px 20px;
  height: auto;
  font-size: 14px;
  transition: all 0.3s;

  &:hover {
    transform: translateY(-2px);
  }
}

.category-btn {
  min-width: 80px;
}

.subcategory-btn {
  min-width: 100px;
}
</style>
