<template>
  <a-modal
    :open="open"
    :width="960"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '80vh', overflowY: 'auto' }"
    title="自然语言编程"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <CodeOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <a-alert
      v-if="store.error"
      class="nlp-error"
      type="error"
      :message="store.error"
      closable
      show-icon
      @close="store.error = null"
    />

    <a-card size="small" class="input-section">
      <a-textarea
        v-model:value="nlInput"
        placeholder="用自然语言描述你想要实现的功能…例如：创建一个用户登录表单，包含用户名和密码字段，支持表单验证"
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
        <a-button :loading="store.loading" @click="openHistory"
          >历史记录</a-button
        >
      </div>
    </a-card>

    <a-row :gutter="16" class="middle-section">
      <a-col :lg="12" :md="24">
        <a-card title="Spec 结构化预览" size="small">
          <template v-if="store.currentSpec">
            <a-descriptions :column="1" size="small">
              <a-descriptions-item label="意图">
                <a-tag color="blue">{{ store.currentSpec.intent }}</a-tag>
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
            <div class="refine-section">
              <a-input-search
                v-model:value="refineFeedback"
                placeholder="补充需求或修正意图…"
                enter-button="优化"
                :loading="store.loading"
                @search="handleRefine"
              />
            </div>
          </template>
          <a-empty v-else description="输入自然语言后点击「翻译为 Spec」" />
        </a-card>
      </a-col>

      <a-col :lg="12" :md="24">
        <a-card title="项目约定" size="small">
          <template v-if="store.conventions">
            <a-descriptions :column="1" size="small" bordered>
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
          <a-empty v-else description="暂无项目约定">
            <a-button :loading="store.loading" @click="handleAnalyzeProject">
              分析当前项目
            </a-button>
          </a-empty>
        </a-card>
      </a-col>
    </a-row>

    <a-card
      v-if="store.generatedCode"
      title="生成代码预览"
      size="small"
      class="code-section"
    >
      <pre class="code-preview"><code>{{ store.generatedCode }}</code></pre>
    </a-card>

    <p class="panel-desc">
      自然语言 → 结构化 Spec → 优化迭代 + 项目约定分析已可用；「生成代码」后端为
      Phase B（开发中，点击会返回待实现提示）。
    </p>

    <a-modal
      v-model:open="showHistory"
      title="历史记录"
      :width="700"
      :footer="null"
    >
      <a-list :data-source="store.history" size="small">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta
              :title="
                item.input.substring(0, 60) +
                (item.input.length > 60 ? '…' : '')
              "
              :description="`${item.status} | ${item.createdAt}`"
            />
            <template #actions>
              <a-button type="link" size="small" @click="loadFromHistory(item)">
                加载
              </a-button>
            </template>
          </a-list-item>
        </template>
      </a-list>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { message } from "ant-design-vue";
import { CodeOutlined } from "@ant-design/icons-vue";
import { useNLProgramStore, type NLHistoryEntry } from "../stores/nlProgram";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useNLProgramStore();

const nlInput = ref("");
const refineFeedback = ref("");
const showHistory = ref(false);

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !store.loading) {
      store.getConventions();
      store.getStats();
    }
  },
  { immediate: true },
);

async function handleTranslate(): Promise<void> {
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

async function handleRefine(feedback: string): Promise<void> {
  if (!feedback || !store.currentSpec) {
    return;
  }
  const result = await store.refine(store.currentSpec, feedback);
  if (result.success) {
    message.success("Spec 已优化");
    refineFeedback.value = "";
  } else {
    message.error(result.error || "优化失败");
  }
}

async function handleGenerate(): Promise<void> {
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

async function handleAnalyzeProject(): Promise<void> {
  const result = await store.analyzeProject(".");
  if (result.success) {
    message.success("项目分析完成");
  } else {
    message.error(result.error || "项目分析失败");
  }
}

async function openHistory(): Promise<void> {
  await store.getHistory();
  showHistory.value = true;
}

function loadFromHistory(item: NLHistoryEntry): void {
  nlInput.value = item.input;
  if (item.spec) {
    store.currentSpec = item.spec;
  }
  if (item.generatedCode) {
    store.generatedCode = item.generatedCode;
  }
  showHistory.value = false;
}
</script>

<style scoped>
.prefill-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  margin-bottom: 12px;
  background: rgba(24, 144, 255, 0.08);
  border-radius: 6px;
  font-size: 13px;
}
.nlp-error {
  margin-bottom: 12px;
}
.input-section {
  margin-bottom: 16px;
}
.input-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
.middle-section {
  margin-bottom: 16px;
}
.acceptance-list {
  margin: 0;
  padding-left: 16px;
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
  max-height: 320px;
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
}
.code-preview code {
  font-family: "Consolas", "Monaco", monospace;
}
.panel-desc {
  margin-top: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
