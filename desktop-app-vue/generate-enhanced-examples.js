/**
 * 为高频工具生成增强的Examples
 * 每个工具2-3个场景化、详细的示例
 */

const fs = require('fs');
const highFreqReport = require('./high-frequency-tools.json');
const tools = require('./src/main/skill-tool-system/builtin-tools.js');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  生成高频工具增强Examples                               ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const toolsMap = new Map(tools.map(t => [t.id, t]));

/**
 * 为特定工具生成多个场景化examples
 */
function generateEnhancedExamples(tool) {
  const examples = [];
  const toolId = tool.id;
  const category = tool.category;
  const name = tool.name;

  // 文件操作工具
  if (category === 'file') {
    if (name.includes('reader')) {
      examples.push(
        {
          description: '读取文本配置文件',
          params: {
            filePath: './config/app.json',
            encoding: 'utf-8'
          }
        },
        {
          description: '读取日志文件最后1000行',
          params: {
            filePath: '/var/log/application.log',
            encoding: 'utf-8',
            lines: 1000
          }
        },
        {
          description: '读取二进制数据文件',
          params: {
            filePath: './data/binary.dat',
            encoding: 'binary'
          }
        }
      );
    } else if (name.includes('searcher')) {
      examples.push(
        {
          description: '在项目中搜索JavaScript文件',
          params: {
            directory: './src',
            pattern: '*.js',
            recursive: true
          }
        },
        {
          description: '搜索包含特定关键词的文件',
          params: {
            directory: './docs',
            pattern: '*.md',
            content: '使用教程',
            recursive: true
          }
        },
        {
          description: '搜索最近修改的文件',
          params: {
            directory: './uploads',
            pattern: '*.*',
            modifiedAfter: '2025-01-01',
            recursive: false
          }
        }
      );
    } else if (name.includes('compressor')) {
      examples.push(
        {
          description: '压缩单个文件',
          params: {
            inputPath: './document.pdf',
            outputPath: './document.pdf.gz',
            format: 'gzip'
          }
        },
        {
          description: '压缩整个目录',
          params: {
            inputPath: './project',
            outputPath: './project-backup.zip',
            format: 'zip',
            level: 9
          }
        }
      );
    } else if (name.includes('decompressor')) {
      examples.push(
        {
          description: '解压ZIP文件',
          params: {
            inputPath: './archive.zip',
            outputPath: './extracted',
            format: 'zip'
          }
        },
        {
          description: '解压tar.gz文件',
          params: {
            inputPath: './backup.tar.gz',
            outputPath: './restored',
            format: 'tar.gz'
          }
        }
      );
    }
  }

  // 数据处理工具
  else if (category === 'data') {
    if (name.includes('json_parser')) {
      examples.push(
        {
          description: '解析API响应JSON',
          params: {
            jsonString: '{"status":"success","data":{"id":123,"name":"张三"}}',
            strict: true
          }
        },
        {
          description: '解析配置文件JSON',
          params: {
            jsonString: '{"database":{"host":"localhost","port":5432}}',
            strict: false
          }
        },
        {
          description: '解析JSON数组',
          params: {
            jsonString: '[{"id":1,"name":"项目A"},{"id":2,"name":"项目B"}]',
            strict: true
          }
        }
      );
    } else if (name.includes('xml_parser')) {
      examples.push(
        {
          description: '解析RSS订阅XML',
          params: {
            xmlString: '<rss><channel><title>新闻</title><item><title>标题</title></item></channel></rss>',
            options: { ignoreAttributes: false }
          }
        },
        {
          description: '解析配置XML',
          params: {
            xmlString: '<config><database host="localhost" port="5432"/></config>',
            options: { parseAttributeValue: true }
          }
        }
      );
    } else if (name.includes('yaml_parser')) {
      examples.push(
        {
          description: '解析Docker Compose配置',
          params: {
            yamlString: 'version: "3"\nservices:\n  web:\n    image: nginx\n    ports:\n      - "80:80"',
            options: { strict: true }
          }
        },
        {
          description: '解析应用配置YAML',
          params: {
            yamlString: 'app:\n  name: MyApp\n  debug: true\n  database:\n    host: localhost',
            options: { strict: false }
          }
        }
      );
    } else if (name.includes('csv_handler')) {
      examples.push(
        {
          description: '解析CSV数据表',
          params: {
            csvData: 'name,age,city\n张三,25,北京\n李四,30,上海',
            options: { header: true, delimiter: ',' }
          }
        },
        {
          description: '生成CSV导出文件',
          params: {
            data: [{name: '张三', age: 25}, {name: '李四', age: 30}],
            options: { header: true, delimiter: ',' }
          }
        },
        {
          description: '处理大型CSV文件（流式）',
          params: {
            filePath: './data/large-dataset.csv',
            options: { streaming: true, batchSize: 1000 }
          }
        }
      );
    } else if (name.includes('validator')) {
      examples.push(
        {
          description: '验证用户注册数据',
          params: {
            data: { username: 'john', email: 'john@example.com', age: 25 },
            schema: {
              username: { type: 'string', minLength: 3, maxLength: 20 },
              email: { type: 'string', format: 'email' },
              age: { type: 'number', minimum: 18 }
            }
          }
        },
        {
          description: '验证API请求参数',
          params: {
            data: { page: 1, limit: 20, sortBy: 'createdAt' },
            schema: {
              page: { type: 'integer', minimum: 1 },
              limit: { type: 'integer', minimum: 1, maximum: 100 },
              sortBy: { type: 'string', enum: ['createdAt', 'updatedAt', 'name'] }
            }
          }
        }
      );
    } else if (name.includes('excel_reader')) {
      examples.push(
        {
          description: '读取Excel财务报表',
          params: {
            filePath: './reports/财务报表.xlsx',
            sheetName: 'Sheet1',
            options: { header: true }
          }
        },
        {
          description: '读取Excel特定范围',
          params: {
            filePath: './data.xlsx',
            sheetName: 'Data',
            range: 'A1:E100',
            options: { header: true }
          }
        }
      );
    } else if (name.includes('aggregator')) {
      examples.push(
        {
          description: '聚合销售数据',
          params: {
            data: [
              { product: 'A', sales: 100, region: '北京' },
              { product: 'A', sales: 150, region: '上海' },
              { product: 'B', sales: 200, region: '北京' }
            ],
            groupBy: ['product'],
            aggregations: { sales: 'sum' }
          }
        },
        {
          description: '多维度数据聚合',
          params: {
            data: [{ date: '2025-01', revenue: 10000, cost: 6000 }],
            groupBy: ['date'],
            aggregations: { revenue: 'sum', cost: 'sum', profit: 'calculated' }
          }
        }
      );
    } else if (name.includes('search')) {
      examples.push(
        {
          description: '全文搜索文档',
          params: {
            query: '人工智能应用',
            index: 'documents',
            options: { fuzzy: true, limit: 10 }
          }
        },
        {
          description: '高级搜索查询',
          params: {
            query: 'title:AI AND category:技术',
            index: 'articles',
            options: { boost: { title: 2 }, limit: 20 }
          }
        }
      );
    } else {
      // 通用数据处理工具
      examples.push(
        {
          description: `使用${tool.display_name}处理基础数据`,
          params: generateGenericParams(tool, 'basic')
        },
        {
          description: `使用${tool.display_name}处理批量数据`,
          params: generateGenericParams(tool, 'batch')
        }
      );
    }
  }

  // 文本处理工具
  else if (category === 'text') {
    if (name.includes('analyzer')) {
      examples.push(
        {
          description: '分析文章情感倾向',
          params: {
            text: '这个产品非常好用，我很满意！',
            options: { sentiment: true, keywords: true }
          }
        },
        {
          description: '分析文本统计信息',
          params: {
            text: '人工智能技术正在改变世界...',
            options: { wordCount: true, readability: true, language: 'zh' }
          }
        },
        {
          description: '提取关键词和实体',
          params: {
            text: '苹果公司在加州库比蒂诺发布了新产品',
            options: { keywords: true, entities: true, limit: 10 }
          }
        }
      );
    } else if (name.includes('formatter')) {
      examples.push(
        {
          description: '格式化Markdown文档',
          params: {
            text: '# 标题\\n\\n这是内容',
            format: 'markdown',
            options: { prettify: true }
          }
        },
        {
          description: '格式化代码',
          params: {
            text: 'function test(){return true;}',
            format: 'javascript',
            options: { indent: 2, semicolons: true }
          }
        }
      );
    } else {
      examples.push(
        {
          description: `使用${tool.display_name}处理短文本`,
          params: generateGenericParams(tool, 'short')
        },
        {
          description: `使用${tool.display_name}处理长文本`,
          params: generateGenericParams(tool, 'long')
        }
      );
    }
  }

  // AI工具
  else if (category === 'ai') {
    if (name.includes('predictor')) {
      examples.push(
        {
          description: '预测用户流失',
          params: {
            model: 'churn_prediction',
            features: { login_days: 5, purchase_count: 2, support_tickets: 1 },
            options: { threshold: 0.5 }
          }
        },
        {
          description: '预测销售趋势',
          params: {
            model: 'sales_forecast',
            features: { historical_data: [100, 120, 150, 180] },
            options: { periods: 3 }
          }
        }
      );
    } else if (name.includes('searcher')) {
      examples.push(
        {
          description: '搜索相关文档',
          params: {
            query: '如何使用API',
            index: 'knowledge_base',
            options: { top_k: 5, similarity_threshold: 0.7 }
          }
        },
        {
          description: '语义搜索',
          params: {
            query: '智能合约安全问题',
            index: 'blockchain_docs',
            options: { semantic: true, top_k: 10 }
          }
        }
      );
    } else {
      examples.push(
        {
          description: `使用${tool.display_name}进行AI推理`,
          params: generateGenericParams(tool, 'inference')
        },
        {
          description: `使用${tool.display_name}批量处理`,
          params: generateGenericParams(tool, 'batch')
        }
      );
    }
  }

  // 如果没有生成examples，使用通用生成器
  if (examples.length === 0) {
    examples.push(
      {
        description: `${tool.display_name}基础使用`,
        params: generateGenericParams(tool, 'basic')
      },
      {
        description: `${tool.display_name}高级使用`,
        params: generateGenericParams(tool, 'advanced')
      }
    );
  }

  return examples;
}

