<template>
  <div class="recommendations-page">
    <a-page-header
      title="Content Recommendations"
      sub-title="Personalized content feed powered by local AI"
    >
      <template #extra>
        <a-button
          type="primary"
          :loading="store.loading"
          @click="handleGenerate"
        >
          Generate Recommendations
        </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="24">
      <!-- Recommendation Feed -->
      <a-col :span="16">
        <a-tabs v-model:active-key="activeTab">
          <a-tab-pane
            key="feed"
            tab="Feed"
          >
            <a-spin :spinning="store.loading">
              <a-empty
                v-if="store.recommendations.length === 0"
                description="No recommendations yet. Click Generate to start."
              />
              <a-list
                v-else
                :data-source="store.recommendations"
                item-layout="vertical"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>
                        <a-space>
                          <a-tag :color="typeColor(item.content_type)">
                            {{ item.content_type }}
                          </a-tag>
                          <span>{{ item.content_id }}</span>
                        </a-space>
                      </template>
                      <template #description>
                        <span>{{ item.reason }} | Score: {{ (item.score * 100).toFixed(0) }}%</span>
                      </template>
                    </a-list-item-meta>
                    <template #actions>
                      <a-button
                        size="small"
                        type="link"
                        @click="handleFeedback(item.id, 'liked')"
                      >
                        Like
                      </a-button>
                      <a-button
                        size="small"
                        type="link"
                        @click="handleFeedback(item.id, 'saved')"
                      >
                        Save
                      </a-button>
                      <a-button
                        size="small"
                        type="link"
                        @click="handleFeedback(item.id, 'dismissed')"
                      >
                        Dismiss
                      </a-button>
                    </template>
                  </a-list-item>
                </template>
              </a-list>
            </a-spin>
          </a-tab-pane>

          <a-tab-pane
            key="profile"
            tab="Interest Profile"
          >
            <a-card
              v-if="store.profile"
              size="small"
            >
              <a-descriptions
                :column="1"
                size="small"
                title="Your Interest Profile"
              >
                <a-descriptions-item label="Last Updated">
                  {{ formatDate(store.profile.last_updated) }}
                </a-descriptions-item>
                <a-descriptions-item label="Updates">
                  {{ store.profile.update_count }}
                </a-descriptions-item>
              </a-descriptions>
              <a-divider>Topics</a-divider>
              <div
                v-for="(weight, topic) in store.profile.topics"
                :key="String(topic)"
                style="margin-bottom: 8px"
              >
                <span>{{ topic }}</span>
                <a-progress
                  :percent="Math.round(Number(weight) * 100)"
                  size="small"
                />
              </div>
            </a-card>
            <a-empty
              v-else
              description="No interest profile found"
            />
          </a-tab-pane>
        </a-tabs>
      </a-col>

      <!-- Stats Sidebar -->
      <a-col :span="8">
        <a-card
          title="Stats"
          size="small"
        >
          <a-statistic
            title="Total Recommendations"
            :value="store.recommendations.length"
          />
          <a-statistic
            title="Unviewed"
            :value="store.unviewedCount"
            style="margin-top: 16px"
          />
        </a-card>
      </a-col>
    </a-row>

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
import { ref, onMounted } from 'vue';
import { message } from 'ant-design-vue';
import { useRecommendationStore } from '../../stores/recommendation';

const store = useRecommendationStore();
const activeTab = ref('feed');
const userId = 'default-user';

function formatDate(ts: number) {
  if (!ts) {return '-';}
  return new Date(ts * 1000).toLocaleString();
}

function typeColor(type: string) {
  const map: Record<string, string> = { post: 'blue', article: 'green', note: 'orange', knowledge: 'purple' };
  return map[type] || 'default';
}

async function handleGenerate() {
  const result = await store.generate(userId);
  if (result.success) {message.success('Recommendations generated');}
  else {message.error(result.error || 'Generation failed');}
}

async function handleFeedback(id: string, feedback: string) {
  await store.provideFeedback(id, feedback);
  message.success(`Marked as ${feedback}`);
}

onMounted(async () => {
  await store.fetchRecommendations(userId);
  await store.fetchProfile(userId);
});
</script>

<style lang="less" scoped>
.recommendations-page {
  padding: 24px;
}
</style>
