<template>
  <div class="code-generator">
    <a-card title="AI代码助手" :bordered="false">
      <a-tabs v-model:activeKey="activeTab">
        <!-- 代码生成 -->
        <a-tab-pane key="generate" tab="生成代码">
          <a-form :model="generateForm" layout="vertical">
            <a-form-item label="功能描述">
              <a-textarea
                v-model:value="generateForm.description"
                :rows="4"
                placeholder="描述你想要实现的功能,例如: 实现一个二分查找算法"
              />
            </a-form-item>

            <a-row :gutter="16">
              <a-col :span="12">
                <a-form-item label="编程语言">
                  <a-select v-model:value="generateForm.language">
                    <a-select-option value="javascript">JavaScript</a-select-option>
                    <a-select-option value="typescript">TypeScript</a-select-option>
                    <a-select-option value="python">Python</a-select-option>
                    <a-select-option value="java">Java</a-select-option>
                    <a-select-option value="cpp">C++</a-select-option>
                    <a-select-option value="go">Go</a-select-option>
                  </a-select>
                </a-form-item>
              </a-col>

              <a-col :span="12">
                <a-form-item label="框架 (可选)">
                  <a-input
                    v-model:value="generateForm.framework"
                    placeholder="例如: React, Vue, Django"
                  />
                </a-form-item>
              </a-col>
            </a-row>

            <a-form-item>
              <a-checkbox v-model:checked="generateForm.includeTests">
                生成单元测试
              </a-checkbox>
              <a-checkbox v-model:checked="generateForm.includeComments" style="margin-left: 16px">
                添加详细注释
              </a-checkbox>
            </a-form-item>

            <a-form-item>
              <a-button type="primary" @click="handleGenerate" :loading="generating">
                <code-outlined /> 生成代码
              </a-button>
            </a-form-item>
          </a-form>

          <!-- 生成的代码 -->
          <div v-if="generatedCode" class="code-result">
            <div class="result-header">
              <h4>生成的代码:</h4>
              <a-button size="small" @click="copyCode(generatedCode)">
                <copy-outlined /> 复制
              </a-button>
            </div>
            <pre><code>{{ generatedCode }}</code></pre>
          </div>

          <!-- 生成的测试 -->
          <div v-if="generatedTests" class="code-result">
            <div class="result-header">
              <h4>单元测试:</h4>
              <a-button size="small" @click="copyCode(generatedTests)">
                <copy-outlined /> 复制
              </a-button>
            </div>
            <pre><code>{{ generatedTests }}</code></pre>
          </div>
        </a-tab-pane>

        <!-- 代码审查 -->
        <a-tab-pane key="review" tab="代码审查">
          <a-form :model="reviewForm" layout="vertical">
            <a-form-item label="代码">
              <a-textarea
                v-model:value="reviewForm.code"
                :rows="10"
                placeholder="粘贴需要审查的代码"
              />
            </a-form-item>

            <a-form-item label="编程语言">
              <a-select v-model:value="reviewForm.language">
                <a-select-option value="javascript">JavaScript</a-select-option>
                <a-select-option value="typescript">TypeScript</a-select-option>
                <a-select-option value="python">Python</a-select-option>
                <a-select-option value="java">Java</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item>
              <a-button type="primary" @click="handleReview" :loading="reviewing">
                <eye-outlined /> 开始审查
              </a-button>
            </a-form-item>
          </a-form>

          <!-- 审查结果 -->
          <div v-if="reviewResult" class="review-result">
            <a-card>
              <template #title>
                <span>审查结果
                  <a-tag v-if="reviewResult.score" :color="getScoreColor(reviewResult.score)">
                    评分: {{ reviewResult.score }}/10
                  </a-tag>
                </span>
              </template>
              <div class="review-content" v-html="formatReview(reviewResult.review)"></div>
            </a-card>

            <!-- 改进建议 -->
            <a-card v-if="reviewResult.suggestions && reviewResult.suggestions.length > 0"
                    title="改进建议"
                    style="margin-top: 16px">
              <a-list :data-source="reviewResult.suggestions" size="small">
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
                        {{ item.advice }}
                      </template>
                    </a-list-item-meta>
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
          </div>
        </a-tab-pane>

        <!-- 代码重构 -->
        <a-tab-pane key="refactor" tab="代码重构">
          <a-form :model="refactorForm" layout="vertical">
            <a-form-item label="代码">
              <a-textarea
                v-model:value="refactorForm.code"
                :rows="10"
                placeholder="粘贴需要重构的代码"
              />
            </a-form-item>

            <a-row :gutter="16">
              <a-col :span="12">
                <a-form-item label="编程语言">
                  <a-select v-model:value="refactorForm.language">
                    <a-select-option value="javascript">JavaScript</a-select-option>
                    <a-select-option value="python">Python</a-select-option>
                    <a-select-option value="java">Java</a-select-option>
                  </a-select>
                </a-form-item>
              </a-col>

              <a-col :span="12">
                <a-form-item label="重构类型">
                  <a-select v-model:value="refactorForm.type">
                    <a-select-option value="extract_function">提取函数</a-select-option>
                    <a-select-option value="rename_variables">改进命名</a-select-option>
                    <a-select-option value="simplify">简化逻辑</a-select-option>
                    <a-select-option value="optimize">性能优化</a-select-option>
                    <a-select-option value="modernize">现代化</a-select-option>
                  </a-select>
                </a-form-item>
              </a-col>
            </a-row>

            <a-form-item>
              <a-button type="primary" @click="handleRefactor" :loading="refactoring">
                <thunderbolt-outlined /> 开始重构
              </a-button>
            </a-form-item>
          </a-form>

          <!-- 重构结果 -->
          <div v-if="refactorResult" class="refactor-result">
            <a-row :gutter="16">
              <a-col :span="12">
                <a-card title="原始代码" size="small">
                  <pre><code>{{ refactorResult.originalCode }}</code></pre>
                </a-card>
              </a-col>
              <a-col :span="12">
                <a-card title="重构后代码" size="small">
                  <a-button size="small" @click="copyCode(refactorResult.refactoredCode)" style="float: right;">
                    <copy-outlined /> 复制
                  </a-button>
                  <pre><code>{{ refactorResult.refactoredCode }}</code></pre>
                </a-card>
              </a-col>
            </a-row>

            <a-card title="重构说明" style="margin-top: 16px">
              <div v-html="formatExplanation(refactorResult.explanation)"></div>
            </a-card>
          </div>
        </a-tab-pane>

        <!-- Bug修复 -->
        <a-tab-pane key="fix" tab="Bug修复">
          <a-form :model="fixForm" layout="vertical">
            <a-form-item label="有问题的代码">
              <a-textarea
                v-model:value="fixForm.code"
                :rows="10"
                placeholder="粘贴有Bug的代码"
              />
            </a-form-item>

            <a-form-item label="错误信息 (可选)">
              <a-textarea
                v-model:value="fixForm.errorMessage"
                :rows="3"
                placeholder="粘贴错误信息,帮助AI更好地定位问题"
              />
            </a-form-item>

            <a-form-item label="编程语言">
              <a-select v-model:value="fixForm.language">
                <a-select-option value="javascript">JavaScript</a-select-option>
                <a-select-option value="python">Python</a-select-option>
                <a-select-option value="java">Java</a-select-option>
              </a-select>
            </a-form-item>

            <a-form-item>
              <a-button type="primary" @click="handleFix" :loading="fixing">
                <tool-outlined /> 修复Bug
              </a-button>
            </a-form-item>
          </a-form>

          <!-- 修复结果 -->
          <div v-if="fixResult" class="fix-result">
            <a-card title="修复后的代码">
              <a-button size="small" @click="copyCode(fixResult.fixedCode)" style="float: right;">
                <copy-outlined /> 复制
              </a-button>
              <pre><code>{{ fixResult.fixedCode }}</code></pre>
            </a-card>

            <a-card title="问题分析和修复说明" style="margin-top: 16px">
              <div v-html="formatAnalysis(fixResult.analysis)"></div>
            </a-card>
          </div>
        </a-tab-pane>
      </a-tabs>

      <!-- 加载状态 -->
      <a-spin v-if="generating || reviewing || refactoring || fixing"
              tip="AI正在处理中..."
              style="margin-top: 24px; width: 100%;" />
    </a-card>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import {
  CodeOutlined,
  CopyOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  ToolOutlined
} from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'