/**
 * 通用参数生成器
 */
function generateGenericParams(tool, scenario) {
  const params = {};
  const props = tool.parameters_schema?.properties || {};

  Object.entries(props).forEach(([paramName, paramSchema]) => {
    const name = paramName.toLowerCase();

    // 根据scenario调整值
    if (scenario === 'batch') {
      if (paramSchema.type === 'array') {
        params[paramName] = ['item1', 'item2', 'item3', 'item4', 'item5'];
      } else if (name.includes('limit') || name.includes('size')) {
        params[paramName] = 100;
      } else {
        params[paramName] = generateSampleValue(paramName, paramSchema, tool.category);
      }
    } else if (scenario === 'advanced') {
      params[paramName] = generateSampleValue(paramName, paramSchema, tool.category);
      // 添加options参数
      if (paramName === 'options' && paramSchema.type === 'object') {
        params[paramName] = { detailed: true, verbose: true, cache: false };
      }
    } else {
      params[paramName] = generateSampleValue(paramName, paramSchema, tool.category);
    }
  });

  return params;
}

/**
 * 生成示例值（复用之前的逻辑）
 */
function generateSampleValue(paramName, paramSchema, toolCategory) {
  const name = paramName.toLowerCase();

  if (name.includes('path') || name.includes('file')) {
    if (name.includes('input')) return './input/sample.txt';
    if (name.includes('output')) return './output/result.txt';
    return './data/sample.dat';
  }

  if (name.includes('url')) return 'https://api.example.com/v1/resource';
  if (name.includes('text') || name.includes('content')) return '这是一段示例文本';
  if (name.includes('query')) return '搜索关键词';

  if (paramSchema?.type === 'array') return ['item1', 'item2'];
  if (paramSchema?.type === 'boolean') return paramSchema?.default ?? true;
  if (paramSchema?.type === 'number') {
    if (name.includes('port')) return 8080;
    if (name.includes('limit')) return 10;
    return 100;
  }
  if (paramSchema?.enum) return paramSchema.enum[0];
  if (paramSchema?.default !== undefined) return paramSchema.default;

  return 'example_value';
}

