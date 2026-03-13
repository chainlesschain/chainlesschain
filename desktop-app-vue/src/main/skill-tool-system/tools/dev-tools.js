/**
 * dev-tools - Auto-generated from builtin-tools.js split
 * 23 tools
 */

module.exports = [
  {
    id: "tool_git_init",
    name: "git_init",
    display_name: "Git初始化",
    description: "初始化Git仓库",
    category: "version-control",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        repoPath: {
          type: "string",
          description: "仓库路径",
        },
        initialBranch: {
          type: "string",
          description: "初始分支名",
          default: "main",
        },
      },
      required: ["repoPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        repoPath: {
          type: "string",
        },
        branch: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "Git初始化基础用法",
        params: {
          repoPath: "./data/sample.dat",
          initialBranch: "main",
        },
      },
      {
        description: "Git初始化高级用法",
        params: {
          repoPath: "./advanced_data/sample.dat",
          initialBranch: "main",
        },
      },
    ],
    required_permissions: ["file:write", "git:init"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_git_commit",
    name: "git_commit",
    display_name: "Git提交",
    description: "提交Git更改",
    category: "version-control",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        repoPath: {
          type: "string",
          description: "仓库路径",
        },
        message: {
          type: "string",
          description: "提交信息",
        },
      },
      required: ["repoPath", "message"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        commitHash: {
          type: "string",
        },
        message: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "Git提交基础用法",
        params: {
          repoPath: "./data/sample.dat",
          message: "value",
        },
      },
      {
        description: "Git提交高级用法",
        params: {
          repoPath: "./advanced_data/sample.dat",
          message: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write", "git:commit"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_env_manager",
    name: "env_manager",
    display_name: "环境变量管理器",
    description: "读取、解析和管理.env文件",
    category: "config",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["read", "parse", "set", "delete", "list"],
          default: "read",
        },
        envPath: {
          type: "string",
          description: ".env文件路径",
          default: ".env",
        },
        key: {
          type: "string",
          description: "环境变量键名",
        },
        value: {
          type: "string",
          description: "环境变量值",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        variables: {
          type: "object",
        },
        count: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "环境变量管理器基础用法",
        params: {
          action: "read",
          envPath: "./data/sample.dat",
          key: "value",
          value: "value",
        },
      },
      {
        description: "环境变量管理器高级用法",
        params: {
          action: "parse",
          envPath: "./advanced_data/sample.dat",
          key: "advanced_value",
          value: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_template_renderer",
    name: "template_renderer",
    display_name: "模板渲染器",
    description: "使用变量渲染模板字符串",
    category: "template",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        template: {
          type: "string",
          description: "模板字符串",
        },
        variables: {
          type: "object",
          description: "变量对象",
        },
        syntax: {
          type: "string",
          description: "模板语法",
          enum: ["mustache", "handlebars", "ejs"],
          default: "mustache",
        },
      },
      required: ["template", "variables"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "模板渲染器基础用法",
        params: {
          template: "value",
          variables: "value",
          syntax: "mustache",
        },
      },
      {
        description: "模板渲染器高级用法",
        params: {
          template: "advanced_value",
          variables: "advanced_value",
          syntax: "handlebars",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_code_formatter",
    name: "code_formatter",
    display_name: "代码美化器",
    description: "格式化各种编程语言的代码",
    category: "code",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "要格式化的代码",
        },
        language: {
          type: "string",
          description: "编程语言",
          enum: ["javascript", "json", "html", "css", "sql", "python"],
          default: "javascript",
        },
        options: {
          type: "object",
          description: "格式化选项",
          properties: {
            indent: {
              type: "number",
              default: 2,
            },
            semicolons: {
              type: "boolean",
              default: true,
            },
          },
        },
      },
      required: ["code", "language"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        formatted: {
          type: "string",
        },
        language: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理简单代码",
        params: {
          code: "value",
          language: "javascript",
          options: "value",
        },
      },
      {
        description: "处理复杂项目",
        params: {
          code: "advanced_value",
          language: "json",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_toml_parser",
    name: "toml_parser",
    display_name: "TOML解析器",
    description: "解析和生成TOML配置文件",
    category: "config",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["parse", "stringify"],
          default: "parse",
        },
        toml: {
          type: "string",
          description: "TOML字符串",
        },
        data: {
          type: "object",
          description: "要转换为TOML的数据",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "any",
        },
      },
    },
    examples: [
      {
        description: "TOML解析器基础用法",
        params: {
          action: "parse",
          toml: "value",
          data: "value",
        },
      },
      {
        description: "TOML解析器高级用法",
        params: {
          action: "stringify",
          toml: "advanced_value",
          data: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_ini_parser",
    name: "ini_parser",
    display_name: "INI解析器",
    description: "解析和生成INI配置文件",
    category: "config",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["parse", "stringify"],
          default: "parse",
        },
        ini: {
          type: "string",
          description: "INI字符串",
        },
        data: {
          type: "object",
          description: "要转换为INI的数据",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "any",
        },
      },
    },
    examples: [
      {
        description: "INI解析器基础用法",
        params: {
          action: "parse",
          ini: "value",
          data: "value",
        },
      },
      {
        description: "INI解析器高级用法",
        params: {
          action: "stringify",
          ini: "advanced_value",
          data: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_gitdiff_parser",
    name: "gitdiff_parser",
    display_name: "Git Diff解析器",
    description: "解析Git diff输出",
    category: "version-control",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        diff: {
          type: "string",
          description: "Git diff输出",
        },
      },
      required: ["diff"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        files: {
          type: "array",
        },
        additions: {
          type: "number",
        },
        deletions: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "Git Diff解析器基础用法",
        params: {
          diff: "value",
        },
      },
      {
        description: "Git Diff解析器高级用法",
        params: {
          diff: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_log_parser",
    name: "log_parser",
    display_name: "日志解析器",
    description: "解析 Nginx、Apache、JSON 等格式的日志",
    category: "devops",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        logContent: {
          type: "string",
          description: "日志内容",
        },
        format: {
          type: "string",
          description: "日志格式",
          enum: ["nginx", "apache", "json", "syslog", "auto"],
        },
        filter: {
          type: "object",
          description: "过滤条件",
        },
      },
      required: ["logContent"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        entries: {
          type: "array",
          items: {
            type: "object",
            properties: {
              timestamp: {
                type: "string",
              },
              level: {
                type: "string",
              },
              message: {
                type: "string",
              },
              metadata: {
                type: "object",
              },
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "日志解析器基础用法",
        params: {
          logContent: "示例文本",
          format: "nginx",
          filter: "value",
        },
      },
      {
        description: "日志解析器高级用法",
        params: {
          logContent: "更复杂的示例文本内容，用于测试高级功能",
          format: "apache",
          filter: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_performance_profiler",
    name: "performance_profiler",
    display_name: "性能分析器",
    description: "分析代码执行性能，收集性能指标",
    category: "devops",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["start", "stop", "snapshot", "report"],
        },
        target: {
          type: "string",
          description: "分析目标",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        metrics: {
          type: "object",
          properties: {
            cpuUsage: {
              type: "number",
            },
            memoryUsage: {
              type: "number",
            },
            executionTime: {
              type: "number",
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "性能分析器基础用法",
        params: {
          action: "start",
          target: "value",
        },
      },
      {
        description: "性能分析器高级用法",
        params: {
          action: "stop",
          target: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:monitor"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_memory_monitor",
    name: "memory_monitor",
    display_name: "内存监控器",
    description: "监控内存使用情况，检测内存泄漏",
    category: "devops",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["snapshot", "compare", "heapdump"],
        },
        previousSnapshot: {
          type: "string",
          description: "之前的快照ID",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        snapshot: {
          type: "object",
          properties: {
            heapUsed: {
              type: "number",
            },
            heapTotal: {
              type: "number",
            },
            external: {
              type: "number",
            },
            rss: {
              type: "number",
            },
          },
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "内存监控器基础用法",
        params: {
          action: "snapshot",
          previousSnapshot: "value",
        },
      },
      {
        description: "内存监控器高级用法",
        params: {
          action: "compare",
          previousSnapshot: "advanced_value",
        },
      },
    ],
    required_permissions: ["system:monitor"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_workflow_executor",
    name: "workflow_executor",
    display_name: "工作流执行器",
    description: "执行定义好的工作流步骤",
    category: "automation",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        workflow: {
          type: "object",
          description: "工作流定义",
          properties: {
            steps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: {
                    type: "string",
                  },
                  tool: {
                    type: "string",
                  },
                  params: {
                    type: "object",
                  },
                  condition: {
                    type: "string",
                  },
                },
              },
            },
          },
        },
        context: {
          type: "object",
          description: "执行上下文",
        },
      },
      required: ["workflow"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        results: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "工作流执行器基础用法",
        params: {
          workflow: "value",
          context: "示例文本",
        },
      },
      {
        description: "工作流执行器高级用法",
        params: {
          workflow: "advanced_value",
          context: "更复杂的示例文本内容，用于测试高级功能",
        },
      },
    ],
    required_permissions: [],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_event_emitter",
    name: "event_emitter",
    display_name: "事件发射器",
    description: "发布订阅模式的事件系统",
    category: "automation",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["emit", "on", "off", "once"],
        },
        event: {
          type: "string",
          description: "事件名称",
        },
        data: {
          type: "any",
          description: "事件数据",
        },
        handler: {
          type: "string",
          description: "处理函数ID",
        },
      },
      required: ["action", "event"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "any",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "事件发射器基础用法",
        params: {
          action: "emit",
          event: "value",
          data: "value",
          handler: "value",
        },
      },
      {
        description: "事件发射器高级用法",
        params: {
          action: "on",
          event: "advanced_value",
          data: "advanced_value",
          handler: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_pipeline_builder",
    name: "pipeline_builder",
    display_name: "数据管道构建器",
    description: "构建和执行数据处理管道",
    category: "automation",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        pipeline: {
          type: "array",
          description: "管道步骤",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              transform: {
                type: "string",
              },
              params: {
                type: "object",
              },
            },
          },
        },
        input: {
          type: "any",
          description: "输入数据",
        },
      },
      required: ["pipeline", "input"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        output: {
          type: "any",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "数据管道构建器基础用法",
        params: {
          pipeline: ["item1", "item2"],
          input: "value",
        },
      },
      {
        description: "数据管道构建器高级用法",
        params: {
          pipeline: ["item1", "item2", "item3", "item4"],
          input: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_docker_manager",
    name: "docker_manager",
    display_name: "Docker管理器",
    description: "管理Docker容器、镜像、网络",
    category: "devops",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["list", "start", "stop", "remove", "create", "exec", "logs"],
        },
        resource: {
          type: "string",
          description: "资源类型",
          enum: ["container", "image", "network", "volume"],
        },
        id: {
          type: "string",
          description: "容器/镜像ID",
        },
        config: {
          type: "object",
          description: "创建配置",
        },
        command: {
          type: "string",
          description: "执行命令",
        },
      },
      required: ["action", "resource"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "any",
        },
        output: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "Docker管理器基础用法",
        params: {
          action: "list",
          resource: "container",
          id: "value",
          config: "value",
          command: "value",
        },
      },
      {
        description: "Docker管理器高级用法",
        params: {
          action: "start",
          resource: "image",
          id: "advanced_value",
          config: "advanced_value",
          command: "advanced_value",
        },
      },
    ],
    required_permissions: ["docker:access"],
    risk_level: 4,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_cron_scheduler",
    name: "cron_scheduler",
    display_name: "Cron调度器",
    description: "使用Cron表达式调度任务",
    category: "automation",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["schedule", "cancel", "list"],
        },
        cronExpression: {
          type: "string",
          description: "Cron表达式（如：0 0 * * *）",
        },
        taskId: {
          type: "string",
          description: "任务ID",
        },
        task: {
          type: "object",
          description: "任务定义",
        },
        timezone: {
          type: "string",
          description: "时区",
          default: "UTC",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        taskId: {
          type: "string",
        },
        nextRun: {
          type: "string",
        },
        tasks: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "Cron调度器基础用法",
        params: {
          action: "schedule",
          cronExpression: "value",
          taskId: "value",
          task: "value",
          timezone: "UTC",
        },
      },
      {
        description: "Cron调度器高级用法",
        params: {
          action: "cancel",
          cronExpression: "advanced_value",
          taskId: "advanced_value",
          task: "advanced_value",
          timezone: "UTC",
        },
      },
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_task_timer",
    name: "task_timer",
    display_name: "任务定时器",
    description: "延时执行任务、间隔执行",
    category: "automation",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["setTimeout", "setInterval", "clear"],
        },
        delay: {
          type: "number",
          description: "延迟时间（毫秒）",
        },
        interval: {
          type: "number",
          description: "间隔时间（毫秒）",
        },
        timerId: {
          type: "string",
          description: "定时器ID",
        },
        task: {
          type: "object",
          description: "要执行的任务",
        },
      },
      required: ["action"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        timerId: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "任务定时器基础用法",
        params: {
          action: "setTimeout",
          delay: 10,
          interval: 10,
          timerId: "value",
          task: "value",
        },
      },
      {
        description: "任务定时器高级用法",
        params: {
          action: "setInterval",
          delay: 50,
          interval: 50,
          timerId: "advanced_value",
          task: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_code_linter",
    name: "code_linter",
    display_name: "代码检查器",
    description: "代码质量和风格检查",
    category: "code",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "代码内容",
        },
        language: {
          type: "string",
          description: "编程语言",
          enum: ["javascript", "typescript", "python", "java", "go"],
        },
        rules: {
          type: "object",
          description: "检查规则配置",
        },
        fix: {
          type: "boolean",
          description: "是否自动修复",
          default: false,
        },
      },
      required: ["code", "language"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              line: {
                type: "number",
              },
              column: {
                type: "number",
              },
              severity: {
                type: "string",
              },
              message: {
                type: "string",
              },
              rule: {
                type: "string",
              },
            },
          },
        },
        fixedCode: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理简单代码",
        params: {
          code: "value",
          language: "javascript",
          rules: "value",
          fix: false,
        },
      },
      {
        description: "处理复杂项目",
        params: {
          code: "advanced_value",
          language: "typescript",
          rules: "advanced_value",
          fix: true,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_ast_parser",
    name: "ast_parser",
    display_name: "AST解析器",
    description: "解析代码为抽象语法树",
    category: "code",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "代码内容",
        },
        language: {
          type: "string",
          description: "编程语言",
          enum: ["javascript", "typescript", "python", "java"],
        },
        includeComments: {
          type: "boolean",
          description: "是否包含注释",
          default: false,
        },
      },
      required: ["code", "language"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        ast: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理简单代码",
        params: {
          code: "value",
          language: "javascript",
          includeComments: false,
        },
      },
      {
        description: "处理复杂项目",
        params: {
          code: "advanced_value",
          language: "typescript",
          includeComments: true,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_complexity_calculator",
    name: "complexity_calculator",
    display_name: "复杂度计算器",
    description: "计算代码圈复杂度、认知复杂度",
    category: "code",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "代码内容",
        },
        language: {
          type: "string",
          description: "编程语言",
          enum: ["javascript", "typescript", "python", "java"],
        },
        metrics: {
          type: "array",
          description: "要计算的指标",
          items: {
            type: "string",
            enum: ["cyclomatic", "cognitive", "halstead", "loc"],
          },
        },
      },
      required: ["code", "language"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        complexity: {
          type: "object",
          properties: {
            cyclomatic: {
              type: "number",
            },
            cognitive: {
              type: "number",
            },
            halstead: {
              type: "object",
            },
            loc: {
              type: "number",
            },
          },
        },
        functions: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理简单代码",
        params: {
          code: "value",
          language: "javascript",
          metrics: ["item1", "item2"],
        },
      },
      {
        description: "处理复杂项目",
        params: {
          code: "advanced_value",
          language: "typescript",
          metrics: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_test_generator",
    name: "test_generator",
    display_name: "测试用例生成器",
    description: "自动生成单元测试/集成测试代码",
    category: "code",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        sourcePath: {
          type: "string",
          description: "源代码路径",
        },
        testType: {
          type: "string",
          description: "测试类型",
          enum: ["unit", "integration", "e2e", "snapshot"],
        },
        framework: {
          type: "string",
          description: "测试框架",
          enum: ["jest", "mocha", "jasmine", "pytest", "junit"],
        },
        coverage_target: {
          type: "number",
          description: "目标覆盖率",
        },
        mocking: {
          type: "boolean",
          description: "是否生成mock",
        },
      },
      required: ["sourcePath", "testType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        testFiles: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: {
                type: "string",
              },
              tests_count: {
                type: "number",
              },
            },
          },
        },
        estimated_coverage: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理简单代码",
        params: {
          sourcePath: "./data/sample.dat",
          testType: "unit",
          framework: "jest",
          coverage_target: 10,
          mocking: false,
        },
      },
      {
        description: "处理复杂项目",
        params: {
          sourcePath: "./advanced_data/sample.dat",
          testType: "integration",
          framework: "mocha",
          coverage_target: 50,
          mocking: true,
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_test_runner",
    name: "test_runner",
    display_name: "测试执行器",
    description: "执行测试套件并生成报告",
    category: "code",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        testPath: {
          type: "string",
          description: "测试路径",
        },
        framework: {
          type: "string",
          description: "测试框架",
        },
        options: {
          type: "object",
          description: "运行选项",
          properties: {
            parallel: {
              type: "boolean",
            },
            coverage: {
              type: "boolean",
            },
            watch: {
              type: "boolean",
            },
            timeout: {
              type: "number",
            },
          },
        },
        filters: {
          type: "object",
          description: "过滤条件",
          properties: {
            pattern: {
              type: "string",
            },
            tags: {
              type: "array",
            },
          },
        },
      },
      required: ["testPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        results: {
          type: "object",
          properties: {
            total: {
              type: "number",
            },
            passed: {
              type: "number",
            },
            failed: {
              type: "number",
            },
            skipped: {
              type: "number",
            },
            duration: {
              type: "number",
            },
          },
        },
        coverage: {
          type: "object",
        },
        report_path: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "处理简单代码",
        params: {
          testPath: "./data/sample.dat",
          framework: "value",
          options: "value",
          filters: "value",
        },
      },
      {
        description: "处理复杂项目",
        params: {
          testPath: "./advanced_data/sample.dat",
          framework: "advanced_value",
          options: "advanced_value",
          filters: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_code_generator",
    name: "code_generator",
    display_name: "代码生成器 / Code Generator",
    description: "生成各类编程语言代码，支持函数、类、模块等多种代码结构",
    category: "code",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        codeSpec: {
          type: "object",
          description: "代码规格",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["codeSpec"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        data: {
          type: "object",
          description: "object",
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "处理简单代码",
        params: {
          codeSpec: "value",
          options: "value",
        },
      },
      {
        description: "处理复杂项目",
        params: {
          codeSpec: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["code:generate"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
];
