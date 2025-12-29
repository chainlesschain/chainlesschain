<template>
  <div class="skill-recommender">
    <!-- 智能搜索框 -->
    <a-card title="智能技能推荐" :bordered="false">
      <a-space direction="vertical" style="width: 100%" :size="16">
        <!-- 搜索输入 -->
        <a-input-search
          v-model:value="searchInput"
          placeholder="描述您想做什么,我会为您推荐合适的技能... (例如: 我想生成一个网页)"
          size="large"
          :loading="searching"
          @search="handleSearch"
        >
          <template #prefix>
            <RobotOutlined style="color: rgba(0,0,0,.45)" />
          </template>
        </a-input-search>

        <!-- 推荐选项 -->
        <a-space>
          <a-tag>推荐数量:</a-tag>
          <a-radio-group v-model:value="recommendLimit" button-style="solid" size="small">
            <a-radio-button :value="3">3个</a-radio-button>
            <a-radio-button :value="5">5个</a-radio-button>
            <a-radio-button :value="10">10个</a-radio-button>
          </a-radio-group>

          <a-divider type="vertical" />

          <a-checkbox v-model:checked="includeUsageStats">
            考虑使用历史
          </a-checkbox>
        </a-space>
      </a-space>
    </a-card>

    <!-- 推荐结果 -->
    <a-card
      v-if="recommendations.length > 0"
      title="推荐结果"
      style="margin-top: 16px"
      :bordered="false"
    >
      <a-list :data-source="recommendations" :grid="{ gutter: 16, column: 2 }">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-card
              hoverable
              @click="selectSkill(item)"
              :class="{ 'high-score': item.recommendationScore >= 0.8 }"
            >
              <!-- 推荐分数徽章 -->
              <template #extra>
                <a-badge
                  :count="`${(item.recommendationScore * 100).toFixed(0)}%`"
                  :color="getScoreColor(item.recommendationScore)"
                />
              </template>

              <a-card-meta
                :title="item.name"
                :description="item.description"
              >
                <template #avatar>
                  <a-avatar :style="{ backgroundColor: getCategoryColor(item.category) }">
                    {{ item.name.charAt(0) }}
                  </a-avatar>
                </template>
              </a-card-meta>

              <div style="margin-top: 12px">
                <!-- 推荐理由 -->
                <a-space direction="vertical" style="width: 100%">
                  <div style="font-size: 12px; color: rgba(0,0,0,0.45)">
                    <BulbOutlined /> {{ item.reason }}
                  </div>

                  <!-- 统计信息 -->
                  <a-space size="small">
                    <a-tag color="blue" v-if="item.usage_count > 0">
                      使用 {{ item.usage_count }} 次
                    </a-tag>
                    <a-tag color="green" v-if="item.success_count > 0">
                      成功率 {{ ((item.success_count / item.usage_count) * 100).toFixed(0) }}%
                    </a-tag>
                    <a-tag>{{ getCategoryLabel(item.category) }}</a-tag>
                  </a-space>
                </a-space>
              </div>
            </a-card>
          </a-list-item>
        </template>
      </a-list>
    </a-card>

    <!-- 热门技能 -->
    <a-card title="热门技能" style="margin-top: 16px" :bordered="false">
      <template #extra>
        <a-button type="link" @click="loadPopularSkills">刷新</a-button>
      </template>

      <a-list :data-source="popularSkills" size="small">
        <template #renderItem="{ item, index }">
          <a-list-item @click="selectSkill(item)" style="cursor: pointer">
            <a-list-item-meta>
              <template #avatar>
                <a-badge
                  :count="index + 1"
                  :number-style="{ backgroundColor: index < 3 ? '#f5222d' : '#52c41a' }"
                />
              </template>
              <template #title>
                <a>{{ item.name }}</a>
              </template>
              <template #description>
                热度: {{ item.popularity?.toFixed(1) || 0 }} |
                使用 {{ item.usage_count }} 次
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>
      </a-list>
    </a-card>

    <!-- 技能详情抽屉 -->
    <a-drawer
      v-model:open="detailDrawerVisible"
      title="技能详情"
      placement="right"
      :width="600"
    >
      <SkillDetails v-if="selectedSkill" :skill-id="selectedSkill.id" />

      <!-- 相关技能推荐 -->
      <a-divider />
      <h4>相关技能</h4>
      <a-list :data-source="relatedSkills" size="small">
        <template #renderItem="{ item }">
          <a-list-item @click="selectSkill(item)" style="cursor: pointer">
            <a-list-item-meta
              :title="item.name"
              :description="`相关度: ${(item.relationScore * 100).toFixed(0)}%`"
            />
          </a-list-item>
        </template>
      </a-list>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { RobotOutlined, BulbOutlined } from '@ant-design/icons-vue';
