const fs = require('fs');
const path = require('path');

// 需要修正的特定字段默认值
const specificFixes = {
  // 教育类
  'tpl_education_exam_101': {
    'examName': '五年级语文期中测试',
    'knowledgePoints': '1. 词语理解与运用\n2. 句子成分分析\n3. 阅读理解\n4. 写作技巧'
  },
  'tpl_education_teaching_design_100': {
    'courseName': '记叙文写作技巧',
    'teachingObjectives': '1. 掌握记叙文的基本结构\n2. 学会运用描写手法\n3. 能够独立完成一篇记叙文',
    'keyPoints': '记叙文的六要素：时间、地点、人物、起因、经过、结果',
    'difficulties': '如何运用细节描写使文章生动'
  },

  // 医疗类
  'tpl_medical_case_006': {
    'topic': '疑难病例讨论：不明原因发热',
    'discussionDate': '2026-01-08',
    'moderator': '李主任',
    'departments': '内科、感染科、检验科',
    'participants': '内科主任医师李医生、感染科副主任医师王医生、检验科主管技师张技师',
    'caseSummary': '患者男性，52岁，因"反复发热1个月"入院。体温波动于37.5-39.2℃，伴乏力、盗汗。',
    'discussionPoints': '1. 发热原因分析\n2. 鉴别诊断\n3. 进一步检查建议',
    'departmentOpinions': '内科：建议完善自身免疫相关检查\n感染科：需排除隐匿性感染\n检验科：血培养已送检',
    'conclusions': '初步诊断：不明原因发热，需进一步检查明确病因',
    'followUpPlan': '1. 完善风湿免疫相关检查\n2. 行PET-CT检查\n3. 继续观察体温变化'
  },
  'tpl_medical_medication_004': {
    'medicationName': '阿莫西林胶囊',
    'genericName': '阿莫西林',
    'indications': '用于敏感菌所致的呼吸道感染、泌尿道感染等',
    'dosage': '成人：一次0.5g，一日3次',
    'precautions': '1. 青霉素过敏者禁用\n2. 肾功能不全者需调整剂量\n3. 服药期间避免饮酒',
    'adverseReactions': '可能出现恶心、呕吐、腹泻、皮疹等',
    'contraindications': '对青霉素类药物过敏者禁用'
  },
  'tpl_medical_report_007': {
    'examName': '血常规检查报告',
    'examDate': '2026-01-08',
    'reportContent': 'WBC: 12.5×10^9/L（参考范围：4-10）\nRBC: 4.5×10^12/L（参考范围：4-5.5）\nHGB: 140g/L（参考范围：120-160）\nPLT: 250×10^9/L（参考范围：100-300）\n中性粒细胞比例: 78%（参考范围：50-70）'
  },

  // 法律类
  'tpl_legal_agency_305': {
    'client': '张三',
    'agent': '李律师',
    'mandate': '代理张三与某科技公司劳动争议一案',
    'rightsObligations': '1. 代理权限：一般代理\n2. 代理期限：至案件审理终结\n3. 费用：律师费10000元',
    'fees': '律师代理费：10000元（一次性支付）'
  },
  'tpl_legal_complaint_302': {
    'plaintiff': '张三',
    'defendant': '某科技公司',
    'caseReason': '劳动合同纠纷',
    'claims': '1. 请求判令被告支付违法解除劳动合同赔偿金50000元\n2. 诉讼费由被告承担',
    'factsAndReasons': '原告于2023年1月入职被告公司，从事软件开发工作。2025年12月，被告以"业绩不佳"为由解除劳动合同，但未提供任何证据。根据《劳动合同法》规定，被告行为构成违法解除。'
  },
  'tpl_legal_evidence_list': {
    'caseName': '张三诉某科技公司劳动争议案',
    'evidenceMaterials': '1. 劳动合同（原件）\n2. 解除劳动合同通知书（原件）\n3. 工资流水（银行打印件）\n4. 社保缴纳记录（社保局打印件）',
    'provingPurpose': '证明双方劳动关系的建立、履行及违法解除的事实'
  },
  'tpl_legal_case_analysis': {
    'caseName': '张三诉某科技公司劳动争议案',
    'facts': '原告于2023年1月入职被告公司，2025年12月被违法解除劳动合同',
    'disputePoints': '被告是否构成违法解除劳动合同',
    'claims': '请求判令被告支付违法解除劳动合同赔偿金50000元',
    'applicableLaws': '《劳动合同法》第四十八条、第八十七条'
  },
  'tpl_legal_opinion': {
    'client': '张三',
    'caseReason': '劳动合同纠纷',
    'facts': '2023年1月入职，2025年12月被违法解除劳动合同',
    'legalAnalysis': '根据《劳动合同法》第四十八条，用人单位违法解除劳动合同的，应当依照经济补偿标准的二倍向劳动者支付赔偿金。',
    'conclusion': '被告公司的解除行为违法，原告有权要求支付赔偿金。建议通过劳动仲裁或诉讼途径维权。'
  },

  // 研究类
  'tpl_research_proposal': {
    'researchTitle': 'AI辅助诊断系统在肺癌早期筛查中的应用研究',
    'researchField': '医学人工智能',
    'background': '肺癌是我国发病率和死亡率最高的恶性肿瘤。早期诊断是提高肺癌患者生存率的关键。',
    'researchQuestions': '1. AI系统能否准确识别早期肺癌影像学特征？\n2. 与传统诊断方法相比，AI辅助诊断的准确率如何？',
    'objectives': '1. 开发基于深度学习的肺癌AI辅助诊断系统\n2. 评估系统在早期肺癌筛查中的性能',
    'methodology': '1. 收集1000例肺部CT影像数据\n2. 使用卷积神经网络训练模型\n3. 进行前瞻性验证研究',
    'expectedOutcomes': '建立准确率>90%的AI辅助诊断系统，提高早期肺癌检出率'
  },
  'tpl_research_literature_review': {
    'researchTopic': 'AI在医疗诊断中的应用',
    'field': '医学人工智能',
    'literatureScope': '2019-2025年发表在顶级期刊的相关研究',
    'currentStatus': '目前AI技术在影像诊断、病理诊断等领域已取得显著进展，但在临床应用中仍面临数据质量、算法可解释性等挑战。'
  }
};

function fixTemplate(templateId, fixes) {
  // 查找模板文件
  const categories = ['medical', 'education', 'research', 'legal'];

  for (const category of categories) {
    const categoryDir = path.join(__dirname, 'src/main/templates', category);
    if (!fs.existsSync(categoryDir)) continue;

    const files = fs.readdirSync(categoryDir);
    for (const file of files) {
      const filePath = path.join(categoryDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const template = JSON.parse(content);

      if (template.id === templateId) {
        console.log(`\n修正模板: ${template.display_name} (${templateId})`);

        let modified = false;
        template.variables_schema.forEach(variable => {
          if (fixes[variable.name] !== undefined) {
            const oldValue = variable.default;
            variable.default = fixes[variable.name];
            console.log(`  ${variable.label}: "${oldValue}" -> "${fixes[variable.name]}"`);
            modified = true;
          }
        });

        if (modified) {
          fs.writeFileSync(filePath, JSON.stringify(template, null, 2) + '\n', 'utf-8');
          console.log(`  ✓ 已保存`);
          return true;
        }
      }
    }
  }

  return false;
}

// 执行修正
console.log('开始修正模板默认值...\n');
let fixed = 0;

for (const [templateId, fixes] of Object.entries(specificFixes)) {
  if (fixTemplate(templateId, fixes)) {
    fixed++;
  }
}

console.log(`\n完成！共修正 ${fixed} 个模板`);
