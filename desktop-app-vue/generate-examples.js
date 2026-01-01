/**
 * 自动生成工具examples
 * 基于工具类别、参数和描述智能生成示例
 */

const fs = require('fs');
const report = require('./missing-fields-report.json');

// 根据参数类型生成示例值
function generateSampleValue(paramName, paramSchema, toolCategory) {
  const name = paramName.toLowerCase();

  // 文件路径
  if (name.includes('path') || name.includes('file')) {
    if (name.includes('input')) return './input/sample.txt';
    if (name.includes('output')) return './output/result.txt';
    if (name.includes('image')) return './images/sample.png';
    if (name.includes('audio')) return './audio/sample.mp3';
    if (name.includes('video')) return './video/sample.mp4';
    return './data/sample.dat';
  }

  // URL
  if (name.includes('url') || name.includes('endpoint')) {
    return 'https://api.example.com/v1/resource';
  }

  // 文本内容
  if (name.includes('text') || name.includes('content') || name.includes('message')) {
    return '这是一段示例文本用于测试';
  }

  // 代码
  if (name.includes('code') || name.includes('script')) {
    if (toolCategory === 'blockchain') {
      return 'pragma solidity ^0.8.0; contract Example { }';
    }
    return 'function example() { return true; }';
  }

  // 数据/对象
  if (name.includes('data') || name.includes('config') || name.includes('options')) {
    return { key: 'value', enabled: true };
  }

  // 数组
  if (paramSchema?.type === 'array') {
    return ['item1', 'item2'];
  }

  // 布尔值
  if (paramSchema?.type === 'boolean') {
    return paramSchema?.default !== undefined ? paramSchema.default : true;
  }

  // 数字
  if (paramSchema?.type === 'number') {
    if (name.includes('port')) return 8080;
    if (name.includes('size') || name.includes('limit')) return 100;
    if (name.includes('timeout')) return 5000;
    return paramSchema?.default !== undefined ? paramSchema.default : 10;
  }

  // 枚举
  if (paramSchema?.enum && paramSchema.enum.length > 0) {
    return paramSchema.enum[0];
  }

  // 默认值
  if (paramSchema?.default !== undefined) {
    return paramSchema.default;
  }

  // 字符串默认值
  return 'example_value';
}

// 生成工具的example
function generateExample(tool) {
  const params = {};
  const props = tool.parameters_schema?.properties || {};

  // 生成参数示例值
  Object.entries(props).forEach(([paramName, paramSchema]) => {
    params[paramName] = generateSampleValue(paramName, paramSchema, tool.category);
  });

  // 生成描述
  let description = '';
  if (tool.category === 'ai') {
    description = `使用${tool.display_name || tool.name}进行AI处理`;
  } else if (tool.category === 'data') {
    description = `处理数据使用${tool.display_name || tool.name}`;
  } else if (tool.category === 'media') {
    description = `处理媒体文件`;
  } else if (tool.category === 'network') {
    description = `网络请求示例`;
  } else if (tool.category === 'file') {
    description = `文件操作示例`;
  } else {
    description = `${tool.display_name || tool.name}使用示例`;
  }

  return {
    description: description,
    params: params
  };
}

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  批量生成Examples                                       ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

const tools = require('./src/main/skill-tool-system/builtin-tools.js');
const toolsMap = new Map(tools.map(t => [t.id, t]));

const generatedExamples = {};

report.missingExamples.forEach(toolInfo => {
  const tool = toolsMap.get(toolInfo.id);
  if (!tool) return;

  const example = generateExample(tool);  // 传入完整的tool对象
  generatedExamples[toolInfo.id] = [example];
});

console.log(`✅ 已为 ${Object.keys(generatedExamples).length} 个工具生成examples`);

// 按类别统计
const byCategory = {};
Object.keys(generatedExamples).forEach(id => {
  const tool = toolsMap.get(id);
  const cat = tool?.category || 'unknown';
  byCategory[cat] = (byCategory[cat] || 0) + 1;
});

console.log('\n按类别统计:');
Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
  console.log(`  ${cat}: ${count}个`);
});

// 保存到文件
fs.writeFileSync('./generated-examples.json', JSON.stringify(generatedExamples, null, 2));
console.log('\n📄 已保存到: generated-examples.json');

// 显示几个示例
console.log('\n示例预览:');
const sampleIds = Object.keys(generatedExamples).slice(0, 3);
sampleIds.forEach(id => {
  const tool = toolsMap.get(id);
  console.log(`\n${id} (${tool?.category}):`);
  console.log(JSON.stringify(generatedExamples[id], null, 2));
});
