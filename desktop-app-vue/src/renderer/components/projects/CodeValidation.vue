<template>
  <div class="code-validation-panel">
    <!-- 头部 -->
    <div class="validation-header">
      <h4 class="validation-title">
        <CheckCircleOutlined />
        代码验证与测试
      </h4>
      <a-button type="text" size="small" @click="$emit('close')">
        <CloseOutlined />
      </a-button>
    </div>

    <!-- 验证选项 -->
    <div class="validation-options">
      <a-space direction="vertical" style="width: 100%">
        <a-card size="small" title="语法检查" :bordered="false">
          <a-checkbox-group v-model:value="selectedValidations" style="width: 100%">
            <a-row>
              <a-col :span="24">
                <a-checkbox value="syntax">语法验证</a-checkbox>
              </a-col>
              <a-col :span="24">
                <a-checkbox value="eslint">ESLint 检查</a-checkbox>
              </a-col>
              <a-col :span="24">
                <a-checkbox value="typescript">TypeScript 类型检查</a-checkbox>
              </a-col>
            </a-row>
          </a-checkbox-group>
        </a-card>

        <a-card size="small" title="代码质量" :bordered="false">
          <a-checkbox-group v-model:value="selectedValidations" style="width: 100%">
            <a-row>
              <a-col :span="24">
                <a-checkbox value="complexity">复杂度分析</a-checkbox>
              </a-col>
              <a-col :span="24">
                <a-checkbox value="security">安全漏洞扫描</a-checkbox>
              </a-col>
              <a-col :span="24">
                <a-checkbox value="performance">性能检查</a-checkbox>
              </a-col>
            </a-row>
          </a-checkbox-group>
        </a-card>

        <a-card size="small" title="测试" :bordered="false">
          <a-checkbox-group v-model:value="selectedValidations" style="width: 100%">
            <a-row>
              <a-col :span="24">
                <a-checkbox value="unit">单元测试</a-checkbox>
              </a-col>
              <a-col :span="24">
                <a-checkbox value="integration">集成测试</a-checkbox>
              </a-col>
              <a-col :span="24">
                <a-checkbox value="e2e">E2E 测试</a-checkbox>
              </a-col>
            </a-row>
          </a-checkbox-group>
        </a-card>
      </a-space>
    </div>

    <!-- 执行按钮 -->
    <div class="validation-actions">
      <a-button
        type="primary"
        block
        :loading="isValidating"
        :disabled="selectedValidations.length === 0"
        @click="handleValidate"
      >
        <PlayCircleOutlined v-if="!isValidating" />
        {{ isValidating ? '验证中...' : '开始验证' }}
      </a-button>
    </div>

    <!-- 验证结果 -->
    <div v-if="validationResults.length > 0" class="validation-results">
      <a-divider>验证结果</a-divider>

      <div
        v-for="result in validationResults"
        :key="result.type"
        :class="['validation-result-item', result.status]"
      >
        <div class="result-header">
          <div class="result-title">
            <CheckCircleOutlined v-if="result.status === 'success'" style="color: #52c41a" />
            <CloseCircleOutlined v-else-if="result.status === 'error'" style="color: #ff4d4f" />
            <ExclamationCircleOutlined v-else style="color: #faad14" />
            <span>{{ result.title }}</span>
          </div>
          <a-tag :color="getStatusColor(result.status)">
            {{ getStatusText(result.status) }}
          </a-tag>
        </div>

        <div v-if="result.message" class="result-message">
          {{ result.message }}
        </div>

        <!-- 详细错误列表 -->
        <div v-if="result.errors && result.errors.length > 0" class="result-errors">
          <a-collapse ghost>
            <a-collapse-panel key="1" :header="`${result.errors.length} 个问题`">
              <div
                v-for="(error, index) in result.errors"
                :key="index"
                class="error-item"
              >
                <div class="error-location">
                  <FileTextOutlined />
                  <span>{{ error.file }}:{{ error.line }}:{{ error.column }}</span>
                </div>
                <div class="error-message">{{ error.message }}</div>
                <div v-if="error.suggestion" class="error-suggestion">
                  <BulbOutlined />
                  建议: {{ error.suggestion }}
                </div>
              </div>
            </a-collapse-panel>
          </a-collapse>
        </div>

        <!-- 统计信息 -->
        <div v-if="result.stats" class="result-stats">
          <a-row :gutter="8">
            <a-col :span="8" v-for="(value, key) in result.stats" :key="key">
              <a-statistic
                :title="key"
                :value="value"
                :value-style="{ fontSize: '14px' }"
              />
            </a-col>
          </a-row>
        </div>
      </div>
    </div>

    <!-- 快速修复建议 -->
    <div v-if="quickFixes.length > 0" class="quick-fixes">
      <a-divider>快速修复</a-divider>
      <a-list size="small" :data-source="quickFixes">
        <template #renderItem="{ item }">
          <a-list-item>
            <template #actions>
              <a-button type="link" size="small" @click="handleApplyFix(item)">
                应用
              </a-button>
            </template>
            <a-list-item-meta>
              <template #title>
                <ToolOutlined />
                {{ item.title }}
              </template>
              <template #description>
                {{ item.description }}
              </template>
            </a-list-item-meta>
          </a-list-item>
        </template>
      </a-list>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import {
  CheckCircleOutlined,
  CloseOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
  BulbOutlined,
  ToolOutlined,
} from '@ant-design/icons-vue';
import { message } from 'ant-design-vue';

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
  currentFile: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['close', 'apply-fix', 'run-test']);

