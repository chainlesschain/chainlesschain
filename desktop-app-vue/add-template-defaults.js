const fs = require('fs');
const path = require('path');

// 为不同类型的字段提供默认值
const defaultValuesByField = {
  // 医疗类
  'patientName': '张三',
  'patientAge': '45岁',
  'age': '45岁',
  'gender': '男',
  'symptoms': '发热、咳嗽',
  'diagnosis': '上呼吸道感染',
  'chiefComplaint': '反复咳嗽、咳痰伴发热3天',
  'presentIllness': '患者3天前无明显诱因出现咳嗽、咳痰，痰为白色粘液痰，伴发热',
  'treatmentPlan': '抗感染、止咳化痰对症治疗',
  'medication': '阿莫西林胶囊',
  'dosage': '0.5g',
  'frequency': '每日3次',
  'duration': '7天',
  'medicalTerm': '高血压',
  'caseBackground': '患者男性，45岁，因反复咳嗽就诊',
  'reportType': '血常规',
  'reportData': 'WBC: 12.5×10^9/L, 中性粒细胞比例: 78%',

  // 教育类
  'subject': '语文',
  'grade': '五年级',
  'topic': '记叙文写作',
  'teachingObjectives': '1. 掌握记叙文的基本结构\n2. 学会运用描写手法',
  'teachingContent': '记叙文的六要素：时间、地点、人物、起因、经过、结果',
  'studentName': '李明',
  'classGrade': '五年级二班',
  'activityTheme': '科技创新',
  'examSubject': '数学',
  'questionType': '选择题',
  'homeworkContent': '完成课后练习1-5题',

  // 研究类
  'researchTopic': '人工智能在医疗诊断中的应用',
  'researchQuestion': 'AI技术如何提高疾病诊断的准确率？',
  'researchObjective': '探讨AI辅助诊断系统的有效性',
  'methodology': '文献综述法、实证研究法',
  'dataSource': '医院病例数据库、公开数据集',
  'analysisMethod': '统计分析、机器学习模型',
  'keyword': '人工智能',
  'literatureTitle': 'AI在医疗领域的应用综述',

  // 法律类
  'caseTitle': '某公司劳动争议案',
  'partyA': '张三',
  'partyB': '某科技公司',
  'caseNumber': '(2026)京01民初1234号',
  'caseFacts': '原告于2023年入职被告公司，2025年12月被违法解除劳动合同',
  'legalBasis': '《劳动合同法》第四十八条',
  'claim': '请求判令被告支付违法解除劳动合同赔偿金',
  'evidence': '1. 劳动合同 2. 解除通知书 3. 工资流水',
  'legalIssue': '劳动合同解除的合法性',
  'contractType': '技术开发合同',
  'contractParties': '甲方：某科技公司，乙方：张三'
};

// 根据字段名和类型推断默认值
function inferDefaultValue(fieldName, fieldType, category) {
  // 检查是否有预定义的默认值
  const lowerName = fieldName.toLowerCase();
  for (const [key, value] of Object.entries(defaultValuesByField)) {
    if (lowerName.includes(key.toLowerCase())) {
      return value;
    }
  }

  // 根据类型提供通用默认值
  if (fieldType === 'text') {
    if (lowerName.includes('name')) return '张三';
    if (lowerName.includes('date')) return '2026-01-08';
    if (lowerName.includes('title')) return '示例标题';
    return '示例内容';
  }

  if (fieldType === 'textarea') {
    if (category === 'medical') return '详细描述医疗相关内容';
    if (category === 'education') return '详细描述教学相关内容';
    if (category === 'research') return '详细描述研究相关内容';
    if (category === 'legal') return '详细描述法律相关内容';
    return '请输入详细内容';
  }

  if (fieldType === 'number') return 1;
  if (fieldType === 'boolean') return false;

  return '';
}

// 处理单个模板文件
function processTemplateFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const template = JSON.parse(content);

    if (!template.variables_schema || !Array.isArray(template.variables_schema)) {
      console.log(`[跳过] ${path.basename(filePath)} - 没有 variables_schema`);
      return false;
    }

    let modified = false;

    // 遍历所有变量
    template.variables_schema.forEach(variable => {
      // 只处理必填字段且当前默认值为空的情况
      if (variable.required && (!variable.default || variable.default === '')) {
        const newDefault = inferDefaultValue(variable.name, variable.type, template.category);
        if (newDefault && newDefault !== '') {
          variable.default = newDefault;
          modified = true;
          console.log(`  [修改] ${variable.name}: "${newDefault}"`);
        }
      }
    });

    if (modified) {
      fs.writeFileSync(filePath, JSON.stringify(template, null, 2) + '\n', 'utf-8');
      console.log(`[已更新] ${path.basename(filePath)}`);
      return true;
    } else {
      console.log(`[无需修改] ${path.basename(filePath)}`);
      return false;
    }
  } catch (error) {
    console.error(`[错误] ${path.basename(filePath)}: ${error.message}`);
    return false;
  }
}

// 主函数
function main() {
  const templatesDir = path.join(__dirname, 'src/main/templates');
  const categories = ['medical', 'education', 'research', 'legal'];

  let totalProcessed = 0;
  let totalModified = 0;

  categories.forEach(category => {
    const categoryDir = path.join(templatesDir, category);

    if (!fs.existsSync(categoryDir)) {
      console.log(`[跳过] 目录不存在: ${category}`);
      return;
    }

    console.log(`\n处理 ${category} 类模板...`);
    console.log('='.repeat(60));

    const files = fs.readdirSync(categoryDir).filter(f => f.endsWith('.json'));

    files.forEach(file => {
      const filePath = path.join(categoryDir, file);
      totalProcessed++;

      if (processTemplateFile(filePath)) {
        totalModified++;
      }
    });
  });

  console.log('\n' + '='.repeat(60));
  console.log(`处理完成！共处理 ${totalProcessed} 个模板，修改了 ${totalModified} 个模板`);
}

main();
