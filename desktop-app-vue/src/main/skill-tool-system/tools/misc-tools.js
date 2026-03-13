/**
 * misc-tools - Auto-generated from builtin-tools.js split
 * 34 tools
 */

module.exports = [
  {
    id: "tool_create_project_structure",
    name: "create_project_structure",
    display_name: "项目结构创建",
    description: "创建标准项目目录结构",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectName: {
          type: "string",
          description: "项目名称",
        },
        projectType: {
          type: "string",
          description: "项目类型",
          enum: ["web", "blog", "simple"],
        },
        outputPath: {
          type: "string",
          description: "输出路径",
        },
      },
      required: ["projectName", "projectType", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        projectPath: {
          type: "string",
        },
        createdFiles: {
          type: "array",
        },
      },
    },
    examples: [
      {
        description: "项目结构创建基础用法",
        params: {
          projectName: "value",
          projectType: "web",
          outputPath: "./output/result.json",
        },
      },
      {
        description: "项目结构创建高级用法",
        params: {
          projectName: "advanced_value",
          projectType: "blog",
          outputPath: "./advanced_output/result.json",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_datetime_handler",
    name: "datetime_handler",
    display_name: "日期时间处理器",
    description: "格式化、解析和计算日期时间",
    category: "utility",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["format", "parse", "add", "subtract", "diff"],
        },
        date: {
          type: "string",
          description: "日期字符串或时间戳",
        },
        format: {
          type: "string",
          description: "日期格式",
          default: "YYYY-MM-DD HH:mm:ss",
        },
        amount: {
          type: "number",
          description: "添加/减少的数量",
        },
        unit: {
          type: "string",
          description: "时间单位",
          enum: ["year", "month", "day", "hour", "minute", "second"],
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
          type: "string",
        },
        timestamp: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "日期时间处理器基础用法",
        params: {
          action: "format",
          date: "value",
          format: "YYYY-MM-DD HH:mm:ss",
          amount: 10,
          unit: "year",
        },
      },
      {
        description: "日期时间处理器高级用法",
        params: {
          action: "parse",
          date: "advanced_value",
          format: "YYYY-MM-DD HH:mm:ss",
          amount: 50,
          unit: "month",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_color_converter",
    name: "color_converter",
    display_name: "颜色转换器",
    description: "转换颜色格式（HEX, RGB, HSL等）",
    category: "utility",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        color: {
          type: "string",
          description: "颜色值",
        },
        from: {
          type: "string",
          description: "源格式",
          enum: ["hex", "rgb", "hsl", "hsv"],
        },
        to: {
          type: "string",
          description: "目标格式",
          enum: ["hex", "rgb", "hsl", "hsv", "all"],
        },
      },
      required: ["color", "from", "to"],
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
        hex: {
          type: "string",
        },
        rgb: {
          type: "object",
        },
        hsl: {
          type: "object",
        },
      },
    },
    examples: [
      {
        description: "颜色转换器基础用法",
        params: {
          color: "value",
          from: "hex",
          to: "hex",
        },
      },
      {
        description: "颜色转换器高级用法",
        params: {
          color: "advanced_value",
          from: "rgb",
          to: "rgb",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_random_generator",
    name: "random_generator",
    display_name: "随机数据生成器",
    description: "生成随机数、字符串、UUID等",
    category: "utility",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "数据类型",
          enum: ["number", "string", "uuid", "boolean", "date", "color"],
        },
        count: {
          type: "number",
          description: "生成数量",
          default: 1,
        },
        options: {
          type: "object",
          description: "生成选项",
          properties: {
            min: {
              type: "number",
            },
            max: {
              type: "number",
            },
            length: {
              type: "number",
            },
            charset: {
              type: "string",
            },
          },
        },
      },
      required: ["type"],
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
        count: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "随机数据生成器基础用法",
        params: {
          type: "number",
          count: 10,
          options: "value",
        },
      },
      {
        description: "随机数据生成器高级用法",
        params: {
          type: "string",
          count: 50,
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
    id: "tool_cron_parser",
    name: "cron_parser",
    display_name: "Cron表达式解析器",
    description: "解析和生成Cron表达式",
    category: "utility",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["parse", "generate", "next"],
          default: "parse",
        },
        expression: {
          type: "string",
          description: "Cron表达式",
        },
        description: {
          type: "string",
          description: "时间描述（用于生成）",
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
        description: {
          type: "string",
        },
        nextRun: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "Cron表达式解析器基础用法",
        params: {
          action: "parse",
          expression: "value",
          description: "value",
        },
      },
      {
        description: "Cron表达式解析器高级用法",
        params: {
          action: "generate",
          expression: "advanced_value",
          description: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_version_comparator",
    name: "version_comparator",
    display_name: "版本号比较器",
    description: "Semver版本号比较和验证",
    category: "utility",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["compare", "validate", "bump", "parse"],
          default: "compare",
        },
        version1: {
          type: "string",
          description: "第一个版本号",
        },
        version2: {
          type: "string",
          description: "第二个版本号",
        },
        bumpType: {
          type: "string",
          description: "升级类型",
          enum: ["major", "minor", "patch"],
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
        comparison: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "版本号比较器基础用法",
        params: {
          action: "compare",
          version1: "value",
          version2: "value",
          bumpType: "major",
        },
      },
      {
        description: "版本号比较器高级用法",
        params: {
          action: "validate",
          version1: "advanced_value",
          version2: "advanced_value",
          bumpType: "minor",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_geocoder",
    name: "geocoder",
    display_name: "地理编码器",
    description: "地址和坐标互相转换",
    category: "location",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["geocode", "reverse"],
        },
        address: {
          type: "string",
          description: "地址（正向编码）",
        },
        latitude: {
          type: "number",
          description: "纬度（反向编码）",
        },
        longitude: {
          type: "number",
          description: "经度（反向编码）",
        },
        provider: {
          type: "string",
          description: "服务提供商",
          enum: ["google", "baidu", "amap"],
          default: "google",
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
        latitude: {
          type: "number",
        },
        longitude: {
          type: "number",
        },
        address: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "地理编码器基础用法",
        params: {
          action: "geocode",
          address: "value",
          latitude: 10,
          longitude: 10,
          provider: "google",
        },
      },
      {
        description: "地理编码器高级用法",
        params: {
          action: "reverse",
          address: "advanced_value",
          latitude: 50,
          longitude: 50,
          provider: "baidu",
        },
      },
    ],
    required_permissions: ["network:http"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_distance_calculator",
    name: "distance_calculator",
    display_name: "距离计算器",
    description: "计算两点间距离（支持多种算法）",
    category: "location",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        point1: {
          type: "object",
          description: "起点坐标",
          properties: {
            latitude: {
              type: "number",
            },
            longitude: {
              type: "number",
            },
          },
        },
        point2: {
          type: "object",
          description: "终点坐标",
          properties: {
            latitude: {
              type: "number",
            },
            longitude: {
              type: "number",
            },
          },
        },
        algorithm: {
          type: "string",
          description: "计算算法",
          enum: ["haversine", "vincenty"],
          default: "haversine",
        },
        unit: {
          type: "string",
          description: "距离单位",
          enum: ["km", "mi", "m"],
          default: "km",
        },
      },
      required: ["point1", "point2"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        distance: {
          type: "number",
        },
        unit: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "距离计算器基础用法",
        params: {
          point1: "value",
          point2: "value",
          algorithm: "haversine",
          unit: "km",
        },
      },
      {
        description: "距离计算器高级用法",
        params: {
          point1: "advanced_value",
          point2: "advanced_value",
          algorithm: "vincenty",
          unit: "mi",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_coordinate_converter",
    name: "coordinate_converter",
    display_name: "坐标转换器",
    description: "不同坐标系统间转换（WGS84、GCJ02、BD09）",
    category: "location",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        latitude: {
          type: "number",
          description: "纬度",
        },
        longitude: {
          type: "number",
          description: "经度",
        },
        from: {
          type: "string",
          description: "源坐标系",
          enum: ["WGS84", "GCJ02", "BD09"],
        },
        to: {
          type: "string",
          description: "目标坐标系",
          enum: ["WGS84", "GCJ02", "BD09"],
        },
      },
      required: ["latitude", "longitude", "from", "to"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        latitude: {
          type: "number",
        },
        longitude: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "坐标转换器基础用法",
        params: {
          latitude: 10,
          longitude: 10,
          from: "WGS84",
          to: "WGS84",
        },
      },
      {
        description: "坐标转换器高级用法",
        params: {
          latitude: 50,
          longitude: 50,
          from: "GCJ02",
          to: "GCJ02",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_qrcode_generator_advanced",
    name: "qrcode_generator_advanced",
    display_name: "高级二维码生成器",
    description: "生成自定义样式的二维码",
    category: "utility",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "二维码内容",
        },
        output_path: {
          type: "string",
          description: "输出图片路径",
        },
        size: {
          type: "number",
          description: "尺寸(像素)",
          default: 256,
        },
        error_correction: {
          type: "string",
          description: "容错级别",
          enum: ["L", "M", "Q", "H"],
        },
        style: {
          type: "object",
          description: "样式配置",
          properties: {
            foreground_color: {
              type: "string",
            },
            background_color: {
              type: "string",
            },
            logo_path: {
              type: "string",
            },
            logo_size_ratio: {
              type: "number",
            },
          },
        },
        format: {
          type: "string",
          description: "输出格式",
          enum: ["png", "jpg", "svg"],
        },
      },
      required: ["content", "output_path"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        qrcode_path: {
          type: "string",
        },
        size: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "高级二维码生成器基础用法",
        params: {
          content: "示例文本",
          output_path: "./output/result.json",
          size: 10,
          error_correction: "L",
          style: "value",
          format: "png",
        },
      },
      {
        description: "高级二维码生成器高级用法",
        params: {
          content: "更复杂的示例文本内容，用于测试高级功能",
          output_path: "./advanced_output/result.json",
          size: 50,
          error_correction: "M",
          style: "advanced_value",
          format: "jpg",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_qrcode_scanner",
    name: "qrcode_scanner",
    display_name: "二维码扫描器",
    description: "识别图片中的二维码/条形码",
    category: "utility",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        image_path: {
          type: "string",
          description: "图片路径或URL",
        },
        scan_type: {
          type: "string",
          description: "扫描类型",
          enum: ["qrcode", "barcode", "auto"],
        },
        multiple: {
          type: "boolean",
          description: "识别多个码",
        },
      },
      required: ["image_path"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        codes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
              },
              data: {
                type: "string",
              },
              position: {
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
        description: "二维码扫描器基础用法",
        params: {
          image_path: "./data/sample.dat",
          scan_type: "qrcode",
          multiple: false,
        },
      },
      {
        description: "二维码扫描器高级用法",
        params: {
          image_path: "./advanced_data/sample.dat",
          scan_type: "barcode",
          multiple: true,
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_calendar_manager",
    name: "calendar_manager",
    display_name: "日历管理器",
    description: "创建和管理日历事件",
    category: "productivity",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["create", "update", "delete", "query"],
        },
        event: {
          type: "object",
          description: "事件信息",
          properties: {
            id: {
              type: "string",
            },
            title: {
              type: "string",
            },
            description: {
              type: "string",
            },
            start_time: {
              type: "string",
            },
            end_time: {
              type: "string",
            },
            location: {
              type: "string",
            },
            attendees: {
              type: "array",
            },
            recurrence: {
              type: "object",
            },
          },
        },
        date_range: {
          type: "object",
          description: "查询日期范围",
          properties: {
            start: {
              type: "string",
            },
            end: {
              type: "string",
            },
          },
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
        event: {
          type: "object",
        },
        events: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "日历管理器基础用法",
        params: {
          action: "create",
          event: "value",
          date_range: "value",
        },
      },
      {
        description: "日历管理器高级用法",
        params: {
          action: "update",
          event: "advanced_value",
          date_range: "advanced_value",
        },
      },
    ],
    required_permissions: ["calendar:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_reminder_scheduler",
    name: "reminder_scheduler",
    display_name: "提醒调度器",
    description: "设置和管理提醒事项",
    category: "productivity",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作",
          enum: ["create", "update", "delete", "list"],
        },
        reminder: {
          type: "object",
          description: "提醒信息",
          properties: {
            id: {
              type: "string",
            },
            title: {
              type: "string",
            },
            description: {
              type: "string",
            },
            remind_time: {
              type: "string",
            },
            repeat: {
              type: "string",
              enum: ["none", "daily", "weekly", "monthly"],
            },
            priority: {
              type: "string",
              enum: ["low", "medium", "high"],
            },
          },
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
        reminder: {
          type: "object",
        },
        reminders: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "提醒调度器基础用法",
        params: {
          action: "create",
          reminder: "value",
        },
      },
      {
        description: "提醒调度器高级用法",
        params: {
          action: "update",
          reminder: "advanced_value",
        },
      },
    ],
    required_permissions: ["notification:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_npm_project_setup",
    name: "npm_project_setup",
    display_name: "NPM项目初始化",
    description: "初始化Node.js/NPM项目，创建项目结构和配置文件",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectName: {
          type: "string",
          description: "项目名称",
        },
        projectPath: {
          type: "string",
          description: "项目路径",
        },
        template: {
          type: "string",
          enum: ["basic", "express", "koa", "nest", "cli", "library"],
          default: "basic",
          description: "项目模板",
        },
        packageManager: {
          type: "string",
          enum: ["npm", "yarn", "pnpm"],
          default: "npm",
          description: "包管理器",
        },
        initGit: {
          type: "boolean",
          default: true,
          description: "是否初始化Git仓库",
        },
        installDeps: {
          type: "boolean",
          default: false,
          description: "是否自动安装依赖",
        },
      },
      required: ["projectName", "projectPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        projectPath: {
          type: "string",
        },
        filesCreated: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
    },
    examples: [
      {
        description: "NPM项目初始化基础用法",
        params: {
          projectName: "value",
          projectPath: "./data/sample.dat",
          template: "basic",
          packageManager: "npm",
          initGit: false,
          installDeps: false,
        },
      },
      {
        description: "NPM项目初始化高级用法",
        params: {
          projectName: "advanced_value",
          projectPath: "./advanced_data/sample.dat",
          template: "express",
          packageManager: "yarn",
          initGit: true,
          installDeps: true,
        },
      },
    ],
    required_permissions: ["file:write", "command:execute"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_package_json_builder",
    name: "package_json_builder",
    display_name: "package.json构建器",
    description: "生成或更新package.json文件",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "项目路径",
        },
        config: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
            version: {
              type: "string",
              default: "1.0.0",
            },
            description: {
              type: "string",
            },
            main: {
              type: "string",
              default: "index.js",
            },
            scripts: {
              type: "object",
            },
            dependencies: {
              type: "object",
            },
            devDependencies: {
              type: "object",
            },
            keywords: {
              type: "array",
              items: {
                type: "string",
              },
            },
            author: {
              type: "string",
            },
            license: {
              type: "string",
              default: "MIT",
            },
          },
          required: ["name"],
        },
      },
      required: ["projectPath", "config"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "package.json构建器基础用法",
        params: {
          projectPath: "./data/sample.dat",
          config: "value",
        },
      },
      {
        description: "package.json构建器高级用法",
        params: {
          projectPath: "./advanced_data/sample.dat",
          config: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_python_project_setup",
    name: "python_project_setup",
    display_name: "Python项目初始化",
    description: "初始化Python项目结构，支持多种项目类型",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectName: {
          type: "string",
          description: "项目名称",
        },
        projectPath: {
          type: "string",
          description: "项目路径",
        },
        projectType: {
          type: "string",
          enum: [
            "package",
            "script",
            "flask",
            "django",
            "fastapi",
            "ml",
            "data-science",
          ],
          default: "package",
          description: "项目类型",
        },
        pythonVersion: {
          type: "string",
          default: "3.9",
          description: "Python版本",
        },
        useVirtualEnv: {
          type: "boolean",
          default: true,
          description: "是否创建虚拟环境",
        },
        initGit: {
          type: "boolean",
          default: true,
          description: "是否初始化Git仓库",
        },
      },
      required: ["projectName", "projectPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        projectPath: {
          type: "string",
        },
        filesCreated: {
          type: "array",
          items: {
            type: "string",
          },
        },
        venvPath: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "Python项目初始化基础用法",
        params: {
          projectName: "value",
          projectPath: "./data/sample.dat",
          projectType: "package",
          pythonVersion: "3.9",
          useVirtualEnv: false,
          initGit: false,
        },
      },
      {
        description: "Python项目初始化高级用法",
        params: {
          projectName: "advanced_value",
          projectPath: "./advanced_data/sample.dat",
          projectType: "script",
          pythonVersion: "3.9",
          useVirtualEnv: true,
          initGit: true,
        },
      },
    ],
    required_permissions: ["file:write", "command:execute"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_requirements_generator",
    name: "requirements_generator",
    display_name: "requirements.txt生成器",
    description: "生成Python项目的requirements.txt文件",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "项目路径",
        },
        packages: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              version: {
                type: "string",
              },
              extras: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },
            required: ["name"],
          },
          description: "包列表",
        },
        autoDetect: {
          type: "boolean",
          default: false,
          description: "是否自动检测当前环境的包",
        },
        outputPath: {
          type: "string",
          description: "输出文件路径（可选）",
        },
      },
      required: ["projectPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
        packageCount: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "requirements.txt生成器基础用法",
        params: {
          projectPath: "./data/sample.dat",
          packages: ["item1", "item2"],
          autoDetect: false,
          outputPath: "./output/result.json",
        },
      },
      {
        description: "requirements.txt生成器高级用法",
        params: {
          projectPath: "./advanced_data/sample.dat",
          packages: ["item1", "item2", "item3", "item4"],
          autoDetect: true,
          outputPath: "./advanced_output/result.json",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_setup_py_generator",
    name: "setup_py_generator",
    display_name: "setup.py生成器",
    description: "生成Python包的setup.py配置文件",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "项目路径",
        },
        config: {
          type: "object",
          properties: {
            name: {
              type: "string",
            },
            version: {
              type: "string",
            },
            author: {
              type: "string",
            },
            author_email: {
              type: "string",
            },
            description: {
              type: "string",
            },
            long_description: {
              type: "string",
            },
            url: {
              type: "string",
            },
            packages: {
              type: "array",
              items: {
                type: "string",
              },
            },
            install_requires: {
              type: "array",
              items: {
                type: "string",
              },
            },
            python_requires: {
              type: "string",
              default: ">=3.7",
            },
            classifiers: {
              type: "array",
              items: {
                type: "string",
              },
            },
          },
          required: ["name", "version"],
        },
      },
      required: ["projectPath", "config"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "setup.py生成器基础用法",
        params: {
          projectPath: "./data/sample.dat",
          config: "value",
        },
      },
      {
        description: "setup.py生成器高级用法",
        params: {
          projectPath: "./advanced_data/sample.dat",
          config: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_dockerfile_generator",
    name: "dockerfile_generator",
    display_name: "Dockerfile生成器",
    description: "生成Docker容器配置文件",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "项目路径",
        },
        baseImage: {
          type: "string",
          description: "基础镜像",
          default: "node:18-alpine",
        },
        appType: {
          type: "string",
          enum: ["nodejs", "python", "java", "go", "custom"],
          description: "应用类型",
        },
        workdir: {
          type: "string",
          default: "/app",
          description: "工作目录",
        },
        port: {
          type: "number",
          description: "暴露端口",
        },
        entrypoint: {
          type: "string",
          description: "入口命令",
        },
        buildSteps: {
          type: "array",
          items: {
            type: "string",
          },
          description: "构建步骤",
        },
      },
      required: ["projectPath", "appType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "Dockerfile生成器基础用法",
        params: {
          projectPath: "./data/sample.dat",
          baseImage: "node:18-alpine",
          appType: "nodejs",
          workdir: "/app",
          port: 10,
          entrypoint: "value",
          buildSteps: ["item1", "item2"],
        },
      },
      {
        description: "Dockerfile生成器高级用法",
        params: {
          projectPath: "./advanced_data/sample.dat",
          baseImage: "node:18-alpine",
          appType: "python",
          workdir: "/app",
          port: 50,
          entrypoint: "advanced_value",
          buildSteps: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_docker_compose_generator",
    name: "docker_compose_generator",
    display_name: "docker-compose.yml生成器",
    description: "生成Docker Compose配置文件",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "项目路径",
        },
        services: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              image: {
                type: "string",
              },
              build: {
                type: "string",
              },
              ports: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              volumes: {
                type: "array",
                items: {
                  type: "string",
                },
              },
              environment: {
                type: "object",
              },
              depends_on: {
                type: "array",
                items: {
                  type: "string",
                },
              },
            },
            required: ["name"],
          },
          description: "服务列表",
        },
        networks: {
          type: "object",
          description: "网络配置",
        },
        volumes: {
          type: "object",
          description: "卷配置",
        },
      },
      required: ["projectPath", "services"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "docker-compose.yml生成器基础用法",
        params: {
          projectPath: "./data/sample.dat",
          services: ["item1", "item2"],
          networks: "value",
          volumes: "value",
        },
      },
      {
        description: "docker-compose.yml生成器高级用法",
        params: {
          projectPath: "./advanced_data/sample.dat",
          services: ["item1", "item2", "item3", "item4"],
          networks: "advanced_value",
          volumes: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_gitignore_generator",
    name: "gitignore_generator",
    display_name: ".gitignore生成器",
    description: "生成适合不同项目类型的.gitignore文件",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "项目路径",
        },
        templates: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "Node",
              "Python",
              "Java",
              "Go",
              "VisualStudioCode",
              "JetBrains",
              "macOS",
              "Windows",
              "Linux",
            ],
          },
          description: "模板列表",
        },
        customPatterns: {
          type: "array",
          items: {
            type: "string",
          },
          description: "自定义忽略模式",
        },
      },
      required: ["projectPath", "templates"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
        patterns: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: ".gitignore生成器基础用法",
        params: {
          projectPath: "./data/sample.dat",
          templates: ["item1", "item2"],
          customPatterns: ["item1", "item2"],
        },
      },
      {
        description: ".gitignore生成器高级用法",
        params: {
          projectPath: "./advanced_data/sample.dat",
          templates: ["item1", "item2", "item3", "item4"],
          customPatterns: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_eslint_config_generator",
    name: "eslint_config_generator",
    display_name: "ESLint配置生成器",
    description: "生成ESLint配置文件",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectPath: {
          type: "string",
          description: "项目路径",
        },
        framework: {
          type: "string",
          enum: ["react", "vue", "angular", "node", "typescript"],
          description: "框架类型",
        },
        style: {
          type: "string",
          enum: ["airbnb", "standard", "google", "custom"],
          default: "airbnb",
          description: "代码风格",
        },
        configFormat: {
          type: "string",
          enum: ["js", "json", "yaml"],
          default: "js",
          description: "配置文件格式",
        },
      },
      required: ["projectPath", "framework"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        filePath: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "ESLint配置生成器基础用法",
        params: {
          projectPath: "./data/sample.dat",
          framework: "react",
          style: "airbnb",
          configFormat: "js",
        },
      },
      {
        description: "ESLint配置生成器高级用法",
        params: {
          projectPath: "./advanced_data/sample.dat",
          framework: "vue",
          style: "standard",
          configFormat: "json",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_legal_template_generator",
    name: "legal_template_generator",
    display_name: "法律文书生成器 / Legal Template Generator",
    description: "生成各类法律文书模板，包括合同、协议、申请书等",
    category: "legal",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        templateType: {
          type: "string",
          description: "文书类型",
          enum: ["contract", "agreement", "notice", "application"],
        },
        jurisdiction: {
          type: "string",
          description: "法律管辖区",
          default: "CN",
        },
        variables: {
          type: "object",
          description: "模板变量",
        },
      },
      required: ["templateType", "variables"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        document: {
          type: "string",
          description: "生成的法律文书",
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "法律文书生成器 基础用法",
        params: {
          templateType: "contract",
          jurisdiction: "CN",
          variables: "value",
        },
      },
      {
        description: "法律文书生成器 高级用法",
        params: {
          templateType: "agreement",
          jurisdiction: "CN",
          variables: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_patent_claim_analyzer",
    name: "claim_analyzer",
    display_name: "专利权利要求分析器 / Patent Claim Analyzer",
    description: "分析专利权利要求的保护范围、新颖性和创造性",
    category: "legal",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        claimText: {
          type: "string",
          description: "专利权利要求文本",
        },
        analysisType: {
          type: "string",
          description: "分析类型",
          enum: ["basic", "comprehensive"],
          default: "comprehensive",
        },
      },
      required: ["claimText"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
          description: "boolean",
        },
        analysis: {
          type: "object",
          description: "分析结果",
        },
        suggestions: {
          type: "array",
          description: "array",
          items: {
            type: "object",
          },
        },
        error: {
          type: "string",
          description: "string",
        },
      },
    },
    examples: [
      {
        description: "专利权利要求分析器 基础用法",
        params: {
          claimText: "示例文本",
          analysisType: "basic",
        },
      },
      {
        description: "专利权利要求分析器 高级用法",
        params: {
          claimText: "更复杂的示例文本内容，用于测试高级功能",
          analysisType: "comprehensive",
        },
      },
    ],
    required_permissions: ["text:analyze"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_stakeholder_mapper",
    name: "stakeholder_analyzer",
    display_name: "利益相关者映射工具 / Stakeholder Mapping Tool",
    description: "分析和映射项目利益相关者，生成权力-利益矩阵",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectData: {
          type: "object",
          description: "项目数据",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["projectData"],
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
        description: "利益相关者映射工具 基础用法",
        params: {
          projectData: "value",
          options: "value",
        },
      },
      {
        description: "利益相关者映射工具 高级用法",
        params: {
          projectData: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["data:read", "data:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_change_readiness_assessor",
    name: "readiness_assessor",
    display_name: "变革准备度评估器 / Change Readiness Assessor",
    description: "评估组织的变革准备度，使用ADKAR或其他框架",
    category: "management",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: [],
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
        description: "变革准备度评估器 基础用法",
        params: {
          options: "value",
        },
      },
      {
        description: "变革准备度评估器 高级用法",
        params: {
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
    id: "tool_communication_planner",
    name: "communication_planner",
    display_name: "沟通计划工具 / Communication Planner",
    description: "规划项目沟通策略，生成沟通矩阵和时间表",
    category: "project",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        projectData: {
          type: "object",
          description: "项目数据",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["projectData"],
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
        description: "沟通计划工具 基础用法",
        params: {
          projectData: "value",
          options: "value",
        },
      },
      {
        description: "沟通计划工具 高级用法",
        params: {
          projectData: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["data:read", "data:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_org_chart_generator",
    name: "org_chart_generator",
    display_name: "组织架构图生成器 / Organization Chart Generator",
    description: "生成组织架构图，支持多种格式和样式",
    category: "hr",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        organizationData: {
          type: "object",
          description: "组织数据",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["organizationData"],
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
        description: "组织架构图生成器 基础用法",
        params: {
          organizationData: "value",
          options: "value",
        },
      },
      {
        description: "组织架构图生成器 高级用法",
        params: {
          organizationData: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["data:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_culture_analyzer",
    name: "culture_analyzer",
    display_name: "企业文化分析器 / Culture Analyzer",
    description: "分析企业文化现状，识别文化差距和改进机会",
    category: "hr",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        organizationData: {
          type: "object",
          description: "组织数据",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["organizationData"],
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
        description: "企业文化分析器 基础用法",
        params: {
          organizationData: "value",
          options: "value",
        },
      },
      {
        description: "企业文化分析器 高级用法",
        params: {
          organizationData: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["data:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_event_timeline_creator",
    name: "event_timeline_generator",
    display_name: "活动时间线生成器 / Event Timeline Generator",
    description: "创建活动执行时间线，包括里程碑和关键任务",
    category: "event",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: [],
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
        description: "活动时间线生成器 基础用法",
        params: {
          options: "value",
        },
      },
      {
        description: "活动时间线生成器 高级用法",
        params: {
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
    id: "tool_press_release_generator",
    name: "press_release_generator",
    display_name: "新闻稿生成器 / Press Release Generator",
    description: "生成专业新闻稿，符合媒体发布标准",
    category: "marketing",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "内容",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["content"],
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
        description: "新闻稿生成器 基础用法",
        params: {
          content: "示例文本",
          options: "value",
        },
      },
      {
        description: "新闻稿生成器 高级用法",
        params: {
          content: "更复杂的示例文本内容，用于测试高级功能",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["text:generate"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_media_list_manager",
    name: "media_list_manager",
    display_name: "媒体列表管理器 / Media List Manager",
    description: "管理媒体联系人列表，分类和追踪媒体关系",
    category: "marketing",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "内容",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["content"],
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
        description: "媒体列表管理器 基础用法",
        params: {
          content: "示例文本",
          options: "value",
        },
      },
      {
        description: "媒体列表管理器 高级用法",
        params: {
          content: "更复杂的示例文本内容，用于测试高级功能",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["text:generate"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_sentiment_analyzer",
    name: "sentiment_analyzer",
    display_name: "舆情分析器 / Sentiment Analyzer",
    description: "分析社交媒体和新闻的情感倾向，监测品牌声誉",
    category: "marketing",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "内容",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["content"],
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
        description: "舆情分析器 基础用法",
        params: {
          content: "示例文本",
          options: "value",
        },
      },
      {
        description: "舆情分析器 高级用法",
        params: {
          content: "更复杂的示例文本内容，用于测试高级功能",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["text:generate"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_competency_framework",
    name: "competency_framework",
    display_name: "能力框架工具 / Competency Framework Tool",
    description: "构建和管理企业能力素质模型，定义岗位能力要求",
    category: "hr",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        organizationData: {
          type: "object",
          description: "组织数据",
        },
        options: {
          type: "object",
          description: "配置选项",
        },
      },
      required: ["organizationData"],
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
        description: "能力框架工具 基础用法",
        params: {
          organizationData: "value",
          options: "value",
        },
      },
      {
        description: "能力框架工具 高级用法",
        params: {
          organizationData: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["data:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
];
