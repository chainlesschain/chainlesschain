<template>
  <div class="enhanced-code-block">
    <div class="code-header">
      <span class="language-tag">{{ language || 'plaintext' }}</span>
      <div class="code-actions">
        <a-tooltip title="复制代码">
          <a-button
            type="text"
            size="small"
            :icon="copied ? h(CheckOutlined) : h(CopyOutlined)"
            @click="handleCopy"
          />
        </a-tooltip>
        <a-tooltip title="解释代码">
          <a-button
            type="text"
            size="small"
            :icon="h(BulbOutlined)"
            :loading="explaining"
            @click="handleExplain"
          />
        </a-tooltip>
        <a-tooltip
          v-if="isRunnable"
          title="运行代码"
        >
          <a-button
            type="text"
            size="small"
            :icon="h(PlayCircleOutlined)"
            :loading="running"
            @click="handleRun"
          />
        </a-tooltip>
      </div>
    </div>
    <pre class="code-content"><code
      :class="`language-${language}`"
      v-html="highlightedCode"
    /></pre>

    <!-- 代码解释抽屉 -->
    <a-drawer
      v-model:open="showExplanation"
      title="代码解释"
      placement="right"
      :width="500"
    >
      <div
        v-if="explanation"
        class="explanation-content"
      >
        <div v-html="renderMarkdown(explanation)" />
      </div>
      <div
        v-else-if="explaining"
        class="loading-container"
      >
        <a-spin tip="AI 正在分析代码..." />
      </div>
    </a-drawer>

    <!-- 运行结果模态框 -->
    <a-modal
      v-model:open="showResult"
      title="运行结果"
      :footer="null"
      width="700px"
    >
      <div
        v-if="runResult"
        class="run-result"
      >
        <div
          v-if="runResult.success"
          class="result-success"
        >
          <h4>✅ 运行成功</h4>
          <pre>{{ runResult.output }}</pre>
        </div>
        <div
          v-else
          class="result-error"
        >
          <h4>❌ 运行失败</h4>
          <pre>{{ runResult.error }}</pre>
        </div>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, computed, h } from 'vue';
import { message } from 'ant-design-vue';
import {
  CopyOutlined,
  CheckOutlined,
  BulbOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons-vue';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

const props = defineProps({
  code: {
    type: String,
    required: true,
  },
  language: {
    type: String,
    default: '',
  },
});

const copied = ref(false);
const explaining = ref(false);
const running = ref(false);
const showExplanation = ref(false);
const showResult = ref(false);
const explanation = ref('');
const runResult = ref(null);

// 语法高亮
const highlightedCode = computed(() => {
  if (!props.code) {return '';}

  try {
    if (props.language && hljs.getLanguage(props.language)) {
      return hljs.highlight(props.code, { language: props.language }).value;
    } else {
      return hljs.highlightAuto(props.code).value;
    }
  } catch (e) {
    console.error('代码高亮失败:', e);
    return props.code;
  }
});

// 判断是否可运行
const isRunnable = computed(() => {
  const runnableLanguages = ['javascript', 'js', 'python', 'py', 'bash', 'sh'];
  return runnableLanguages.includes(props.language?.toLowerCase());
});

// 复制代码
const handleCopy = async () => {
  try {
    await navigator.clipboard.writeText(props.code);
    copied.value = true;
    message.success('代码已复制到剪贴板');

    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (error) {
    console.error('复制失败:', error);
    message.error('复制失败');
  }
};

// 解释代码
const handleExplain = async () => {
  if (explaining.value) {return;}

  try {
    explaining.value = true;
    showExplanation.value = true;
    explanation.value = '';

    // 调用 LLM 解释代码
    const response = await window.electronAPI.llm.chat({
      messages: [
        {
          role: 'system',
          content: '你是一个专业的代码讲解助手。请用简洁明了的语言解释代码的功能、逻辑和关键点。',
        },
        {
          role: 'user',
          content: `请解释以下${props.language || ''}代码：\n\n\`\`\`${props.language}\n${props.code}\n\`\`\``,
        },
      ],
      enableRAG: false,
    });

    explanation.value = response.content || response.message?.content || '解释生成失败';
  } catch (error) {
    console.error('代码解释失败:', error);
    message.error('代码解释失败');
    showExplanation.value = false;
  } finally {
    explaining.value = false;
  }
};

// 运行代码
const handleRun = async () => {
  if (running.value) {return;}

  try {
    running.value = true;
    showResult.value = true;
    runResult.value = null;

    const lang = props.language?.toLowerCase();
    let command = '';

    // 根据语言构建执行命令
    if (lang === 'javascript' || lang === 'js') {
      // JavaScript: 使用 Node.js
      command = `node -e "${props.code.replace(/"/g, '\\"')}"`;
    } else if (lang === 'python' || lang === 'py') {
      // Python: 创建临时文件执行
      const tempFile = `temp_${Date.now()}.py`;
      await window.electronAPI.fs.writeFile(tempFile, props.code);
      command = `python ${tempFile}`;
    } else if (lang === 'bash' || lang === 'sh') {
      // Bash: 直接执行
      command = props.code;
    } else {
      throw new Error(`不支持运行 ${props.language} 代码`);
    }

    // 执行命令（需要添加相应的 IPC handler）
    // 注意：这里需要谨慎处理，避免安全问题
    const result = await window.electronAPI.system.executeCode({
      code: props.code,
      language: props.language,
    });

    runResult.value = result;
  } catch (error) {
    console.error('代码运行失败:', error);
    runResult.value = {
      success: false,
      error: error.message,
    };
  } finally {
    running.value = false;
  }
};

// 简单的 Markdown 渲染（与主页面保持一致）
const renderMarkdown = (content) => {
  if (!content) {return '';}

  return content
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/\n/g, '<br>');
};
</script>

<style scoped>
.enhanced-code-block {
  margin: 12px 0;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  overflow: hidden;
  background: #1e1e1e;
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #2d2d2d;
  border-bottom: 1px solid #3d3d3d;
}

.language-tag {
  font-size: 12px;
  color: #888;
  text-transform: uppercase;
  font-weight: 500;
}

.code-actions {
  display: flex;
  gap: 4px;
}

.code-actions :deep(.ant-btn) {
  color: #888;
}

.code-actions :deep(.ant-btn:hover) {
  color: #fff;
}

.code-content {
  margin: 0;
  padding: 16px;
  background: #1e1e1e;
  overflow-x: auto;
}

.code-content code {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.6;
  color: #d4d4d4;
}

.explanation-content {
  font-size: 14px;
  line-height: 1.8;
}

.explanation-content :deep(code) {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 13px;
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 40px;
}

.run-result {
  font-size: 14px;
}

.run-result pre {
  background: #f5f5f5;
  padding: 12px;
  border-radius: 4px;
  overflow-x: auto;
  margin-top: 8px;
}

.result-success h4 {
  color: #52c41a;
}

.result-error h4 {
  color: #ff4d4f;
}
</style>
