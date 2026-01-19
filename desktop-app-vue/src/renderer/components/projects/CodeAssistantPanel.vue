<template>
  <div class="code-assistant-panel">
    <a-card :bordered="false">
      <a-tabs v-model:active-key="activeTab">
        <!-- 代码生成 -->
        <a-tab-pane
          key="generate"
          tab="代码生成"
        >
          <a-form layout="vertical">
            <a-form-item label="功能描述">
              <a-textarea
                v-model:value="generateForm.description"
                placeholder="描述你想要生成的代码功能，例如：实现一个快速排序算法"
                :rows="4"
              />
            </a-form-item>

            <a-row :gutter="16">
              <a-col :span="8">
                <a-form-item label="编程语言">
                  <a-select v-model:value="generateForm.language">
                    <a-select-option value="javascript">
                      JavaScript
                    </a-select-option>
                    <a-select-option value="typescript">
                      TypeScript
                    </a-select-option>
                    <a-select-option value="python">
                      Python
                    </a-select-option>
                    <a-select-option value="java">
                      Java
                    </a-select-option>
                    <a-select-option value="cpp">
                      C++
                    </a-select-option>
                    <a-select-option value="go">
                      Go
                    </a-select-option>
                    <a-select-option value="rust">
                      Rust
                    </a-select-option>
                    <a-select-option value="csharp">
                      C#
                    </a-select-option>
                  </a-select>
                </a-form-item>
              </a-col>
              <a-col :span="8">
                <a-form-item label="代码风格">
                  <a-select v-model:value="generateForm.style">
                    <a-select-option value="modern">
                      现代风格
                    </a-select-option>
                    <a-select-option value="classic">
                      经典风格
                    </a-select-option>
                    <a-select-option value="functional">
                      函数式
                    </a-select-option>
                  </a-select>
                </a-form-item>
              </a-col>
              <a-col :span="8">
                <a-form-item label="选项">
                  <a-checkbox-group v-model:value="generateForm.options">
                    <a-checkbox value="tests">
                      包含单元测试
                    </a-checkbox>
                    <a-checkbox value="comments">
                      包含注释
                    </a-checkbox>
                  </a-checkbox-group>
                </a-form-item>
              </a-col>
            </a-row>

            <a-form-item>
              <a-space>
                <a-button
                  type="primary"
                  :loading="generating"
                  :icon="h(CodeOutlined)"
                  @click="handleGenerate"
                >
                  生成代码
                </a-button>
                <a-button @click="resetGenerateForm">
                  重置
                </a-button>
              </a-space>
            </a-form-item>

            <!-- 生成结果 -->
            <div
              v-if="generateResult"
              class="result-section"
            >
              <a-divider>生成结果</a-divider>

              <a-tabs>
                <a-tab-pane
                  key="code"
                  tab="代码"
                >
                  <div class="code-header">
                    <a-space>
                      <a-button
                        size="small"
                        @click="copyCode(generateResult.code)"
                      >
                        <CopyOutlined /> 复制代码
                      </a-button>
                      <a-button
                        size="small"
                        @click="insertCode(generateResult.code)"
                      >
                        <FileAddOutlined /> 插入编辑器
                      </a-button>
                    </a-space>
                  </div>
                  <pre class="code-block"><code>{{ generateResult.code }}</code></pre>
                </a-tab-pane>

                <a-tab-pane
                  v-if="generateResult.tests"
                  key="tests"
                  tab="单元测试"
                >
                  <div class="code-header">
                    <a-button
                      size="small"
                      @click="copyCode(generateResult.tests)"
                    >
                      <CopyOutlined /> 复制测试
                    </a-button>
                  </div>
                  <pre class="code-block"><code>{{ generateResult.tests }}</code></pre>
                </a-tab-pane>
              </a-tabs>
            </div>
          </a-form>
        </a-tab-pane>

        <!-- 代码审查 -->
        <a-tab-pane
          key="review"
          tab="代码审查"
        >
          <a-form layout="vertical">
            <a-form-item label="待审查代码">
              <a-textarea
                v-model:value="reviewForm.code"
                placeholder="粘贴需要审查的代码"
                :rows="10"
              />
            </a-form-item>

            <a-form-item label="编程语言">
              <a-select
                v-model:value="reviewForm.language"
                style="width: 200px"
              >
                <a-select-option value="javascript">
                  JavaScript
                </a-select-option>
                <a-select-option value="typescript">
                  TypeScript
                </a-select-option>
                <a-select-option value="python">
                  Python
                </a-select-option>
                <a-select-option value="java">
                  Java
                </a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item>
              <a-button
                type="primary"
                :loading="reviewing"
                :icon="h(CheckCircleOutlined)"
                @click="handleReview"
              >
                开始审查
              </a-button>
            </a-form-item>

            <!-- 审查结果 -->
            <div
              v-if="reviewResult"
              class="result-section"
            >
              <a-divider>审查结果</a-divider>

              <a-alert
                :message="`代码评分: ${reviewResult.score}/10`"
                :type="reviewResult.score >= 8 ? 'success' : reviewResult.score >= 6 ? 'warning' : 'error'"
                show-icon
                style="margin-bottom: 16px"
              />

              <a-tabs>
                <a-tab-pane
                  key="suggestions"
                  tab="改进建议"
                >
                  <a-list
                    :data-source="reviewResult.suggestions"
                    bordered
                  >
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <a-list-item-meta>
                          <template #title>
                            <a-tag :color="getPriorityColor(item.priority)">
                              {{ item.priority }}
                            </a-tag>
                            {{ item.issue }}
                          </template>
                          <template #description>
                            <strong>建议:</strong> {{ item.advice }}
                          </template>
                        </a-list-item-meta>
                      </a-list-item>
                    </template>
                  </a-list>
                </a-tab-pane>

                <a-tab-pane
                  v-if="reviewResult.improvedCode"
                  key="improved"
                  tab="改进后的代码"
                >
                  <div class="code-header">
                    <a-button
                      size="small"
                      @click="copyCode(reviewResult.improvedCode)"
                    >
                      <CopyOutlined /> 复制改进代码
                    </a-button>
                  </div>
                  <pre class="code-block"><code>{{ reviewResult.improvedCode }}</code></pre>
                </a-tab-pane>
              </a-tabs>
            </div>
          </a-form>
        </a-tab-pane>

        <!-- 代码重构 -->
        <a-tab-pane
          key="refactor"
          tab="代码重构"
        >
          <a-form layout="vertical">
            <a-form-item label="待重构代码">
              <a-textarea
                v-model:value="refactorForm.code"
                placeholder="粘贴需要重构的代码"
                :rows="10"
              />
            </a-form-item>

            <a-row :gutter="16">
              <a-col :span="12">
                <a-form-item label="编程语言">
                  <a-select v-model:value="refactorForm.language">
                    <a-select-option value="javascript">
                      JavaScript
                    </a-select-option>
                    <a-select-option value="typescript">
                      TypeScript
                    </a-select-option>
                    <a-select-option value="python">
                      Python
                    </a-select-option>
                    <a-select-option value="java">
                      Java
                    </a-select-option>
                  </a-select>
                </a-form-item>
              </a-col>
              <a-col :span="12">
                <a-form-item label="重构类型">
                  <a-select v-model:value="refactorForm.type">
                    <a-select-option value="extract_function">
                      提取函数
                    </a-select-option>
                    <a-select-option value="rename_variables">
                      改进命名
                    </a-select-option>
                    <a-select-option value="simplify">
                      简化逻辑
                    </a-select-option>
                    <a-select-option value="optimize">
                      性能优化
                    </a-select-option>
                    <a-select-option value="modernize">
                      现代化语法
                    </a-select-option>
                    <a-select-option value="add_types">
                      添加类型注解
                    </a-select-option>
                  </a-select>
                </a-form-item>
              </a-col>
            </a-row>

            <a-form-item>
              <a-button
                type="primary"
                :loading="refactoring"
                :icon="h(ReloadOutlined)"
                @click="handleRefactor"
              >
                开始重构
              </a-button>
            </a-form-item>

            <!-- 重构结果 -->
            <div
              v-if="refactorResult"
              class="result-section"
            >
              <a-divider>重构结果</a-divider>

              <a-alert
                message="重构完成"
                description="代码已按要求重构，功能保持不变"
                type="success"
                show-icon
                style="margin-bottom: 16px"
              />

              <a-tabs>
                <a-tab-pane
                  key="original"
                  tab="原始代码"
                >
                  <pre class="code-block"><code>{{ refactorResult.originalCode }}</code></pre>
                </a-tab-pane>

                <a-tab-pane
                  key="refactored"
                  tab="重构后代码"
                >
                  <div class="code-header">
                    <a-button
                      size="small"
                      @click="copyCode(refactorResult.refactoredCode)"
                    >
                      <CopyOutlined /> 复制重构代码
                    </a-button>
                  </div>
                  <pre class="code-block"><code>{{ refactorResult.refactoredCode }}</code></pre>
                </a-tab-pane>

                <a-tab-pane
                  key="explanation"
                  tab="重构说明"
                >
                  <div style="white-space: pre-wrap; padding: 16px; background: #f5f5f5; border-radius: 4px;">
                    {{ refactorResult.explanation }}
                  </div>
                </a-tab-pane>
              </a-tabs>
            </div>
          </a-form>
        </a-tab-pane>
      </a-tabs>
    </a-card>
  </div>