// 验证状态
const selectedValidations = ref(['syntax', 'eslint']);
const isValidating = ref(false);
const validationResults = ref([]);
const quickFixes = ref([]);

// 执行验证
const handleValidate = async () => {
  isValidating.value = true;
  validationResults.value = [];
  quickFixes.value = [];

  try {
    // 模拟验证过程
    for (const validationType of selectedValidations.value) {
      await new Promise(resolve => setTimeout(resolve, 500));

      const result = await performValidation(validationType);
      validationResults.value.push(result);

      // 收集快速修复建议
      if (result.fixes) {
        quickFixes.value.push(...result.fixes);
      }
    }

    message.success('验证完成');
  } catch (error) {
    message.error('验证失败: ' + error.message);
  } finally {
    isValidating.value = false;
  }
};

// 执行具体验证
const performValidation = async (type) => {
  const validationMap = {
    syntax: performSyntaxValidation,
    eslint: performESLintValidation,
    typescript: performTypeScriptValidation,
    complexity: performComplexityAnalysis,
    security: performSecurityScan,
    performance: performPerformanceCheck,
    unit: performUnitTests,
    integration: performIntegrationTests,
    e2e: performE2ETests,
  };

  const validator = validationMap[type];
  if (validator) {
    return await validator();
  }

  return {
    type,
    title: '未知验证',
    status: 'error',
    message: '不支持的验证类型',
  };
};

// 语法验证
const performSyntaxValidation = async () => {
  // 实际项目中应该调用真实的语法检查工具
  const hasErrors = Math.random() > 0.7;

  if (hasErrors) {
    return {
      type: 'syntax',
      title: '语法检查',
      status: 'error',
      message: '发现语法错误',
      errors: [
        {
          file: 'src/components/Example.vue',
          line: 42,
          column: 15,
          message: 'Unexpected token',
          suggestion: '检查括号是否匹配',
        },
      ],
      fixes: [
        {
          title: '自动修复括号匹配',
          description: '自动添加缺失的右括号',
          type: 'syntax',
          action: 'fix-brackets',
        },
      ],
    };
  }

  return {
    type: 'syntax',
    title: '语法检查',
    status: 'success',
    message: '未发现语法错误',
  };
};

// ESLint 验证
const performESLintValidation = async () => {
  const hasWarnings = Math.random() > 0.5;

  if (hasWarnings) {
    return {
      type: 'eslint',
      title: 'ESLint 检查',
      status: 'warning',
      message: '发现代码风格问题',
      errors: [
        {
          file: 'src/utils/helper.js',
          line: 15,
          column: 3,
          message: 'Unexpected console statement',
          suggestion: '移除 console.log 或使用 logger',
        },
        {
          file: 'src/utils/helper.js',
          line: 28,
          column: 10,
          message: 'Missing semicolon',
          suggestion: '添加分号',
        },
      ],
      stats: {
        '错误': 0,
        '警告': 2,
        '信息': 0,
      },
      fixes: [
        {
          title: '自动修复 ESLint 问题',
          description: '运行 eslint --fix 自动修复可修复的问题',
          type: 'eslint',
          action: 'eslint-fix',
        },
      ],
    };
  }

  return {
    type: 'eslint',
    title: 'ESLint 检查',
    status: 'success',
    message: '代码风格良好',
    stats: {
      '错误': 0,
      '警告': 0,
      '信息': 0,
    },
  };
};

