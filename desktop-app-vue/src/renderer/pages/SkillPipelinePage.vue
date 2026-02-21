<template>
  <div class="skill-pipeline-page">
    <a-page-header title="流水线编排" sub-title="Skill Pipeline Designer">
      <template #extra>
        <a-button type="primary" @click="showCreateModal = true">
          新建流水线
        </a-button>
        <a-button @click="loadTemplates"> 加载模板 </a-button>
      </template>
    </a-page-header>

    <a-row :gutter="16" style="padding: 16px">
      <!-- Pipeline list -->
      <a-col :span="8">
        <a-card title="流水线列表" :loading="store.loading">
          <a-list
            :data-source="store.pipelines"
            :locale="{ emptyText: '暂无流水线' }"
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
                      <a-avatar style="background-color: #722ed1"> P </a-avatar>
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

        <!-- Templates -->
        <a-card
          v-if="store.templates.length > 0"
          title="预置模板"
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

      <!-- Execution status -->
      <a-col :span="16">
        <a-card v-if="store.executionStatus" title="执行状态">
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

    <!-- Create Modal -->
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
            <a-select-option value="development"> Development </a-select-option>
            <a-select-option value="data"> Data </a-select-option>
            <a-select-option value="security"> Security </a-select-option>
            <a-select-option value="devops"> DevOps </a-select-option>
            <a-select-option value="media"> Media </a-select-option>
            <a-select-option value="knowledge"> Knowledge </a-select-option>
            <a-select-option value="custom"> Custom </a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { message } from "ant-design-vue";
import { useSkillPipelineStore } from "../stores/skill-pipeline";

const store = useSkillPipelineStore();
const showCreateModal = ref(false);
const creating = ref(false);

const newPipeline = ref({
  name: "",
  description: "",
  category: "custom",
});

onMounted(async () => {
  await store.loadPipelines();
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
  } catch (error) {
    message.error(error.message);
  } finally {
    creating.value = false;
  }
}

async function executePipeline(id) {
  try {
    await store.executePipeline(id);
    message.success("流水线执行完成");
  } catch (error) {
    message.error(`执行失败: ${error.message}`);
  }
}

async function deletePipeline(id) {
  await store.deletePipeline(id);
  message.success("已删除");
}

async function createFromTemplate(template) {
  try {
    await store.createPipeline(template);
    message.success(`已从模板 "${template.name}" 创建流水线`);
  } catch (error) {
    message.error(error.message);
  }
}
</script>
