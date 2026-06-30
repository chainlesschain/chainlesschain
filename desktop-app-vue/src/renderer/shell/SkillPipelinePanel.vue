<template>
  <a-modal
    :open="open"
    :width="920"
    :footer="null"
    :mask-closable="true"
    :body-style="{ maxHeight: '78vh', overflowY: 'auto' }"
    title="流水线编排"
    @update:open="(v) => $emit('update:open', v)"
  >
    <div v-if="prefillText" class="prefill-banner">
      <PartitionOutlined />
      <span class="prefill-text">命令：{{ prefillText }}</span>
    </div>

    <div class="sp-toolbar">
      <span class="sp-subtitle">Skill Pipeline Designer</span>
      <a-space size="small">
        <a-button size="small" @click="loadTemplates">加载模板</a-button>
        <a-button type="primary" size="small" @click="showCreateModal = true">
          <template #icon><PlusOutlined /></template>
          新建流水线
        </a-button>
      </a-space>
    </div>

    <a-row :gutter="16">
      <a-col :span="9">
        <a-card title="流水线列表" size="small" :loading="store.loading">
          <a-list
            :data-source="store.pipelines"
            :locale="{ emptyText: '暂无流水线' }"
            size="small"
          >
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta
                  :title="item.name"
                  :description="item.description"
                >
                  <template #avatar>
                    <a-badge
                      :count="item.stepCount"
                      :number-style="{ backgroundColor: '#1890ff' }"
                    >
                      <a-avatar style="background-color: #722ed1">P</a-avatar>
                    </a-badge>
                  </template>
                </a-list-item-meta>
                <template #actions>
                  <a-button
                    size="small"
                    type="link"
                    @click="executePipeline(item.id)"
                  >
                    执行
                  </a-button>
                  <a-button
                    size="small"
                    type="link"
                    danger
                    @click="deletePipeline(item.id)"
                  >
                    删除
                  </a-button>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </a-card>

        <a-card
          v-if="store.templates.length > 0"
          title="预置模板"
          size="small"
          style="margin-top: 16px"
        >
          <a-list :data-source="store.templates" size="small">
            <template #renderItem="{ item }">
              <a-list-item>
                <a-list-item-meta
                  :title="item.name"
                  :description="item.description"
                />
                <template #actions>
                  <a-button
                    size="small"
                    type="link"
                    @click="createFromTemplate(item)"
                  >
                    使用
                  </a-button>
                </template>
              </a-list-item>
            </template>
          </a-list>
        </a-card>
      </a-col>

      <a-col :span="15">
        <a-card v-if="store.executionStatus" title="执行状态" size="small">
          <a-result
            :status="
              store.executionStatus.state === 'completed'
                ? 'success'
                : store.executionStatus.state === 'failed'
                  ? 'error'
                  : 'info'
            "
            :title="store.executionStatus.state"
            :sub-title="`耗时: ${store.executionStatus.duration}ms`"
          />
          <a-timeline>
            <a-timeline-item
              v-for="step in store.executionStatus.stepResults"
              :key="step.stepIndex"
              :color="step.success ? 'green' : 'red'"
            >
              {{ step.stepName }} ({{ step.duration }}ms)
            </a-timeline-item>
          </a-timeline>
        </a-card>
        <a-empty v-else description="选择一个流水线并执行以查看结果" />
      </a-col>
    </a-row>

    <a-modal
      v-model:open="showCreateModal"
      title="新建流水线"
      :confirm-loading="creating"
      @ok="handleCreate"
    >
      <a-form layout="vertical">
        <a-form-item label="名称">
          <a-input
            v-model:value="newPipeline.name"
            placeholder="输入流水线名称"
          />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea
            v-model:value="newPipeline.description"
            placeholder="描述"
            :rows="3"
          />
        </a-form-item>
        <a-form-item label="分类">
          <a-select v-model:value="newPipeline.category" placeholder="选择分类">
            <a-select-option value="development">Development</a-select-option>
            <a-select-option value="data">Data</a-select-option>
            <a-select-option value="security">Security</a-select-option>
            <a-select-option value="devops">DevOps</a-select-option>
            <a-select-option value="media">Media</a-select-option>
            <a-select-option value="knowledge">Knowledge</a-select-option>
            <a-select-option value="custom">Custom</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </a-modal>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { message } from "ant-design-vue";
import { PlusOutlined, PartitionOutlined } from "@ant-design/icons-vue";
import { useSkillPipelineStore } from "../stores/skill-pipeline";

const props = defineProps<{ open: boolean; prefillText?: string }>();
defineEmits<{ (e: "update:open", value: boolean): void }>();

const store = useSkillPipelineStore();
const showCreateModal = ref(false);
const creating = ref(false);

const newPipeline = ref({
  name: "",
  description: "",
  category: "custom",
});

async function loadTemplates() {
  await store.loadTemplates();
  message.success(`已加载 ${store.templates.length} 个模板`);
}

async function handleCreate() {
  creating.value = true;
  try {
    await store.createPipeline({
      name: newPipeline.value.name,
      description: newPipeline.value.description,
      category: newPipeline.value.category,
      steps: [],
      tags: [],
      variables: {},
    });
    showCreateModal.value = false;
    newPipeline.value = { name: "", description: "", category: "custom" };
    message.success("流水线创建成功");
  } catch (error: any) {
    message.error(error.message);
  } finally {
    creating.value = false;
  }
}

async function executePipeline(id: string) {
  try {
    await store.executePipeline(id);
    message.success("流水线执行完成");
  } catch (error: any) {
    message.error(`执行失败: ${error.message}`);
  }
}

async function deletePipeline(id: string) {
  await store.deletePipeline(id);
  message.success("已删除");
}

async function createFromTemplate(template: any) {
  try {
    await store.createPipeline(template);
    message.success(`已从模板 "${template.name}" 创建流水线`);
  } catch (error: any) {
    message.error(error.message);
  }
}

// Load pipelines on open.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      store.loadPipelines();
    }
  },
  { immediate: true },
);
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
.sp-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.sp-subtitle {
  color: rgba(0, 0, 0, 0.45);
  font-size: 13px;
}
</style>
