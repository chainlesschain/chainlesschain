import Foundation

/// 23 个 skill commands 的 file-level 种子数据 — Phase 3.1。
///
/// **来源**：与 Android `app/src/main/java/.../remote/registry/SeedRegistry.kt`
/// 1:1 翻译（commit `7613ea710` 时刻 393 LOC Android 文件）。逐字段对照确保两端
/// metadata 一致。改字段或加 entry 时**两端必须同步**。
///
/// **数量**：23 entries，total methodCount = 795，与 M1 [Android_REMOTE_commands_inventory.md]
/// 表合计一致。
///
/// **risk 取规则**：每文件最高档（mutating + privileged → Privileged；safe + mutating
/// → Mutating；safe + privileged → Privileged）。
///
/// **method-level metadata**：knowledge / ai 两个 namespace 含 sub-methods 列表
/// （细粒度 ApprovalUI 决策用）。
public enum SeedRegistry {

    public static let SKILLS: [SkillMetadata] = [
        SkillMetadata(
            namespace: "extension",
            displayName: "浏览器扩展",
            description: "Chrome 扩展：tab / cookie / storage / script 注入",
            category: "browser",
            risk: .Privileged,
            transport: "extension-ws",
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 95
        ),
        SkillMetadata(
            namespace: "desktop",
            displayName: "远程桌面",
            description: "鼠键 / 窗口 / 剪贴板 / 屏幕画面",
            category: "control",
            risk: .Privileged,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 70
        ),
        SkillMetadata(
            namespace: "media",
            displayName: "媒体控制",
            description: "音量 / 播放 / 录制 / 截屏",
            category: "ui",
            risk: .Mutating,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 61
        ),
        SkillMetadata(
            namespace: "knowledge",
            displayName: "知识库",
            description: "RAG / 笔记 CRUD / 检索 / 版本 / 归档 / 导入导出 — Phase 6.3 30 method 已 wired",
            category: "data",
            risk: .Mutating,
            nativeSourceFile: "KnowledgeCommands.swift",
            methodCount: 30,
            methods: [
                MethodMetadata(name: "createNote", description: "创建笔记（Markdown 内容 + 可选 folder/tags）",
                               paramCount: 4, paramSummary: "title, content, folderId?, tags?",
                               returnTypeHint: "CreateNoteResponse"),
                MethodMetadata(name: "updateNote", description: "更新笔记标题/内容/标签",
                               paramCount: 4, paramSummary: "noteId, title?, content?, tags?",
                               returnTypeHint: "UpdateNoteResponse"),
                MethodMetadata(name: "deleteNote", description: "删除笔记（不可逆）",
                               paramCount: 1, paramSummary: "noteId",
                               returnTypeHint: "DeleteNoteResponse",
                               riskOverride: .Privileged),
                MethodMetadata(name: "getNote", description: "按 ID 取单条笔记",
                               paramCount: 1, paramSummary: "noteId",
                               returnTypeHint: "Note",
                               riskOverride: .Safe),
                MethodMetadata(name: "searchNotes", description: "全文 + 标签搜索（只读）",
                               paramCount: 3, paramSummary: "query, limit, offset",
                               returnTypeHint: "SearchNotesResponse",
                               riskOverride: .Safe),
                MethodMetadata(name: "listFolders", description: "列出所有文件夹（树状）",
                               paramCount: 0, returnTypeHint: "FoldersResponse",
                               riskOverride: .Safe),
                MethodMetadata(name: "createFolder", description: "创建文件夹",
                               paramCount: 2, paramSummary: "name, parentId?",
                               returnTypeHint: "CreateFolderResponse"),
                MethodMetadata(name: "listTags", description: "列出所有标签",
                               paramCount: 0, returnTypeHint: "TagsResponse",
                               riskOverride: .Safe),
                MethodMetadata(name: "createTag", description: "创建标签",
                               paramCount: 2, paramSummary: "name, color?",
                               returnTypeHint: "CreateTagResponse"),
                MethodMetadata(name: "exportNote", description: "导出笔记为 markdown/html/pdf",
                               paramCount: 2, paramSummary: "noteId, format",
                               returnTypeHint: "ExportNoteResponse"),
            ]
        ),
        SkillMetadata(
            namespace: "network",
            displayName: "网络信息",
            description: "网络状态 / 接口 / DNS / 代理",
            category: "system",
            risk: .Privileged,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 53
        ),
        SkillMetadata(
            namespace: "ai",
            displayName: "AI 对话",
            description: "LLM 对话 / RAG / agent / 多模态 / TTS / ASR — Phase 5 + 6.4 共 37 method (chat 12 + extended 25)",
            category: "ai",
            risk: .Privileged,
            nativeSourceFile: "AIChatCommands.swift + AIExtendedCommands.swift",
            methodCount: 37,
            methods: [
                MethodMetadata(name: "chat", description: "LLM 对话（带 conversationId 维持上下文）",
                               paramCount: 5, paramSummary: "message, conversationId?, model?, systemPrompt?, temperature?",
                               returnTypeHint: "ChatResponse",
                               riskOverride: .Mutating),
                MethodMetadata(name: "chatStream", description: "流式 LLM 对话（返 streamId 后续 getStreamChunk）",
                               paramCount: 5, paramSummary: "message, conversationId?, model?, systemPrompt?, temperature?",
                               returnTypeHint: "StreamStartResponse",
                               riskOverride: .Mutating),
                MethodMetadata(name: "getModels", description: "列出桌面可用 LLM 模型（只读）",
                               paramCount: 0, returnTypeHint: "ModelsResponse",
                               riskOverride: .Safe),
                MethodMetadata(name: "getConversations", description: "查询历史对话（只读）",
                               paramCount: 3, paramSummary: "limit, offset, keyword?",
                               returnTypeHint: "ConversationsResponse",
                               riskOverride: .Safe),
                MethodMetadata(name: "deleteConversation", description: "删除会话（不可逆，含所有消息）",
                               paramCount: 1, paramSummary: "conversationId",
                               returnTypeHint: "DeleteConversationResponse",
                               riskOverride: .Privileged,
                               requiresApprovalOverride: true),
                MethodMetadata(name: "ragSearch", description: "RAG 知识库语义检索（只读）",
                               paramCount: 3, paramSummary: "query, topK, filters?",
                               returnTypeHint: "RAGSearchResponse",
                               riskOverride: .Safe),
                MethodMetadata(name: "ocrImage", description: "图片 OCR 文字识别",
                               paramCount: 2, paramSummary: "imageData(base64), language",
                               returnTypeHint: "OCRResponse",
                               riskOverride: .Mutating),
                MethodMetadata(name: "transcribeAudio", description: "音频转文字（语音识别）",
                               paramCount: 3, paramSummary: "audioData(base64), language, model?",
                               returnTypeHint: "TranscriptionResponse",
                               riskOverride: .Mutating),
                MethodMetadata(name: "textToSpeech", description: "文字转语音合成（返 base64 音频）",
                               paramCount: 4, paramSummary: "text, voice, speed, format",
                               returnTypeHint: "TTSResponse",
                               riskOverride: .Mutating),
                MethodMetadata(name: "controlAgent", description: "控制远端 Agent（start/stop/pause/resume）",
                               paramCount: 2, paramSummary: "action, agentId",
                               returnTypeHint: "AgentControlResponse",
                               requiresApprovalOverride: true),
            ]
        ),
        SkillMetadata(
            namespace: "system",
            displayName: "系统操作",
            description: "shutdown / restart / lock / sleep / env",
            category: "system",
            risk: .Privileged,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 49
        ),
        SkillMetadata(
            namespace: "file",
            displayName: "文件传输",
            description: "文件 CRUD + 分块上传下载 + 校验",
            category: "data",
            risk: .Privileged,
            nativeSourceFile: "FileCommands.swift",  // Phase 3.4 will implement
            methodCount: 45
        ),
        SkillMetadata(
            namespace: "system.info",
            displayName: "系统信息",
            description: "只读系统信息：CPU / GPU / OS / BIOS",
            category: "system",
            risk: .Safe,
            nativeSourceFile: "SystemInfoCommands.swift",  // Phase 3.5 will implement
            methodCount: 42
        ),
        SkillMetadata(
            namespace: "storage",
            displayName: "存储管理",
            description: "磁盘信息 + 分区 + SMART 监测",
            category: "system",
            risk: .Mutating,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 41
        ),
        SkillMetadata(
            namespace: "browser",
            displayName: "浏览器自动化",
            description: "Electron 内嵌 puppeteer-like 自动化",
            category: "browser",
            risk: .Mutating,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 40
        ),
        SkillMetadata(
            namespace: "power",
            displayName: "电源管理",
            description: "电源 / 电池 / 散热 / 模式切换",
            category: "system",
            risk: .Privileged,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 34
        ),
        SkillMetadata(
            namespace: "process",
            displayName: "进程管理",
            description: "进程列表 / 启停 / 资源占用",
            category: "system",
            risk: .Privileged,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 30
        ),
        SkillMetadata(
            namespace: "input",
            displayName: "输入模拟",
            description: "键鼠模拟 / 输入语言 / IME",
            category: "ui",
            risk: .Mutating,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 24
        ),
        SkillMetadata(
            namespace: "workflow",
            displayName: "工作流",
            description: "桌面 Workflow run / status / 步骤回调",
            category: "infra",
            risk: .Privileged,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 19
        ),
        SkillMetadata(
            namespace: "userBrowser",
            displayName: "用户浏览器",
            description: "用户系统浏览器（Chrome / Edge）控制",
            category: "browser",
            risk: .Mutating,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 18
        ),
        SkillMetadata(
            namespace: "device",
            displayName: "设备管理",
            description: "已配对设备 / pairing / 撤销",
            category: "infra",
            risk: .Privileged,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 12
        ),
        SkillMetadata(
            namespace: "notification",
            displayName: "通知",
            description: "桌面通知发起 / 撤销 / 历史",
            category: "ui",
            risk: .Mutating,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 11
        ),
        SkillMetadata(
            namespace: "display",
            displayName: "显示器",
            description: "多屏 / 分辨率 / 亮度 / 截屏",
            category: "system",
            risk: .Mutating,
            nativeSourceFile: "ScreenshotCommands.swift",  // Phase 3.5 will implement (display.screenshot)
            methodCount: 11
        ),
        SkillMetadata(
            namespace: "clipboard",
            displayName: "剪贴板",
            description: "读写 / 历史 / 跨端 sync",
            category: "data",
            risk: .Mutating,
            nativeSourceFile: "ClipboardCommands.swift",  // Phase 3.3 will implement
            methodCount: 9
        ),
        SkillMetadata(
            namespace: "app",
            displayName: "应用管理",
            description: "桌面已装 app 列表 / launch / focus",
            category: "control",
            risk: .Mutating,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 8
        ),
        SkillMetadata(
            namespace: "security",
            displayName: "安全",
            description: "DID 验签 / 设备指纹 / 权限查询",
            category: "infra",
            risk: .Privileged,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 8
        ),
        SkillMetadata(
            namespace: "history",
            displayName: "命令历史",
            description: "RPC 调用历史 / 审计 / 撤销",
            category: "data",
            risk: .Safe,
            nativeSourceFile: "NotImplementedYet.swift",
            methodCount: 7
        ),
    ]

    /// Sanity check：23 entries with total methodCount 795（与 M1 inventory 表合计一致）。
    public static func verifyCounts() -> Bool {
        SKILLS.count == EXPECTED_FILE_COUNT
            && SKILLS.reduce(0) { $0 + $1.methodCount } == EXPECTED_METHOD_COUNT
    }

    public static let EXPECTED_FILE_COUNT = 23
    public static let EXPECTED_METHOD_COUNT = 795
}