// 生成增强examples
const enhancedExamples = {};
let totalGenerated = 0;

highFreqReport.tools.forEach(toolInfo => {
  const tool = toolsMap.get(toolInfo.id);
  if (!tool) return;

  const examples = generateEnhancedExamples(tool);
  enhancedExamples[toolInfo.id] = examples;
  totalGenerated += examples.length;
});

console.log(`✅ 为 ${Object.keys(enhancedExamples).length} 个高频工具生成增强examples`);
console.log(`📊 总共生成: ${totalGenerated} 个examples（平均每工具${(totalGenerated / Object.keys(enhancedExamples).length).toFixed(1)}个）\n`);

// 统计每个工具的examples数量
const exampleCounts = {};
Object.values(enhancedExamples).forEach(examples => {
  const count = examples.length;
  exampleCounts[count] = (exampleCounts[count] || 0) + 1;
});

console.log('Examples数量分布:');
Object.entries(exampleCounts).sort((a, b) => a[0] - b[0]).forEach(([count, tools]) => {
  console.log(`  ${count}个examples: ${tools}个工具`);
});

// 保存到文件
fs.writeFileSync('./enhanced-examples.json', JSON.stringify(enhancedExamples, null, 2));
console.log('\n📄 已保存到: enhanced-examples.json');

// 显示几个示例
console.log('\n示例预览（前3个工具）:');
Object.keys(enhancedExamples).slice(0, 3).forEach(id => {
  const tool = toolsMap.get(id);
  console.log(`\n${id} (${tool?.category}):`);
  console.log(`  当前有${enhancedExamples[id].length}个examples`);
  enhancedExamples[id].forEach((ex, i) => {
    console.log(`  ${i+1}. ${ex.description}`);
  });
});
