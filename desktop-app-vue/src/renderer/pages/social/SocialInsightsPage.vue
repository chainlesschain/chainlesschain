<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useSocialAIStore } from '../../stores/socialAI';

const store = useSocialAIStore();

const analyzeContent = ref('');
const replyContext = ref('');
const selectedStyle = ref('friendly');

const styleOptions = [
  { label: 'Friendly', value: 'friendly' },
  { label: 'Professional', value: 'professional' },
  { label: 'Formal', value: 'formal' },
  { label: 'Concise', value: 'concise' },
  { label: 'Casual', value: 'casual' },
];

const activeTab = ref('topics');

const sentimentColor = computed(() => {
  const sentiment = store.sentimentLabel;
  if (sentiment === 'positive') {return '#52c41a';}
  if (sentiment === 'negative') {return '#ff4d4f';}
  if (sentiment === 'mixed') {return '#faad14';}
  return '#8c8c8c';
});

async function handleAnalyze() {
  if (!analyzeContent.value.trim()) {return;}
  await store.analyzeTopics(analyzeContent.value);
}

async function handleGetReplies() {
  if (!replyContext.value.trim()) {return;}
  const messages = replyContext.value.split('\n').filter(Boolean).map((line: string) => {
    const [role, ...content] = line.split(':');
    return { role: role?.trim() || 'user', content: content.join(':').trim() || line };
  });
  await store.getMultiStyleReplies(messages);
}

async function handleFetchTrending() {
  await store.fetchTrendingTopics({ limit: 15 });
}

onMounted(async () => {
  await store.fetchTrendingTopics({ limit: 10 });
});
</script>

<template>
  <div class="social-insights-page">
    <a-page-header
      title="Social Insights"
      sub-title="AI-powered social analytics"
    />

    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane
        key="topics"
        tab="Topic Analysis"
      >
        <a-row :gutter="16">
          <a-col :span="12">
            <a-card
              title="Analyze Content"
              :bordered="false"
            >
              <a-textarea
                v-model:value="analyzeContent"
                placeholder="Paste content to analyze topics, sentiment, and keywords..."
                :rows="4"
              />
              <a-button
                type="primary"
                :loading="store.loading"
                style="margin-top: 12px"
                @click="handleAnalyze"
              >
                Analyze
              </a-button>
            </a-card>

            <a-card
              v-if="store.currentAnalysis"
              title="Analysis Result"
              :bordered="false"
              style="margin-top: 16px"
            >
              <a-descriptions
                :column="1"
                size="small"
              >
                <a-descriptions-item label="Sentiment">
                  <a-tag :color="sentimentColor">
                    {{ store.sentimentLabel }}
                  </a-tag>
                  <span style="margin-left: 8px">Score: {{ store.currentAnalysis.sentimentScore }}</span>
                </a-descriptions-item>
                <a-descriptions-item label="Category">
                  <a-tag color="blue">
                    {{ store.currentAnalysis.category }}
                  </a-tag>
                </a-descriptions-item>
                <a-descriptions-item label="Topics">
                  <a-tag
                    v-for="topic in store.topTopics"
                    :key="topic"
                    color="cyan"
                  >
                    {{ topic }}
                  </a-tag>
                </a-descriptions-item>
                <a-descriptions-item label="Keywords">
                  <a-tag
                    v-for="kw in store.currentAnalysis.keywords"
                    :key="kw"
                  >
                    {{ kw }}
                  </a-tag>
                </a-descriptions-item>
                <a-descriptions-item label="Summary">
                  {{ store.currentAnalysis.summary }}
                </a-descriptions-item>
              </a-descriptions>
            </a-card>
          </a-col>

          <a-col :span="12">
            <a-card
              title="Trending Topics"
              :bordered="false"
              :extra="undefined"
            >
              <template #extra>
                <a-button
                  size="small"
                  @click="handleFetchTrending"
                >
                  Refresh
                </a-button>
              </template>
              <a-list
                :data-source="store.trendingTopics"
                :loading="store.loading"
                size="small"
              >
                <template #renderItem="{ item, index }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>
                        <span>{{ index + 1 }}. {{ item.topic }}</span>
                      </template>
                      <template #description>
                        <a-tag color="green">
                          {{ item.count }} mentions
                        </a-tag>
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
              <a-empty
                v-if="store.trendingTopics.length === 0 && !store.loading"
                description="No trending topics yet"
              />
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>

      <a-tab-pane
        key="replies"
        tab="AI Reply Suggestions"
      >
        <a-card
          title="Context-Aware Replies"
          :bordered="false"
        >
          <a-textarea
            v-model:value="replyContext"
            placeholder="Enter conversation (one message per line, format: role: content)..."
            :rows="4"
          />
          <a-space style="margin-top: 12px">
            <a-select
              v-model:value="selectedStyle"
              :options="styleOptions"
              style="width: 160px"
            />
            <a-button
              type="primary"
              :loading="store.loading"
              @click="handleGetReplies"
            >
              Generate Replies
            </a-button>
          </a-space>
        </a-card>

        <a-row
          v-if="store.multiStyleReplies"
          :gutter="16"
          style="margin-top: 16px"
        >
          <a-col
            v-for="(reply, style) in store.multiStyleReplies"
            :key="style"
            :span="8"
          >
            <a-card
              :title="String(style)"
              :bordered="false"
              size="small"
            >
              <p>{{ reply.suggestion }}</p>
              <a-tag
                :color="reply.source === 'llm' ? 'green' : 'orange'"
                size="small"
              >
                {{ reply.source }}
              </a-tag>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>

      <a-tab-pane
        key="graph"
        tab="Social Graph"
      >
        <a-row :gutter="16">
          <a-col :span="16">
            <a-card
              title="Relationship Graph"
              :bordered="false"
            >
              <a-empty
                v-if="!store.graph"
                description="Enter your DID to load the social graph"
              />
              <div
                v-else
                class="graph-placeholder"
              >
                <p>{{ store.graph.nodes.length }} nodes, {{ store.graph.edges.length }} edges</p>
                <a-tag
                  v-for="community in store.communities"
                  :key="community.clusterId"
                  color="purple"
                >
                  Cluster {{ community.clusterId }}: {{ community.size }} members
                </a-tag>
              </div>
            </a-card>
          </a-col>
          <a-col :span="8">
            <a-card
              title="Graph Stats"
              :bordered="false"
            >
              <a-statistic
                title="Total Contacts"
                :value="store.contactCount"
                style="margin-bottom: 16px"
              />
              <a-statistic
                v-if="store.graphStats"
                title="Total Interactions"
                :value="store.graphStats.totalInteractions"
                style="margin-bottom: 16px"
              />
              <a-statistic
                v-if="store.graphStats"
                title="Avg Closeness"
                :value="store.graphStats.avgCloseness"
                :precision="2"
              />
            </a-card>

            <a-card
              title="Closest Contacts"
              :bordered="false"
              style="margin-top: 16px"
            >
              <a-list
                :data-source="store.closestContacts"
                size="small"
              >
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta :title="item.did.substring(0, 20) + '...'">
                      <template #description>
                        Closeness: {{ item.closeness }} | {{ item.totalInteractions }} interactions
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
          </a-col>
        </a-row>
      </a-tab-pane>
    </a-tabs>

    <a-alert
      v-if="store.error"
      :message="store.error"
      type="error"
      closable
      style="margin-top: 16px"
      @close="store.error = null"
    />
  </div>
</template>

<style lang="less" scoped>
.social-insights-page {
  padding: 24px;

  .graph-placeholder {
    min-height: 200px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
}
</style>
