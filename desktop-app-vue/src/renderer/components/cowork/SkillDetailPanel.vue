<template>
  <div class="skill-detail-panel">
    <!-- 基本信息 -->
    <a-descriptions
      title="基本信息"
      :column="1"
      bordered
      class="info-section"
    >
      <a-descriptions-item label="技能名称">
        {{ skill.name }}
      </a-descriptions-item>
      <a-descriptions-item label="类型">
        <a-tag :color="getTypeColor(skill.type)">
          {{ getTypeText(skill.type) }}
        </a-tag>
      </a-descriptions-item>
      <a-descriptions-item label="描述">
        {{ skill.description || "-" }}
      </a-descriptions-item>
    </a-descriptions>

    <!-- 支持的操作 -->
    <div v-if="skill.supportedOperations && skill.supportedOperations.length > 0" class="info-section">
      <h3 class="section-title">
        <ThunderboltOutlined />
        支持的操作
      </h3>

      <div class="operations-grid">
        <a-tag
          v-for="op in skill.supportedOperations"
          :key="op"
          color="blue"
        >
          {{ op }}
        </a-tag>
      </div>
    </div>

    <!-- 支持的文件类型 -->
    <div v-if="skill.supportedFileTypes && skill.supportedFileTypes.length > 0" class="info-section">
      <h3 class="section-title">
        <FileTextOutlined />
        支持的文件类型
      </h3>

      <div class="file-types-grid">
        <a-tag
          v-for="type in skill.supportedFileTypes"
          :key="type"
          color="geekblue"
        >
          .{{ type }}
        </a-tag>
      </div>
    </div>

    <!-- 匹配关键词 -->
    <div v-if="skill.keywords && skill.keywords.length > 0" class="info-section">
      <h3 class="section-title">
        <TagOutlined />
        匹配关键词
      </h3>

      <div class="keywords-grid">
        <a-tag
          v-for="keyword in skill.keywords"
          :key="keyword"
          color="green"
        >
          {{ keyword }}
        </a-tag>
      </div>
    </div>

    <!-- 匹配算法说明 -->
    <div class="info-section">
      <h3 class="section-title">
        <BulbOutlined />
        匹配算法
      </h3>

      <a-card size="small" style="background: #fafafa;">
        <p style="margin: 0; line-height: 1.8;">
          技能匹配采用 0-100 评分系统：
        </p>
        <ul style="margin-top: 12px; padding-left: 20px; line-height: 1.8;">
          <li><strong>任务类型匹配</strong>: +40 分</li>
          <li><strong>操作匹配</strong>: +30 分</li>
          <li><strong>文件类型匹配</strong>: +20 分</li>
          <li><strong>关键词匹配</strong>: +10 分</li>
        </ul>
        <p style="margin-top: 12px; margin-bottom: 0; color: #8c8c8c;">
          评分 ≥ 80 表示高度匹配，推荐使用该技能执行任务。
        </p>
      </a-card>
    </div>

    <!-- 使用示例 -->
    <div class="info-section">
      <h3 class="section-title">
        <CodeOutlined />
        使用示例
      </h3>

      <pre class="code-example">{{getUsageExample(skill)}}</pre>
    </div>
  </div>
</template>

<script setup>
import {
  ThunderboltOutlined,
  FileTextOutlined,
  TagOutlined,
  BulbOutlined,
  CodeOutlined,
} from "@ant-design/icons-vue";

// Props
const props = defineProps({
  skill: {
    type: Object,
    required: true,
  },
});

// Emits
const emit = defineEmits(["close"]);

// ==========================================
// 辅助函数
// ==========================================

function getTypeColor(type) {
  const colors = {
    office: "green",
    coding: "blue",
    "data-analysis": "orange",
    other: "default",
  };
  return colors[type] || "default";
}

function getTypeText(type) {
  const texts = {
    office: "Office 文档",
    coding: "编程",
    "data-analysis": "数据分析",
    other: "其他",
  };
  return texts[type] || type;
}

function getUsageExample(skill) {
  if (skill.type === "office") {
    return `// 通过 IPC 调用技能
const result = await ipcRenderer.invoke('cowork:skill-auto-execute', {
  task: {
    type: 'office',
    operation: 'createExcel',
    input: {
      outputPath: '/path/to/report.xlsx',
      sheetName: '销售数据',
      columns: [
        { header: '产品', key: 'product' },
        { header: '销量', key: 'sales' }
      ],
      rows: [
        { product: '产品 A', sales: 100 },
        { product: '产品 B', sales: 150 }
      ]
    }
  }
});

console.log('生成的文件:', result.result.filePath);`;
  }

  return `// 通过 IPC 调用技能
const result = await ipcRenderer.invoke('cowork:skill-auto-execute', {
  task: {
    type: '${skill.type}',
    operation: '${skill.supportedOperations?.[0] || 'execute'}',
    input: {
      // 输入参数...
    }
  }
});`;
}
</script>

<style scoped lang="scss">
.skill-detail-panel {
  .info-section {
    margin-bottom: 24px;

    :deep(.ant-descriptions-title) {
      font-weight: 600;
      font-size: 16px;
      margin-bottom: 16px;
    }
  }

  .section-title {
    font-size: 16px;
    font-weight: 600;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;

    :deep(.anticon) {
      color: #1890ff;
    }
  }

  .operations-grid,
  .file-types-grid,
  .keywords-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .code-example {
    background: #fafafa;
    border: 1px solid #d9d9d9;
    border-radius: 4px;
    padding: 12px;
    font-size: 13px;
    font-family: "Courier New", monospace;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-x: auto;
  }
}
</style>
