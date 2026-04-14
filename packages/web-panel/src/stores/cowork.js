import { defineStore } from 'pinia'
import { ref, reactive, computed, watch } from 'vue'
import { useWsStore } from './ws.js'
import { useChatStore } from './chat.js'

/**
 * Default template definitions used as fallback when backend is unavailable.
 * The canonical source is cowork-task-templates.js on the backend;
 * use loadTemplates() to fetch them via WS.
 */
const DEFAULT_TEMPLATES = [
  { id: 'doc-convert', name: '文档格式转换', icon: 'FileTextOutlined', category: 'document', description: 'Word、Markdown、HTML、PDF 之间的格式互转', examples: ['把 report.docx 转成 PDF', '合并多个 Markdown 为一个文档'], acceptsFiles: true },
  { id: 'media-process', name: '音视频处理', icon: 'PlayCircleOutlined', category: 'media', description: '视频压缩、音频提取、格式转换、剪辑', examples: ['提取 MP4 的音频', '压缩视频到 50MB 以内'], acceptsFiles: true },
  { id: 'data-analysis', name: '数据分析', icon: 'BarChartOutlined', category: 'data', description: 'CSV/Excel 分析、统计、可视化图表', examples: ['分析 sales.csv 的月度趋势'], acceptsFiles: true },
  { id: 'web-research', name: '信息检索与调研', icon: 'SearchOutlined', category: 'research', description: '网页抓取、API 调用、多源信息汇总', examples: ['调研 AI Agent 框架对比'], acceptsFiles: false },
  { id: 'image-process', name: '图片处理', icon: 'PictureOutlined', category: 'media', description: '批量压缩、格式转换、加水印、OCR', examples: ['批量压缩到 500KB'], acceptsFiles: true },
  { id: 'code-helper', name: '代码辅助', icon: 'CodeOutlined', category: 'development', description: '生成脚本、调试代码、自动化任务', examples: ['写一个批量重命名脚本'], acceptsFiles: true },
  { id: 'system-admin', name: '系统运维', icon: 'DesktopOutlined', category: 'system', description: '磁盘分析、进程管理、日志分析', examples: ['查看磁盘使用情况'], acceptsFiles: false },
  { id: 'file-organize', name: '文件整理', icon: 'FolderOpenOutlined', category: 'file', description: '批量重命名、分类整理、查找重复', examples: ['按文件类型分类整理'], acceptsFiles: false },
  { id: 'network-tools', name: '网络工具', icon: 'GlobalOutlined', category: 'network', description: 'API 调试、网页抓取、网络诊断', examples: ['测试 API 接口'], acceptsFiles: false },
  { id: 'learning-assist', name: '学习辅助', icon: 'ReadOutlined', category: 'learning', description: '文档翻译、内容总结、论文分析', examples: ['翻译 PDF 摘要'], acceptsFiles: true },
]

