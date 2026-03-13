/**
 * web-tools - Auto-generated from builtin-tools.js split
 * 27 tools
 */

module.exports = [
  {
    id: "tool_html_generator",
    name: "html_generator",
    display_name: "HTML生成器",
    description: "生成标准HTML页面结构",
    category: "web",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "页面标题",
          default: "我的网页",
        },
        content: {
          type: "string",
          description: "页面内容",
        },
        primaryColor: {
          type: "string",
          description: "主题颜色",
          default: "#667eea",
        },
      },
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        html: {
          type: "string",
        },
        fileName: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "HTML生成器基础用法",
        params: {
          title: "我的网页",
          content: "示例文本",
          primaryColor: "#667eea",
        },
      },
      {
        description: "HTML生成器高级用法",
        params: {
          title: "我的网页",
          content: "更复杂的示例文本内容，用于测试高级功能",
          primaryColor: "#667eea",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_css_generator",
    name: "css_generator",
    display_name: "CSS生成器",
    description: "生成CSS样式文件",
    category: "web",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        primaryColor: {
          type: "string",
          description: "主题颜色",
          default: "#667eea",
        },
        fontSize: {
          type: "string",
          description: "基础字体大小",
          default: "16px",
        },
      },
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        css: {
          type: "string",
        },
        fileName: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "CSS生成器基础用法",
        params: {
          primaryColor: "#667eea",
          fontSize: "16px",
        },
      },
      {
        description: "CSS生成器高级用法",
        params: {
          primaryColor: "#667eea",
          fontSize: "16px",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_js_generator",
    name: "js_generator",
    display_name: "JS生成器",
    description: "生成JavaScript文件",
    category: "web",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        features: {
          type: "array",
          items: {
            type: "string",
          },
          description: "需要的功能列表",
        },
      },
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        js: {
          type: "string",
        },
        fileName: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "JS生成器基础用法",
        params: {
          features: ["item1", "item2"],
        },
      },
      {
        description: "JS生成器高级用法",
        params: {
          features: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_url_parser",
    name: "url_parser",
    display_name: "URL处理器",
    description: "解析、构建和验证URL",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL字符串",
        },
        action: {
          type: "string",
          description: "操作类型",
          enum: ["parse", "build", "validate", "encode", "decode"],
        },
        params: {
          type: "object",
          description: "查询参数（用于build）",
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
        valid: {
          type: "boolean",
        },
      },
    },
    examples: [
      {
        description: "基本网络URL处理器",
        params: {
          url: "https://api.example.com/endpoint",
          action: "parse",
          params: "value",
        },
      },
      {
        description: "高级网络URL处理器",
        params: {
          url: "https://api.example.com/advanced_endpoint",
          action: "build",
          params: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_http_client",
    name: "http_client",
    display_name: "HTTP客户端",
    description: "发送HTTP/HTTPS请求",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "请求URL",
        },
        method: {
          type: "string",
          description: "HTTP方法",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
          default: "GET",
        },
        headers: {
          type: "object",
          description: "请求头",
        },
        body: {
          type: "any",
          description: "请求体",
        },
        timeout: {
          type: "number",
          description: "超时时间（毫秒）",
          default: 10000,
        },
      },
      required: ["url"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        status: {
          type: "number",
        },
        headers: {
          type: "object",
        },
        data: {
          type: "any",
        },
      },
    },
    examples: [
      {
        description: "基本网络HTTP客户端",
        params: {
          url: "https://api.example.com/endpoint",
          method: "GET",
          headers: "value",
          body: "value",
          timeout: 10,
        },
      },
      {
        description: "高级网络HTTP客户端",
        params: {
          url: "https://api.example.com/advanced_endpoint",
          method: "POST",
          headers: "advanced_value",
          body: "advanced_value",
          timeout: 50,
        },
      },
    ],
    required_permissions: ["network:http"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_ip_utility",
    name: "ip_utility",
    display_name: "IP地址工具",
    description: "IP地址验证、解析和查询",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["validate", "parse", "lookup", "cidr"],
          default: "validate",
        },
        ip: {
          type: "string",
          description: "IP地址",
        },
        cidr: {
          type: "string",
          description: "CIDR表示法",
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
        isValid: {
          type: "boolean",
        },
        version: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基本网络IP地址工具",
        params: {
          action: "validate",
          ip: "value",
          cidr: "value",
        },
      },
      {
        description: "高级网络IP地址工具",
        params: {
          action: "parse",
          ip: "advanced_value",
          cidr: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_useragent_parser",
    name: "useragent_parser",
    display_name: "User-Agent解析器",
    description: "解析User-Agent字符串",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        userAgent: {
          type: "string",
          description: "User-Agent字符串",
        },
      },
      required: ["userAgent"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        browser: {
          type: "object",
        },
        os: {
          type: "object",
        },
        device: {
          type: "object",
        },
      },
    },
    examples: [
      {
        description: "基本网络User-Agent解析器",
        params: {
          userAgent: "value",
        },
      },
      {
        description: "高级网络User-Agent解析器",
        params: {
          userAgent: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_html_parser",
    name: "html_parser",
    display_name: "HTML解析器",
    description: "解析HTML并提取内容",
    category: "web",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        html: {
          type: "string",
          description: "HTML字符串",
        },
        selector: {
          type: "string",
          description: "CSS选择器",
        },
        action: {
          type: "string",
          description: "操作类型",
          enum: ["parse", "query", "extract", "text"],
          default: "parse",
        },
      },
      required: ["html", "action"],
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
        elements: {
          type: "array",
        },
      },
    },
    examples: [
      {
        description: "HTML解析器基础用法",
        params: {
          html: "value",
          selector: "value",
          action: "parse",
        },
      },
      {
        description: "HTML解析器高级用法",
        params: {
          html: "advanced_value",
          selector: "advanced_value",
          action: "query",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_dns_lookup",
    name: "dns_lookup",
    display_name: "DNS查询器",
    description: "查询DNS记录",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        domain: {
          type: "string",
          description: "域名",
        },
        recordType: {
          type: "string",
          description: "记录类型",
          enum: ["A", "AAAA", "MX", "TXT", "NS", "CNAME"],
          default: "A",
        },
      },
      required: ["domain"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        records: {
          type: "array",
        },
        type: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基本网络DNS查询器",
        params: {
          domain: "value",
          recordType: "A",
        },
      },
      {
        description: "高级网络DNS查询器",
        params: {
          domain: "advanced_value",
          recordType: "AAAA",
        },
      },
    ],
    required_permissions: ["network:dns"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_port_checker",
    name: "port_checker",
    display_name: "端口检测器",
    description: "检测端口是否开放",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "主机地址",
        },
        port: {
          type: "number",
          description: "端口号",
        },
        timeout: {
          type: "number",
          description: "超时时间（毫秒）",
          default: 3000,
        },
      },
      required: ["host", "port"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        isOpen: {
          type: "boolean",
        },
        host: {
          type: "string",
        },
        port: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "基本网络端口检测器",
        params: {
          host: "value",
          port: 10,
          timeout: 10,
        },
      },
      {
        description: "高级网络端口检测器",
        params: {
          host: "advanced_value",
          port: 50,
          timeout: 50,
        },
      },
    ],
    required_permissions: ["network:connect"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_email_parser",
    name: "email_parser",
    display_name: "邮件解析器",
    description: "解析电子邮件地址和内容",
    category: "email",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["validate", "parse", "extract"],
          default: "validate",
        },
        email: {
          type: "string",
          description: "邮件地址",
        },
        content: {
          type: "string",
          description: "邮件内容",
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
        isValid: {
          type: "boolean",
        },
      },
    },
    examples: [
      {
        description: "邮件解析器基础用法",
        params: {
          action: "validate",
          email: "value",
          content: "示例文本",
        },
      },
      {
        description: "邮件解析器高级用法",
        params: {
          action: "parse",
          email: "advanced_value",
          content: "更复杂的示例文本内容，用于测试高级功能",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_api_requester",
    name: "api_requester",
    display_name: "API请求器",
    description: "发送 HTTP 请求（GET/POST/PUT/DELETE）并处理响应",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "API URL",
        },
        method: {
          type: "string",
          description: "HTTP 方法",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        },
        headers: {
          type: "object",
          description: "请求头",
        },
        body: {
          type: "any",
          description: "请求体",
        },
        timeout: {
          type: "number",
          description: "超时时间（毫秒）",
          default: 30000,
        },
      },
      required: ["url", "method"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        status: {
          type: "number",
        },
        data: {
          type: "any",
        },
        headers: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "API请求器基础用法",
        params: {
          url: "https://api.example.com/endpoint",
          method: "GET",
          headers: "value",
          body: "value",
          timeout: 10,
        },
      },
      {
        description: "API请求器高级用法",
        params: {
          url: "https://api.example.com/advanced_endpoint",
          method: "POST",
          headers: "advanced_value",
          body: "advanced_value",
          timeout: 50,
        },
      },
    ],
    required_permissions: ["network:http"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_oauth_helper",
    name: "oauth_helper",
    display_name: "OAuth助手",
    description: "处理 OAuth 2.0 认证流程",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["authorize", "token", "refresh"],
        },
        clientId: {
          type: "string",
          description: "客户端ID",
        },
        clientSecret: {
          type: "string",
          description: "客户端密钥",
        },
        authorizationUrl: {
          type: "string",
          description: "授权URL",
        },
        tokenUrl: {
          type: "string",
          description: "令牌URL",
        },
        refreshToken: {
          type: "string",
          description: "刷新令牌",
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
        accessToken: {
          type: "string",
        },
        refreshToken: {
          type: "string",
        },
        expiresIn: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "OAuth助手基础用法",
        params: {
          action: "authorize",
          clientId: "value",
          clientSecret: "value",
          authorizationUrl: "https://api.example.com/endpoint",
          tokenUrl: "https://api.example.com/endpoint",
          refreshToken: "value",
        },
      },
      {
        description: "OAuth助手高级用法",
        params: {
          action: "token",
          clientId: "advanced_value",
          clientSecret: "advanced_value",
          authorizationUrl: "https://api.example.com/advanced_endpoint",
          tokenUrl: "https://api.example.com/advanced_endpoint",
          refreshToken: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:http"],
    risk_level: 4,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_email_sender",
    name: "email_sender",
    display_name: "邮件发送器",
    description: "通过SMTP发送邮件（支持HTML、附件）",
    category: "communication",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        from: {
          type: "string",
          description: "发件人邮箱",
        },
        to: {
          type: "array",
          description: "收件人列表",
          items: {
            type: "string",
          },
        },
        subject: {
          type: "string",
          description: "邮件主题",
        },
        text: {
          type: "string",
          description: "纯文本内容",
        },
        html: {
          type: "string",
          description: "HTML内容",
        },
        attachments: {
          type: "array",
          description: "附件列表",
        },
        smtpConfig: {
          type: "object",
          description: "SMTP配置",
        },
      },
      required: ["from", "to", "subject"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        messageId: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "邮件发送器基础用法",
        params: {
          from: "value",
          to: ["item1", "item2"],
          subject: "value",
          text: "示例文本",
          html: "value",
          attachments: ["item1", "item2"],
          smtpConfig: "value",
        },
      },
      {
        description: "邮件发送器高级用法",
        params: {
          from: "advanced_value",
          to: ["item1", "item2", "item3", "item4"],
          subject: "advanced_value",
          text: "更复杂的示例文本内容，用于测试高级功能",
          html: "advanced_value",
          attachments: ["item1", "item2", "item3", "item4"],
          smtpConfig: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:smtp"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_email_reader",
    name: "email_reader",
    display_name: "邮件读取器",
    description: "通过IMAP读取邮件",
    category: "communication",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        imapConfig: {
          type: "object",
          description: "IMAP配置",
          properties: {
            host: {
              type: "string",
            },
            port: {
              type: "number",
            },
            user: {
              type: "string",
            },
            password: {
              type: "string",
            },
            tls: {
              type: "boolean",
            },
          },
        },
        mailbox: {
          type: "string",
          description: "邮箱文件夹",
          default: "INBOX",
        },
        limit: {
          type: "number",
          description: "读取数量",
          default: 10,
        },
        filter: {
          type: "object",
          description: "过滤条件",
        },
      },
      required: ["imapConfig"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        emails: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: {
                type: "string",
              },
              subject: {
                type: "string",
              },
              date: {
                type: "string",
              },
              body: {
                type: "string",
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
        description: "邮件读取器基础用法",
        params: {
          imapConfig: "value",
          mailbox: "INBOX",
          limit: 10,
          filter: "value",
        },
      },
      {
        description: "邮件读取器高级用法",
        params: {
          imapConfig: "advanced_value",
          mailbox: "INBOX",
          limit: 100,
          filter: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:imap"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_email_attachment_handler",
    name: "email_attachment_handler",
    display_name: "邮件附件处理器",
    description: "提取、保存、发送邮件附件",
    category: "communication",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["extract", "save", "attach"],
        },
        emailId: {
          type: "string",
          description: "邮件ID",
        },
        attachmentIndex: {
          type: "number",
          description: "附件索引",
        },
        savePath: {
          type: "string",
          description: "保存路径",
        },
        filePath: {
          type: "string",
          description: "文件路径（添加附件时）",
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
        attachments: {
          type: "array",
        },
        savedPath: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "邮件附件处理器基础用法",
        params: {
          action: "extract",
          emailId: "value",
          attachmentIndex: 10,
          savePath: "./data/sample.dat",
          filePath: "./data/sample.dat",
        },
      },
      {
        description: "邮件附件处理器高级用法",
        params: {
          action: "save",
          emailId: "advanced_value",
          attachmentIndex: 50,
          savePath: "./advanced_data/sample.dat",
          filePath: "./advanced_data/sample.dat",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_web_crawler",
    name: "web_crawler",
    display_name: "网页爬虫",
    description: "爬取网页内容、下载资源",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "目标URL",
        },
        selectors: {
          type: "object",
          description: "CSS选择器映射",
        },
        followLinks: {
          type: "boolean",
          description: "是否跟随链接",
          default: false,
        },
        maxDepth: {
          type: "number",
          description: "最大深度",
          default: 1,
        },
        headers: {
          type: "object",
          description: "请求头",
        },
      },
      required: ["url"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        data: {
          type: "object",
        },
        links: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "网页爬虫基础用法",
        params: {
          url: "https://api.example.com/endpoint",
          selectors: "value",
          followLinks: false,
          maxDepth: 10,
          headers: "value",
        },
      },
      {
        description: "网页爬虫高级用法",
        params: {
          url: "https://api.example.com/advanced_endpoint",
          selectors: "advanced_value",
          followLinks: true,
          maxDepth: 50,
          headers: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:http"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_html_extractor",
    name: "html_extractor",
    display_name: "HTML内容提取器",
    description: "从HTML中提取特定内容、表格、图片等",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        html: {
          type: "string",
          description: "HTML内容",
        },
        extractType: {
          type: "string",
          description: "提取类型",
          enum: ["text", "links", "images", "tables", "metadata"],
        },
        selector: {
          type: "string",
          description: "CSS选择器",
        },
      },
      required: ["html", "extractType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        extracted: {
          type: "any",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基本网络HTML内容提取器",
        params: {
          html: "value",
          extractType: "text",
          selector: "value",
        },
      },
      {
        description: "高级网络HTML内容提取器",
        params: {
          html: "advanced_value",
          extractType: "links",
          selector: "advanced_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_message_queue_client",
    name: "message_queue_client",
    display_name: "消息队列客户端",
    description: "发布订阅消息、队列操作",
    category: "messaging",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["publish", "subscribe", "consume", "ack"],
        },
        queue: {
          type: "string",
          description: "队列名称",
        },
        message: {
          type: "any",
          description: "消息内容",
        },
        exchange: {
          type: "string",
          description: "交换机名称",
        },
        routingKey: {
          type: "string",
          description: "路由键",
        },
      },
      required: ["action", "queue"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        messageId: {
          type: "string",
        },
        messages: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "消息队列客户端基础用法",
        params: {
          action: "publish",
          queue: "value",
          message: "value",
          exchange: "value",
          routingKey: "value",
        },
      },
      {
        description: "消息队列客户端高级用法",
        params: {
          action: "subscribe",
          queue: "advanced_value",
          message: "advanced_value",
          exchange: "advanced_value",
          routingKey: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:amqp"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_websocket_server",
    name: "websocket_server",
    display_name: "WebSocket服务器",
    description: "创建和管理WebSocket服务器",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["start", "stop", "broadcast", "send"],
        },
        port: {
          type: "number",
          description: "端口号",
          default: 8080,
        },
        message: {
          type: "any",
          description: "消息内容",
        },
        clientId: {
          type: "string",
          description: "客户端ID（发送单个消息时）",
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
        serverId: {
          type: "string",
        },
        clients: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "WebSocket服务器基础用法",
        params: {
          action: "start",
          port: 10,
          message: "value",
          clientId: "value",
        },
      },
      {
        description: "WebSocket服务器高级用法",
        params: {
          action: "stop",
          port: 50,
          message: "advanced_value",
          clientId: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:listen"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_websocket_client",
    name: "websocket_client",
    display_name: "WebSocket客户端",
    description: "连接WebSocket服务器",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["connect", "disconnect", "send", "subscribe"],
        },
        url: {
          type: "string",
          description: "WebSocket URL",
        },
        message: {
          type: "any",
          description: "消息内容",
        },
        connectionId: {
          type: "string",
          description: "连接ID",
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
        connectionId: {
          type: "string",
        },
        data: {
          type: "any",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基本网络WebSocket客户端",
        params: {
          action: "connect",
          url: "https://api.example.com/endpoint",
          message: "value",
          connectionId: "value",
        },
      },
      {
        description: "高级网络WebSocket客户端",
        params: {
          action: "disconnect",
          url: "https://api.example.com/advanced_endpoint",
          message: "advanced_value",
          connectionId: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:http"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_contract_caller",
    name: "contract_caller",
    display_name: "智能合约调用器",
    description: "调用以太坊智能合约方法",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        contractAddress: {
          type: "string",
          description: "合约地址",
        },
        abi: {
          type: "array",
          description: "合约ABI",
        },
        method: {
          type: "string",
          description: "方法名",
        },
        params: {
          type: "array",
          description: "方法参数",
        },
        network: {
          type: "string",
          description: "网络类型",
          enum: ["mainnet", "testnet", "localhost"],
        },
      },
      required: ["contractAddress", "abi", "method"],
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
        transactionHash: {
          type: "string",
        },
        gasUsed: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "智能合约调用器基础用法",
        params: {
          contractAddress: "value",
          abi: ["item1", "item2"],
          method: "value",
          params: ["item1", "item2"],
          network: "mainnet",
        },
      },
      {
        description: "智能合约调用器高级用法",
        params: {
          contractAddress: "advanced_value",
          abi: ["item1", "item2", "item3", "item4"],
          method: "advanced_value",
          params: ["item1", "item2", "item3", "item4"],
          network: "testnet",
        },
      },
    ],
    required_permissions: ["network:request"],
    risk_level: 3,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_device_manager",
    name: "device_manager",
    display_name: "设备管理器",
    description: "IoT设备注册、配置、状态管理",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["register", "configure", "getStatus", "control"],
        },
        deviceId: {
          type: "string",
          description: "设备ID",
        },
        deviceType: {
          type: "string",
          description: "设备类型",
          enum: ["sensor", "actuator", "gateway", "controller"],
        },
        config: {
          type: "object",
          description: "设备配置参数",
        },
        command: {
          type: "object",
          description: "控制命令",
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
        deviceId: {
          type: "string",
        },
        status: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基本网络设备管理器",
        params: {
          action: "register",
          deviceId: "value",
          deviceType: "sensor",
          config: "value",
          command: "value",
        },
      },
      {
        description: "高级网络设备管理器",
        params: {
          action: "configure",
          deviceId: "advanced_value",
          deviceType: "actuator",
          config: "advanced_value",
          command: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:request"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_mqtt_client",
    name: "mqtt_client",
    display_name: "MQTT客户端",
    description: "MQTT消息发布订阅",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["connect", "publish", "subscribe", "unsubscribe"],
        },
        broker: {
          type: "string",
          description: "MQTT代理地址",
        },
        topic: {
          type: "string",
          description: "主题",
        },
        message: {
          type: "string",
          description: "消息内容",
        },
        qos: {
          type: "number",
          description: "服务质量等级",
          enum: [0, 1, 2],
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
        connected: {
          type: "boolean",
        },
        messages: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基本网络MQTT客户端",
        params: {
          action: "connect",
          broker: "value",
          topic: "value",
          message: "value",
          qos: 10,
        },
      },
      {
        description: "高级网络MQTT客户端",
        params: {
          action: "publish",
          broker: "advanced_value",
          topic: "advanced_value",
          message: "advanced_value",
          qos: 50,
        },
      },
    ],
    required_permissions: ["network:request"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_photonic_router",
    name: "photonic_router",
    display_name: "光子路由器",
    description: "全光网络路由和交换",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        architecture: {
          type: "string",
          description: "架构",
          enum: ["wavelength_routing", "optical_burst", "optical_packet"],
        },
        wavelength_channels: {
          type: "number",
          description: "波长信道数",
        },
        switching_technology: {
          type: "string",
          description: "交换技术",
          enum: ["MEMS", "SOA", "electro_optic", "thermo_optic"],
        },
        modulation_format: {
          type: "string",
          description: "调制格式",
          enum: ["OOK", "DPSK", "QPSK", "QAM16", "QAM64"],
        },
        routing_table: {
          type: "array",
          description: "路由表",
          items: {
            type: "object",
            properties: {
              source: {
                type: "string",
              },
              destination: {
                type: "string",
              },
              wavelength: {
                type: "number",
              },
            },
          },
        },
        qos_requirements: {
          type: "object",
          description: "QoS要求",
          properties: {
            latency_ms: {
              type: "number",
            },
            bandwidth_gbps: {
              type: "number",
            },
            ber_threshold: {
              type: "number",
            },
          },
        },
      },
      required: ["architecture", "wavelength_channels"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        routes: {
          type: "array",
        },
        wavelength_assignment: {
          type: "object",
        },
        throughput_gbps: {
          type: "number",
        },
        blocking_probability: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基本网络光子路由器",
        params: {
          architecture: "wavelength_routing",
          wavelength_channels: 10,
          switching_technology: "MEMS",
          modulation_format: "OOK",
          routing_table: ["item1", "item2"],
          qos_requirements: "value",
        },
      },
      {
        description: "高级网络光子路由器",
        params: {
          architecture: "optical_burst",
          wavelength_channels: 50,
          switching_technology: "SOA",
          modulation_format: "DPSK",
          routing_table: ["item1", "item2", "item3", "item4"],
          qos_requirements: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:admin"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_network_speed_tester",
    name: "network_speed_tester",
    display_name: "网速测试器",
    description: "测试网络上传和下载速度",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        test_type: {
          type: "string",
          description: "测试类型",
          enum: ["download", "upload", "both", "ping_only"],
        },
        server: {
          type: "string",
          description: "测速服务器(可选)",
        },
        duration: {
          type: "number",
          description: "测试时长(秒)",
        },
      },
      required: [],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        download_speed: {
          type: "number",
          description: "Mbps",
        },
        upload_speed: {
          type: "number",
          description: "Mbps",
        },
        ping: {
          type: "number",
          description: "ms",
        },
        jitter: {
          type: "number",
          description: "ms",
        },
        server_location: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基本网络网速测试器",
        params: {
          test_type: "download",
          server: "value",
          duration: 10,
        },
      },
      {
        description: "高级网络网速测试器",
        params: {
          test_type: "upload",
          server: "advanced_value",
          duration: 50,
        },
      },
    ],
    required_permissions: ["network:test"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_network_diagnostic_tool",
    name: "network_diagnostic_tool",
    display_name: "网络诊断工具",
    description: "Ping、端口扫描、DNS查询、路由追踪",
    category: "network",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "诊断操作",
          enum: ["ping", "port_scan", "dns_lookup", "traceroute", "whois"],
        },
        target: {
          type: "string",
          description: "目标主机或域名",
        },
        options: {
          type: "object",
          description: "操作选项",
          properties: {
            count: {
              type: "number",
              description: "Ping次数",
            },
            timeout: {
              type: "number",
              description: "超时(ms)",
            },
            ports: {
              type: "array",
              description: "端口列表",
            },
            port_range: {
              type: "object",
              properties: {
                start: {
                  type: "number",
                },
                end: {
                  type: "number",
                },
              },
            },
            dns_server: {
              type: "string",
            },
            max_hops: {
              type: "number",
            },
          },
        },
      },
      required: ["operation", "target"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "基本网络网络诊断工具",
        params: {
          operation: "ping",
          target: "value",
          options: "value",
        },
      },
      {
        description: "高级网络网络诊断工具",
        params: {
          operation: "port_scan",
          target: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["network:diagnostic"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
];
