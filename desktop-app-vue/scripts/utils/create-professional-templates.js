const fs = require('fs');
const path = require('path');

// 教育模板
const educationTemplates = [
  {
    id: 'tpl_education_homework_102',
    name: 'homework-design',
    display_name: '作业设计方案',
    description: '分层作业设计，满足不同学生需求',
    category: 'education',
    subcategory: '作业设计',
    prompt: '请帮我设计分层作业：\n\n学科：{{subject}}\n年级：{{grade}}\n知识点：{{knowledgePoints}}\n\n基础层作业：\n{{basicLevel}}\n\n提高层作业：\n{{advancedLevel}}\n\n请设计完整的分层作业，包括：\n1. 基础巩固题\n2. 能力提升题\n3. 拓展探究题\n4. 评价标准'
  },
  {
    id: 'tpl_education_evaluation_103',
    name: 'student-evaluation',
    display_name: '学生评价报告',
    description: '综合素质评价和学期总结',
    category: 'education',
    subcategory: '学生评价',
    prompt: '请帮我撰写学生评价报告：\n\n学生姓名：{{studentName}}\n学期：{{semester}}\n\n学习表现：\n{{academicPerformance}}\n\n综合表现：\n{{overallPerformance}}\n\n请生成完整的评价报告'
  },
  {
    id: 'tpl_education_parent_meeting_104',
    name: 'parent-meeting',
    display_name: '家长会发言稿',
    description: '家长会主题发言和班级情况汇报',
    category: 'education',
    subcategory: '家校沟通',
    prompt: '请帮我撰写家长会发言稿：\n\n会议主题：{{meetingTheme}}\n班级：{{className}}\n\n班级情况：\n{{classStatus}}\n\n重点内容：\n{{keyPoints}}'
  },
  {
    id: 'tpl_education_teaching_reflection_105',
    name: 'teaching-reflection',
    display_name: '教学反思记录',
    description: '课后反思和教学改进建议',
    category: 'education',
    subcategory: '教学反思',
    prompt: '请帮我撰写教学反思：\n\n课程：{{courseName}}\n日期：{{date}}\n\n教学过程：\n{{teachingProcess}}\n\n存在问题：\n{{issues}}\n\n改进措施：\n{{improvements}}'
  },
  {
    id: 'tpl_education_class_activity_106',
    name: 'class-activity',
    display_name: '班级活动方案',
    description: '主题班会和班级活动设计',
    category: 'education',
    subcategory: '班级管理',
    prompt: '请帮我设计班级活动：\n\n活动主题：{{activityTheme}}\n参与对象：{{participants}}\n\n活动目标：\n{{objectives}}\n\n活动流程：\n{{process}}'
  }
];

// 研究模板
const researchTemplates = [
  {
    id: 'tpl_research_literature_review_201',
    name: 'literature-review',
    display_name: '文献综述撰写',
    description: '学术文献综述和研究现状分析',
    category: 'research',
    subcategory: '文献研究',
    prompt: '请帮我撰写文献综述：\n\n研究主题：{{researchTopic}}\n研究领域：{{field}}\n\n文献范围：\n{{literatureScope}}\n\n研究现状：\n{{currentStatus}}\n\n请生成完整的文献综述'
  },
  {
    id: 'tpl_research_data_analysis_202',
    name: 'data-analysis',
    display_name: '数据分析报告',
    description: '研究数据分析和结果解读',
    category: 'research',
    subcategory: '数据分析',
    prompt: '请帮我撰写数据分析报告：\n\n研究课题：{{researchTitle}}\n数据来源：{{dataSource}}\n\n分析方法：\n{{analysisMethod}}\n\n数据结果：\n{{results}}'
  }
];

