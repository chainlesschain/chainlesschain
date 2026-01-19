/**
 * 为现有模板添加技能和工具关联
 *
 * 使用方法：
 * node add-skills-tools-to-templates.js
 */

const { logger, createLogger } = require('../utils/logger.js');
const fs = require('fs').promises;
const path = require('path');

// 模板分类与技能/工具映射表
const TEMPLATE_MAPPINGS = {
  // writing 分类
  'writing': {
    defaultSkills: ['skill_content_creation', 'skill_document_processing', 'skill_template_application'],
    defaultTools: ['tool_word_generator', 'tool_template_renderer', 'tool_file_writer'],
    executionEngine: 'word'
  },

  // ppt 分类
  'ppt': {
    defaultSkills: ['skill_office_suite', 'skill_content_creation'],
    defaultTools: ['tool_ppt_generator', 'tool_ppt_slide_creator', 'tool_template_renderer'],
    executionEngine: 'ppt'
  },

  // excel 分类
  'excel': {
    defaultSkills: ['skill_office_suite', 'skill_data_analysis'],
    defaultTools: ['tool_excel_generator', 'tool_excel_formula_builder', 'tool_excel_chart_creator', 'tool_template_renderer'],
    executionEngine: 'excel'
  },

  // web 分类
  'web': {
    defaultSkills: ['skill_web_development', 'skill_code_development'],
    defaultTools: ['tool_html_generator', 'tool_css_generator', 'tool_js_generator', 'tool_create_project_structure'],
    executionEngine: 'web'
  },

  // code-project 分类
  'code-project': {
    defaultSkills: ['skill_code_development', 'skill_project_management'],
    defaultTools: ['tool_create_project_structure', 'tool_git_init', 'tool_file_writer'],
    executionEngine: 'code',
    // 子分类特殊处理
    subcategoryMappings: {
      'frontend': {
        skills: ['skill_web_development'],
        tools: ['tool_npm_project_setup', 'tool_package_json_builder']
      },
      'backend': {
        skills: ['skill_code_development'],
        tools: ['tool_npm_project_setup', 'tool_dockerfile_generator']
      },
      'python': {
        skills: ['skill_code_development'],
        tools: ['tool_python_project_setup', 'tool_requirements_generator']
      }
    }
  },

  // data-science 分类
  'data-science': {
    defaultSkills: ['skill_data_science', 'skill_data_analysis', 'skill_code_development'],
    defaultTools: ['tool_data_preprocessor', 'tool_chart_generator', 'tool_python_project_setup'],
    executionEngine: 'ml',
    subcategoryMappings: {
      'machine-learning': {
        skills: ['skill_data_science'],
        tools: ['tool_ml_model_trainer', 'tool_model_evaluator', 'tool_feature_engineer']
      },
      'data-analysis': {
        skills: ['skill_data_analysis'],
        tools: ['tool_statistical_analyzer', 'tool_eda_generator']
      }
    }
  },

  // design 分类
  'design': {
    defaultSkills: ['skill_image_processing', 'skill_ui_ux_design'],
    defaultTools: ['tool_image_editor', 'tool_color_palette_generator', 'tool_file_writer'],
    executionEngine: 'design'
  },

  // video 分类
  'video': {
    defaultSkills: ['skill_video_production', 'skill_content_creation'],
    defaultTools: ['tool_video_cutter', 'tool_video_merger', 'tool_file_writer'],
    executionEngine: 'video'
  },

  // podcast 分类
  'podcast': {
    defaultSkills: ['skill_audio_editing', 'skill_content_creation'],
    defaultTools: ['tool_audio_editor', 'tool_file_writer'],
    executionEngine: 'audio'
  },

  // creative-writing 分类
  'creative-writing': {
    defaultSkills: ['skill_content_creation', 'skill_document_processing'],
    defaultTools: ['tool_word_generator', 'tool_file_writer', 'tool_template_renderer'],
    executionEngine: 'document'
  },

  // social-media 分类
  'social-media': {
    defaultSkills: ['skill_content_creation', 'skill_seo_marketing'],
    defaultTools: ['tool_seo_optimizer', 'tool_keyword_extractor', 'tool_file_writer'],
    executionEngine: 'default'
  },

  // marketing 分类
  'marketing': {
    defaultSkills: ['skill_content_creation', 'skill_seo_marketing'],
    defaultTools: ['tool_seo_optimizer', 'tool_file_writer', 'tool_template_renderer'],
    executionEngine: 'default'
  },

  // education 分类
  'education': {
    defaultSkills: ['skill_content_creation', 'skill_document_processing'],
    defaultTools: ['tool_word_generator', 'tool_ppt_generator', 'tool_file_writer'],
    executionEngine: 'document'
  },

  // legal 分类
  'legal': {
    defaultSkills: ['skill_document_processing', 'skill_content_creation'],
    defaultTools: ['tool_word_generator', 'tool_pdf_generator', 'tool_file_writer'],
    executionEngine: 'document'
  },

  // ecommerce 分类
  'ecommerce': {
    defaultSkills: ['skill_content_creation', 'skill_seo_marketing'],
    defaultTools: ['tool_file_writer', 'tool_excel_generator', 'tool_template_renderer'],
    executionEngine: 'default'
  },

  // health 分类
  'health': {
    defaultSkills: ['skill_content_creation', 'skill_document_processing'],
    defaultTools: ['tool_word_generator', 'tool_file_writer'],
    executionEngine: 'document'
  }
};

/**
 * 为模板添加技能和工具
 */