const activeTab = ref('generate')
const generating = ref(false)
const reviewing = ref(false)
const refactoring = ref(false)
const fixing = ref(false)

const generatedCode = ref('')
const generatedTests = ref('')
const reviewResult = ref(null)
const refactorResult = ref(null)
const fixResult = ref(null)

const generateForm = reactive({
  description: '',
  language: 'javascript',
  framework: '',
  includeTests: false,
  includeComments: true
})

const reviewForm = reactive({
  code: '',
  language: 'javascript'
})

const refactorForm = reactive({
  code: '',
  language: 'javascript',
  type: 'simplify'
})

const fixForm = reactive({
  code: '',
  errorMessage: '',
  language: 'javascript'
})

// 生成代码
const handleGenerate = async () => {
  if (!generateForm.description.trim()) {
    message.warning('请输入功能描述')
    return
  }

  generating.value = true
  generatedCode.value = ''
  generatedTests.value = ''

  try {
    const response = await window.electron.ipcRenderer.invoke('code:generate',
      generateForm.description,
      {
        language: generateForm.language,
        framework: generateForm.framework || null,
        includeTests: generateForm.includeTests,
        includeComments: generateForm.includeComments
      }
    )

    if (response.success) {
      generatedCode.value = response.code
      if (response.tests) {
        generatedTests.value = response.tests
      }
      message.success('代码生成成功！')
    }
  } catch (error) {
    message.error('代码生成失败: ' + error.message)
  } finally {
    generating.value = false
  }
}

