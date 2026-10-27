export const productPages = {
  web: {
    doc: "cli-web-panel",
    zh: {
      name: "Web 版",
      title: "在浏览器里，打开你的 AI 工作台。",
      description:
        "用 cc ui 在本机启动浏览器工作台，使用 Cowork、AI 对话、技能、笔记与配置。",
      intro:
        "安装 CLI 后运行 cc ui，在浏览器里管理任务、笔记和工具。Cowork 提供常用任务模板，Agent 根据你的配置和权限执行操作，进度在页面中展示。",
      primary: "查看启动步骤",
      secondary: "Web 面板使用指南 ↗",
      section: "从日常任务，到持续工作的上下文。",
      features: [
        [
          "Cowork 协作",
          "从文档转换、数据分析、文件整理等任务模板开始，也可以直接描述需求。工具可用性取决于本机安装和权限。",
        ],
        [
          "AI 对话与 Agent",
          "管理会话、选择模型，并在对话和工具执行之间切换。连接云端模型时，请求会发送给你配置的服务商。",
        ],
        [
          "笔记与知识管理",
          "查看笔记、检索知识、管理记忆和个人数据。可用内容取决于当前工作区和数据源配置。",
        ],
        [
          "Skills 与 MCP",
          "查看技能、连接外部工具；工具执行继续使用当前工作区的权限设置。",
        ],
        [
          "任务与交付",
          "查看任务、后台 Agent 和产物入口，保留任务进度与操作记录。",
        ],
        [
          "模型与自进化设置",
          "在页面中管理模型服务与自进化开关。自进化默认关闭；开启后候选项发布仍需人工审核。",
        ],
      ],
      start: "安装一次，随后从浏览器进入。",
      startNote:
        "默认 HTTP 地址为 127.0.0.1:18810，WebSocket 端口为 18800；环境变量或启动参数可以修改它们。默认仅监听本机。远程访问需另外配置绑定地址与访问认证。",
      privacy:
        "面板服务运行在本机。使用本地模型或云端模型由你的配置决定，文件处理与第三方工具也可能访问网络。",
    },
    en: {
      name: "Web",
      title: "Your AI workbench, in a browser.",
      description:
        "Start cc ui locally to use Cowork, AI chat, skills, notes and configuration in your browser.",
      intro:
        "Install the CLI, run cc ui, and manage tasks, notes and tools from your browser. Cowork provides everyday task templates; the Agent works within your configured permissions and shows progress in the panel.",
      primary: "Get started",
      secondary: "Web panel guide ↗",
      section: "Everyday tasks, with context that stays with you.",
      features: [
        [
          "Cowork",
          "Start with document conversion, data analysis or file organization, or describe a custom task. Tools require the appropriate local installation and permissions.",
        ],
        [
          "AI chat and Agent",
          "Manage sessions, select models and use tools. Cloud model requests go to the provider you configure.",
        ],
        [
          "Notes and knowledge",
          "Browse notes, search knowledge and manage memory and personal data, depending on your workspace and configured sources.",
        ],
        [
          "Skills and MCP",
          "Discover skills and connect external tools. Execution uses the current workspace permissions.",
        ],
        [
          "Tasks and deliverables",
          "Open tasks, background Agents and artifact views to follow progress and operation records.",
        ],
        [
          "Models and evolution",
          "Manage model providers and the evolution switch. Evolution is off by default; publishing candidates still requires human review.",
        ],
      ],
      start: "Install once. Open the workbench in your browser.",
      startNote:
        "The default HTTP address is 127.0.0.1:18810 and the WebSocket port is 18800. Environment variables or launch options can change them. The default binding is local-only; remote access requires separate binding and authentication settings.",
      privacy:
        "The panel runs locally. Your configuration determines whether inference uses a local or cloud model; file processing and external tools may also access the network.",
    },
  },
  desktop: {
    doc: "desktop-model-governance",
    zh: {
      name: "桌面版",
      title: "把 AI、文件和工具，放在一个工作台里。",
      description:
        "ChainlessChain 桌面版支持 Windows、macOS 和 Linux，结合共享 Web Shell 与桌面宿主提供的本地能力。",
      intro:
        "默认 Web Shell 提供统一的任务和对话界面；桌面宿主连接本地文件、窗口、工具进程和可用硬件。你也可以按设置切回传统桌面界面。",
      primary: "下载桌面版",
      secondary: "桌面模型与权限指南 ↗",
      section: "围绕你的本地工作，组织 AI 能力。",
      features: [
        [
          "对话与任务",
          "在共享界面中使用对话、Cowork 和 Agent，管理任务过程及交付产物。模型使用你的服务配置。",
        ],
        [
          "本地文件与知识库",
          "围绕笔记、文档和项目组织资料。检索能力取决于本地索引和已连接的数据源。",
        ],
        [
          "可检查的执行过程",
          "按当前模式查看计划、工具调用和执行结果；敏感操作仍受配置的权限与审批规则约束。",
        ],
        [
          "技能与外部工具",
          "组合内置技能、MCP 服务器和本机工具，处理开发、写作与日常办公任务。",
        ],
        [
          "设备协作",
          "使用配对、远程控制和同步入口连接移动端。设备需在线，具体同步通道需单独配置。",
        ],
        [
          "本地模型与硬件",
          "可连接 Ollama 等本地模型；硬件签名取决于操作系统、驱动和设备支持。",
        ],
      ],
      start: "选择与你的系统和处理器匹配的安装包。",
      startNote:
        "安装后选择模型服务并配置工作区。CLI、IDE 扩展与桌面安装包分别发行；桌面版本号和 CLI 版本号不同。",
      privacy:
        "截图展示桌面默认采用的共享 Web Shell，由浏览器渲染实拍；桌面窗口、硬件签名与原生集成未在这些图中演示。",
    },
    en: {
      name: "Desktop",
      title: "AI, files and tools. One place to work.",
      description:
        "ChainlessChain Desktop supports Windows, macOS and Linux, combining the shared Web Shell with local desktop-host capabilities.",
      intro:
        "The default Web Shell brings tasks and chat into one interface. The desktop host connects local files, windows, tool processes and supported hardware. The traditional desktop interface remains available in settings.",
      primary: "Download Desktop",
      secondary: "Desktop model and permissions guide ↗",
      section: "AI capabilities, organized around your local work.",
      features: [
        [
          "Chat and tasks",
          "Use chat, Cowork and Agent views to follow work and deliverables. Models use your provider configuration.",
        ],
        [
          "Files and knowledge",
          "Organize notes, documents and projects. Search depends on local indexes and configured data sources.",
        ],
        [
          "Visible execution",
          "Review plans, tool calls and results where supported by the current mode. Sensitive operations follow configured permissions and approval rules.",
        ],
        [
          "Skills and tools",
          "Combine built-in skills, MCP servers and local tools for coding, writing and everyday work.",
        ],
        [
          "Device collaboration",
          "Pair with mobile devices for remote control and synchronization. Devices must be reachable and sync channels require configuration.",
        ],
        [
          "Local models and hardware",
          "Connect local models such as Ollama. Hardware signing depends on the OS, drivers and device support.",
        ],
      ],
      start: "Choose an installer for your operating system and processor.",
      startNote:
        "After installation, select a model provider and configure your workspace. The CLI, IDE extensions and desktop installers are separate releases with different version numbers.",
      privacy:
        "These are browser captures of the shared Web Shell used by Desktop by default. Native windows, hardware signing and desktop-host integrations are not demonstrated in these images.",
    },
  },
  mobile: {
    doc: "mobile-positioning",
    zh: {
      name: "移动版",
      title: "随身的个人助手，也能连接你的桌面。",
      description:
        "了解当前 Android 个人助手、知识采集、家庭功能、本地 CLI 与远程桌面入口，下载 Android APK 或 iOS ad-hoc IPA。",
      intro:
        "Android 已包含个人助手、知识采集、社交、按角色显示的家庭入口，以及本地 CLI 和配对后的远程终端。可以在手机处理本地资料，也可以连接在线桌面继续工作。",
      primary: "下载移动版",
      secondary: "移动端使用指南 ↗",
      section: "先处理手机上的事，再连接需要的设备。",
      features: [
        [
          "个人助手",
          "从底部「个人助手」进入对话与个人数据相关能力。可用数据和模型取决于你的权限与服务配置。",
        ],
        [
          "知识采集",
          "使用笔记、分享导入及拍照等入口收集资料。相机、麦克风和位置能力需设备支持并授予相应权限。",
        ],
        [
          "家庭与 AI 陪学",
          "家庭入口按家长或孩子角色显示，包含陪学、任务、积分与错题相关页面。",
        ],
        [
          "手机本地 CLI",
          "Android 内置运行时可在应用沙箱中运行 cc。离线可用范围取决于具体命令；云端推理和下载仍需联网。",
        ],
        [
          "配对与远程终端",
          "扫码配对后访问在线桌面的终端与已开放能力。远程 shell 的命令实际在配对设备上运行。",
        ],
        [
          "身份与设备安全",
          "管理 DID 和设备连接。StrongBox、硬件密钥与生物识别的可用性取决于设备。",
        ],
      ],
      start: "Android 选 APK；iOS 先确认设备已获授权。",
      startNote:
        "多数较新的 Android 手机选择 arm64-v8a，旧设备可选 armeabi-v7a，不确定架构时使用 universal。AAB 用于应用商店提交。iOS ad-hoc IPA 仅适用于签名描述文件内的设备；以下功能导览以 Android 为主，不代表两端功能完全一致。",
      privacy:
        "功能导览依据当前 Android 导航与页面源码整理，是示意图，不是真机截图。本次没有可连接设备，未将历史真机照片标作当前版本。",
    },
    en: {
      name: "Mobile",
      title: "A personal assistant that travels with you.",
      description:
        "Explore the current Android assistant, capture, family, local CLI and remote-desktop entry points; download Android APKs or the iOS ad-hoc IPA.",
      intro:
        "Android includes a personal assistant, knowledge capture, social features, role-based family navigation, a local CLI and a paired remote terminal. Work with local phone data or connect to an online desktop.",
      primary: "Download Mobile",
      secondary: "Mobile guide ↗",
      section: "Work on your phone. Connect other devices when needed.",
      features: [
        [
          "Personal assistant",
          "Use the assistant tab for chat and personal-data features, subject to your permissions and configured providers.",
        ],
        [
          "Knowledge capture",
          "Collect material through notes, shared content and camera entry points. Camera, microphone and location features require supported hardware and permission.",
        ],
        [
          "Family and AI study",
          "Parent and child roles control the family entry point, with study, tasks, rewards and mistake-book pages.",
        ],
        [
          "Local CLI on Android",
          "The bundled runtime runs cc inside the app sandbox. Offline availability depends on the command; cloud inference and downloads require a network.",
        ],
        [
          "Pairing and remote terminal",
          "Scan to pair and access a reachable desktop and its enabled capabilities. Remote shell commands run on the paired device.",
        ],
        [
          "Identity and device security",
          "Manage DIDs and device connections. StrongBox, hardware keys and biometrics depend on device support.",
        ],
      ],
      start:
        "Choose an Android APK. Check provisioning before installing on iOS.",
      startNote:
        "Use arm64-v8a for most recent Android phones, armeabi-v7a for older devices, or universal when unsure. AAB files are for store submission. The iOS ad-hoc IPA installs only on provisioned devices. This overview focuses on Android and does not imply identical features on both platforms.",
      privacy:
        "This feature map follows current Android navigation and screen source. It is an illustration, not a device screenshot. No device was connected for a new capture; historical device images are not presented as the current release.",
    },
  },
};