// TypeScript 类型检查
const performTypeScriptValidation = async () => {
  return {
    type: 'typescript',
    title: 'TypeScript 类型检查',
    status: 'success',
    message: '类型检查通过',
  };
};

// 复杂度分析
const performComplexityAnalysis = async () => {
  return {
    type: 'complexity',
    title: '复杂度分析',
    status: 'warning',
    message: '部分函数复杂度较高',
    errors: [
      {
        file: 'src/services/dataProcessor.js',
        line: 50,
        column: 1,
        message: '函数 processData 的圈复杂度为 15，建议重构',
        suggestion: '将复杂逻辑拆分为多个小函数',
      },
    ],
    stats: {
      '平均复杂度': 5.2,
      '最高复杂度': 15,
      '函数数量': 28,
    },
  };
};

// 安全漏洞扫描
const performSecurityScan = async () => {
  return {
    type: 'security',
    title: '安全漏洞扫描',
    status: 'success',
    message: '未发现安全漏洞',
    stats: {
      '高危': 0,
      '中危': 0,
      '低危': 0,
    },
  };
};

// 性能检查
const performPerformanceCheck = async () => {
  return {
    type: 'performance',
    title: '性能检查',
    status: 'success',
    message: '性能良好',
    stats: {
      '内存泄漏': 0,
      '大文件': 0,
      '未优化图片': 0,
    },
  };
};

// 单元测试
const performUnitTests = async () => {
  return {
    type: 'unit',
    title: '单元测试',
    status: 'success',
    message: '所有测试通过',
    stats: {
      '通过': 45,
      '失败': 0,
      '跳过': 2,
    },
  };
};

// 集成测试
const performIntegrationTests = async () => {
  return {
    type: 'integration',
    title: '集成测试',
    status: 'success',
    message: '集成测试通过',
    stats: {
      '通过': 12,
      '失败': 0,
      '跳过': 1,
    },
  };
};

// E2E 测试
const performE2ETests = async () => {
  return {
    type: 'e2e',
    title: 'E2E 测试',
    status: 'success',
    message: 'E2E 测试通过',
    stats: {
      '通过': 8,
      '失败': 0,
      '跳过': 0,
    },
  };
};

// 应用快速修复
const handleApplyFix = (fix) => {
  emit('apply-fix', fix);
  message.success('已应用修复: ' + fix.title);
};

// 获取状态颜色
const getStatusColor = (status) => {
  const colorMap = {
    success: 'success',
    warning: 'warning',
    error: 'error',
  };
  return colorMap[status] || 'default';
};

// 获取状态文本
const getStatusText = (status) => {
  const textMap = {
    success: '通过',
    warning: '警告',
    error: '失败',
  };
  return textMap[status] || '未知';
};
</script>

<style scoped>
.code-validation-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: white;
}

.validation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #e8e8e8;
}

.validation-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.validation-options {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.validation-options :deep(.ant-card) {
  margin-bottom: 12px;
}

.validation-options :deep(.ant-checkbox-wrapper) {
  margin-bottom: 8px;
}

.validation-actions {
  padding: 16px;
  border-top: 1px solid #e8e8e8;
}

.validation-results {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: #fafafa;
}

.validation-result-item {
  padding: 16px;
  margin-bottom: 12px;
  background: white;
  border-radius: 6px;
  border-left: 4px solid #d9d9d9;
}

.validation-result-item.success {
  border-left-color: #52c41a;
}

.validation-result-item.warning {
  border-left-color: #faad14;
}

.validation-result-item.error {
  border-left-color: #ff4d4f;
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.result-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
}

.result-message {
  margin-bottom: 12px;
  color: #666;
  font-size: 13px;
}

.result-errors {
  margin-top: 12px;
}

.error-item {
  padding: 12px;
  margin-bottom: 8px;
  background: #fafafa;
  border-radius: 4px;
  border-left: 3px solid #ff4d4f;
}

.error-location {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #666;
  margin-bottom: 6px;
}

.error-message {
  font-size: 13px;
  color: #333;
  margin-bottom: 6px;
}

.error-suggestion {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #1890ff;
  padding: 6px;
  background: #e6f7ff;
  border-radius: 4px;
}

.result-stats {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f0f0f0;
}

.quick-fixes {
  padding: 16px;
  background: #f5f5f5;
}

.quick-fixes :deep(.ant-list-item) {
  background: white;
  padding: 12px;
  margin-bottom: 8px;
  border-radius: 6px;
}
</style>
