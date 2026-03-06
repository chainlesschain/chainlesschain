<template>
  <div class="nl-programming-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h2>自然语言编程</h2>
        <span class="subtitle">Natural Language Programming</span>
      </div>
      <div class="header-right">
        <a-button @click="handleLoadHistory">
          历史记录
        </a-button>
      </div>
    </div>

    <!-- 输入区域 -->
    <a-card class="input-section">
      <a-textarea
        v-model:value="nlInput"
        placeholder="用自然语言描述你想要实现的功能...&#10;例如：创建一个用户登录表单，包含用户名和密码字段，支持表单验证"
        :rows="4"
        :maxlength="2000"
        show-count
      />
      <div class="input-actions">
        <a-button
          type="primary"
          :loading="store.loading"
          @click="handleTranslate"
        >
          翻译为 Spec
        </a-button>
        <a-button
          v-if="store.hasSpec"
          :loading="store.loading"
          @click="handleGenerate"
        >
          生成代码
        </a-button>
      </div>
    </a-card>

    <!-- 中部内容 -->
    <a-row
      :gutter="16"
      class="middle-section"
    >
      <!-- Spec 预览 -->
      <a-col
        :lg="12"
        :md="24"
      >
        <a-card
          title="Spec 结构化预览"
          size="small"
        >
          <template v-if="store.currentSpec">
            <a-descriptions
              :column="1"
              size="small"
            >
              <a-descriptions-item label="意图">
                <a-tag color="blue">
                  {{ store.currentSpec.intent }}
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="实体">
                <a-tag
                  v-for="entity in store.currentSpec.entities"
                  :key="entity.name"
                  color="cyan"
                >
                  {{ entity.name }} ({{ entity.type }})
                </a-tag>
              </a-descriptions-item>
              <a-descriptions-item label="验收条件">
                <ul class="acceptance-list">
                  <li
                    v-for="(criteria, idx) in store.currentSpec
                      .acceptanceCriteria"
                    :key="idx"
                  >
                    {{ criteria }}
                  </li>
                </ul>
              </a-descriptions-item>
              <a-descriptions-item label="完整度">
                <a-progress
                  :percent="store.specCompleteness"
                  :status="store.specCompleteness >= 80 ? 'success' : 'active'"
                />
              </a-descriptions-item>
            </a-descriptions>

            <!-- 反馈优化 -->
            <div class="refine-section">
              <a-input-search
                v-model:value="refineFeedback"
                placeholder="补充需求或修正意图..."
                enter-button="优化"
                :loading="store.loading"
                @search="handleRefine"
              />
            </div>
          </template>
          <a-empty
            v-else
            description="输入自然语言后点击「翻译为 Spec」"
          />
        </a-card>
      </a-col>

      <!-- 项目约定 -->
      <a-col
        :lg="12"
        :md="24"
      >
        <a-card
          title="项目约定"
          size="small"
        >
          <template v-if="store.conventions">
            <a-descriptions
              :column="1"
              size="small"
              bordered
            >
              <a-descriptions-item label="命名规范">
                {{ store.conventions.naming }}
              </a-descriptions-item>
              <a-descriptions-item label="框架">
                {{ store.conventions.framework }}
              </a-descriptions-item>
              <a-descriptions-item label="测试框架">
                {{ store.conventions.testFramework }}
              </a-descriptions-item>
              <a-descriptions-item label="代码风格">
                {{ store.conventions.style }}
              </a-descriptions-item>
              <a-descriptions-item label="模式">
                <a-tag
                  v-for="pattern in store.conventions.patterns"
                  :key="pattern"
                >
                  {{ pattern }}
                </a-tag>
              </a-descriptions-item>
            </a-descriptions>
          </template>
          <a-empty
            v-else
            description="暂无项目约定"
          >
            <a-button @click="handleAnalyzeProject">
              分析当前项目
            </a-button>
          </a-empty>
        </a-card>
      </a-col>
    </a-row>

    <!-- 代码预览 -->
    <a-card
      v-if="store.generatedCode"
      title="生成代码预览"
      size="small"
      class="code-section"
    >
      <template #extra>
        <a-button
          type="primary"
          size="small"
          @click="handleApplyCode"
        >
          应用到工作区
        </a-button>
      </template>
      <pre class="code-preview"><code>{{ store.generatedCode }}</code></pre>
    </a-card>

    <!-- 历史记录抽屉 -->
    <a-modal
      v-model:open="showHistory"
      title="历史记录"
      width="700px"
      :footer="null"
    >
      <a-list
        :data-source="store.history"
        size="small"
      >
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta
              :title="
                item.input.substring(0, 60) +
                  (item.input.length > 60 ? '...' : '')
              "
              :description="`${item.status} | ${item.createdAt}`"
            />
            <template #actions>
              <a-button
                type="link"
                size="small"
                @click="handleLoadFromHistory(item)"
              >
                加载
              </a-button>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-modal>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useNLProgramStore } from "../stores/nlProgram";

const store = useNLProgramStore();

const nlInput = ref("");
const refineFeedback = ref("");
const showHistory = ref(false);

async function handleTranslate() {
  if (!nlInput.value.trim()) {
    message.warning("请输入自然语言描述");
    return;
  }
  const result = await store.translate(nlInput.value);
  if (result.success) {
    message.success("翻译完成");
  } else {
    message.error(result.error || "翻译失败");
  }
}

async function handleRefine(feedback: string) {
  if (!feedback || !store.currentSpec) {
    return;
  }
  const result = await store.refine(store.currentSpec, feedback);
  if (result.success) {
    message.success("Spec 已优化");
    refineFeedback.value = "";
  }
}

async function handleGenerate() {
  if (!store.currentSpec) {
    return;
  }
  const result = await store.generate(store.currentSpec);
  if (result.success) {
    message.success("代码生成完成");
  } else {
    message.error(result.error || "生成失败");
  }
}

async function handleAnalyzeProject() {
  const result = await store.analyzeProject(".");
  if (result.success) {
    message.success("项目分析完成");
  }
}

function handleApplyCode() {
  message.info("将代码应用到工作区（功能开发中）");
}

async function handleLoadHistory() {
  await store.getHistory();
  showHistory.value = true;
}

function handleLoadFromHistory(item: any) {
  nlInput.value = item.input;
  if (item.spec) {
    store.currentSpec = item.spec;
  }
  if (item.generatedCode) {
    store.generatedCode = item.generatedCode;
  }
  showHistory.value = false;
}

onMounted(async () => {
  await store.getConventions();
  await store.getStats();
});
</script>

<style lang="less" scoped>
.nl-programming-page {
  padding: 24px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;

  .header-left {
    h2 {
      margin: 0;
    }
    .subtitle {
      color: rgba(0, 0, 0, 0.45);
      font-size: 14px;
    }
  }
}

.input-section {
  margin-bottom: 16px;

  .input-actions {
    margin-top: 12px;
    display: flex;
    gap: 8px;
  }
}

.middle-section {
  margin-bottom: 16px;
}

.acceptance-list {
  margin: 0;
  padding-left: 16px;

  li {
    margin-bottom: 4px;
  }
}

.refine-section {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

.code-section {
  margin-top: 16px;
}

.code-preview {
  background: #f5f5f5;
  padding: 16px;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 400px;
  font-size: 13px;
  line-height: 1.5;
  margin: 0;

  code {
    font-family: "Consolas", "Monaco", monospace;
  }
}
</style>
