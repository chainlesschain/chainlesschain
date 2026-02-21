<template>
  <div class="node-property-panel">
    <div v-if="node" class="panel-content">
      <div class="panel-header">
        <h3>节点属性</h3>
        <a-tag :color="typeColorMap[node.type] || 'default'">
          {{ node.type }}
        </a-tag>
      </div>

      <a-form layout="vertical" size="small">
        <a-form-item label="名称">
          <a-input
            :value="node.data?.label"
            placeholder="节点名称"
            @change="(e) => onFieldChange('label', e.target.value)"
          />
        </a-form-item>

        <a-form-item v-if="node.type === 'skill'" label="技能 ID">
          <a-input
            :value="node.data?.skillId"
            placeholder="例如: code-review"
            @change="(e) => onFieldChange('skillId', e.target.value)"
          />
        </a-form-item>

        <a-form-item label="输出变量">
          <a-input
            :value="node.data?.outputVar"
            placeholder="例如: result"
            @change="(e) => onFieldChange('outputVar', e.target.value)"
          />
        </a-form-item>

        <a-form-item
          v-if="node.type === 'condition' || node.type === 'transform'"
          label="表达式"
        >
          <a-textarea
            :value="node.data?.expression"
            placeholder="输入表达式"
            :rows="3"
            @change="(e) => onFieldChange('expression', e.target.value)"
          />
        </a-form-item>

        <a-form-item v-if="node.type === 'skill'" label="重试次数">
          <a-input-number
            :value="node.data?.retries ?? 0"
            :min="0"
            :max="10"
            style="width: 100%"
            @change="(val) => onFieldChange('retries', val)"
          />
        </a-form-item>
      </a-form>

      <div class="panel-footer">
        <a-button danger block @click="emit('remove', node)">
          <DeleteOutlined />
          删除节点
        </a-button>
      </div>
    </div>

    <div v-else class="panel-empty">
      <InboxOutlined style="font-size: 32px; color: #bfbfbf" />
      <span>选择节点以编辑属性</span>
    </div>
  </div>
</template>

<script setup>
import { DeleteOutlined, InboxOutlined } from "@ant-design/icons-vue";

const props = defineProps({
  node: { type: Object, default: null },
});

const emit = defineEmits(["update", "remove"]);

const typeColorMap = {
  skill: "blue",
  condition: "orange",
  parallel: "purple",
  transform: "cyan",
  loop: "green",
};

const onFieldChange = (field, value) => {
  emit("update", {
    ...props.node,
    data: { ...props.node.data, [field]: value },
  });
};
</script>

<style scoped>
.node-property-panel {
  padding: 12px;
  height: 100%;
  overflow-y: auto;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.panel-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #262626;
}

.panel-footer {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
}

.panel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 200px;
  color: #8c8c8c;
  font-size: 13px;
}
</style>