export const useCoworkStore = defineStore('cowork', () => {
  const templates = ref(DEFAULT_TEMPLATES)
  const selectedTemplate = ref(null)
  const files = ref([])
  const isRunning = ref(false)
  const steps = ref([])
  const messages = ref([])
  const result = ref(null)
  const agentSessionId = ref(null)

  // Sync isRunning with chatStore.isLoading for session mode
  const chatStore = useChatStore()
  watch(
    () => chatStore.isLoading,
    (loading) => {
      if (!loading && agentSessionId.value) {
        isRunning.value = false
      }
    },
  )

  /** Pick a template (or null for free mode). */
  function selectTemplate(tpl) {
    selectedTemplate.value = tpl
    reset()
  }

  function reset() {
    steps.value = []
    messages.value = []
    result.value = null
    isRunning.value = false
    agentSessionId.value = null
  }

  function addFile(filePath) {
    if (!files.value.includes(filePath)) files.value.push(filePath)
  }

  function removeFile(filePath) {
    files.value = files.value.filter(f => f !== filePath)
  }

  /**
   * Load templates from backend via WS. Falls back to DEFAULT_TEMPLATES on error.
   */
  async function loadTemplates() {
    const wsStore = useWsStore()
    try {
      await wsStore.waitConnected(5000)
      const res = await wsStore.sendRaw({ type: 'cowork-templates' }, 10000)
      if (res?.templates?.length) {
        templates.value = res.templates
      }
    } catch (_err) {
      // Keep DEFAULT_TEMPLATES as fallback
    }
  }

  /**
   * Execute task via Agent session.
   * Uses the existing chat store's agent session mechanism with
   * a system prompt extension from the selected template.
   */
  async function execute(message) {
    isRunning.value = true

    // Template prompt injection happens server-side;
    // session mode only needs the template name for context
    const tpl = selectedTemplate.value
    let systemPromptExtension = ''
    if (tpl) {
      systemPromptExtension = `## 当前任务类型: ${tpl.name}\n${tpl.description || ''}`
    }

    // Build user message (only the actual user content + files)
    let userMessage = message
    if (files.value.length) {
      userMessage += `\n\n[用户提供的文件: ${files.value.join(', ')}]`
    }

    messages.value.push({ role: 'user', content: message, timestamp: Date.now() })

    // Build session options with system prompt extension + shell policy overrides
    const sessionOpts = { systemPromptExtension }
    if (tpl?.shellPolicyOverrides) {
      sessionOpts.shellPolicyOverrides = tpl.shellPolicyOverrides
    }

    // Create an agent session with system prompt extension injected server-side
    const sessionId = await chatStore.createSession('agent', sessionOpts)
    agentSessionId.value = sessionId
    await chatStore.sendMessage(sessionId, userMessage)
  }

  /**
   * Execute task via direct WS cowork-task message.
   * Uses the backend cowork-task-runner with SubAgentContext.
   * This is the preferred path — template prompt injection happens server-side.
   */
  async function executeDirectWs(message) {
    const wsStore = useWsStore()
    isRunning.value = true

    messages.value.push({ role: 'user', content: message, timestamp: Date.now() })

    try {
      await wsStore.waitConnected(8000)
      const res = await wsStore.sendRaw({
        type: 'cowork-task',
        templateId: selectedTemplate.value?.id || null,
        userMessage: message,
        files: files.value,
      }, 300000) // 5 min timeout for long-running tasks

      messages.value.push({
        role: 'assistant',
        content: res.summary || '(No output)',
        timestamp: Date.now(),
        toolsUsed: res.toolsUsed || [],
        iterationCount: res.iterationCount || 0,
      })
      result.value = res
    } catch (err) {
      messages.value.push({
        role: 'assistant',
        content: `Error: ${err.message}`,
        timestamp: Date.now(),
      })
    } finally {
      isRunning.value = false
    }
  }

  const currentAgentMessages = computed(() => {
    if (!agentSessionId.value) return []
    const chatStore = useChatStore()
    return chatStore.getMessages(agentSessionId.value)
  })

  const currentStreaming = computed(() => {
    if (!agentSessionId.value) return null
    const chatStore = useChatStore()
    const s = chatStore.streaming[agentSessionId.value]
    return s?.active ? s.content : null
  })

  const currentQuestion = computed(() => {
    if (!agentSessionId.value) return null
    const chatStore = useChatStore()
    return chatStore.pendingQuestion[agentSessionId.value] || null
  })

  function answerQuestion(answer) {
    if (!agentSessionId.value) return
    const chatStore = useChatStore()
    chatStore.answerQuestion(agentSessionId.value, answer)
  }

  async function sendFollowUp(message) {
    if (!agentSessionId.value) return
    const chatStore = useChatStore()
    messages.value.push({ role: 'user', content: message, timestamp: Date.now() })
    let fullMessage = message
    if (files.value.length) {
      fullMessage += `\n\n[用户提供的文件: ${files.value.join(', ')}]`
    }
    await chatStore.sendMessage(agentSessionId.value, fullMessage)
  }

  return {
    selectedTemplate, files, isRunning, steps, messages, result,
    agentSessionId,
    currentAgentMessages, currentStreaming, currentQuestion,
    selectTemplate, reset, addFile, removeFile,
    execute, executeDirectWs, sendFollowUp, answerQuestion,
    loadTemplates, templates,
  }
})