async function addSkillsAndTools(templatePath, category, subcategory = null) {
  try {
    // 读取模板文件
    const templateContent = await fs.readFile(templatePath, 'utf-8');
    const template = JSON.parse(templateContent);

    // 如果已经有 required_skills 和 required_tools，跳过
    if (template.required_skills || template.required_tools) {
      logger.info(`⏭️  跳过（已有关联）: ${path.basename(templatePath)}`);
      return { skipped: true };
    }

    // 获取该分类的默认映射
    const mapping = TEMPLATE_MAPPINGS[category];
    if (!mapping) {
      logger.warn(`⚠️  未找到分类 ${category} 的映射配置`);
      return { skipped: true };
    }

    // 组合技能和工具列表
    let skills = [...mapping.defaultSkills];
    let tools = [...mapping.defaultTools];

    // 处理子分类特殊配置
    if (subcategory && mapping.subcategoryMappings && mapping.subcategoryMappings[subcategory]) {
      const subMapping = mapping.subcategoryMappings[subcategory];
      if (subMapping.skills) {
        skills = [...new Set([...skills, ...subMapping.skills])];
      }
      if (subMapping.tools) {
        tools = [...new Set([...tools, ...subMapping.tools])];
      }
    }

    // 根据 project_type 添加特定工具
    if (template.project_type === 'spreadsheet') {
      if (!tools.includes('tool_excel_generator')) {
        tools.push('tool_excel_generator');
      }
    } else if (template.project_type === 'presentation') {
      if (!tools.includes('tool_ppt_generator')) {
        tools.push('tool_ppt_generator');
      }
    } else if (template.project_type === 'document') {
      if (!tools.includes('tool_word_generator')) {
        tools.push('tool_word_generator');
      }
    }

    // 添加新字段
    template.required_skills = skills;
    template.required_tools = tools;
    template.execution_engine = mapping.executionEngine;

    // 写回文件
    await fs.writeFile(templatePath, JSON.stringify(template, null, 2), 'utf-8');

    logger.info(`✅ 已更新: ${path.basename(templatePath)}`);
    logger.info(`   - 技能: ${skills.length} 个`);
    logger.info(`   - 工具: ${tools.length} 个`);
    logger.info(`   - 执行引擎: ${template.execution_engine}`);

    return { updated: true, skills, tools };
  } catch (error) {
    logger.error(`❌ 处理失败: ${templatePath}`, error.message);
    return { error: true };
  }
}

/**
 * 扫描并更新所有模板
 */
async function updateAllTemplates() {
  const templatesDir = path.join(__dirname);
  logger.info('📁 模板目录:', templatesDir);
  logger.info('🔄 开始扫描模板...\n');

  const stats = {
    total: 0,
    updated: 0,
    skipped: 0,
    errors: 0
  };

  // 遍历所有分类目录
  const categories = Object.keys(TEMPLATE_MAPPINGS);

  for (const category of categories) {
    const categoryPath = path.join(templatesDir, category);

    try {
      const stat = await fs.stat(categoryPath);
      if (!stat.isDirectory()) {continue;}

      logger.info(`\n📂 处理分类: ${category}`);

      const files = await fs.readdir(categoryPath);

      for (const file of files) {
        if (!file.endsWith('.json')) {continue;}

        stats.total++;
        const filePath = path.join(categoryPath, file);

        // 读取模板获取 subcategory
        const templateContent = await fs.readFile(filePath, 'utf-8');
        const template = JSON.parse(templateContent);
        const subcategory = template.subcategory;

        const result = await addSkillsAndTools(filePath, category, subcategory);

        if (result.updated) {stats.updated++;}
        if (result.skipped) {stats.skipped++;}
        if (result.error) {stats.errors++;}
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        logger.error(`❌ 处理分类 ${category} 失败:`, error.message);
      }
    }
  }

  // 输出统计
  logger.info('\n' + '='.repeat(50));
  logger.info('📊 更新统计:');
  logger.info(`   - 总计: ${stats.total} 个模板`);
  logger.info(`   - 已更新: ${stats.updated} 个`);
  logger.info(`   - 已跳过: ${stats.skipped} 个`);
  logger.info(`   - 失败: ${stats.errors} 个`);
  logger.info('='.repeat(50));
}

/**
 * 生成映射报告
 */
async function generateMappingReport() {
  const reportPath = path.join(__dirname, 'TEMPLATE_SKILLS_TOOLS_MAPPING.md');

  let report = `# 模板-技能-工具映射表

> 自动生成时间: ${new Date().toISOString()}

## 映射规则

`;

  for (const [category, mapping] of Object.entries(TEMPLATE_MAPPINGS)) {
    report += `### ${category}\n\n`;
    report += `**默认技能**: ${mapping.defaultSkills.map(s => `\`${s}\``).join(', ')}\n\n`;
    report += `**默认工具**: ${mapping.defaultTools.map(t => `\`${t}\``).join(', ')}\n\n`;
    report += `**执行引擎**: \`${mapping.executionEngine}\`\n\n`;

    if (mapping.subcategoryMappings) {
      report += `**子分类特殊配置**:\n\n`;
      for (const [subcat, subMapping] of Object.entries(mapping.subcategoryMappings)) {
        report += `- **${subcat}**\n`;
        if (subMapping.skills) {
          report += `  - 额外技能: ${subMapping.skills.map(s => `\`${s}\``).join(', ')}\n`;
        }
        if (subMapping.tools) {
          report += `  - 额外工具: ${subMapping.tools.map(t => `\`${t}\``).join(', ')}\n`;
        }
      }
      report += '\n';
    }

    report += '---\n\n';
  }

  await fs.writeFile(reportPath, report, 'utf-8');
  logger.info(`\n📄 映射报告已生成: ${reportPath}`);
}

// 执行主函数
(async () => {
  logger.info('🚀 开始为模板添加技能和工具关联...\n');

  await updateAllTemplates();
  await generateMappingReport();

  logger.info('\n✨ 完成！');
})();