</template>

<script setup>
import { logger, createLogger } from '@/utils/logger';

import { ref, h } from 'vue';
import { message } from 'ant-design-vue';
import {
  CodeOutlined,
  CheckCircleOutlined,
  ReloadOutlined,
  CopyOutlined,
  FileAddOutlined
} from '@ant-design/icons-vue';

const emit = defineEmits(['insert-code']);

// 当前Tab
const activeTab = ref('generate');

// 代码生成表单
const generateForm = ref({
  description: '',
  language: 'javascript',
  style: 'modern',
  options: ['comments']
});

const generating = ref(false);
const generateResult = ref(null);

// 代码审查表单
const reviewForm = ref({
  code: '',
  language: 'javascript'
});

const reviewing = ref(false);
const reviewResult = ref(null);

// 代码重构表单
const refactorForm = ref({
  code: '',
  language: 'javascript',
  type: 'simplify'
});

const refactoring = ref(false);
const refactorResult = ref(null);

/**
 * 生成代码
 */
async function handleGenerate() {
  if (!generateForm.value.description.trim()) {
    message.warning('请输入功能描述');
    return;
  }

  generating.value = true;
  generateResult.value = null;

  try {
    const result = await window.electronAPI.code.generate(
      generateForm.value.description,
      {
        language: generateForm.value.language,
        style: generateForm.value.style,
        includeTests: generateForm.value.options.includes('tests'),
        includeComments: generateForm.value.options.includes('comments')
      }
    );

    generateResult.value = result;
    message.success('代码生成成功！');

  } catch (error) {
    logger.error('代码生成失败:', error);
    message.error('代码生成失败: ' + error.message);
  } finally {
    generating.value = false;
  }
}

