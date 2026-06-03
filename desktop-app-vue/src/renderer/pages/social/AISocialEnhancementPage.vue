<template>
  <div class="ai-social-enhancement-page">
    <a-page-header
      title="AI Social Enhancement"
      sub-title="Translation and content quality"
    />
    <a-tabs v-model:active-key="activeTab">
      <a-tab-pane key="translate" tab="Translation">
        <a-form layout="vertical" style="max-width: 500px">
          <a-form-item label="Text">
            <a-textarea v-model:value="translateForm.text" :rows="3" />
          </a-form-item>
          <a-form-item label="Target Language">
            <a-input
              v-model:value="translateForm.targetLang"
              placeholder="zh, ja, en..."
            />
          </a-form-item>
          <a-button type="primary" @click="handleTranslate">
            Translate
          </a-button>
        </a-form>
        <a-card
          v-if="translationResult"
          title="Result"
          style="margin-top: 16px"
        >
          <p>{{ translationResult.translated_text }}</p>
          <p>
            <a-tag>
              {{ translationResult.source_lang }} →
              {{ translationResult.target_lang }}
            </a-tag>
          </p>
        </a-card>
      </a-tab-pane>
      <a-tab-pane key="quality" tab="Content Quality">
        <a-form layout="vertical" style="max-width: 500px">
          <a-form-item label="Content">
            <a-textarea v-model:value="qualityContent" :rows="3" />
          </a-form-item>
          <a-button type="primary" @click="handleAssess">
            Assess Quality
          </a-button>
        </a-form>
      </a-tab-pane>
    </a-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useAISocialEnhancementStore } from "../../stores/aiSocialEnhancement";

const store = useAISocialEnhancementStore();
const activeTab = ref("translate");
const translateForm = ref({ text: "", targetLang: "zh" });
const qualityContent = ref("");
const translationResult = ref<any>(null);

async function handleTranslate() {
  if (!translateForm.value.text) {
    message.warning("Text is required");
    return;
  }
  const r = await store.translateMessage(translateForm.value);
  if (r.success) {
    translationResult.value = r.result;
  } else {
    message.error(r.error || "Failed");
  }
}

async function handleAssess() {
  if (!qualityContent.value) {
    message.warning("Content is required");
    return;
  }
  const r = await store.assessQuality({ content: qualityContent.value });
  if (r.success) {
    message.success(
      `Quality: ${r.assessment.quality_level} (${(r.assessment.quality_score * 100).toFixed(0)}%)`,
    );
  } else {
    message.error(r.error || "Failed");
  }
}

onMounted(() => store.fetchTranslationStats());
</script>

<style lang="less" scoped>
.ai-social-enhancement-page {
  padding: 24px;
}
</style>
