/**
 * 为中频工具生成增强的Examples
 * 每个工具2个场景化示例
 */

const fs = require('fs');
const midFreqReport = require('./mid-frequency-tools.json');
const tools = require('./src/main/skill-tool-system/builtin-tools.js');

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  生成中频工具Examples                                   ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const toolsMap = new Map(tools.map(t => [t.id, t]));

/**
 * 生成示例值
 */
function generateSampleValue(paramName, paramSchema, toolCategory, scenario) {
  const name = paramName.toLowerCase();

  // 根据scenario调整
  const prefix = scenario === 'basic' ? '' : 'advanced_';

  if (name.includes('path') || name.includes('file')) {
    if (name.includes('input')) return `./${prefix}input/data.json`;
    if (name.includes('output')) return `./${prefix}output/result.json`;
    if (name.includes('model')) return `./${prefix}models/trained_model.pkl`;
    return `./${prefix}data/sample.dat`;
  }

  if (name.includes('url')) return `https://api.example.com/${prefix}endpoint`;
  if (name.includes('text') || name.includes('content')) {
    return scenario === 'basic' ? '示例文本' : '更复杂的示例文本内容，用于测试高级功能';
  }
  if (name.includes('query')) {
    return scenario === 'basic' ? '搜索关键词' : '复杂查询：条件A AND 条件B';
  }
  if (name.includes('model')) return scenario === 'basic' ? 'base_model' : 'advanced_model_v2';

  if (paramSchema?.type === 'array') {
    return scenario === 'basic' ? ['item1', 'item2'] : ['item1', 'item2', 'item3', 'item4'];
  }
  if (paramSchema?.type === 'boolean') return scenario === 'basic' ? false : true;
  if (paramSchema?.type === 'number') {
    if (name.includes('threshold')) return scenario === 'basic' ? 0.5 : 0.8;
    if (name.includes('limit')) return scenario === 'basic' ? 10 : 100;
    return scenario === 'basic' ? 10 : 50;
  }
  if (paramSchema?.enum) return paramSchema.enum[scenario === 'basic' ? 0 : 1] || paramSchema.enum[0];
  if (paramSchema?.default !== undefined) return paramSchema.default;

  return scenario === 'basic' ? 'value' : 'advanced_value';
}

/**
 * 为工具生成examples
 */
function generateExamples(tool) {
  const examples = [];
  const category = tool.category;
  const name = tool.name;

  // AI类工具
  if (category === 'ai') {
    if (name.includes('recognizer') || name.includes('detector')) {
      examples.push(
        {
          description: `基础${tool.display_name.split('/')[0]}`,
          params: generateParams(tool, 'basic')
        },
        {
          description: `批量${tool.display_name.split('/')[0]}`,
          params: { ...generateParams(tool, 'advanced'), batch: true }
        }
      );
    } else if (name.includes('predictor') || name.includes('forecaster')) {
      examples.push(
        {
          description: `单次${tool.display_name.split('/')[0]}`,
          params: generateParams(tool, 'basic')
        },
        {
          description: `持续${tool.display_name.split('/')[0]}`,
          params: { ...generateParams(tool, 'advanced'), continuous: true }
        }
      );
    } else if (name.includes('simulator') || name.includes('modeler')) {
      examples.push(
        {
          description: `简单${tool.display_name.split('/')[0]}`,
          params: generateParams(tool, 'basic')
        },
        {
          description: `复杂${tool.display_name.split('/')[0]}`,
          params: generateParams(tool, 'advanced')
        }
      );
    } else {
      examples.push(
        {
          description: `使用${tool.display_name.split('/')[0]}`,
          params: generateParams(tool, 'basic')
        },
        {
          description: `高级${tool.display_name.split('/')[0]}`,
          params: generateParams(tool, 'advanced')
        }
      );
    }
  }
  // Network类工具
  else if (category === 'network') {
    examples.push(
      {
        description: `基本网络${tool.display_name.split('/')[0]}`,
        params: generateParams(tool, 'basic')
      },
      {
        description: `高级网络${tool.display_name.split('/')[0]}`,
        params: generateParams(tool, 'advanced')
      }
    );
  }
  // Code类工具
  else if (category === 'code') {
    examples.push(
      {
        description: `处理简单代码`,
        params: generateParams(tool, 'basic')
      },
      {
        description: `处理复杂项目`,
        params: generateParams(tool, 'advanced')
      }
    );
  }
  // Document类工具
  else if (category === 'document') {
    examples.push(
      {
        description: `处理单个文档`,
        params: generateParams(tool, 'basic')
      },
      {
        description: `批量处理文档`,
        params: generateParams(tool, 'advanced')
      }
    );
  }
  // 其他类别
  else {
    examples.push(
      {
        description: `${tool.display_name.split('/')[0]}基础用法`,
        params: generateParams(tool, 'basic')
      },
      {
        description: `${tool.display_name.split('/')[0]}高级用法`,
        params: generateParams(tool, 'advanced')
      }
    );
  }

  return examples;
}

/**
 * 生成参数
 */
function generateParams(tool, scenario) {
  const params = {};
  const props = tool.parameters_schema?.properties || {};

  Object.entries(props).forEach(([paramName, paramSchema]) => {
    params[paramName] = generateSampleValue(paramName, paramSchema, tool.category, scenario);
  });

  return params;
}

// 生成examples
const enhancedExamples = {};
let totalGenerated = 0;

midFreqReport.tools.forEach(toolInfo => {
  const tool = toolsMap.get(toolInfo.id);
  if (!tool) return;

  const examples = generateExamples(tool);
  enhancedExamples[toolInfo.id] = examples;
  totalGenerated += examples.length;
});

console.log(`✅ 为 ${Object.keys(enhancedExamples).length} 个中频工具生成examples`);
console.log(`📊 总共生成: ${totalGenerated} 个examples（每工具2个）\n`);

// 保存到文件
fs.writeFileSync('./mid-freq-enhanced-examples.json', JSON.stringify(enhancedExamples, null, 2));
console.log('📄 已保存到: mid-freq-enhanced-examples.json');

// 显示几个示例
console.log('\n示例预览（前5个工具）:');
Object.keys(enhancedExamples).slice(0, 5).forEach(id => {
  const tool = toolsMap.get(id);
  console.log(`\n${id} (${tool?.category}):`);
  console.log(`  ${tool?.display_name}`);
  enhancedExamples[id].forEach((ex, i) => {
    console.log(`  ${i+1}. ${ex.description}`);
  });
});