import SkillDetails from './SkillDetails.vue';

// 响应式数据
const searchInput = ref('');
const searching = ref(false);
const recommendations = ref([]);
const popularSkills = ref([]);
const relatedSkills = ref([]);
const selectedSkill = ref(null);
const detailDrawerVisible = ref(false);

// 配置
const recommendLimit = ref(5);
const includeUsageStats = ref(true);

// 分类映射
const categoryLabels = {
  'code': '代码开发',
  'web': 'Web开发',
  'data': '数据分析',
  'content': '内容创作',
  'document': '文档处理',
  'media': '多媒体',
  'file': '文件操作',
  'system': '系统操作',
  'automation': '自动化',
  'ai': 'AI助手'
};

const categoryColors = {
  'code': '#1890ff',
  'web': '#52c41a',
  'data': '#faad14',
  'content': '#722ed1',
  'document': '#13c2c2',
  'media': '#eb2f96',
  'file': '#fa8c16',
  'system': '#2f54eb',
  'automation': '#a0d911',
  'ai': '#f5222d'
};

// 方法
const handleSearch = async () => {
  if (!searchInput.value.trim()) {
    message.warning('请输入您的需求');
    return;
  }

  searching.value = true;
  try {
    const result = await window.electron.invoke('skill:recommend', searchInput.value, {
      limit: recommendLimit.value,
      includeUsageStats: includeUsageStats.value
    });

    if (result.success) {
      recommendations.value = result.data;
      if (recommendations.value.length === 0) {
        message.info('未找到匹配的技能,请尝试不同的描述');
      }
    } else {
      message.error(`推荐失败: ${result.error}`);
    }
  } catch (error) {
    message.error(`推荐失败: ${error.message}`);
  } finally {
    searching.value = false;
  }
};

const loadPopularSkills = async () => {
  try {
    const result = await window.electron.invoke('skill:get-popular', 10);
    if (result.success) {
      popularSkills.value = result.data;
    }
  } catch (error) {
    console.error('加载热门技能失败:', error);
  }
};

const loadRelatedSkills = async (skillId) => {
  try {
    const result = await window.electron.invoke('skill:get-related', skillId, 5);
    if (result.success) {
      relatedSkills.value = result.data;
    }
  } catch (error) {
    console.error('加载相关技能失败:', error);
  }
};

const selectSkill = (skill) => {
  selectedSkill.value = skill;
  detailDrawerVisible.value = true;
  loadRelatedSkills(skill.id);
};

const getCategoryLabel = (category) => {
  return categoryLabels[category] || category;
};

const getCategoryColor = (category) => {
  return categoryColors[category] || '#666';
};

const getScoreColor = (score) => {
  if (score >= 0.8) return '#52c41a';
  if (score >= 0.6) return '#1890ff';
  if (score >= 0.4) return '#faad14';
  return '#d9d9d9';
};

// 生命周期
onMounted(() => {
  loadPopularSkills();
});
</script>

<style scoped>
.skill-recommender {
  padding: 16px;
}

.high-score {
  border: 2px solid #52c41a;
}

:deep(.ant-card-hoverable:hover) {
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  transform: translateY(-2px);
  transition: all 0.3s ease;
}
</style>
