/**
 * 将V3工具JSON转换为JavaScript格式
 * 用于添加到builtin-tools.js
 */

const fs = require('fs');
const path = require('path');

const tools = require('./v3-tools-complete.json');

let output = `
  // ==================== V3专业领域工具（已补全Schema）====================
  // 以下28个工具来自additional-tools-v3.js，已补充完整schema定义
  // 涵盖：区块链、法律、财务、CRM、HR、项目管理、市场营销、审计等专业领域

`;

tools.forEach((tool, index) => {
  output += `  // ${index + 1}. ${tool.display_name}\n`;
  output += `  {\n`;
  output += `    id: '${tool.id}',\n`;
  output += `    name: '${tool.name}',\n`;
  output += `    display_name: '${tool.display_name}',\n`;
  output += `    description: '${tool.description}',\n`;
  output += `    category: '${tool.category}',\n`;
  output += `    tool_type: '${tool.tool_type}',\n`;

  // parameters_schema
  output += `    parameters_schema: ${JSON.stringify(tool.parameters_schema, null, 6).replace(/^/gm, '    ')},\n`;

  // return_schema
  output += `    return_schema: ${JSON.stringify(tool.return_schema, null, 6).replace(/^/gm, '    ')},\n`;

  // examples
  if (tool.examples && tool.examples.length > 0) {
    output += `    examples: [\n`;
    tool.examples.forEach(ex => {
      output += `      {\n`;
      output += `        description: '${ex.description}',\n`;
      output += `        params: ${JSON.stringify(ex.params, null, 10).replace(/^/gm, '        ')}\n`;
      output += `      }\n`;
    });
    output += `    ],\n`;
  } else {
    output += `    examples: [],\n`;
  }

  // required_permissions
  output += `    required_permissions: ${JSON.stringify(tool.required_permissions)},\n`;

  output += `    risk_level: ${tool.risk_level},\n`;
  output += `    is_builtin: ${tool.is_builtin},\n`;
  output += `    enabled: ${tool.enabled}\n`;
  output += `  }`;

  if (index < tools.length - 1) {
    output += ',\n\n';
  } else {
    output += '\n';
  }
});

// 保存到文件
const outputPath = path.join(__dirname, 'v3-tools-js-format.txt');
fs.writeFileSync(outputPath, output);

console.log(`✅ 已生成JavaScript格式的工具定义`);
console.log(`📄 输出文件: ${outputPath}`);
console.log(`📦 共${tools.length}个工具`);
console.log(`📏 预计增加约${Math.ceil(output.length / 1024)}KB到builtin-tools.js`);
