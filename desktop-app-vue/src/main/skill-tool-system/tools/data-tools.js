/**
 * data-tools - Auto-generated from builtin-tools.js split
 * 50 tools
 */

module.exports = [
  {
    id: "tool_format_output",
    name: "format_output",
    display_name: "格式化输出",
    description: "格式化输出内容为指定格式",
    category: "format",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "要格式化的内容",
        },
        format: {
          type: "string",
          description: "输出格式",
          enum: ["json", "markdown", "html", "plain"],
        },
        options: {
          type: "object",
          description: "格式化选项",
        },
      },
      required: ["content", "format"],
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
        format: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "格式化输出基础用法",
        params: {
          content: "示例文本",
          format: "json",
          options: "value",
        },
      },
      {
        description: "格式化输出高级用法",
        params: {
          content: "更复杂的示例文本内容，用于测试高级功能",
          format: "markdown",
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
    id: "tool_json_parser",
    name: "json_parser",
    display_name: "JSON解析器",
    description: "解析、验证和格式化JSON数据",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        json: {
          type: "string",
          description: "JSON字符串",
        },
        action: {
          type: "string",
          description: "操作类型",
          enum: ["parse", "validate", "format", "minify"],
        },
        indent: {
          type: "number",
          description: "格式化时的缩进空格数",
          default: 2,
        },
      },
      required: ["json", "action"],
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
        description: "解析API响应JSON",
        params: {
          jsonString: '{"status":"success","data":{"id":123,"name":"张三"}}',
          strict: true,
        },
      },
      {
        description: "解析配置文件JSON",
        params: {
          jsonString: '{"database":{"host":"localhost","port":5432}}',
          strict: false,
        },
      },
      {
        description: "解析JSON数组",
        params: {
          jsonString: '[{"id":1,"name":"项目A"},{"id":2,"name":"项目B"}]',
          strict: true,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_yaml_parser",
    name: "yaml_parser",
    display_name: "YAML解析器",
    description: "解析和生成YAML格式数据",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "YAML内容或JSON对象字符串",
        },
        action: {
          type: "string",
          description: "操作类型",
          enum: ["parse", "stringify"],
        },
      },
      required: ["content", "action"],
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
        description: "解析Docker Compose配置",
        params: {
          yamlString:
            'version: "3"\nservices:\n  web:\n    image: nginx\n    ports:\n      - "80:80"',
          options: {
            strict: true,
          },
        },
      },
      {
        description: "解析应用配置YAML",
        params: {
          yamlString:
            "app:\n  name: MyApp\n  debug: true\n  database:\n    host: localhost",
          options: {
            strict: false,
          },
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_base64_handler",
    name: "base64_handler",
    display_name: "Base64编解码",
    description: "Base64编码和解码",
    category: "encoding",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["encode", "decode"],
        },
        data: {
          type: "string",
          description: "要处理的数据",
        },
        encoding: {
          type: "string",
          description: "字符编码",
          default: "utf8",
          enum: ["utf8", "ascii", "binary"],
        },
      },
      required: ["action", "data"],
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
        description: "Base64编解码基础用法",
        params: {
          action: "encode",
          data: "value",
          encoding: "utf8",
        },
      },
      {
        description: "Base64编解码高级用法",
        params: {
          action: "decode",
          data: "advanced_value",
          encoding: "ascii",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_markdown_converter",
    name: "markdown_converter",
    display_name: "Markdown转换器",
    description: "将Markdown转换为HTML或其他格式",
    category: "format",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        markdown: {
          type: "string",
          description: "Markdown内容",
        },
        targetFormat: {
          type: "string",
          description: "目标格式",
          enum: ["html", "plain", "pdf"],
          default: "html",
        },
        options: {
          type: "object",
          description: "转换选项",
          properties: {
            sanitize: {
              type: "boolean",
              default: true,
            },
            breaks: {
              type: "boolean",
              default: true,
            },
            tables: {
              type: "boolean",
              default: true,
            },
          },
        },
      },
      required: ["markdown"],
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
        format: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "Markdown转换器基础用法",
        params: {
          markdown: "value",
          targetFormat: "html",
          options: "value",
        },
      },
      {
        description: "Markdown转换器高级用法",
        params: {
          markdown: "advanced_value",
          targetFormat: "plain",
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
    id: "tool_csv_handler",
    name: "csv_handler",
    display_name: "CSV处理器",
    description: "解析、生成和操作CSV数据",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["parse", "stringify", "filter", "sort"],
          default: "parse",
        },
        data: {
          type: "string",
          description: "CSV字符串或JSON数组字符串",
        },
        options: {
          type: "object",
          description: "CSV选项",
          properties: {
            delimiter: {
              type: "string",
              default: ",",
            },
            header: {
              type: "boolean",
              default: true,
            },
            quote: {
              type: "string",
              default: '"',
            },
          },
        },
      },
      required: ["action", "data"],
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
        rowCount: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "解析CSV数据表",
        params: {
          csvData: "name,age,city\n张三,25,北京\n李四,30,上海",
          options: {
            header: true,
            delimiter: ",",
          },
        },
      },
      {
        description: "生成CSV导出文件",
        params: {
          data: [
            {
              name: "张三",
              age: 25,
            },
            {
              name: "李四",
              age: 30,
            },
          ],
          options: {
            header: true,
            delimiter: ",",
          },
        },
      },
      {
        description: "处理大型CSV文件（流式）",
        params: {
          filePath: "./data/large-dataset.csv",
          options: {
            streaming: true,
            batchSize: 1000,
          },
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_excel_reader",
    name: "excel_reader",
    display_name: "Excel读取器",
    description: "读取和解析Excel文件（.xlsx, .xls）",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Excel文件路径",
        },
        sheetName: {
          type: "string",
          description: "工作表名称（留空读取第一个）",
        },
        range: {
          type: "string",
          description: "读取范围（如 A1:C10）",
        },
        header: {
          type: "boolean",
          description: "是否包含表头",
          default: true,
        },
      },
      required: ["filePath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        data: {
          type: "array",
        },
        sheets: {
          type: "array",
        },
        rowCount: {
          type: "number",
        },
      },
    },
    examples: [
      {
        description: "读取Excel财务报表",
        params: {
          filePath: "./reports/财务报表.xlsx",
          sheetName: "Sheet1",
          options: {
            header: true,
          },
        },
      },
      {
        description: "读取Excel特定范围",
        params: {
          filePath: "./data.xlsx",
          sheetName: "Data",
          range: "A1:E100",
          options: {
            header: true,
          },
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_sql_builder",
    name: "sql_builder",
    display_name: "SQL查询构建器",
    description: "构建和验证SQL查询语句",
    category: "database",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["select", "insert", "update", "delete", "validate"],
          default: "select",
        },
        table: {
          type: "string",
          description: "表名",
        },
        fields: {
          type: "array",
          description: "字段列表",
          items: {
            type: "string",
          },
        },
        where: {
          type: "object",
          description: "WHERE条件",
        },
        values: {
          type: "object",
          description: "插入/更新的值",
        },
        orderBy: {
          type: "string",
          description: "排序字段",
        },
        limit: {
          type: "number",
          description: "返回记录数",
        },
      },
      required: ["action", "table"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        sql: {
          type: "string",
        },
        params: {
          type: "array",
        },
      },
    },
    examples: [
      {
        description: "SQL查询构建器基础用法",
        params: {
          action: "select",
          table: "value",
          fields: ["item1", "item2"],
          where: "value",
          values: "value",
          orderBy: "value",
          limit: 10,
        },
      },
      {
        description: "SQL查询构建器高级用法",
        params: {
          action: "insert",
          table: "advanced_value",
          fields: ["item1", "item2", "item3", "item4"],
          where: "advanced_value",
          values: "advanced_value",
          orderBy: "advanced_value",
          limit: 100,
        },
      },
    ],
    required_permissions: [],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_xml_parser",
    name: "xml_parser",
    display_name: "XML解析器",
    description: "解析和生成XML数据",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["parse", "stringify", "validate"],
          default: "parse",
        },
        xml: {
          type: "string",
          description: "XML字符串",
        },
        data: {
          type: "object",
          description: "要转换为XML的数据",
        },
        options: {
          type: "object",
          description: "解析选项",
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
        description: "解析RSS订阅XML",
        params: {
          xmlString:
            "<rss><channel><title>新闻</title><item><title>标题</title></item></channel></rss>",
          options: {
            ignoreAttributes: false,
          },
        },
      },
      {
        description: "解析配置XML",
        params: {
          xmlString:
            '<config><database host="localhost" port="5432"/></config>',
          options: {
            parseAttributeValue: true,
          },
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_data_aggregator",
    name: "data_aggregator",
    display_name: "数据聚合器",
    description: "对数据进行分组、聚合、统计计算",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        data: {
          type: "array",
          description: "数据数组",
        },
        groupBy: {
          type: "string",
          description: "分组字段",
        },
        aggregations: {
          type: "array",
          description: "聚合操作列表",
          items: {
            type: "object",
            properties: {
              field: {
                type: "string",
              },
              operation: {
                type: "string",
                enum: ["sum", "avg", "min", "max", "count"],
              },
            },
          },
        },
      },
      required: ["data", "aggregations"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "聚合销售数据",
        params: {
          data: [
            {
              product: "A",
              sales: 100,
              region: "北京",
            },
            {
              product: "A",
              sales: 150,
              region: "上海",
            },
            {
              product: "B",
              sales: 200,
              region: "北京",
            },
          ],
          groupBy: ["product"],
          aggregations: {
            sales: "sum",
          },
        },
      },
      {
        description: "多维度数据聚合",
        params: {
          data: [
            {
              date: "2025-01",
              revenue: 10000,
              cost: 6000,
            },
          ],
          groupBy: ["date"],
          aggregations: {
            revenue: "sum",
            cost: "sum",
            profit: "calculated",
          },
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_statistical_calculator",
    name: "statistical_calculator",
    display_name: "统计计算器",
    description: "计算均值、方差、标准差、百分位数等统计指标",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        data: {
          type: "array",
          description: "数值数组",
          items: {
            type: "number",
          },
        },
        metrics: {
          type: "array",
          description: "要计算的指标",
          items: {
            type: "string",
            enum: [
              "mean",
              "median",
              "mode",
              "variance",
              "stddev",
              "min",
              "max",
              "percentile",
            ],
          },
        },
        percentile: {
          type: "number",
          description: "百分位数（0-100）",
          default: 50,
        },
      },
      required: ["data", "metrics"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        statistics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用统计计算器处理基础数据",
        params: {
          data: ["item1", "item2"],
          metrics: ["item1", "item2"],
          percentile: 100,
        },
      },
      {
        description: "使用统计计算器处理批量数据",
        params: {
          data: ["item1", "item2", "item3", "item4", "item5"],
          metrics: ["item1", "item2", "item3", "item4", "item5"],
          percentile: 100,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_chart_data_generator",
    name: "chart_data_generator",
    display_name: "图表数据生成器",
    description: "为各种图表（折线图、柱状图、饼图）生成数据格式",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        data: {
          type: "array",
          description: "原始数据",
        },
        chartType: {
          type: "string",
          description: "图表类型",
          enum: ["line", "bar", "pie", "scatter", "area"],
        },
        xField: {
          type: "string",
          description: "X 轴字段",
        },
        yField: {
          type: "string",
          description: "Y 轴字段",
        },
      },
      required: ["data", "chartType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        chartData: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用图表数据生成器处理基础数据",
        params: {
          data: ["item1", "item2"],
          chartType: "line",
          xField: "example_value",
          yField: "example_value",
        },
      },
      {
        description: "使用图表数据生成器处理批量数据",
        params: {
          data: ["item1", "item2", "item3", "item4", "item5"],
          chartType: "line",
          xField: "example_value",
          yField: "example_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_chart_renderer",
    name: "chart_renderer",
    display_name: "图表渲染器",
    description: "渲染各类图表为图片（PNG、SVG）",
    category: "visualization",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        chartConfig: {
          type: "object",
          description: "图表配置（Chart.js格式）",
        },
        outputPath: {
          type: "string",
          description: "输出文件路径",
        },
        format: {
          type: "string",
          description: "输出格式",
          enum: ["png", "svg", "pdf"],
          default: "png",
        },
        width: {
          type: "number",
          description: "宽度",
          default: 800,
        },
        height: {
          type: "number",
          description: "高度",
          default: 600,
        },
      },
      required: ["chartConfig", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        imagePath: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "图表渲染器基础用法",
        params: {
          chartConfig: "value",
          outputPath: "./output/result.json",
          format: "png",
          width: 10,
          height: 10,
        },
      },
      {
        description: "图表渲染器高级用法",
        params: {
          chartConfig: "advanced_value",
          outputPath: "./advanced_output/result.json",
          format: "svg",
          width: 50,
          height: 50,
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_data_validator",
    name: "data_validator",
    display_name: "数据验证器",
    description: "验证数据类型、范围、格式等",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        data: {
          type: "any",
          description: "要验证的数据",
        },
        rules: {
          type: "array",
          description: "验证规则",
          items: {
            type: "object",
            properties: {
              field: {
                type: "string",
              },
              type: {
                type: "string",
              },
              required: {
                type: "boolean",
              },
              min: {
                type: "number",
              },
              max: {
                type: "number",
              },
              pattern: {
                type: "string",
              },
            },
          },
        },
      },
      required: ["data", "rules"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        valid: {
          type: "boolean",
        },
        errors: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "验证用户注册数据",
        params: {
          data: {
            username: "john",
            email: "john@example.com",
            age: 25,
          },
          schema: {
            username: {
              type: "string",
              minLength: 3,
              maxLength: 20,
            },
            email: {
              type: "string",
              format: "email",
            },
            age: {
              type: "number",
              minimum: 18,
            },
          },
        },
      },
      {
        description: "验证API请求参数",
        params: {
          data: {
            page: 1,
            limit: 20,
            sortBy: "createdAt",
          },
          schema: {
            page: {
              type: "integer",
              minimum: 1,
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
            },
            sortBy: {
              type: "string",
              enum: ["createdAt", "updatedAt", "name"],
            },
          },
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_schema_validator",
    name: "schema_validator",
    display_name: "Schema验证器",
    description: "使用JSON Schema验证数据结构",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        data: {
          type: "any",
          description: "要验证的数据",
        },
        schema: {
          type: "object",
          description: "JSON Schema",
        },
      },
      required: ["data", "schema"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        valid: {
          type: "boolean",
        },
        errors: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "验证用户注册数据",
        params: {
          data: {
            username: "john",
            email: "john@example.com",
            age: 25,
          },
          schema: {
            username: {
              type: "string",
              minLength: 3,
              maxLength: 20,
            },
            email: {
              type: "string",
              format: "email",
            },
            age: {
              type: "number",
              minimum: 18,
            },
          },
        },
      },
      {
        description: "验证API请求参数",
        params: {
          data: {
            page: 1,
            limit: 20,
            sortBy: "createdAt",
          },
          schema: {
            page: {
              type: "integer",
              minimum: 1,
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 100,
            },
            sortBy: {
              type: "string",
              enum: ["createdAt", "updatedAt", "name"],
            },
          },
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_time_series_analyzer",
    name: "time_series_analyzer",
    display_name: "时间序列分析器",
    description: "时间序列数据分析、模式识别",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        data: {
          type: "array",
          description: "时间序列数据",
          items: {
            type: "object",
            properties: {
              timestamp: {
                type: "string",
              },
              value: {
                type: "number",
              },
            },
          },
        },
        analysis: {
          type: "array",
          description: "分析类型",
          items: {
            type: "string",
            enum: ["trend", "seasonality", "anomaly", "forecast"],
          },
        },
        forecastPeriods: {
          type: "number",
          description: "预测周期数",
          default: 10,
        },
      },
      required: ["data", "analysis"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        results: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用时间序列分析器处理基础数据",
        params: {
          data: ["item1", "item2"],
          analysis: ["item1", "item2"],
          forecastPeriods: 100,
        },
      },
      {
        description: "使用时间序列分析器处理批量数据",
        params: {
          data: ["item1", "item2", "item3", "item4", "item5"],
          analysis: ["item1", "item2", "item3", "item4", "item5"],
          forecastPeriods: 100,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_trend_detector",
    name: "trend_detector",
    display_name: "趋势检测器",
    description: "检测数据趋势（上升、下降、平稳）",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        data: {
          type: "array",
          description: "数值数组",
          items: {
            type: "number",
          },
        },
        window: {
          type: "number",
          description: "滑动窗口大小",
          default: 5,
        },
        sensitivity: {
          type: "number",
          description: "灵敏度（0-1）",
          default: 0.1,
        },
      },
      required: ["data"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        trend: {
          type: "string",
          enum: ["upward", "downward", "stable", "volatile"],
        },
        strength: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用趋势检测器处理基础数据",
        params: {
          data: ["item1", "item2"],
          window: 100,
          sensitivity: 100,
        },
      },
      {
        description: "使用趋势检测器处理批量数据",
        params: {
          data: ["item1", "item2", "item3", "item4", "item5"],
          window: 100,
          sensitivity: 100,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_migration_runner",
    name: "migration_runner",
    display_name: "迁移执行器",
    description: "执行数据库迁移脚本",
    category: "database",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["up", "down", "latest", "rollback", "status"],
        },
        steps: {
          type: "number",
          description: "执行步数",
          default: 1,
        },
        dryRun: {
          type: "boolean",
          description: "是否模拟执行",
          default: false,
        },
        dbConfig: {
          type: "object",
          description: "数据库配置",
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
        executed: {
          type: "array",
        },
        pending: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "迁移执行器基础用法",
        params: {
          action: "up",
          steps: 10,
          dryRun: false,
          dbConfig: "value",
        },
      },
      {
        description: "迁移执行器高级用法",
        params: {
          action: "down",
          steps: 50,
          dryRun: true,
          dbConfig: "advanced_value",
        },
      },
    ],
    required_permissions: ["database:write"],
    risk_level: 4,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_schema_differ",
    name: "schema_differ",
    display_name: "Schema差异检测器",
    description: "比较数据库Schema差异",
    category: "database",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        source: {
          type: "object",
          description: "源Schema",
        },
        target: {
          type: "object",
          description: "目标Schema",
        },
        options: {
          type: "object",
          description: "比较选项",
          properties: {
            ignoreColumnOrder: {
              type: "boolean",
              default: true,
            },
            ignoreConstraints: {
              type: "boolean",
              default: false,
            },
          },
        },
      },
      required: ["source", "target"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        differences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
              },
              table: {
                type: "string",
              },
              column: {
                type: "string",
              },
              change: {
                type: "string",
              },
            },
          },
        },
        sqlStatements: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "Schema差异检测器基础用法",
        params: {
          source: "value",
          target: "value",
          options: "value",
        },
      },
      {
        description: "Schema差异检测器高级用法",
        params: {
          source: "advanced_value",
          target: "advanced_value",
          options: "advanced_value",
        },
      },
    ],
    required_permissions: ["database:read"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_chart_generator",
    name: "chart_generator",
    display_name: "图表生成器",
    description: "生成各类统计图表(折线图、柱状图、饼图等)",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        chartType: {
          type: "string",
          description: "图表类型",
          enum: ["line", "bar", "pie", "scatter", "area", "radar"],
        },
        data: {
          type: "object",
          description: "图表数据",
          properties: {
            labels: {
              type: "array",
            },
            datasets: {
              type: "array",
            },
          },
        },
        options: {
          type: "object",
          description: "图表选项",
          properties: {
            title: {
              type: "string",
            },
            width: {
              type: "number",
            },
            height: {
              type: "number",
            },
            theme: {
              type: "string",
            },
          },
        },
        outputFormat: {
          type: "string",
          description: "输出格式",
          enum: ["png", "svg", "pdf", "html"],
        },
      },
      required: ["chartType", "data"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        chartPath: {
          type: "string",
        },
        chartData: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用图表生成器处理基础数据",
        params: {
          chartType: "line",
          data: "example_value",
          options: "example_value",
          outputFormat: "png",
        },
      },
      {
        description: "使用图表生成器处理批量数据",
        params: {
          chartType: "line",
          data: "example_value",
          options: "example_value",
          outputFormat: "png",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_graph_plotter",
    name: "graph_plotter",
    display_name: "图形绘制器",
    description: "绘制数学函数图形和数据点",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "绘图类型",
          enum: ["function", "points", "heatmap", "contour"],
        },
        expression: {
          type: "string",
          description: '数学表达式(如 "x^2 + 2*x + 1")',
        },
        points: {
          type: "array",
          description: "数据点数组",
        },
        range: {
          type: "object",
          description: "坐标范围",
          properties: {
            xMin: {
              type: "number",
            },
            xMax: {
              type: "number",
            },
            yMin: {
              type: "number",
            },
            yMax: {
              type: "number",
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
        imagePath: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用图形绘制器处理基础数据",
        params: {
          type: "function",
          expression: "example_value",
          points: ["item1", "item2"],
          range: "example_value",
        },
      },
      {
        description: "使用图形绘制器处理批量数据",
        params: {
          type: "function",
          expression: "example_value",
          points: ["item1", "item2", "item3", "item4", "item5"],
          range: "example_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_protobuf_encoder",
    name: "protobuf_encoder",
    display_name: "Protobuf编码器",
    description: "将JSON数据编码为Protocol Buffer格式",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        schema: {
          type: "string",
          description: "Protobuf模式定义(.proto文件路径)",
        },
        messageName: {
          type: "string",
          description: "消息类型名称",
        },
        data: {
          type: "object",
          description: "要编码的数据(JSON格式)",
        },
        outputFormat: {
          type: "string",
          description: "输出格式",
          enum: ["binary", "base64", "hex"],
        },
      },
      required: ["schema", "messageName", "data"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        encoded: {
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
        description: "使用Protobuf编码器处理基础数据",
        params: {
          schema: "example_value",
          messageName: "example_value",
          data: "example_value",
          outputFormat: "binary",
        },
      },
      {
        description: "使用Protobuf编码器处理批量数据",
        params: {
          schema: "example_value",
          messageName: "example_value",
          data: "example_value",
          outputFormat: "binary",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_protobuf_decoder",
    name: "protobuf_decoder",
    display_name: "Protobuf解码器",
    description: "将Protocol Buffer数据解码为JSON",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        schema: {
          type: "string",
          description: "Protobuf模式定义(.proto文件路径)",
        },
        messageName: {
          type: "string",
          description: "消息类型名称",
        },
        data: {
          type: "string",
          description: "编码后的数据",
        },
        inputFormat: {
          type: "string",
          description: "输入格式",
          enum: ["binary", "base64", "hex"],
        },
      },
      required: ["schema", "messageName", "data"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        decoded: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用Protobuf解码器处理基础数据",
        params: {
          schema: "example_value",
          messageName: "example_value",
          data: "example_value",
          inputFormat: "binary",
        },
      },
      {
        description: "使用Protobuf解码器处理批量数据",
        params: {
          schema: "example_value",
          messageName: "example_value",
          data: "example_value",
          inputFormat: "binary",
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_search_indexer",
    name: "search_indexer",
    display_name: "搜索索引器",
    description: "构建和管理全文搜索索引",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["create", "add", "update", "delete", "optimize"],
        },
        indexName: {
          type: "string",
          description: "索引名称",
        },
        documents: {
          type: "array",
          description: "文档数组",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
              },
              content: {
                type: "string",
              },
              metadata: {
                type: "object",
              },
            },
          },
        },
        analyzer: {
          type: "string",
          description: "分词器",
          enum: ["standard", "chinese", "english"],
        },
      },
      required: ["action", "indexName"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        indexed: {
          type: "number",
        },
        totalDocuments: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "全文搜索文档",
        params: {
          query: "人工智能应用",
          index: "documents",
          options: {
            fuzzy: true,
            limit: 10,
          },
        },
      },
      {
        description: "高级搜索查询",
        params: {
          query: "title:AI AND category:技术",
          index: "articles",
          options: {
            boost: {
              title: 2,
            },
            limit: 20,
          },
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_search_query",
    name: "search_query",
    display_name: "搜索查询器",
    description: "执行全文搜索查询",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        indexName: {
          type: "string",
          description: "索引名称",
        },
        query: {
          type: "string",
          description: "搜索查询",
        },
        options: {
          type: "object",
          description: "查询选项",
          properties: {
            limit: {
              type: "number",
            },
            offset: {
              type: "number",
            },
            filters: {
              type: "object",
            },
            sortBy: {
              type: "string",
            },
            highlight: {
              type: "boolean",
            },
          },
        },
      },
      required: ["indexName", "query"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
              },
              content: {
                type: "string",
              },
              score: {
                type: "number",
              },
              highlights: {
                type: "array",
              },
            },
          },
        },
        total: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "全文搜索文档",
        params: {
          query: "人工智能应用",
          index: "documents",
          options: {
            fuzzy: true,
            limit: 10,
          },
        },
      },
      {
        description: "高级搜索查询",
        params: {
          query: "title:AI AND category:技术",
          index: "articles",
          options: {
            boost: {
              title: 2,
            },
            limit: 20,
          },
        },
      },
    ],
    required_permissions: ["file:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_spatial_analyzer",
    name: "spatial_analyzer",
    display_name: "空间分析器",
    description: "GIS空间分析,缓冲区/叠加/聚类分析",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        analysisType: {
          type: "string",
          description: "分析类型",
          enum: ["buffer", "overlay", "proximity", "cluster", "hotspot"],
        },
        inputData: {
          type: "object",
          description: "输入GeoJSON数据",
        },
        parameters: {
          type: "object",
          description: "分析参数",
          properties: {
            distance: {
              type: "number",
            },
            unit: {
              type: "string",
            },
            method: {
              type: "string",
            },
          },
        },
      },
      required: ["analysisType", "inputData"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "object",
          description: "GeoJSON结果",
        },
        statistics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用空间分析器处理基础数据",
        params: {
          analysisType: "buffer",
          inputData: "example_value",
          parameters: "example_value",
        },
      },
      {
        description: "使用空间分析器处理批量数据",
        params: {
          analysisType: "buffer",
          inputData: "example_value",
          parameters: "example_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_route_planner",
    name: "route_planner",
    display_name: "路径规划器",
    description: "最优路径规划,支持多种算法",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        start: {
          type: "object",
          description: "起点坐标",
          properties: {
            lat: {
              type: "number",
            },
            lon: {
              type: "number",
            },
          },
        },
        end: {
          type: "object",
          description: "终点坐标",
          properties: {
            lat: {
              type: "number",
            },
            lon: {
              type: "number",
            },
          },
        },
        waypoints: {
          type: "array",
          description: "途经点列表",
        },
        algorithm: {
          type: "string",
          description: "路径算法",
          enum: ["dijkstra", "astar", "bidirectional", "tsp"],
        },
        constraints: {
          type: "object",
          description: "约束条件",
          properties: {
            avoid_tolls: {
              type: "boolean",
            },
            avoid_highways: {
              type: "boolean",
            },
            max_distance: {
              type: "number",
            },
          },
        },
      },
      required: ["start", "end"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        route: {
          type: "object",
          properties: {
            path: {
              type: "array",
            },
            distance: {
              type: "number",
            },
            duration: {
              type: "number",
            },
            steps: {
              type: "array",
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
        description: "使用路径规划器处理基础数据",
        params: {
          start: "example_value",
          end: "example_value",
          waypoints: ["item1", "item2"],
          algorithm: "dijkstra",
          constraints: "example_value",
        },
      },
      {
        description: "使用路径规划器处理批量数据",
        params: {
          start: "example_value",
          end: "example_value",
          waypoints: ["item1", "item2", "item3", "item4", "item5"],
          algorithm: "dijkstra",
          constraints: "example_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_financial_modeler",
    name: "financial_modeler",
    display_name: "财务建模器",
    description: "财务模型构建,DCF/NPV/IRR计算",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        modelType: {
          type: "string",
          description: "模型类型",
          enum: ["dcf", "npv", "irr", "capm", "black_scholes"],
        },
        inputs: {
          type: "object",
          description: "模型输入参数",
          properties: {
            cash_flows: {
              type: "array",
            },
            discount_rate: {
              type: "number",
            },
            initial_investment: {
              type: "number",
            },
            risk_free_rate: {
              type: "number",
            },
          },
        },
        assumptions: {
          type: "object",
          description: "假设条件",
        },
      },
      required: ["modelType", "inputs"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "object",
          properties: {
            value: {
              type: "number",
            },
            npv: {
              type: "number",
            },
            irr: {
              type: "number",
            },
            payback_period: {
              type: "number",
            },
          },
        },
        sensitivity_analysis: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用财务建模器处理基础数据",
        params: {
          modelType: "dcf",
          inputs: "example_value",
          assumptions: "example_value",
        },
      },
      {
        description: "使用财务建模器处理批量数据",
        params: {
          modelType: "dcf",
          inputs: "example_value",
          assumptions: "example_value",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_risk_analyzer",
    name: "risk_analyzer",
    display_name: "风险分析器",
    description: "投资风险评估,VaR/CVaR计算",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        portfolio: {
          type: "array",
          description: "投资组合",
          items: {
            type: "object",
            properties: {
              asset: {
                type: "string",
              },
              weight: {
                type: "number",
              },
              returns: {
                type: "array",
              },
            },
          },
        },
        riskMetrics: {
          type: "array",
          description: "风险指标",
          items: {
            type: "string",
            enum: ["var", "cvar", "sharpe", "beta", "volatility"],
          },
        },
        confidence_level: {
          type: "number",
          description: "置信水平",
        },
        time_horizon: {
          type: "number",
          description: "时间范围(天)",
        },
      },
      required: ["portfolio", "riskMetrics"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        risk_metrics: {
          type: "object",
          properties: {
            var: {
              type: "number",
            },
            cvar: {
              type: "number",
            },
            sharpe_ratio: {
              type: "number",
            },
            beta: {
              type: "number",
            },
            volatility: {
              type: "number",
            },
          },
        },
        recommendations: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用风险分析器处理基础数据",
        params: {
          portfolio: ["item1", "item2"],
          riskMetrics: ["item1", "item2"],
          confidence_level: 100,
          time_horizon: 100,
        },
      },
      {
        description: "使用风险分析器处理批量数据",
        params: {
          portfolio: ["item1", "item2", "item3", "item4", "item5"],
          riskMetrics: ["item1", "item2", "item3", "item4", "item5"],
          confidence_level: 100,
          time_horizon: 100,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_recommendation_engine",
    name: "recommendation_engine",
    display_name: "推荐引擎",
    description: "个性化推荐,协同过滤/内容推荐",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "用户ID",
        },
        algorithm: {
          type: "string",
          description: "推荐算法",
          enum: [
            "collaborative",
            "content_based",
            "hybrid",
            "matrix_factorization",
          ],
        },
        context: {
          type: "object",
          description: "上下文信息",
          properties: {
            location: {
              type: "string",
            },
            time: {
              type: "string",
            },
            device: {
              type: "string",
            },
          },
        },
        filters: {
          type: "object",
          description: "过滤条件",
          properties: {
            categories: {
              type: "array",
            },
            price_range: {
              type: "object",
            },
            in_stock: {
              type: "boolean",
            },
          },
        },
        limit: {
          type: "number",
          description: "推荐数量",
        },
      },
      required: ["userId", "algorithm"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item_id: {
                type: "string",
              },
              score: {
                type: "number",
              },
              reason: {
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
        description: "使用推荐引擎处理基础数据",
        params: {
          userId: "example_value",
          algorithm: "collaborative",
          context: "这是一段示例文本",
          filters: "example_value",
          limit: 10,
        },
      },
      {
        description: "使用推荐引擎处理批量数据",
        params: {
          userId: "example_value",
          algorithm: "collaborative",
          context: "这是一段示例文本",
          filters: "example_value",
          limit: 100,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_inventory_manager",
    name: "inventory_manager",
    display_name: "库存管理器",
    description: "库存优化,需求预测,补货策略",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["forecast", "optimize", "reorder", "analyze"],
        },
        inventory: {
          type: "array",
          description: "库存数据",
          items: {
            type: "object",
            properties: {
              sku: {
                type: "string",
              },
              quantity: {
                type: "number",
              },
              cost: {
                type: "number",
              },
              sales_history: {
                type: "array",
              },
            },
          },
        },
        parameters: {
          type: "object",
          description: "管理参数",
          properties: {
            lead_time: {
              type: "number",
            },
            service_level: {
              type: "number",
            },
            holding_cost: {
              type: "number",
            },
          },
        },
        forecast_horizon: {
          type: "number",
          description: "预测周期(天)",
        },
      },
      required: ["action", "inventory"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        result: {
          type: "object",
          properties: {
            forecast: {
              type: "array",
            },
            reorder_points: {
              type: "object",
            },
            order_quantities: {
              type: "object",
            },
            stockout_risk: {
              type: "number",
            },
          },
        },
        recommendations: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用库存管理器处理基础数据",
        params: {
          action: "forecast",
          inventory: ["item1", "item2"],
          parameters: "example_value",
          forecast_horizon: 100,
        },
      },
      {
        description: "使用库存管理器处理批量数据",
        params: {
          action: "forecast",
          inventory: ["item1", "item2", "item3", "item4", "item5"],
          parameters: "example_value",
          forecast_horizon: 100,
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_content_publisher",
    name: "content_publisher",
    display_name: "内容发布器",
    description: "内容发布与版本管理",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["create", "update", "publish", "unpublish", "delete"],
        },
        content: {
          type: "object",
          description: "内容数据",
          properties: {
            id: {
              type: "string",
            },
            title: {
              type: "string",
            },
            body: {
              type: "string",
            },
            author: {
              type: "string",
            },
            tags: {
              type: "array",
            },
            metadata: {
              type: "object",
            },
          },
        },
        workflow: {
          type: "object",
          description: "工作流配置",
          properties: {
            approval_required: {
              type: "boolean",
            },
            reviewers: {
              type: "array",
            },
          },
        },
        schedule: {
          type: "object",
          description: "发布计划",
          properties: {
            publish_at: {
              type: "string",
            },
            expire_at: {
              type: "string",
            },
          },
        },
      },
      required: ["action", "content"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        content_id: {
          type: "string",
        },
        status: {
          type: "string",
        },
        version: {
          type: "number",
        },
        url: {
          type: "string",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "内容发布器基础用法",
        params: {
          action: "create",
          content: "示例文本",
          workflow: "value",
          schedule: "value",
        },
      },
      {
        description: "内容发布器高级用法",
        params: {
          action: "update",
          content: "更复杂的示例文本内容，用于测试高级功能",
          workflow: "advanced_value",
          schedule: "advanced_value",
        },
      },
    ],
    required_permissions: ["content:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_media_manager",
    name: "media_manager",
    display_name: "媒体管理器",
    description: "媒体文件上传、转码、CDN分发",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "操作类型",
          enum: ["upload", "transcode", "delete", "get_url"],
        },
        file: {
          type: "object",
          description: "文件信息",
          properties: {
            path: {
              type: "string",
            },
            type: {
              type: "string",
            },
            size: {
              type: "number",
            },
          },
        },
        transcode_options: {
          type: "object",
          description: "转码选项",
          properties: {
            format: {
              type: "string",
            },
            quality: {
              type: "string",
            },
            resolution: {
              type: "string",
            },
          },
        },
        cdn: {
          type: "object",
          description: "CDN配置",
          properties: {
            enabled: {
              type: "boolean",
            },
            cache_ttl: {
              type: "number",
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
        file_id: {
          type: "string",
        },
        url: {
          type: "string",
        },
        cdn_url: {
          type: "string",
        },
        metadata: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "媒体管理器基础用法",
        params: {
          action: "upload",
          file: "./data/sample.dat",
          transcode_options: "value",
          cdn: "value",
        },
      },
      {
        description: "媒体管理器高级用法",
        params: {
          action: "transcode",
          file: "./advanced_data/sample.dat",
          transcode_options: "advanced_value",
          cdn: "advanced_value",
        },
      },
    ],
    required_permissions: ["file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_sentiment_monitor",
    name: "sentiment_monitor",
    display_name: "舆情监控器",
    description: "监控社交媒体情感倾向",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        keywords: {
          type: "array",
          description: "关键词列表",
          items: {
            type: "string",
          },
        },
        platforms: {
          type: "array",
          description: "平台列表",
          items: {
            type: "string",
            enum: ["twitter", "weibo", "facebook", "reddit"],
          },
        },
        timeRange: {
          type: "object",
          description: "时间范围",
          properties: {
            start: {
              type: "string",
            },
            end: {
              type: "string",
            },
          },
        },
        language: {
          type: "string",
          description: "语言过滤",
        },
      },
      required: ["keywords", "platforms"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        sentiment: {
          type: "object",
          properties: {
            positive: {
              type: "number",
            },
            neutral: {
              type: "number",
            },
            negative: {
              type: "number",
            },
          },
        },
        trends: {
          type: "array",
        },
        top_posts: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用舆情监控器处理基础数据",
        params: {
          keywords: ["item1", "item2"],
          platforms: ["item1", "item2"],
          timeRange: "example_value",
          language: "example_value",
        },
      },
      {
        description: "使用舆情监控器处理批量数据",
        params: {
          keywords: ["item1", "item2", "item3", "item4", "item5"],
          platforms: ["item1", "item2", "item3", "item4", "item5"],
          timeRange: "example_value",
          language: "example_value",
        },
      },
    ],
    required_permissions: ["network:request"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_influencer_analyzer",
    name: "influencer_analyzer",
    display_name: "影响力分析器",
    description: "分析用户/账号影响力",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        user_id: {
          type: "string",
          description: "用户ID/用户名",
        },
        platform: {
          type: "string",
          description: "平台",
          enum: ["twitter", "weibo", "instagram", "youtube"],
        },
        metrics: {
          type: "array",
          description: "分析指标",
          items: {
            type: "string",
            enum: ["reach", "engagement", "growth", "authenticity"],
          },
        },
        period: {
          type: "number",
          description: "分析周期(天)",
        },
      },
      required: ["user_id", "platform"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        profile: {
          type: "object",
          properties: {
            followers: {
              type: "number",
            },
            engagement_rate: {
              type: "number",
            },
            influence_score: {
              type: "number",
            },
          },
        },
        audience_demographics: {
          type: "object",
        },
        content_analysis: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用影响力分析器处理基础数据",
        params: {
          user_id: "example_value",
          platform: "twitter",
          metrics: ["item1", "item2"],
          period: 100,
        },
      },
      {
        description: "使用影响力分析器处理批量数据",
        params: {
          user_id: "example_value",
          platform: "twitter",
          metrics: ["item1", "item2", "item3", "item4", "item5"],
          period: 100,
        },
      },
    ],
    required_permissions: ["network:request"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_logistics_optimizer",
    name: "logistics_optimizer",
    display_name: "物流优化器",
    description: "优化配送路线和资源分配",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        problem_type: {
          type: "string",
          description: "问题类型",
          enum: ["vehicle_routing", "facility_location", "network_design"],
        },
        locations: {
          type: "array",
          description: "位置列表",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
              },
              lat: {
                type: "number",
              },
              lon: {
                type: "number",
              },
              demand: {
                type: "number",
              },
            },
          },
        },
        vehicles: {
          type: "array",
          description: "车辆配置",
        },
        constraints: {
          type: "object",
          description: "约束条件",
          properties: {
            max_distance: {
              type: "number",
            },
            time_windows: {
              type: "array",
            },
            capacity: {
              type: "number",
            },
          },
        },
        optimization_goal: {
          type: "string",
          description: "优化目标",
          enum: ["minimize_cost", "minimize_time", "minimize_distance"],
        },
      },
      required: ["problem_type", "locations"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        solution: {
          type: "object",
          properties: {
            routes: {
              type: "array",
            },
            total_cost: {
              type: "number",
            },
            total_distance: {
              type: "number",
            },
            vehicles_used: {
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
        description: "使用物流优化器处理基础数据",
        params: {
          problem_type: "vehicle_routing",
          locations: ["item1", "item2"],
          vehicles: ["item1", "item2"],
          constraints: "example_value",
          optimization_goal: "minimize_cost",
        },
      },
      {
        description: "使用物流优化器处理批量数据",
        params: {
          problem_type: "vehicle_routing",
          locations: ["item1", "item2", "item3", "item4", "item5"],
          vehicles: ["item1", "item2", "item3", "item4", "item5"],
          constraints: "example_value",
          optimization_goal: "minimize_cost",
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_demand_forecaster",
    name: "demand_forecaster",
    display_name: "需求预测器",
    description: "预测产品需求和市场趋势",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        historical_data: {
          type: "array",
          description: "历史数据",
          items: {
            type: "object",
            properties: {
              date: {
                type: "string",
              },
              value: {
                type: "number",
              },
            },
          },
        },
        forecast_horizon: {
          type: "number",
          description: "预测周期(天)",
        },
        model: {
          type: "string",
          description: "预测模型",
          enum: ["arima", "prophet", "lstm", "exponential_smoothing"],
        },
        external_factors: {
          type: "array",
          description: "外部因素",
          items: {
            type: "object",
            properties: {
              name: {
                type: "string",
              },
              values: {
                type: "array",
              },
            },
          },
        },
      },
      required: ["historical_data", "forecast_horizon"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        forecast: {
          type: "array",
          items: {
            type: "object",
            properties: {
              date: {
                type: "string",
              },
              predicted: {
                type: "number",
              },
              lower_bound: {
                type: "number",
              },
              upper_bound: {
                type: "number",
              },
            },
          },
        },
        accuracy_metrics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用需求预测器处理基础数据",
        params: {
          historical_data: ["item1", "item2"],
          forecast_horizon: 100,
          model: "arima",
          external_factors: ["item1", "item2"],
        },
      },
      {
        description: "使用需求预测器处理批量数据",
        params: {
          historical_data: ["item1", "item2", "item3", "item4", "item5"],
          forecast_horizon: 100,
          model: "arima",
          external_factors: ["item1", "item2", "item3", "item4", "item5"],
        },
      },
    ],
    required_permissions: [],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_production_scheduler",
    name: "production_scheduler",
    display_name: "生产调度器",
    description: "生产计划优化和资源调度",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        orders: {
          type: "array",
          description: "生产订单列表",
        },
        resources: {
          type: "object",
          description: "可用资源(设备、人员、材料)",
        },
        constraints: {
          type: "object",
          description: "约束条件",
        },
        optimization_goal: {
          type: "string",
          description: "优化目标",
          enum: [
            "minimize_time",
            "minimize_cost",
            "maximize_throughput",
            "balance_load",
          ],
        },
      },
      required: ["orders", "resources"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        schedule: {
          type: "array",
        },
        gantt_chart: {
          type: "object",
        },
        metrics: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "生产调度器基础用法",
        params: {
          orders: ["item1", "item2"],
          resources: "value",
          constraints: "value",
          optimization_goal: "minimize_time",
        },
      },
      {
        description: "生产调度器高级用法",
        params: {
          orders: ["item1", "item2", "item3", "item4"],
          resources: "advanced_value",
          constraints: "advanced_value",
          optimization_goal: "minimize_cost",
        },
      },
    ],
    required_permissions: ["data:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_orbit_calculator",
    name: "orbit_calculator",
    display_name: "轨道计算器",
    description: "卫星/航天器轨道计算和预测",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        calculation_type: {
          type: "string",
          description: "计算类型",
          enum: ["propagation", "maneuver", "rendezvous", "reentry"],
        },
        orbital_elements: {
          type: "object",
          description: "轨道根数",
          properties: {
            a: {
              type: "number",
              description: "半长轴(km)",
            },
            e: {
              type: "number",
              description: "偏心率",
            },
            i: {
              type: "number",
              description: "轨道倾角(度)",
            },
            omega: {
              type: "number",
              description: "升交点赤经(度)",
            },
            w: {
              type: "number",
              description: "近地点幅角(度)",
            },
            M: {
              type: "number",
              description: "平近点角(度)",
            },
          },
        },
        time_span: {
          type: "number",
          description: "时间跨度(秒)",
        },
        perturbations: {
          type: "array",
          description: "摄动项",
          items: {
            type: "string",
            enum: ["j2", "drag", "sun", "moon", "srp"],
          },
        },
      },
      required: ["calculation_type", "orbital_elements"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        trajectory: {
          type: "array",
        },
        future_elements: {
          type: "object",
        },
        ground_track: {
          type: "array",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用轨道计算器处理基础数据",
        params: {
          calculation_type: "propagation",
          orbital_elements: "example_value",
          time_span: 100,
          perturbations: ["item1", "item2"],
        },
      },
      {
        description: "使用轨道计算器处理批量数据",
        params: {
          calculation_type: "propagation",
          orbital_elements: "example_value",
          time_span: 100,
          perturbations: ["item1", "item2", "item3", "item4", "item5"],
        },
      },
    ],
    required_permissions: ["data:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_flight_planner",
    name: "flight_planner",
    display_name: "飞行规划器",
    description: "航空飞行路径规划和优化",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        departure: {
          type: "object",
          description: "起飞点",
          properties: {
            airport: {
              type: "string",
            },
            coordinates: {
              type: "object",
            },
            time: {
              type: "string",
            },
          },
        },
        destination: {
          type: "object",
          description: "目的地",
        },
        aircraft: {
          type: "object",
          description: "飞机信息",
          properties: {
            type: {
              type: "string",
            },
            cruise_speed: {
              type: "number",
            },
            range: {
              type: "number",
            },
          },
        },
        optimization: {
          type: "string",
          description: "优化目标",
          enum: ["shortest", "fastest", "fuel_efficient", "weather_avoid"],
        },
        weather_data: {
          type: "object",
          description: "气象数据",
        },
      },
      required: ["departure", "destination", "aircraft"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        route: {
          type: "array",
        },
        waypoints: {
          type: "array",
        },
        flight_plan: {
          type: "object",
        },
        estimates: {
          type: "object",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用飞行规划器处理基础数据",
        params: {
          departure: "example_value",
          destination: "example_value",
          aircraft: "example_value",
          optimization: "shortest",
          weather_data: "example_value",
        },
      },
      {
        description: "使用飞行规划器处理批量数据",
        params: {
          departure: "example_value",
          destination: "example_value",
          aircraft: "example_value",
          optimization: "shortest",
          weather_data: "example_value",
        },
      },
    ],
    required_permissions: ["data:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_navigation_planner",
    name: "navigation_planner",
    display_name: "航海规划器",
    description: "船舶航海路径规划和优化",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        departure: {
          type: "object",
          description: "起点港口",
        },
        destination: {
          type: "object",
          description: "目的港口",
        },
        vessel: {
          type: "object",
          description: "船舶信息",
          properties: {
            type: {
              type: "string",
            },
            draft: {
              type: "number",
            },
            speed: {
              type: "number",
            },
          },
        },
        optimization: {
          type: "string",
          description: "优化目标",
          enum: ["shortest", "fastest", "fuel_efficient", "weather_routing"],
        },
        constraints: {
          type: "object",
          description: "约束条件",
        },
      },
      required: ["departure", "destination", "vessel"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        route: {
          type: "array",
        },
        waypoints: {
          type: "array",
        },
        eta: {
          type: "string",
        },
        distance: {
          type: "number",
        },
        fuel_estimate: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用航海规划器处理基础数据",
        params: {
          departure: "example_value",
          destination: "example_value",
          vessel: "example_value",
          optimization: "shortest",
          constraints: "example_value",
        },
      },
      {
        description: "使用航海规划器处理批量数据",
        params: {
          departure: "example_value",
          destination: "example_value",
          vessel: "example_value",
          optimization: "shortest",
          constraints: "example_value",
        },
      },
    ],
    required_permissions: ["data:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_underwater_navigator",
    name: "underwater_navigator",
    display_name: "水下导航器",
    description: "INS/DVL/USBL组合水下导航",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        navigation_mode: {
          type: "string",
          description: "导航模式",
          enum: ["INS", "DVL", "USBL", "integrated"],
        },
        sensor_data: {
          type: "object",
          description: "传感器数据",
          properties: {
            imu: {
              type: "object",
            },
            dvl: {
              type: "object",
            },
            depth: {
              type: "number",
            },
          },
        },
        initial_position: {
          type: "object",
          description: "初始位置",
        },
        current: {
          type: "object",
          description: "海流信息",
        },
      },
      required: ["navigation_mode", "sensor_data"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        position: {
          type: "object",
        },
        velocity: {
          type: "object",
        },
        accuracy: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用水下导航器处理基础数据",
        params: {
          navigation_mode: "INS",
          sensor_data: "example_value",
          initial_position: "example_value",
          current: "example_value",
        },
      },
      {
        description: "使用水下导航器处理批量数据",
        params: {
          navigation_mode: "INS",
          sensor_data: "example_value",
          initial_position: "example_value",
          current: "example_value",
        },
      },
    ],
    required_permissions: ["data:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_deep_sea_mapper",
    name: "deep_sea_mapper",
    display_name: "深海测绘器",
    description: "多波束声呐深海地形测绘",
    category: "data",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        sonar_type: {
          type: "string",
          description: "声呐类型",
          enum: ["multibeam", "sidescan", "synthetic_aperture"],
        },
        survey_area: {
          type: "object",
          description: "测量区域",
          properties: {
            bounds: {
              type: "array",
            },
            depth_range: {
              type: "object",
            },
          },
        },
        resolution: {
          type: "number",
          description: "分辨率(m)",
        },
        raw_data: {
          type: "array",
          description: "原始声呐数据",
        },
      },
      required: ["sonar_type", "survey_area"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        bathymetry: {
          type: "array",
        },
        features: {
          type: "array",
        },
        coverage: {
          type: "number",
        },
        error: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "使用深海测绘器处理基础数据",
        params: {
          sonar_type: "multibeam",
          survey_area: "example_value",
          resolution: 100,
          raw_data: ["item1", "item2"],
        },
      },
      {
        description: "使用深海测绘器处理批量数据",
        params: {
          sonar_type: "multibeam",
          survey_area: "example_value",
          resolution: 100,
          raw_data: ["item1", "item2", "item3", "item4", "item5"],
        },
      },
    ],
    required_permissions: ["data:read"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_data_preprocessor",
    name: "data_preprocessor",
    display_name: "数据预处理器",
    description: "数据清洗、缺失值处理、异常值检测、特征缩放和编码",
    category: "data-science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        dataPath: {
          type: "string",
          description: "数据文件路径（CSV/Excel）",
        },
        operations: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "remove_duplicates",
              "handle_missing",
              "detect_outliers",
              "normalize",
              "standardize",
              "encode_categorical",
              "one_hot_encode",
              "label_encode",
            ],
          },
          description: "预处理操作列表",
        },
        options: {
          type: "object",
          properties: {
            missingStrategy: {
              type: "string",
              enum: [
                "drop",
                "mean",
                "median",
                "mode",
                "forward_fill",
                "backward_fill",
              ],
              default: "median",
            },
            outlierMethod: {
              type: "string",
              enum: ["iqr", "zscore", "isolation_forest"],
              default: "iqr",
            },
            scalingMethod: {
              type: "string",
              enum: ["standard", "minmax", "robust"],
              default: "standard",
            },
          },
        },
        outputPath: {
          type: "string",
          description: "输出文件路径",
        },
      },
      required: ["dataPath", "operations"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        outputPath: {
          type: "string",
        },
        rowsProcessed: {
          type: "number",
        },
        columnsProcessed: {
          type: "number",
        },
        summary: {
          type: "object",
          properties: {
            duplicatesRemoved: {
              type: "number",
            },
            missingValuesHandled: {
              type: "number",
            },
            outliersDetected: {
              type: "number",
            },
          },
        },
      },
    },
    examples: [
      {
        description: "数据预处理器基础用法",
        params: {
          dataPath: "./data/sample.dat",
          operations: ["item1", "item2"],
          options: "value",
          outputPath: "./output/result.json",
        },
      },
      {
        description: "数据预处理器高级用法",
        params: {
          dataPath: "./advanced_data/sample.dat",
          operations: ["item1", "item2", "item3", "item4"],
          options: "advanced_value",
          outputPath: "./advanced_output/result.json",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_feature_engineer",
    name: "feature_engineer",
    display_name: "特征工程工具",
    description: "特征创建、选择、转换和降维",
    category: "data-science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        dataPath: {
          type: "string",
          description: "数据文件路径",
        },
        operations: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "polynomial_features",
              "interaction_features",
              "binning",
              "pca",
              "feature_selection",
              "timestamp_features",
            ],
          },
        },
        config: {
          type: "object",
          properties: {
            polynomialDegree: {
              type: "number",
              default: 2,
            },
            pcaComponents: {
              type: "number",
              default: 0.95,
            },
            selectionMethod: {
              type: "string",
              enum: ["chi2", "mutual_info", "f_classif", "rfe"],
              default: "mutual_info",
            },
            topK: {
              type: "number",
              description: "保留前K个特征",
            },
          },
        },
        outputPath: {
          type: "string",
          description: "输出文件路径",
        },
      },
      required: ["dataPath", "operations"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        outputPath: {
          type: "string",
        },
        originalFeatures: {
          type: "number",
        },
        newFeatures: {
          type: "number",
        },
        featureNames: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
    },
    examples: [
      {
        description: "特征工程工具基础用法",
        params: {
          dataPath: "./data/sample.dat",
          operations: ["item1", "item2"],
          config: "value",
          outputPath: "./output/result.json",
        },
      },
      {
        description: "特征工程工具高级用法",
        params: {
          dataPath: "./advanced_data/sample.dat",
          operations: ["item1", "item2", "item3", "item4"],
          config: "advanced_value",
          outputPath: "./advanced_output/result.json",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_model_evaluator",
    name: "model_evaluator",
    display_name: "模型评估器",
    description: "评估模型性能，生成评估报告和可视化",
    category: "data-science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        modelPath: {
          type: "string",
          description: "模型文件路径",
        },
        testDataPath: {
          type: "string",
          description: "测试数据路径",
        },
        taskType: {
          type: "string",
          enum: ["classification", "regression", "clustering"],
          description: "任务类型",
        },
        generatePlots: {
          type: "boolean",
          default: true,
          description: "是否生成可视化图表",
        },
        reportOutputPath: {
          type: "string",
          description: "评估报告输出路径",
        },
      },
      required: ["modelPath", "testDataPath", "taskType"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        metrics: {
          type: "object",
          description: "评估指标（accuracy、f1_score、rmse等）",
        },
        confusionMatrix: {
          type: "array",
        },
        featureImportance: {
          type: "array",
        },
        plots: {
          type: "array",
          items: {
            type: "string",
          },
          description: "生成的图表路径列表",
        },
        reportPath: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "模型评估器基础用法",
        params: {
          modelPath: "./models/trained_model.pkl",
          testDataPath: "./data/sample.dat",
          taskType: "classification",
          generatePlots: false,
          reportOutputPath: "./output/result.json",
        },
      },
      {
        description: "模型评估器高级用法",
        params: {
          modelPath: "./advanced_models/trained_model.pkl",
          testDataPath: "./advanced_data/sample.dat",
          taskType: "regression",
          generatePlots: true,
          reportOutputPath: "./advanced_output/result.json",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_statistical_analyzer",
    name: "statistical_analyzer",
    display_name: "统计分析工具",
    description: "执行描述性统计、相关性分析、假设检验等",
    category: "data-science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        dataPath: {
          type: "string",
          description: "数据文件路径",
        },
        analyses: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "descriptive",
              "correlation",
              "t_test",
              "chi_square",
              "anova",
              "normality_test",
              "distribution_fit",
            ],
          },
          description: "分析类型列表",
        },
        columns: {
          type: "array",
          items: {
            type: "string",
          },
          description: "要分析的列名（可选）",
        },
        options: {
          type: "object",
          properties: {
            confidence_level: {
              type: "number",
              default: 0.95,
            },
            method: {
              type: "string",
            },
          },
        },
        reportOutputPath: {
          type: "string",
          description: "分析报告输出路径",
        },
      },
      required: ["dataPath", "analyses"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        results: {
          type: "object",
          description: "分析结果",
        },
        reportPath: {
          type: "string",
        },
      },
    },
    examples: [
      {
        description: "统计分析工具基础用法",
        params: {
          dataPath: "./data/sample.dat",
          analyses: ["item1", "item2"],
          columns: ["item1", "item2"],
          options: "value",
          reportOutputPath: "./output/result.json",
        },
      },
      {
        description: "统计分析工具高级用法",
        params: {
          dataPath: "./advanced_data/sample.dat",
          analyses: ["item1", "item2", "item3", "item4"],
          columns: ["item1", "item2", "item3", "item4"],
          options: "advanced_value",
          reportOutputPath: "./advanced_output/result.json",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_eda_generator",
    name: "eda_generator",
    display_name: "EDA报告生成器",
    description: "自动生成探索性数据分析报告，包含数据概览、分布、相关性等",
    category: "data-science",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        dataPath: {
          type: "string",
          description: "数据文件路径",
        },
        targetColumn: {
          type: "string",
          description: "目标变量（可选）",
        },
        reportType: {
          type: "string",
          enum: ["quick", "detailed", "comprehensive"],
          default: "detailed",
          description: "报告详细程度",
        },
        outputFormat: {
          type: "string",
          enum: ["html", "pdf", "notebook"],
          default: "html",
          description: "输出格式",
        },
        outputPath: {
          type: "string",
          description: "输出路径",
        },
      },
      required: ["dataPath", "outputPath"],
    },
    return_schema: {
      type: "object",
      properties: {
        success: {
          type: "boolean",
        },
        reportPath: {
          type: "string",
        },
        sections: {
          type: "array",
          items: {
            type: "string",
          },
          description: "报告章节列表",
        },
      },
    },
    examples: [
      {
        description: "EDA报告生成器基础用法",
        params: {
          dataPath: "./data/sample.dat",
          targetColumn: "value",
          reportType: "quick",
          outputFormat: "html",
          outputPath: "./output/result.json",
        },
      },
      {
        description: "EDA报告生成器高级用法",
        params: {
          dataPath: "./advanced_data/sample.dat",
          targetColumn: "advanced_value",
          reportType: "detailed",
          outputFormat: "pdf",
          outputPath: "./advanced_output/result.json",
        },
      },
    ],
    required_permissions: ["file:read", "file:write"],
    risk_level: 2,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_market_data_analyzer",
    name: "market_data_analyzer",
    display_name: "市场数据分析器 / Market Data Analyzer",
    description: "分析市场数据，包括价格趋势、供需关系、竞争格局等",
    category: "analysis",
    tool_type: "function",
    parameters_schema: {
      type: "object",
      properties: {
        market: {
          type: "string",
          description: "市场名称",
        },
        dataSources: {
          type: "array",
          description: "数据源",
          default: ["multiple"],
        },
        metrics: {
          type: "array",
          description: "分析指标",
          default: ["price", "volume", "trend"],
        },
      },
      required: ["market"],
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
          description: "object",
        },
        trends: {
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
        description: "市场数据分析器 基础用法",
        params: {
          market: "value",
          dataSources: ["item1", "item2"],
          metrics: ["item1", "item2"],
        },
      },
      {
        description: "市场数据分析器 高级用法",
        params: {
          market: "advanced_value",
          dataSources: ["item1", "item2", "item3", "item4"],
          metrics: ["item1", "item2", "item3", "item4"],
        },
      },
    ],
    required_permissions: ["network:request"],
    risk_level: 1,
    is_builtin: 1,
    enabled: 1,
  },
  {
    id: "tool_simulation_runner",
    name: "simulation_runner",
    display_name: "模拟运行器 / Simulation Runner",
    description: "运行各类业务模拟场景，支持蒙特卡洛模拟、敏感性分析等",
    category: "analysis",
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
        description: "模拟运行器 基础用法",
        params: {
          options: "value",
        },
      },
      {
        description: "模拟运行器 高级用法",
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
];