// 代码审查
const handleReview = async () => {
  if (!reviewForm.code.trim()) {
    message.warning('请输入需要审查的代码')
    return
  }

  reviewing.value = true
  reviewResult.value = null

  try {
    const response = await window.electron.ipcRenderer.invoke('code:review',
      reviewForm.code,
      reviewForm.language
    )

    if (response.success) {
      reviewResult.value = response
      message.success('代码审查完成！')
    }
  } catch (error) {
    message.error('代码审查失败: ' + error.message)
  } finally {
    reviewing.value = false
  }
}

// 代码重构
const handleRefactor = async () => {
  if (!refactorForm.code.trim()) {
    message.warning('请输入需要重构的代码')
    return
  }

  refactoring.value = true
  refactorResult.value = null

  try {
    const response = await window.electron.ipcRenderer.invoke('code:refactor',
      refactorForm.code,
      refactorForm.language,
      refactorForm.type
    )

    if (response.success) {
      refactorResult.value = response
      message.success('代码重构完成！')
    }
  } catch (error) {
    message.error('代码重构失败: ' + error.message)
  } finally {
    refactoring.value = false
  }
}

// 修复Bug
const handleFix = async () => {
  if (!fixForm.code.trim()) {
    message.warning('请输入有问题的代码')
    return
  }

  fixing.value = true
  fixResult.value = null

  try {
    const response = await window.electron.ipcRenderer.invoke('code:fixBug',
      fixForm.code,
      fixForm.language,
      fixForm.errorMessage || null
    )

    if (response.success) {
      fixResult.value = response
      message.success('Bug修复完成！')
    }
  } catch (error) {
    message.error('Bug修复失败: ' + error.message)
  } finally {
    fixing.value = false
  }
}

// 复制代码
const copyCode = async (code) => {
  try {
    await navigator.clipboard.writeText(code)
    message.success('代码已复制到剪贴板')
  } catch (error) {
    message.error('复制失败')
  }
}

// 格式化审查结果
const formatReview = (text) => {
  return text.replace(/\n/g, '<br>').replace(/##/g, '<h4>').replace(/\*\*/g, '<strong>')
}

// 格式化说明
const formatExplanation = (text) => {
  return text.replace(/\n/g, '<br>')
}

// 格式化分析
const formatAnalysis = (text) => {
  return text.replace(/\n/g, '<br>')
}

// 获取评分颜色
const getScoreColor = (score) => {
  if (score >= 8) return 'green'
  if (score >= 6) return 'orange'
  return 'red'
}

// 获取优先级颜色
const getPriorityColor = (priority) => {
  if (priority === 'high') return 'red'
  if (priority === 'medium') return 'orange'
  return 'blue'
}
</script>

<style scoped>
.code-generator {
  padding: 16px;
}

.code-result {
  margin-top: 24px;
  padding: 16px;
  background: #f5f5f5;
  border-radius: 4px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.result-header h4 {
  margin: 0;
}

pre {
  background: #282c34;
  color: #abb2bf;
  padding: 16px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 0;
}

code {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.5;
}

.review-result,
.refactor-result,
.fix-result {
  margin-top: 24px;
}

.review-content {
  line-height: 1.8;
}
</style>