// 法律模板
const legalTemplates = [
  {
    id: 'tpl_legal_opinion_301',
    name: 'legal-opinion',
    display_name: '法律意见书',
    description: '专业法律意见和风险分析',
    category: 'legal',
    subcategory: '法律文书',
    prompt: '请帮我撰写法律意见书：\n\n委托人：{{client}}\n案由：{{caseReason}}\n\n案件事实：\n{{facts}}\n\n法律分析：\n{{legalAnalysis}}\n\n意见结论：\n{{conclusion}}'
  },
  {
    id: 'tpl_legal_complaint_302',
    name: 'complaint-draft',
    display_name: '起诉状代写',
    description: '民事、刑事起诉状撰写',
    category: 'legal',
    subcategory: '诉讼文书',
    prompt: '请帮我撰写起诉状：\n\n原告：{{plaintiff}}\n被告：{{defendant}}\n案由：{{caseReason}}\n\n诉讼请求：\n{{claims}}\n\n事实与理由：\n{{factsAndReasons}}'
  },
  {
    id: 'tpl_legal_defense_303',
    name: 'defense-statement',
    display_name: '答辩状撰写',
    description: '诉讼答辩意见和抗辩理由',
    category: 'legal',
    subcategory: '诉讼文书',
    prompt: '请帮我撰写答辩状：\n\n答辩人：{{defendant}}\n原告主张：\n{{plaintiffClaims}}\n\n答辩意见：\n{{defenseOpinion}}\n\n事实与理由：\n{{factsAndReasons}}'
  },
  {
    id: 'tpl_legal_evidence_304',
    name: 'evidence-list',
    display_name: '证据清单整理',
    description: '诉讼证据目录和说明',
    category: 'legal',
    subcategory: '证据材料',
    prompt: '请帮我整理证据清单：\n\n案件：{{caseName}}\n\n证据材料：\n{{evidenceMaterials}}\n\n证明目的：\n{{provingPurpose}}'
  },
  {
    id: 'tpl_legal_agency_305',
    name: 'agency-agreement',
    display_name: '委托代理协议',
    description: '法律服务委托合同',
    category: 'legal',
    subcategory: '合同协议',
    prompt: '请帮我撰写委托代理协议：\n\n委托人：{{client}}\n受托人：{{agent}}\n\n委托事项：\n{{mandate}}\n\n权利义务：\n{{rightsObligations}}\n\n费用：\n{{fees}}'
  },
  {
    id: 'tpl_legal_compliance_306',
    name: 'compliance-review',
    display_name: '合规审查报告',
    description: '企业合规性审查和建议',
    category: 'legal',
    subcategory: '合规审查',
    prompt: '请帮我撰写合规审查报告：\n\n企业：{{company}}\n审查范围：{{scope}}\n\n审查发现：\n{{findings}}\n\n合规建议：\n{{recommendations}}'
  }
];

// 生成模板JSON文件
function createTemplateFile(template, category) {
  const templateObj = {
    id: template.id,
    name: template.name,
    display_name: template.display_name,
    description: template.description,
    icon: category === 'education' ? '📚' : (category === 'research' ? '🔬' : '⚖️'),
    category: template.category,
    subcategory: template.subcategory,
    tags: [template.subcategory],
    project_type: 'document',
    prompt_template: template.prompt,
    variables_schema: extractVariables(template.prompt),
    file_structure: {
      type: 'folder',
      name: `${template.display_name}`,
      children: [{type: 'file', name: `${template.display_name}.md`}]
    },
    is_builtin: true,
    author: 'ChainlessChain Team',
    version: '1.0.0',
    usage_count: 0,
    rating: 0,
    rating_count: 0,
    required_skills: ['skill_document_processing'],
    required_tools: ['tool_word_generator', 'tool_pdf_generator'],
    execution_engine: 'document'
  };

  const dir = path.join('src/main/templates', category);
  const filePath = path.join(dir, `${template.name}.json`);
  
  fs.writeFileSync(filePath, JSON.stringify(templateObj, null, 2));
  console.log(`Created: ${filePath}`);
}

// 从prompt提取变量
function extractVariables(prompt) {
  const matches = prompt.match(/\{\{(\w+)\}\}/g) || [];
  const vars = [...new Set(matches.map(m => m.replace(/\{\{|\}\}/g, '')))];
  
  return vars.map(v => ({
    name: v,
    type: 'textarea',
    label: v,
    required: true
  }));
}

// 创建所有模板
[...educationTemplates, ...researchTemplates, ...legalTemplates].forEach(t => {
  createTemplateFile(t, t.category);
});

console.log('All templates created successfully!');