/**
 * 审查代码
 */
async function handleReview() {
  if (!reviewForm.value.code.trim()) {
    message.warning('请输入待审查的代码');
    return;
  }

  reviewing.value = true;
  reviewResult.value = null;

  try {
    const result = await window.electronAPI.code.review(
      reviewForm.value.code,
      reviewForm.value.language
    );

    reviewResult.value = result;
    message.success(`代码审查完成！评分: ${result.score}/10`);

  } catch (error) {
    logger.error('代码审查失败:', error);
    message.error('代码审查失败: ' + error.message);
  } finally {
    reviewing.value = false;
  }
}

/**
 * 重构代码
 */
async function handleRefactor() {
  if (!refactorForm.value.code.trim()) {
    message.warning('请输入待重构的代码');
    return;
  }

  refactoring.value = true;
  refactorResult.value = null;

  try {
    const result = await window.electronAPI.code.refactor(
      refactorForm.value.code,
      refactorForm.value.language,
      refactorForm.value.type
    );

    refactorResult.value = result;
    message.success('代码重构完成！');

  } catch (error) {
    logger.error('代码重构失败:', error);
    message.error('代码重构失败: ' + error.message);
  } finally {
    refactoring.value = false;
  }
}

/**
 * 复制代码
 */
async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    message.success('代码已复制到剪贴板');
  } catch (error) {
    message.error('复制失败');
  }
}

/**
 * 插入代码到编辑器
 */
function insertCode(code) {
  emit('insert-code', code);
  message.success('代码已插入编辑器');
}

/**
 * 获取优先级颜色
 */
function getPriorityColor(priority) {
  const colors = {
    high: 'red',
    medium: 'orange',
    low: 'blue'
  };
  return colors[priority] || 'default';
}

/**
 * 重置生成表单
 */
function resetGenerateForm() {
  generateForm.value = {
    description: '',
    language: 'javascript',
    style: 'modern',
    options: ['comments']
  };
  generateResult.value = null;
}
</script>

<style scoped>
.code-assistant-panel {
  padding: 16px;
}

.result-section {
  margin-top: 24px;
}

.code-header {
  margin-bottom: 8px;
  text-align: right;
}

.code-block {
  background: #f5f5f5;
  padding: 16px;
  border-radius: 4px;
  overflow-x: auto;
  max-height: 500px;
  overflow-y: auto;
}

.code-block code {
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  font-size: 13px;
  line-height: 1.6;
}
</style>
