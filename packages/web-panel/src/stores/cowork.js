import { defineStore } from 'pinia'
import { ref, reactive, computed, watch } from 'vue'
import { useWsStore } from './ws.js'
import { useChatStore } from './chat.js'

/**
 * Task template definitions — mirrors cowork-task-templates.js on the backend.
 * Kept here for UI rendering (icons, examples, descriptions).
 */
export const TASK_TEMPLATES = [
  {
    id: 'doc-convert',
    name: '文档格式转换',
    icon: 'FileTextOutlined',
    category: 'document',
    description: 'Word、Markdown、HTML、PDF 之间的格式互转',
    examples: ['把 report.docx 转成 PDF', '合并多个 Markdown 为一个文档', '把 Excel 导出为 PDF'],
    acceptsFiles: true,
  },
  {
    id: 'media-process',
    name: '音视频处理',
    icon: 'PlayCircleOutlined',
    category: 'media',
    description: '视频压缩、音频提取、格式转换、剪辑',
    examples: ['提取 MP4 的音频', '压缩视频到 50MB 以内', '剪辑 10:30 到 25:00 的片段'],
    acceptsFiles: true,
  },
  {
    id: 'data-analysis',
    name: '数据分析',
    icon: 'BarChartOutlined',
    category: 'data',
    description: 'CSV/Excel 分析、统计、可视化图表',
    examples: ['分析 sales.csv 的月度趋势', '清洗数据去重修复格式', '比较两个 CSV 的差异'],
    acceptsFiles: true,
  },
  {
    id: 'web-research',
    name: '信息检索与调研',
    icon: 'SearchOutlined',
    category: 'research',
    description: '网页抓取、API 调用、多源信息汇总',
    examples: ['调研 AI Agent 框架对比', '查询实时汇率', '抓取网页内容并翻译'],
    acceptsFiles: false,
    shellPolicyOverrides: ['network-download'],
  },
  {
    id: 'image-process',
    name: '图片处理',
    icon: 'PictureOutlined',
    category: 'media',
    description: '批量压缩、格式转换、加水印、OCR',
    examples: ['批量压缩到 500KB', '加水印文字', '识别图上的文字 (OCR)'],
    acceptsFiles: true,
  },
  {
    id: 'code-helper',
    name: '代码辅助',
    icon: 'CodeOutlined',
    category: 'development',
    description: '生成脚本、调试代码、自动化任务',
    examples: ['写一个批量重命名脚本', '调试这段报错代码', '生成 REST API 脚手架'],
    acceptsFiles: true,
  },
  {
    id: 'system-admin',
    name: '系统运维',
    icon: 'DesktopOutlined',
    category: 'system',
    description: '磁盘分析、进程管理、日志分析',
    examples: ['查看磁盘使用情况', '找出最大的 10 个文件', '列出占用端口的进程'],
    acceptsFiles: false,
  },
  {
    id: 'file-organize',
    name: '文件整理',
    icon: 'FolderOpenOutlined',
    category: 'file',
    description: '批量重命名、分类整理、查找重复',
    examples: ['按文件类型分类整理', '批量重命名去空格', '打包排除 node_modules'],
    acceptsFiles: false,
  },
  {
    id: 'network-tools',
    name: '网络工具',
    icon: 'GlobalOutlined',
    category: 'network',
    description: 'API 调试、网页抓取、网络诊断',
    examples: ['测试 API 接口', '抓取网页图片链接', 'ping 测试网络延迟'],
    acceptsFiles: false,
    shellPolicyOverrides: ['network-download'],
  },
  {
    id: 'learning-assist',
    name: '学习辅助',
    icon: 'ReadOutlined',
    category: 'learning',
    description: '文档翻译、内容总结、论文分析',
    examples: ['翻译 PDF 摘要', '总结长文档要点', '解释代码工作原理'],
    acceptsFiles: true,
  },
]

export const useCoworkStore = defineStore('cowork', () => {
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
   * Auto-install & open-source-first instructions injected into every cowork agent prompt.
   * Prioritizes cli-anything registered tools > direct open-source CLI > Python libs.
   */
  const AUTO_INSTALL_PROMPT = `## 开源工具优先 + 自动安装规则

### 第一步: 检查 cli-anything 已注册技能
先执行 list_skills 查看是否已有 cli-anything-* 技能（如 cli-anything-ffmpeg、cli-anything-pandoc）。
如果有，优先用 run_skill 调用:
  run_skill cli-anything-ffmpeg "用户的自然语言需求"
cli-anything 会自动将自然语言翻译为正确的 CLI 命令，成功率更高。

### 第二步: 工具不存在时自动安装
当所需工具未安装时，直接自动安装，不要询问用户:
1. Python 包 (pandas/Pillow/pytesseract/...): run_code 的 auto-install 自动处理
2. npm 包: run_shell: npm install -g <package>
3. 系统级开源工具:
   - Windows: winget install <winget-id> --accept-package-agreements --accept-source-agreements
   - 备选: choco install <pkg> -y
   - macOS: brew install <pkg>
4. 安装后验证: <tool> --version
5. 只有在安装失败且无替代方案时才告知用户

### 第三步: 尝试注册为 cli-anything 技能
安装完底层工具后，尝试为其创建 cli-anything 包装器:
  run_shell: chainlesschain cli-anything register <tool> --force --json
如果成功，后续可用 run_skill cli-anything-<tool> 自然语言调用。
如果失败（如 cli-anything 未装），直接 run_shell 调用原始工具也可以。

### 工具优先级总结
cli-anything 已注册技能 > 直接调用开源工具 CLI > Python/Node 开源库 > 告知用户

### 常用开源工具速查
| 工具 | winget ID | 用途 |
| ffmpeg | Gyan.FFmpeg | 音视频处理 |
| pandoc | JohnMacFarlane.Pandoc | 文档格式转换 |
| LibreOffice | TheDocumentFoundation.LibreOffice | Office 文档 |
| Tesseract | UB-Mannheim.TesseractOCR | OCR 文字识别 |
| ImageMagick | ImageMagick.ImageMagick | 图片处理 |
| Ghostscript | ArtifexSoftware.GhostScript | PDF 处理 |
| 7-Zip | 7zip.7zip | 压缩解压 |
| GraphViz | Graphviz.Graphviz | 图表生成 |
| yt-dlp | yt-dlp.yt-dlp | 视频下载 |
| jq | jqlang.jq | JSON 处理 |
`

  /**
   * Execute task via Agent session.
   * Uses the existing chat store's agent session mechanism with
   * a system prompt extension from the selected template.
   */
  async function execute(message) {
    isRunning.value = true

    // Build system prompt extension from template + auto-install rules
    const tpl = selectedTemplate.value
    let systemPromptExtension = AUTO_INSTALL_PROMPT
    if (tpl) {
      systemPromptExtension += `\n\n## 当前任务类型: ${tpl.name}\n${tpl.description || ''}`
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
    TASK_TEMPLATES,
  }
})
