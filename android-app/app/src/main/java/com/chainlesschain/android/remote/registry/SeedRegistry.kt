package com.chainlesschain.android.remote.registry

/**
 * 23 个 *Commands.kt 的 file-level 种子数据（来源：M1 [Android_REMOTE_commands_inventory.md]）。
 *
 * - 数量与 inventory 表对齐：23 entries，total methodCount = 795
 * - risk 取**每文件最高档**（mutating + privileged → Privileged；safe + mutating → Mutating；
 *   safe + privileged → Privileged）
 * - requiresApproval 默认从 risk 推导（Privileged 强 ApprovalUI）
 * - transport：ExtensionCommands → "extension-ws"（Chrome 扩展独立 WS 子系统），其余 → "handler-rpc"
 *
 * 桌面侧 mobile-skill-whitelist.js（M4 D2 落地）可下发更精细的 method-level metadata，
 * 由 [RemoteSkillRegistry.updateFromRemote] 合并；本 seed 仅作启动期 fallback。
 */
internal object SeedRegistry {

    val SKILLS: List<SkillMetadata> = listOf(
        SkillMetadata(
            namespace = "extension",
            displayName = "浏览器扩展",
            description = "Chrome 扩展：tab / cookie / storage / script 注入",
            category = "browser",
            risk = SkillRiskTag.Privileged,
            transport = "extension-ws",
            androidSourceFile = "ExtensionCommands.kt",
            methodCount = 95,
        ),
        SkillMetadata(
            namespace = "desktop",
            displayName = "远程桌面",
            description = "鼠键 / 窗口 / 剪贴板 / 屏幕画面",
            category = "control",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "DesktopCommands.kt",
            methodCount = 70,
        ),
        SkillMetadata(
            namespace = "media",
            displayName = "媒体控制",
            description = "音量 / 播放 / 录制 / 截屏",
            category = "ui",
            risk = SkillRiskTag.Mutating,
            androidSourceFile = "MediaCommands.kt",
            methodCount = 61,
        ),
        SkillMetadata(
            namespace = "knowledge",
            displayName = "知识库",
            description = "RAG / 笔记 CRUD / 检索",
            category = "data",
            risk = SkillRiskTag.Mutating,
            androidSourceFile = "KnowledgeCommands.kt",
            methodCount = 55,
        ),
        SkillMetadata(
            namespace = "network",
            displayName = "网络信息",
            description = "网络状态 / 接口 / DNS / 代理",
            category = "system",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "NetworkCommands.kt",
            methodCount = 53,
        ),
        SkillMetadata(
            namespace = "ai",
            displayName = "AI 对话",
            description = "LLM 对话 / RAG / agent / 多模态 / TTS / ASR",
            category = "ai",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "AICommands.kt",
            methodCount = 53,
        ),
        SkillMetadata(
            namespace = "system",
            displayName = "系统操作",
            description = "shutdown / restart / lock / sleep / env",
            category = "system",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "SystemCommands.kt",
            methodCount = 49,
        ),
        SkillMetadata(
            namespace = "file",
            displayName = "文件传输",
            description = "文件 CRUD + 分块上传下载 + 校验",
            category = "data",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "FileCommands.kt",
            methodCount = 45,
        ),
        SkillMetadata(
            namespace = "system.info",
            displayName = "系统信息",
            description = "只读系统信息：CPU / GPU / OS / BIOS",
            category = "system",
            risk = SkillRiskTag.Safe,
            androidSourceFile = "SystemInfoCommands.kt",
            methodCount = 42,
        ),
        SkillMetadata(
            namespace = "storage",
            displayName = "存储管理",
            description = "磁盘信息 + 分区 + SMART 监测",
            category = "system",
            risk = SkillRiskTag.Mutating,
            androidSourceFile = "StorageCommands.kt",
            methodCount = 41,
        ),
        SkillMetadata(
            namespace = "browser",
            displayName = "浏览器自动化",
            description = "Electron 内嵌 puppeteer-like 自动化",
            category = "browser",
            risk = SkillRiskTag.Mutating,
            androidSourceFile = "BrowserCommands.kt",
            methodCount = 40,
        ),
        SkillMetadata(
            namespace = "power",
            displayName = "电源管理",
            description = "电源 / 电池 / 散热 / 模式切换",
            category = "system",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "PowerCommands.kt",
            methodCount = 34,
        ),
        SkillMetadata(
            namespace = "process",
            displayName = "进程管理",
            description = "进程列表 / 启停 / 资源占用",
            category = "system",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "ProcessCommands.kt",
            methodCount = 30,
        ),
        SkillMetadata(
            namespace = "input",
            displayName = "输入模拟",
            description = "键鼠模拟 / 输入语言 / IME",
            category = "ui",
            risk = SkillRiskTag.Mutating,
            androidSourceFile = "InputCommands.kt",
            methodCount = 24,
        ),
        SkillMetadata(
            namespace = "workflow",
            displayName = "工作流",
            description = "桌面 Workflow run / status / 步骤回调",
            category = "infra",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "WorkflowCommands.kt",
            methodCount = 19,
        ),
        SkillMetadata(
            namespace = "userBrowser",
            displayName = "用户浏览器",
            description = "用户系统浏览器（Chrome / Edge）控制",
            category = "browser",
            risk = SkillRiskTag.Mutating,
            androidSourceFile = "UserBrowserCommands.kt",
            methodCount = 18,
        ),
        SkillMetadata(
            namespace = "device",
            displayName = "设备管理",
            description = "已配对设备 / pairing / 撤销",
            category = "infra",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "DeviceCommands.kt",
            methodCount = 12,
        ),
        SkillMetadata(
            namespace = "notification",
            displayName = "通知",
            description = "桌面通知发起 / 撤销 / 历史",
            category = "ui",
            risk = SkillRiskTag.Mutating,
            androidSourceFile = "NotificationCommands.kt",
            methodCount = 11,
        ),
        SkillMetadata(
            namespace = "display",
            displayName = "显示器",
            description = "多屏 / 分辨率 / 亮度 / 截屏",
            category = "system",
            risk = SkillRiskTag.Mutating,
            androidSourceFile = "DisplayCommands.kt",
            methodCount = 11,
        ),
        SkillMetadata(
            namespace = "clipboard",
            displayName = "剪贴板",
            description = "读写 / 历史 / 跨端 sync",
            category = "data",
            risk = SkillRiskTag.Mutating,
            androidSourceFile = "ClipboardCommands.kt",
            methodCount = 9,
        ),
        SkillMetadata(
            namespace = "app",
            displayName = "应用管理",
            description = "桌面已装 app 列表 / launch / focus",
            category = "control",
            risk = SkillRiskTag.Mutating,
            androidSourceFile = "ApplicationCommands.kt",
            methodCount = 8,
        ),
        SkillMetadata(
            namespace = "security",
            displayName = "安全",
            description = "DID 验签 / 设备指纹 / 权限查询",
            category = "infra",
            risk = SkillRiskTag.Privileged,
            androidSourceFile = "SecurityCommands.kt",
            methodCount = 8,
        ),
        SkillMetadata(
            namespace = "history",
            displayName = "命令历史",
            description = "RPC 调用历史 / 审计 / 撤销",
            category = "data",
            risk = SkillRiskTag.Safe,
            androidSourceFile = "HistoryCommands.kt",
            methodCount = 7,
        ),
    )

    /** sanity check: 23 entries with total methodCount 795（与 M1 inventory 表合计一致）。 */
    fun verifyCounts(): Boolean {
        return SKILLS.size == EXPECTED_FILE_COUNT &&
            SKILLS.sumOf { it.methodCount } == EXPECTED_METHOD_COUNT
    }

    const val EXPECTED_FILE_COUNT = 23
    const val EXPECTED_METHOD_COUNT = 795
}
