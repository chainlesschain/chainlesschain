/**
 * 提示词模板管理器
 *
 * 管理 AI 提示词模板，支持变量替换、分类管理、使用统计等功能
 */

const { v4: uuidv4 } = require('uuid');

/**
 * 提示词模板管理器类
 */
class PromptTemplateManager {
  constructor(databaseManager) {
    this.db = databaseManager;
  }

  /**
   * 初始化
   * 创建数据库表并插入内置模板
   */
  async initialize() {
    try {
      console.log('[PromptTemplateManager] 初始化提示词模板管理器...');

      // 创建表
      await this.createTable();

      // 插入内置模板
      await this.insertBuiltInTemplates();

      console.log('[PromptTemplateManager] 提示词模板管理器初始化成功');
      return true;
    } catch (error) {
      console.error('[PromptTemplateManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 创建数据库表
   */
  async createTable() {
    const sql = `
      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        template TEXT NOT NULL,
        variables TEXT,
        category TEXT DEFAULT 'general',
        is_system INTEGER DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `;

    await this.db.run(sql);
    console.log('[PromptTemplateManager] 数据库表已创建');
  }

  /**
   * 插入内置模板
   */
  async insertBuiltInTemplates() {
    // 检查是否已经存在内置模板
    const existing = await this.db.get(
      'SELECT COUNT(*) as count FROM prompt_templates WHERE is_system = 1'
    );

    if (existing && existing.count > 0) {
      console.log('[PromptTemplateManager] 内置模板已存在，跳过插入');
      return;
    }

    const builtInTemplates = [
      {
        id: 'builtin-summarize',
        name: '内容摘要',
        description: '为长文本生成简洁摘要',
        template: `请为以下内容生成一个简洁的摘要：

{{content}}

要求：
- 保留关键信息和核心观点
- 使用简洁明了的语言
- 长度控制在 200 字以内`,
        variables: JSON.stringify(['content']),
        category: 'writing',
        is_system: 1,
      },
      {
        id: 'builtin-expand',
        name: '内容扩写',
        description: '扩展和丰富简短内容',
        template: `请将以下简短内容扩写成详细的文章：

{{content}}

要求：
- 保持原意不变
- 补充细节和例子
- 逻辑连贯，结构清晰
- 目标长度约 {{length}} 字`,
        variables: JSON.stringify(['content', 'length']),
        category: 'writing',
        is_system: 1,
      },
      {
        id: 'builtin-translate',
        name: '翻译助手',
        description: '翻译文本到指定语言',
        template: `请将以下文本翻译成{{target_language}}：

{{content}}

要求：
- 准确传达原文含义
- 符合目标语言表达习惯
- 保持专业术语的准确性`,
        variables: JSON.stringify(['content', 'target_language']),
        category: 'translation',
        is_system: 1,
      },
      {
        id: 'builtin-proofread',
        name: '文本校对',
        description: '检查并修正文本错误',
        template: `请校对以下文本，找出并修正其中的错误：

{{content}}

请检查：
- 拼写错误
- 语法错误
- 标点符号
- 表达不当的地方

请以表格形式列出：
| 位置 | 原文 | 修改建议 | 原因 |`,
        variables: JSON.stringify(['content']),
        category: 'writing',
        is_system: 1,
      },
      {
        id: 'builtin-extract-keywords',
        name: '关键词提取',
        description: '提取文本的关键词和主题',
        template: `请从以下内容中提取关键词和主题：

{{content}}

请按以下格式输出：
1. 核心主题：
2. 关键词列表（5-10个）：
3. 主要概念：`,
        variables: JSON.stringify(['content']),
        category: 'analysis',
        is_system: 1,
      },
      {
        id: 'builtin-qa',
        name: '问答助手',
        description: '基于上下文回答问题',
        template: `根据以下背景信息回答问题：

背景信息：
{{context}}

问题：{{question}}

请提供准确、详细的回答。如果背景信息不足以回答问题，请说明。`,
        variables: JSON.stringify(['context', 'question']),
        category: 'qa',
        is_system: 1,
      },
      {
        id: 'builtin-brainstorm',
        name: '头脑风暴',
        description: '生成创意想法',
        template: `请就以下主题进行头脑风暴：

主题：{{topic}}

要求：
- 提供 {{count}} 个创意想法
- 每个想法包含简短说明
- 想法应该新颖、可行
- 从不同角度思考`,
        variables: JSON.stringify(['topic', 'count']),
        category: 'creative',
        is_system: 1,
      },
      {
        id: 'builtin-code-explain',
        name: '代码解释',
        description: '解释代码的功能和逻辑',
        template: `请解释以下{{language}}代码的功能和逻辑：

\`\`\`{{language}}
{{code}}
\`\`\`

请包含：
1. 代码整体功能
2. 关键逻辑说明
3. 重要函数/方法解释
4. 可能的优化建议`,
        variables: JSON.stringify(['code', 'language']),
        category: 'programming',
        is_system: 1,
      },
      {
        id: 'builtin-outline',
        name: '大纲生成',
        description: '为文章生成结构化大纲',
        template: `请为以下主题生成一个详细的文章大纲：

主题：{{topic}}

要求：
- 至少包含 {{sections}} 个主要章节
- 每个章节有 2-3 个小节
- 逻辑清晰，结构合理
- 包含引言和结论`,
        variables: JSON.stringify(['topic', 'sections']),
        category: 'writing',
        is_system: 1,
      },
      {
        id: 'builtin-rag-query',
        name: 'RAG 增强查询',
        description: '基于检索结果回答问题',
        template: `你是一个知识助手，请基于以下检索到的相关文档回答用户问题。

相关文档：
{{retrieved_docs}}

用户问题：{{question}}

请遵循以下原则：
1. 优先使用检索到的文档信息
2. 如果文档信息不足，可以使用你的知识补充
3. 明确区分文档信息和推理内容
4. 如果无法回答，诚实说明
5. 提供信息来源（引用文档序号）`,
        variables: JSON.stringify(['retrieved_docs', 'question']),
        category: 'rag',
        is_system: 1,
      },
      // ============================================
      // 医生/医疗职业专用模板
      // ============================================
      {
        id: 'builtin-medical-record',
        name: '病历记录助手',
        description: '结构化病历记录模板，帮助医生快速整理患者病历',
        template: `请帮我生成结构化的病历记录：

患者信息：
- 姓名：{{patientName}}
- 性别：{{gender}}
- 年龄：{{age}}岁
- 就诊日期：{{visitDate}}

主诉：{{chiefComplaint}}

现病史：{{presentIllness}}

既往史：{{pastHistory}}

请按照以下标准格式整理病历：

## 病历记录

**患者基本信息**
- 姓名：{{patientName}}
- 性别：{{gender}}
- 年龄：{{age}}岁
- 门诊/住院号：[待填写]
- 就诊日期：{{visitDate}}

**主诉**
{{chiefComplaint}}

**现病史**
{{presentIllness}}

**既往史**
{{pastHistory}}

**体格检查**
[根据主诉建议需要进行的体格检查项目]

**辅助检查**
[根据临床表现建议需要进行的辅助检查]

**初步诊断**
[基于以上信息的初步诊断意见]

**诊疗计划**
[建议的治疗方案和注意事项]

**医嘱**
[具体医嘱内容]

**随访建议**
[复诊时间和注意事项]

注意：以上内容仅供参考，请结合实际临床情况进行调整。`,
        variables: JSON.stringify(['patientName', 'gender', 'age', 'visitDate', 'chiefComplaint', 'presentIllness', 'pastHistory']),
        category: 'medical',
        is_system: 1,
      },
      {
        id: 'builtin-medical-diagnosis-aid',
        name: '诊断辅助分析',
        description: '基于症状和检查结果，提供诊断思路梳理',
        template: `作为医疗诊断辅助工具，请分析以下患者信息并提供诊断思路：

患者症状：{{symptoms}}

检查结果：{{testResults}}

请按照以下框架进行分析：

## 诊断思路分析

### 1. 症状归纳
[总结主要症状特点]

### 2. 鉴别诊断
列出可能的诊断及其依据：
- 诊断1：[依据]
- 诊断2：[依据]
- 诊断3：[依据]

### 3. 进一步检查建议
[建议进行的其他检查以明确诊断]

### 4. 紧急情况评估
[评估是否存在需要紧急处理的情况]

### 5. 治疗方向建议
[初步治疗方向建议]

**免责声明**：本分析仅供临床参考，最终诊断和治疗方案需由执业医师根据完整临床信息综合判断。`,
        variables: JSON.stringify(['symptoms', 'testResults']),
        category: 'medical',
        is_system: 1,
      },
      {
        id: 'builtin-medical-literature-summary',
        name: '医学文献摘要',
        description: '快速提取医学论文核心要点',
        template: `请为以下医学文献生成结构化摘要：

文献标题：{{title}}

文献内容：
{{content}}

请按照以下格式整理摘要：

## 文献摘要

**标题**：{{title}}

**研究背景**
[简述研究背景和意义]

**研究目的**
[明确研究的主要目的]

**研究方法**
- 研究类型：
- 样本量：
- 研究对象：
- 方法学：

**主要结果**
[核心研究发现，用数据说话]

**结论**
[研究得出的主要结论]

**临床意义**
[对临床实践的指导意义]

**局限性**
[研究存在的局限性]

**关键词**：[提取3-5个关键词]

**证据等级**：[评估证据等级]`,
        variables: JSON.stringify(['title', 'content']),
        category: 'medical',
        is_system: 1,
      },
      {
        id: 'builtin-medical-medication-guide',
        name: '用药指导生成',
        description: '生成患者易懂的用药说明',
        template: `请为以下药物生成患者用药指导：

药物名称：{{medicationName}}

适应症：{{indication}}

用法用量：{{dosage}}

请生成患者易懂的用药指导：

## {{medicationName}} 用药指导

**您需要服用的药物**
{{medicationName}}

**为什么要服用这个药**
{{indication}}

**如何服用**
{{dosage}}

**服药时间**
[建议的具体服药时间，如饭前/饭后/睡前等]

**注意事项**
1. 不要随意增减药量或停药
2. [其他重要注意事项]
3. [饮食禁忌]
4. [活动限制]

**可能的副作用**
[常见副作用及应对方法]

**什么情况需要立即就医**
[需要警惕的严重不良反应]

**药物保存**
[储存方法和有效期]

**如有疑问**
请及时联系您的主治医师或药师

**复诊提醒**
[下次复诊时间]`,
        variables: JSON.stringify(['medicationName', 'indication', 'dosage']),
        category: 'medical',
        is_system: 1,
      },
      {
        id: 'builtin-medical-terminology-explain',
        name: '医学术语解释',
        description: '将专业医学术语转换为患者易懂的语言',
        template: `请将以下医学术语用通俗易懂的语言解释给患者：

医学术语：{{medicalTerm}}

相关上下文：{{context}}

请按以下格式解释：

## {{medicalTerm}} - 通俗解释

**专业术语**：{{medicalTerm}}

**简单理解**
[用日常语言解释，避免使用其他专业术语]

**打个比方**
[用生活中的例子类比说明]

**为什么会出现这种情况**
[简单说明原因或机制]

**需要注意什么**
[患者需要了解的注意事项]

**相关知识**
[补充相关的健康知识]

**记住这一点**
[最核心、最重要的信息，一句话总结]`,
        variables: JSON.stringify(['medicalTerm', 'context']),
        category: 'medical',
        is_system: 1,
      },
      {
        id: 'builtin-medical-case-discussion',
        name: '病例讨论记录',
        description: '多学科会诊和病例讨论记录模板',
        template: `请整理以下病例讨论记录：

患者情况：{{patientSummary}}

讨论科室：{{departments}}

讨论主题：{{topic}}

请生成规范的病例讨论记录：

## 多学科病例讨论记录

**会诊时间**：[当前日期时间]

**患者信息**
{{patientSummary}}

**讨论主题**
{{topic}}

**参与科室**
{{departments}}

**各科室意见**

[为每个参与科室整理意见要点]

### [科室1]意见：
- 意见要点1
- 意见要点2

### [科室2]意见：
- 意见要点1
- 意见要点2

**综合诊疗意见**
[整合各科室意见后的综合诊疗建议]

**下一步计划**
1. [具体措施1]
2. [具体措施2]
3. [随访计划]

**责任医师**
主管医师：
参与会诊医师：`,
        variables: JSON.stringify(['patientSummary', 'departments', 'topic']),
        category: 'medical',
        is_system: 1,
      },
      {
        id: 'builtin-medical-report-interpret',
        name: '医疗报告解读',
        description: '将检验检查报告转换为患者易懂的解读',
        template: `请将以下医疗报告解读给患者：

报告类型：{{reportType}}

检查结果：
{{reportContent}}

请生成患者易懂的解读：

## {{reportType}}检查结果解读

**您做的检查**
{{reportType}}

**检查结果总体评价**
[用简单的语言总结整体情况：正常/基本正常/异常需注意]

**具体指标解读**

[对每个重要指标进行解释]

### 指标1：[指标名称]
- 您的结果：[数值]
- 正常范围：[范围]
- 这意味着什么：[通俗解释]

### 指标2：[指标名称]
- 您的结果：[数值]
- 正常范围：[范围]
- 这意味着什么：[通俗解释]

**需要注意的地方**
[重点标注异常指标及其意义]

**医生的建议**
[根据结果给出生活方式建议]

**是否需要进一步检查**
[是否需要复查或其他检查]

**疑问解答**
[预判患者可能的疑问并提前解答]`,
        variables: JSON.stringify(['reportType', 'reportContent']),
        category: 'medical',
        is_system: 1,
      },
      // ============================================
      // 律师/法律职业专用模板
      // ============================================
      {
        id: 'builtin-legal-case-analysis',
        name: '案件分析助手',
        description: '案情分析和法律适用框架',
        template: `请对以下案件进行法律分析：

案情概述：{{caseDescription}}

争议焦点：{{disputeFocus}}

相关证据：{{evidence}}

请按照以下框架进行专业分析：

## 案件分析报告

### 一、案情摘要
{{caseDescription}}

### 二、争议焦点
{{disputeFocus}}

### 三、法律关系分析
[识别并分析案件中的法律关系]

### 四、法律适用分析

#### 4.1 适用法律法规
[列举相关法律法规及具体条款]

#### 4.2 法律要件分析
[分析各项法律要件是否满足]

#### 4.3 举证责任分配
[明确各方当事人的举证责任]

### 五、证据分析

#### 5.1 现有证据评估
{{evidence}}

[逐项分析证据的证明力和可采信度]

#### 5.2 证据链完整性
[评估证据链是否完整]

#### 5.3 补充证据建议
[建议需要补充收集的证据]

### 六、案件风险评估

#### 6.1 有利因素
[列举对我方有利的因素]

#### 6.2 不利因素
[识别潜在风险点]

#### 6.3 胜诉可能性评估
[给出胜诉可能性评估]

### 七、法律意见

#### 7.1 诉讼策略建议
[提出诉讼策略]

#### 7.2 和解方案建议
[如适用，提出和解方案]

#### 7.3 后续工作建议
[提出下一步工作重点]

**注意**：本分析仅供法律专业人士参考，不构成正式法律意见。`,
        variables: JSON.stringify(['caseDescription', 'disputeFocus', 'evidence']),
        category: 'legal',
        is_system: 1,
      },
      {
        id: 'builtin-legal-opinion-letter',
        name: '法律意见书撰写',
        description: '专业法律意见书撰写框架',
        template: `请撰写法律意见书：

委托方：{{client}}

咨询事项：{{matter}}

事实背景：{{background}}

请按以下专业格式撰写法律意见书：

# 法律意见书

**致**：{{client}}

**事由**：关于{{matter}}的法律意见

**编号**：[待填写]

**日期**：[当前日期]

---

## 一、委托事项

{{client}}就{{matter}}事宜委托本律师出具法律意见。

## 二、事实背景

{{background}}

以上事实基于委托方提供的资料，如有新的事实需补充调整本意见。

## 三、法律分析

### 3.1 法律依据

[列举相关法律法规]

### 3.2 法律适用分析

[详细分析法律如何适用于本案]

### 3.3 法律后果分析

[分析可能产生的法律后果]

## 四、风险提示

### 4.1 主要法律风险

[识别主要法律风险]

### 4.2 次要风险因素

[识别次要风险]

### 4.3 风险防范建议

[提出风险防范措施]

## 五、法律意见

基于以上分析，本律师认为：

[明确、具体的法律意见]

## 六、建议

### 6.1 程序建议

[提出程序性建议]

### 6.2 实体建议

[提出实体性建议]

### 6.3 其他建议

[其他相关建议]

## 七、声明

1. 本法律意见仅基于委托方提供的资料和现行有效的法律法规
2. 本法律意见仅供委托方参考，不应作为其他用途使用
3. 如有新的事实或法律变化，本意见可能需要调整

---

**律师事务所**：[律所名称]

**出具律师**：[律师姓名]

**执业证号**：[证号]

**日期**：[日期]`,
        variables: JSON.stringify(['client', 'matter', 'background']),
        category: 'legal',
        is_system: 1,
      },
      {
        id: 'builtin-legal-contract-review',
        name: '合同审查清单',
        description: '全面的合同审查要点清单',
        template: `请审查以下合同：

合同类型：{{contractType}}

合同内容：
{{contractContent}}

请按照专业标准进行合同审查：

## 合同审查报告

**合同名称**：{{contractType}}

**审查日期**：[当前日期]

### 一、形式审查

#### 1.1 基本形式要件
- [ ] 合同名称是否明确
- [ ] 当事人信息是否完整
- [ ] 合同编号是否规范
- [ ] 签署日期是否填写

#### 1.2 当事人资格审查
- [ ] 当事人主体资格
- [ ] 签约代表授权
- [ ] 公章真实性

### 二、实质审查

#### 2.1 核心条款审查

**标的条款**
[审查标的是否明确、合法]

**价款条款**
[审查价款确定方式、支付方式]

**履行条款**
[审查履行期限、地点、方式]

**违约责任**
[审查违约责任是否对等、合理]

#### 2.2 重点风险条款

[识别存在风险的条款]

### 三、法律合规性审查

#### 3.1 合同效力审查
[是否存在影响合同效力的情形]

#### 3.2 法律法规符合性
[是否违反法律法规强制性规定]

### 四、风险识别

#### 4.1 重大风险
[列举重大法律风险]

#### 4.2 一般风险
[列举一般法律风险]

#### 4.3 潜在风险
[识别潜在风险]

### 五、修改建议

#### 5.1 必须修改条款
[必须修改的条款及修改建议]

#### 5.2 建议修改条款
[建议修改的条款及理由]

#### 5.3 补充条款建议
[建议增加的条款]

### 六、审查结论

#### 综合意见
[给出审查结论：建议签署/修改后签署/不建议签署]

#### 注意事项
[特别提醒注意的事项]

---

**审查律师**：[姓名]

**日期**：[日期]`,
        variables: JSON.stringify(['contractType', 'contractContent']),
        category: 'legal',
        is_system: 1,
      },
      {
        id: 'builtin-legal-litigation-strategy',
        name: '诉讼策略规划',
        description: '诉讼方案设计和策略规划',
        template: `请制定诉讼策略：

案件类型：{{caseType}}

当事人角色：{{partyRole}}（原告/被告/第三人）

案情简介：{{caseBrief}}

请设计诉讼策略方案：

## 诉讼策略方案

### 一、案件基本情况

**案件类型**：{{caseType}}

**我方角色**：{{partyRole}}

**案情概述**：{{caseBrief}}

### 二、诉讼目标确定

#### 2.1 核心诉求
[明确最核心的诉讼目标]

#### 2.2 次要诉求
[列出次要诉讼目标]

#### 2.3 底线目标
[确定可接受的最低目标]

### 三、诉讼方案设计

#### 3.1 管辖法院选择
[分析并选择有利的管辖法院]

#### 3.2 诉讼请求设计
[设计具体的诉讼请求]

#### 3.3 事实和理由
[梳理主张的事实和法律依据]

### 四、证据策略

#### 4.1 现有证据评估
[评估手中证据的证明力]

#### 4.2 证据补充计划
[制定证据收集补充计划]

#### 4.3 举证时机安排
[规划证据提交的时机]

### 五、程序策略

#### 5.1 保全措施
[是否需要申请保全及保全方案]

#### 5.2 程序阶段策略
[各诉讼阶段的具体策略]

#### 5.3 时间节点规划
[关键时间节点和应对计划]

### 六、风险应对

#### 6.1 对方可能的抗辩
[预判对方抗辩理由]

#### 6.2 应对策略
[针对性的应对方案]

### 七、和解方案

#### 7.1 和解时机
[合适的和解时机判断]

#### 7.2 和解条件
[可接受的和解条件]

### 八、费用预算

[诉讼费用概算]

### 九、总结建议

[综合性建议和提醒]

---

**制定人**：[律师姓名]

**日期**：[日期]`,
        variables: JSON.stringify(['caseType', 'partyRole', 'caseBrief']),
        category: 'legal',
        is_system: 1,
      },
      {
        id: 'builtin-legal-consultation-record',
        name: '法律咨询记录',
        description: '结构化法律咨询记录模板',
        template: `请整理法律咨询记录：

咨询人：{{consultantName}}

咨询事项：{{consultationMatter}}

咨询内容：{{consultationContent}}

请生成专业的咨询记录：

## 法律咨询记录

**记录编号**：[编号]

**咨询时间**：[当前日期时间]

**咨询方式**：[面谈/电话/在线]

### 一、咨询人信息

**姓名/名称**：{{consultantName}}

**联系方式**：[待填写]

**身份**：[当事人本人/代理人/其他]

### 二、咨询事项

{{consultationMatter}}

### 三、咨询内容详情

{{consultationContent}}

### 四、相关材料

[咨询人提供的材料清单]

### 五、法律分析

#### 5.1 基本事实认定
[整理和确认基本事实]

#### 5.2 法律关系分析
[分析涉及的法律关系]

#### 5.3 适用法律
[确定应适用的法律法规]

### 六、法律意见

#### 6.1 主要意见
[针对咨询事项的主要法律意见]

#### 6.2 风险提示
[告知可能存在的法律风险]

#### 6.3 建议方案
[提供解决方案建议]

### 七、后续安排

#### 7.1 需要补充的材料
[列出需要补充的材料]

#### 7.2 下一步工作
[明确下一步工作内容]

#### 7.3 时间要求
[告知时间节点要求]

### 八、备注

[其他需要记录的事项]

---

**接待律师**：[姓名]

**记录人**：[姓名]

**日期**：[日期]

**咨询人签字**：____________`,
        variables: JSON.stringify(['consultantName', 'consultationMatter', 'consultationContent']),
        category: 'legal',
        is_system: 1,
      },
      {
        id: 'builtin-legal-precedent-analysis',
        name: '判例检索分析',
        description: '相似判例对比分析工具',
        template: `请分析相似判例：

本案情况：{{currentCase}}

检索到的判例：
{{precedents}}

请进行系统的判例分析：

## 判例检索分析报告

### 一、本案基本情况

{{currentCase}}

### 二、检索情况说明

**检索关键词**：[使用的检索词]

**检索范围**：[检索的数据库和时间范围]

**检索结果数量**：[检索到的判例数量]

### 三、相似判例分析

{{precedents}}

#### 判例一

**案号**：[案号]

**审理法院**：[法院]

**裁判时间**：[时间]

**相似度评估**：[高/中/低]

**案情简介**
[简要案情]

**争议焦点**
[争议焦点]

**法院观点**
[法院的法律观点]

**裁判结果**
[裁判结果]

**相似性分析**
[与本案的相似点和不同点]

**参考价值**
[对本案的参考价值评估]

#### 判例二

[同上格式]

### 四、判例共性归纳

#### 4.1 法律适用共性
[归纳法律适用的共同点]

#### 4.2 裁判规则提炼
[提炼可参考的裁判规则]

#### 4.3 司法倾向分析
[分析法院在此类案件的司法倾向]

### 五、对本案的启示

#### 5.1 有利因素
[判例支持我方观点的因素]

#### 5.2 不利因素
[判例不利于我方的因素]

#### 5.3 应对策略
[基于判例分析的策略建议]

### 六、结论建议

[综合性结论和建议]

---

**分析人**：[律师姓名]

**日期**：[日期]`,
        variables: JSON.stringify(['currentCase', 'precedents']),
        category: 'legal',
        is_system: 1,
      },
      {
        id: 'builtin-legal-document-proofread',
        name: '法律文书校对',
        description: '法律文书规范性和准确性检查',
        template: `请校对以下法律文书：

文书类型：{{documentType}}

文书内容：
{{documentContent}}

请进行全面的专业校对：

## 法律文书校对报告

**文书类型**：{{documentType}}

**校对日期**：[当前日期]

### 一、形式规范检查

#### 1.1 格式规范
- [ ] 文书标题格式
- [ ] 段落编号规范
- [ ] 页码页眉设置
- [ ] 字体字号统一

#### 1.2 必备要素
- [ ] 案号/文号
- [ ] 当事人信息完整
- [ ] 日期签署栏
- [ ] 署名盖章位置

### 二、内容准确性检查

#### 2.1 事实部分
[检查事实叙述的准确性和完整性]

- 错误或不准确之处：
- 建议修改：

#### 2.2 法律适用部分
[检查法律条文引用的准确性]

- 错误或不规范之处：
- 建议修改：

#### 2.3 诉求/请求部分
[检查诉求表述的明确性和完整性]

- 不明确或不完整之处：
- 建议修改：

### 三、语言文字检查

#### 3.1 错别字
[列出发现的错别字]

#### 3.2 标点符号
[指出标点符号错误]

#### 3.3 语句通顺性
[指出语句不通顺之处]

#### 3.4 专业术语规范性
[检查法律术语使用是否规范]

### 四、逻辑性检查

#### 4.1 论证逻辑
[检查论证是否严密]

#### 4.2 前后一致性
[检查前后表述是否一致]

### 五、风险提示

#### 5.1 表述风险
[指出可能引起歧义或不利解释的表述]

#### 5.2 遗漏风险
[指出可能遗漏的重要内容]

### 六、修改建议汇总

#### 6.1 必须修改
[列出必须修改的问题]

#### 6.2 建议修改
[列出建议修改的内容]

#### 6.3 优化建议
[提出优化建议]

### 七、校对结论

**整体评价**：[合格/需修改后使用/需重新起草]

**主要问题**：[summarize]

**修改建议**：[整体建议]

---

**校对人**：[姓名]

**日期**：[日期]`,
        variables: JSON.stringify(['documentType', 'documentContent']),
        category: 'legal',
        is_system: 1,
      },
      // ============================================
      // 教师/教育职业专用模板
      // ============================================
      {
        id: 'builtin-teacher-lesson-plan',
        name: '课程大纲生成',
        description: '完整课程体系设计框架',
        template: `请设计完整的课程大纲：

课程名称：{{courseName}}

授课对象：{{targetStudents}}

课时安排：{{totalHours}}课时

教学目标：{{objectives}}

请生成系统的课程大纲：

## {{courseName}} 课程大纲

### 一、课程基本信息

**课程名称**：{{courseName}}

**授课对象**：{{targetStudents}}

**总课时**：{{totalHours}}课时

**课程性质**：[必修/选修/公选]

**学分**：[待定]

### 二、课程简介

[课程概述、主要内容和特色]

### 三、教学目标

#### 3.1 知识目标
{{objectives}}

[学生应掌握的知识点]

#### 3.2 能力目标
[学生应培养的能力]

#### 3.3 素质目标
[学生应形成的价值观和态度]

### 四、课程内容与学时分配

#### 第一单元：[单元名称]（X课时）

**教学内容**
1. [知识点1]
2. [知识点2]

**教学重点**
[本单元重点内容]

**教学难点**
[学生可能遇到的困难]

**教学方法**
[讲授/讨论/实践等]

#### 第二单元：[单元名称]（X课时）

[同上格式]

### 五、教学方法与手段

#### 5.1 教学方法
- 讲授法
- 案例教学法
- 小组讨论法
- 项目式学习

#### 5.2 教学手段
- 多媒体课件
- 在线学习平台
- 实践操作
- 翻转课堂

### 六、考核方式

#### 6.1 考核构成
- 平时成绩：30%
  - 课堂参与：10%
  - 作业：10%
  - 小测验：10%
- 期中考试：20%
- 期末考试：50%

#### 6.2 考核标准
[具体评分标准]

### 七、教材与参考资料

#### 7.1 主要教材
[教材名称、作者、出版社]

#### 7.2 参考资料
1. [参考书1]
2. [参考书2]
3. [在线资源]

### 八、教学进度安排

| 周次 | 教学内容 | 教学方式 | 作业/考核 |
|------|---------|----------|-----------|
| 1 | [内容] | [方式] | [作业] |
| 2 | [内容] | [方式] | [作业] |

### 九、特色与创新

[本课程的特色和创新点]

### 十、备注

[其他需要说明的事项]

---

**制定人**：{{teacherName}}

**制定日期**：[当前日期]`,
        variables: JSON.stringify(['courseName', 'targetStudents', 'totalHours', 'objectives', 'teacherName']),
        category: 'education',
        is_system: 1,
      },
      {
        id: 'builtin-teacher-reflection',
        name: '教学反思记录',
        description: '教学效果分析和改进建议',
        template: `请记录教学反思：

课程：{{lessonName}}

授课班级：{{className}}

授课日期：{{date}}

教学内容：{{content}}

请进行系统的教学反思：

## 教学反思

**课程名称**：{{lessonName}}

**授课班级**：{{className}}

**授课日期**：{{date}}

**教学内容**：{{content}}

### 一、教学设计回顾

#### 1.1 教学目标达成情况
[分析各项教学目标是否达成]

- 知识目标达成度：[高/中/低]
- 能力目标达成度：[高/中/低]
- 情感目标达成度：[高/中/低]

#### 1.2 教学流程回顾
[回顾实际教学流程]

### 二、教学亮点

#### 2.1 成功之处
[总结本节课的成功经验]

1. [亮点1]
2. [亮点2]

#### 2.2 学生表现亮点
[记录学生的优秀表现]

### 三、存在问题

#### 3.1 教学设计问题
[教学设计中的不足]

#### 3.2 教学实施问题
[课堂实施中的问题]

#### 3.3 学生学习问题
[学生学习中遇到的困难]

### 四、原因分析

#### 4.1 教师层面
[从教师角度分析问题原因]

#### 4.2 学生层面
[从学生角度分析问题原因]

#### 4.3 资源层面
[教学资源、环境等方面的影响]

### 五、改进措施

#### 5.1 短期改进
[下次课立即可以改进的措施]

1. [措施1]
2. [措施2]

#### 5.2 长期改进
[需要逐步改进的方面]

1. [措施1]
2. [措施2]

### 六、教学启示

[本次教学带来的启发和思考]

### 七、后续行动计划

#### 7.1 学生辅导计划
[针对学习困难学生的辅导安排]

#### 7.2 教学资源完善
[需要补充的教学资源]

#### 7.3 教学方法调整
[下次教学的方法调整]

### 八、备注

[其他值得记录的事项]

---

**反思人**：[教师姓名]

**反思日期**：[当前日期]`,
        variables: JSON.stringify(['lessonName', 'className', 'date', 'content']),
        category: 'education',
        is_system: 1,
      },
      {
        id: 'builtin-teacher-student-evaluation',
        name: '学生评价生成',
        description: '个性化学生评语生成',
        template: `请生成学生评价：

学生姓名：{{studentName}}

学习表现：{{performance}}

特点描述：{{characteristics}}

请生成个性化、激励性的学生评语：

## 学生综合评价

**学生姓名**：{{studentName}}

**评价学期**：[学期]

**评价日期**：[当前日期]

### 一、学习表现

#### 1.1 学习态度
{{performance}}

[具体描述学习态度]

#### 1.2 课堂表现
[课堂参与、纪律等]

#### 1.3 作业完成情况
[作业质量和完成及时性]

#### 1.4 学习成绩
[成绩表现和进步情况]

### 二、综合素质

#### 2.1 思想品德
[品德修养、价值观]

#### 2.2 能力发展
{{characteristics}}

[分析能力、创造力、合作能力等]

#### 2.3 个性特点
[性格特点、兴趣爱好]

### 三、突出优点

[用具体事例说明学生的优点]

1. [优点1 + 具体事例]
2. [优点2 + 具体事例]
3. [优点3 + 具体事例]

### 四、需要改进的方面

[委婉指出需要改进的地方]

1. [改进点1 + 建议]
2. [改进点2 + 建议]

### 五、教师寄语

[鼓励性的寄语，提出具体期望]

### 六、家校合作建议

[给家长的具体建议]

1. [建议1]
2. [建议2]

---

**评价教师**：[姓名]

**日期**：[日期]`,
        variables: JSON.stringify(['studentName', 'performance', 'characteristics']),
        category: 'education',
        is_system: 1,
      },
      {
        id: 'builtin-teacher-assignment-feedback',
        name: '作业批改辅助',
        description: '作业批改意见生成工具',
        template: `请生成作业批改意见：

作业类型：{{assignmentType}}

学生答案：
{{studentAnswer}}

标准答案/评分标准：
{{rubric}}

请生成详细的批改意见：

## 作业批改反馈

**作业类型**：{{assignmentType}}

**批改日期**：[当前日期]

### 一、整体评价

**得分**：[分数]/[总分]

**等级**：[优秀/良好/中等/需改进]

**总体评价**：
[一句话概括作业质量]

### 二、逐项评分

#### 评分细则

| 评分项 | 满分 | 得分 | 评语 |
|--------|------|------|------|
| [项目1] | XX | XX | [简要评语] |
| [项目2] | XX | XX | [简要评语] |
| 总分 | 100 | XX | |

### 三、优点分析

[指出作业中的亮点]

1. **[优点1]**
   具体表现：[详细说明]

2. **[优点2]**
   具体表现：[详细说明]

### 四、存在问题

[指出需要改进的地方]

1. **[问题1]**
   - 具体表现：[说明]
   - 原因分析：[分析]
   - 改进建议：[建议]

2. **[问题2]**
   - 具体表现：[说明]
   - 原因分析：[分析]
   - 改进建议：[建议]

### 五、知识点掌握情况

#### 5.1 已掌握的知识点
- [知识点1]
- [知识点2]

#### 5.2 需要加强的知识点
- [知识点1] - [建议]
- [知识点2] - [建议]

### 六、改进建议

#### 6.1 学习方法建议
[提出具体的学习方法建议]

#### 6.2 练习建议
[推荐相关练习]

### 七、鼓励语

[个性化的鼓励话语]

### 八、下次作业要求

[提出具体要求，帮助学生改进]

---

**批改教师**：[姓名]

**日期**：[日期]`,
        variables: JSON.stringify(['assignmentType', 'studentAnswer', 'rubric']),
        category: 'education',
        is_system: 1,
      },
      {
        id: 'builtin-teacher-exam-design',
        name: '考试命题助手',
        description: '试题设计和难度分级工具',
        template: `请设计考试试卷：

科目：{{subject}}

考试类型：{{examType}}（期中/期末/单元测试）

考试时长：{{duration}}分钟

考查范围：{{scope}}

请设计科学合理的试卷：

## {{subject}} {{examType}}试卷

**考试时间**：{{duration}}分钟

**总分**：100分

**考查范围**：{{scope}}

### 一、试卷结构设计

#### 1.1 题型分布

| 题型 | 题量 | 每题分值 | 小计 | 难度系数 |
|------|------|----------|------|----------|
| 选择题 | 20题 | 2分 | 40分 | 0.7 |
| 填空题 | 10题 | 2分 | 20分 | 0.6 |
| 简答题 | 4题 | 5分 | 20分 | 0.5 |
| 综合题 | 2题 | 10分 | 20分 | 0.4 |

#### 1.2 知识点分布

| 知识点 | 分值 | 占比 |
|--------|------|------|
| [知识点1] | XX分 | XX% |
| [知识点2] | XX分 | XX% |

#### 1.3 能力层次分布

- 识记：30%
- 理解：40%
- 应用：20%
- 综合：10%

### 二、试题示例

#### 第一部分：选择题（40分）

**示例题目**

1. [题目内容]
   A. [选项A]
   B. [选项B]
   C. [选项C]
   D. [选项D]

   **答案**：[正确答案]
   **解析**：[答案解析]
   **考点**：[考查知识点]
   **难度**：[易/中/难]

#### 第二部分：填空题（20分）

**示例题目**

1. [题目内容] ________。

   **答案**：[正确答案]
   **考点**：[考查知识点]
   **难度**：[易/中/难]

#### 第三部分：简答题（20分）

**示例题目**

1. [题目内容]

   **参考答案**：
   [答案要点]

   **评分标准**：
   - [要点1]（2分）
   - [要点2]（2分）
   - [要点3]（1分）

   **考点**：[考查知识点]
   **难度**：[易/中/难]

#### 第四部分：综合题（20分）

**示例题目**

1. [综合性题目，可能包含多个小问]

   **参考答案**：
   [详细答案]

   **评分标准**：
   [分步骤评分标准]

   **考点**：[综合考查的知识点]
   **难度**：难

### 三、命题说明

#### 3.1 命题依据
[说明命题依据的教学大纲和教材]

#### 3.2 难度控制
- 易：30%
- 中：50%
- 难：20%

#### 3.3 区分度
[预期的区分度]

### 四、评分标准

#### 4.1 客观题评分
[选择题、填空题的评分要求]

#### 4.2 主观题评分
[简答题、综合题的评分细则]

#### 4.3 注意事项
[阅卷时需要注意的问题]

### 五、答题卡设计

[答题卡格式建议]

### 六、参考答案与评分细则

[完整的参考答案和详细评分标准]

---

**命题人**：[姓名]

**审核人**：[姓名]

**命题日期**：[日期]`,
        variables: JSON.stringify(['subject', 'examType', 'duration', 'scope']),
        category: 'education',
        is_system: 1,
      },
      {
        id: 'builtin-teacher-parent-communication',
        name: '家长沟通模板',
        description: '家校沟通话术和要点',
        template: `请准备家长沟通内容：

沟通目的：{{purpose}}

学生情况：{{studentSituation}}

沟通方式：{{communicationType}}（家长会/个别约谈/电话/微信）

请生成有效的沟通方案：

## 家校沟通方案

**沟通对象**：[学生姓名]家长

**沟通目的**：{{purpose}}

**沟通方式**：{{communicationType}}

**沟通时间**：[预计时间]

### 一、沟通准备

#### 1.1 学生情况梳理
{{studentSituation}}

[详细梳理学生各方面表现]

#### 1.2 准备材料
- 学生成绩单
- 作业情况记录
- 课堂表现记录
- [其他相关材料]

#### 1.3 沟通要点提纲
1. [要点1]
2. [要点2]
3. [要点3]

### 二、沟通开场

#### 2.1 开场白
[建立良好氛围的开场语]

示例：
"X家长您好，感谢您在百忙之中抽出时间。今天主要想和您交流一下孩子最近在学校的表现..."

#### 2.2 情感铺垫
[先讲优点，建立信任]

### 三、核心内容

#### 3.1 肯定优点
[具体事例说明学生优点]

1. **[优点1]**
   具体表现：[举例]

2. **[优点2]**
   具体表现：[举例]

#### 3.2 客观分析问题
[委婉指出问题]

存在的问题：
1. **[问题1]**
   - 具体表现：[说明]
   - 可能原因：[分析]

2. **[问题2]**
   - 具体表现：[说明]
   - 可能原因：[分析]

#### 3.3 了解家庭情况
[询问家庭教育情况]

建议询问的问题：
1. 孩子在家的学习习惯如何？
2. 家庭作业完成情况？
3. 孩子课余时间安排？

### 四、合作方案

#### 4.1 学校层面措施
[说明学校和老师将采取的措施]

1. [措施1]
2. [措施2]

#### 4.2 家庭层面建议
[给家长的具体建议]

1. **学习方面**
   - [建议1]
   - [建议2]

2. **生活方面**
   - [建议1]
   - [建议2]

3. **心理方面**
   - [建议1]
   - [建议2]

#### 4.3 家校配合要点
[明确需要家长配合的具体事项]

### 五、沟通技巧提醒

#### 5.1 语言技巧
- 多用"我们"而非"你们"
- 用"建议"代替"要求"
- 用"希望"代替"必须"

#### 5.2 注意事项
- 保持客观，不夸大问题
- 避免与其他学生比较
- 尊重家长意见
- 给予家长信心

#### 5.3 可能的家长反应及应对
[预判家长可能的反应并准备应对]

**反应1**：[可能的反应]
应对：[应对策略]

**反应2**：[可能的反应]
应对：[应对策略]

### 六、沟通结尾

#### 6.1 总结要点
[简要总结沟通内容]

#### 6.2 后续跟进
[约定后续沟通时间和方式]

#### 6.3 结束语
[积极的结束语]

示例：
"让我们一起努力，相信孩子一定会越来越好！"

### 七、沟通记录

#### 7.1 沟通要点记录
[记录沟通的主要内容]

#### 7.2 家长反馈
[记录家长的意见和建议]

#### 7.3 达成共识
[记录双方达成的一致意见]

---

**沟通教师**：[姓名]

**记录日期**：[日期]`,
        variables: JSON.stringify(['purpose', 'studentSituation', 'communicationType']),
        category: 'education',
        is_system: 1,
      },
      {
        id: 'builtin-teacher-research-activity',
        name: '教研活动记录',
        description: '教研讨论总结和行动计划',
        template: `请记录教研活动：

教研主题：{{topic}}

参与人员：{{participants}}

讨论内容：{{discussion}}

请生成完整的教研活动记录：

## 教研活动记录

**活动主题**：{{topic}}

**活动时间**：[时间]

**活动地点**：[地点]

**参与人员**：{{participants}}

**主持人**：[姓名]

**记录人**：[姓名]

### 一、活动背景

{{topic}}

[说明开展本次教研活动的背景和目的]

### 二、活动流程

#### 2.1 主题汇报
[主讲人的汇报内容摘要]

#### 2.2 集体讨论
{{discussion}}

[记录讨论的主要内容]

#### 2.3 经验分享
[教师分享的教学经验]

### 三、讨论要点

#### 3.1 教学理念
[关于教学理念的讨论]

#### 3.2 教学方法
[关于教学方法的探讨]

#### 3.3 学生学习
[关于学生学习特点和问题的讨论]

### 四、教师发言摘要

#### [教师1]
主要观点：
[观点摘要]

#### [教师2]
主要观点：
[观点摘要]

### 五、形成共识

#### 5.1 教学改进方向
[达成的共识]

1. [共识1]
2. [共识2]

#### 5.2 具体措施
[商定的具体措施]

1. [措施1]
2. [措施2]

### 六、优秀案例分享

#### 案例1：[案例名称]
- 实施者：[教师姓名]
- 具体做法：[详细描述]
- 效果：[实施效果]
- 可推广性：[分析]

### 七、存在问题与困惑

#### 7.1 共性问题
[教师们普遍面临的问题]

#### 7.2 待解决的困惑
[需要进一步研究的问题]

### 八、行动计划

#### 8.1 近期行动
[本学期内的行动计划]

| 行动项 | 责任人 | 完成时间 | 验收标准 |
|--------|--------|----------|----------|
| [项目1] | [姓名] | [时间] | [标准] |
| [项目2] | [姓名] | [时间] | [标准] |

#### 8.2 长期规划
[长期改进方向]

### 九、资源需求

[开展改进需要的资源支持]

- 培训需求：[说明]
- 设备需求：[说明]
- 资料需求：[说明]

### 十、下次教研安排

**主题**：[下次教研主题]

**时间**：[预计时间]

**准备要求**：[参与者需要准备的内容]

### 十一、总结反思

[本次教研活动的总体评价和反思]

### 十二、附件

- 附件1：[相关资料]
- 附件2：[课件/案例等]

---

**主持人签字**：____________

**记录人签字**：____________

**日期**：[日期]`,
        variables: JSON.stringify(['topic', 'participants', 'discussion']),
        category: 'education',
        is_system: 1,
      },
      // ============================================
      // 研究员/科研职业专用模板
      // ============================================
      {
        id: 'builtin-research-question-refine',
        name: '研究问题提炼',
        description: '从现象到研究问题的转化工具',
        template: `请帮助提炼研究问题：

研究领域：{{field}}

观察到的现象：{{phenomenon}}

初步想法：{{initialIdea}}

请系统地提炼研究问题：

## 研究问题提炼报告

**研究领域**：{{field}}

### 一、现象描述与分析

#### 1.1 现象描述
{{phenomenon}}

#### 1.2 现象的重要性
[说明为什么这个现象值得研究]

#### 1.3 现象的普遍性
[分析现象是否具有普遍意义]

### 二、文献回顾

#### 2.1 已有研究
[总结该领域的已有研究]

#### 2.2 研究空白
[识别研究空白和不足]

#### 2.3 理论基础
[可能相关的理论框架]

### 三、研究问题提炼

#### 3.1 初步研究问题
{{initialIdea}}

[基于现象的初步问题]

#### 3.2 问题细化

**主问题**：
[核心研究问题，清晰、具体、可研究]

**子问题**：
1. [子问题1]
2. [子问题2]
3. [子问题3]

#### 3.3 问题的可研究性评估

| 评估维度 | 评价 | 说明 |
|---------|------|------|
| 问题明确性 | 高/中/低 | [说明] |
| 理论价值 | 高/中/低 | [说明] |
| 实践意义 | 高/中/低 | [说明] |
| 可操作性 | 高/中/低 | [说明] |
| 创新性 | 高/中/低 | [说明] |

### 四、研究假设

#### 4.1 核心假设
[提出可检验的研究假设]

H1: [假设1]
H2: [假设2]

#### 4.2 假设的理论依据
[说明假设的理论基础]

### 五、研究意义

#### 5.1 理论意义
[对学术理论的贡献]

#### 5.2 实践意义
[对实践的指导价值]

#### 5.3 方法论意义
[如有方法创新，在此说明]

### 六、研究可行性分析

#### 6.1 数据可获得性
[分析所需数据是否可获得]

#### 6.2 方法可行性
[分析研究方法是否可行]

#### 6.3 资源需求
[评估所需资源]

#### 6.4 预期困难
[预判可能遇到的困难]

### 七、研究设计建议

#### 7.1 研究方法
[建议采用的研究方法]

#### 7.2 研究对象
[建议的研究样本]

#### 7.3 数据收集
[数据收集方案]

#### 7.4 分析方法
[数据分析方法]

### 八、预期贡献

[总结本研究的预期学术贡献]

### 九、下一步工作

1. [行动项1]
2. [行动项2]
3. [行动项3]

---

**研究者**：[姓名]

**日期**：[日期]`,
        variables: JSON.stringify(['field', 'phenomenon', 'initialIdea']),
        category: 'research',
        is_system: 1,
      },
      {
        id: 'builtin-research-experiment-design',
        name: '实验设计方案',
        description: '实验流程和变量设计工具',
        template: `请设计实验方案：

研究目的：{{purpose}}

研究假设：{{hypothesis}}

实验条件：{{conditions}}

请生成科学严谨的实验设计：

## 实验设计方案

**实验名称**：[实验名称]

**研究目的**：{{purpose}}

**研究假设**：{{hypothesis}}

### 一、实验设计概述

#### 1.1 实验类型
[实验室实验/现场实验/准实验/自然实验]

#### 1.2 实验设计类型
[前后测/所罗门四组/因子设计等]

#### 1.3 实验周期
[预计实验时长]

### 二、变量设计

#### 2.1 自变量（Independent Variable）

**主自变量**：[变量名称]
- 操作定义：[如何操作]
- 水平设置：[几个水平，分别是什么]

**其他自变量**（如有）：
[说明]

#### 2.2 因变量（Dependent Variable）

**主因变量**：[变量名称]
- 操作定义：[如何测量]
- 测量指标：[具体指标]
- 测量工具：[使用的工具]

**其他因变量**（如有）：
[说明]

#### 2.3 控制变量

需要控制的变量：
1. [变量1] - 控制方法：[方法]
2. [变量2] - 控制方法：[方法]

#### 2.4 无关变量处理

[说明如何处理无关变量]

### 三、实验对象

#### 3.1 总体界定
[明确研究总体]

#### 3.2 样本选择

- 抽样方法：[随机/分层/整群等]
- 样本量：[N = ?]
- 样本量确定依据：[统计检验力分析]

#### 3.3 分组方案

{{conditions}}

- 实验组：[人数] - [接受何种处理]
- 对照组：[人数] - [接受何种处理]
- [其他组]（如有）

#### 3.4 随机化程序
[如何进行随机分配]

### 四、实验材料与设备

#### 4.1 实验材料
1. [材料1]
2. [材料2]

#### 4.2 实验设备
1. [设备1] - 规格：[规格]
2. [设备2] - 规格：[规格]

#### 4.3 测量工具
1. [量表/问卷名称]
   - 信度：[Cronbach's α = ?]
   - 效度：[说明]

### 五、实验程序

#### 5.1 前期准备
1. [准备工作1]
2. [准备工作2]

#### 5.2 实验流程

**第一阶段：前测**（时长：XX分钟）
1. [步骤1]
2. [步骤2]

**第二阶段：实验处理**（时长：XX）
1. [步骤1]
2. [步骤2]

**第三阶段：后测**（时长：XX分钟）
1. [步骤1]
2. [步骤2]

**第四阶段：追踪测试**（如有）
[说明]

#### 5.3 标准化程序
[确保实验标准化的措施]

### 六、数据收集

#### 6.1 数据类型
[定量/定性/混合]

#### 6.2 数据记录
[如何记录数据]

#### 6.3 数据存储
[数据管理方案]

### 七、数据分析计划

#### 7.1 描述性统计
[计算的描述性指标]

#### 7.2 推断性统计
[计划使用的统计方法]

- t检验/方差分析/回归分析/等
- 显著性水平：α = 0.05

#### 7.3 统计软件
[使用的软件：SPSS/R/Python等]

### 八、质量控制

#### 8.1 内部效度控制
[确保内部效度的措施]

1. [措施1]
2. [措施2]

#### 8.2 外部效度控制
[确保外部效度的措施]

#### 8.3 信度控制
[确保测量信度的措施]

### 九、伦理考虑

#### 9.1 知情同意
[如何获取知情同意]

#### 9.2 隐私保护
[如何保护参与者隐私]

#### 9.3 风险评估
[评估实验风险并说明应对]

#### 9.4 伦理审查
[是否需要伦理委员会审查]

### 十、预期结果

#### 10.1 预期发现
[基于假设的预期结果]

#### 10.2 备选假设
[如果主假设不成立的备选解释]

### 十一、潜在问题与应对

| 潜在问题 | 影响 | 应对策略 |
|---------|------|----------|
| [问题1] | [影响] | [策略] |
| [问题2] | [影响] | [策略] |

### 十二、时间安排

| 阶段 | 工作内容 | 时间 |
|------|---------|------|
| 准备期 | [内容] | [时间] |
| 实施期 | [内容] | [时间] |
| 分析期 | [内容] | [时间] |

### 十三、预算估算

[实验所需经费估算]

---

**设计人**：[姓名]

**审核人**：[姓名]

**日期**：[日期]`,
        variables: JSON.stringify(['purpose', 'hypothesis', 'conditions']),
        category: 'research',
        is_system: 1,
      },
      {
        id: 'builtin-research-data-interpretation',
        name: '数据分析解读',
        description: '统计结果解释和可视化建议',
        template: `请解读研究数据：

研究问题：{{researchQuestion}}

统计结果：
{{statisticalResults}}

请进行专业的数据解读：

## 数据分析解读报告

**研究问题**：{{researchQuestion}}

**分析日期**：[当前日期]

### 一、数据概览

#### 1.1 样本描述
[样本基本信息]

- 样本量：N = ?
- 有效样本：N = ?
- 缺失值处理：[说明]

#### 1.2 数据质量检验
[数据清洗和质量检查结果]

### 二、描述性统计结果

#### 2.1 主要变量描述

| 变量 | M | SD | Min | Max | Skewness | Kurtosis |
|------|---|----|----|-----|----------|----------|
| [变量1] | X.XX | X.XX | X.XX | X.XX | X.XX | X.XX |
| [变量2] | X.XX | X.XX | X.XX | X.XX | X.XX | X.XX |

**解读**：
[对描述性统计的解释]

#### 2.2 数据分布
[正态性检验结果]

### 三、推断性统计结果

{{statisticalResults}}

#### 3.1 主要检验结果

**检验1**：[检验名称]
- 统计量：[统计量值]
- p值：p = ?
- 效应量：[Cohen's d / η² / r 等] = ?

**结果解读**：
[详细解释统计结果的含义]

**检验2**：[检验名称]
[同上格式]

#### 3.2 假设检验结论

H1: [假设内容]
结论：[支持/不支持/部分支持]
依据：[说明]

H2: [假设内容]
结论：[支持/不支持/部分支持]
依据：[说明]

### 四、深入分析

#### 4.1 中介效应分析（如适用）
[中介效应检验结果及解读]

#### 4.2 调节效应分析（如适用）
[调节效应检验结果及解读]

#### 4.3 其他分析
[其他统计分析结果]

### 五、结果可视化

#### 5.1 推荐图表

**图1：[图表名称]**
- 图表类型：[柱状图/折线图/散点图等]
- 呈现内容：[说明]
- 设计要点：[说明]

**图2：[图表名称]**
[同上]

#### 5.2 可视化代码示例（如使用R/Python）
\`\`\`
# 示例代码
\`\`\`

### 六、结果总结

#### 6.1 主要发现
[总结最重要的发现]

1. [发现1]
2. [发现2]
3. [发现3]

#### 6.2 意外发现
[超出预期的发现]

#### 6.3 无显著结果的分析
[对未达到显著性的结果进行分析]

### 七、理论意义

#### 7.1 与已有研究的对比
[与文献中的研究进行对比]

#### 7.2 理论贡献
[对理论的贡献或挑战]

#### 7.3 新的理论洞见
[本研究带来的新理论理解]

### 八、实践启示

#### 8.1 对实践的指导
[结果对实践的指导意义]

#### 8.2 应用建议
[具体的应用建议]

### 九、研究局限

#### 9.1 样本局限
[样本方面的局限性]

#### 9.2 测量局限
[测量工具或方法的局限]

#### 9.3 因果推断局限
[因果关系推断的局限]

### 十、未来研究方向

#### 10.1 亟待解决的问题
[本研究引发的新问题]

#### 10.2 方法改进建议
[未来研究可以改进的方法]

#### 10.3 扩展研究方向
[可以扩展的研究方向]

### 十一、数据报告建议

#### 11.1 论文报告格式
[如何在论文中报告这些结果]

示例：
"t检验结果显示... (t = X.XX, df = XX, p < .05, Cohen's d = X.XX)"

#### 11.2 关键数据表格
[应该在论文中呈现的关键表格]

### 十二、补充分析建议

[建议进行的补充分析]

1. [分析1]
2. [分析2]

---

**分析人**：[姓名]

**审核人**：[姓名]

**日期**：[日期]`,
        variables: JSON.stringify(['researchQuestion', 'statisticalResults']),
        category: 'research',
        is_system: 1,
      },
    ];

    const now = Date.now();

    for (const template of builtInTemplates) {
      const id = template.id || uuidv4();
      const name = template.name || 'Untitled';
      const description = template.description || '';
      const templateText = template.template || '';
      const variables = template.variables || JSON.stringify([]);
      const category = template.category || 'general';
      const isSystem = template.is_system ? 1 : 0;

      await this.db.run(
        `INSERT OR IGNORE INTO prompt_templates
         (id, name, description, template, variables, category, is_system, usage_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          name,
          description,
          templateText,
          variables,
          category,
          isSystem,
          0,
          now,
          now,
        ]
      );
    }

    console.log('[PromptTemplateManager] 内置模板已插入:', builtInTemplates.length);
  }

  /**
   * 创建模板
   * @param {Object} templateData - 模板数据
   * @returns {Promise<Object>} 创建的模板
   */
  async createTemplate(templateData) {
    const {
      name,
      description = '',
      template,
      variables = [],
      category = 'general',
    } = templateData;

    if (!name || !template) {
      throw new Error('模板名称和内容不能为空');
    }

    const id = uuidv4();
    const now = Date.now();

    await this.db.run(
      `INSERT INTO prompt_templates
       (id, name, description, template, variables, category, is_system, usage_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        description,
        template,
        JSON.stringify(variables),
        category,
        0, // 用户创建的模板，is_system = 0
        0,
        now,
        now,
      ]
    );

    return this.getTemplateById(id);
  }

  /**
   * 获取模板列表
   * @param {Object} filters - 过滤条件
   * @returns {Promise<Array>} 模板列表
   */
  async getTemplates(filters = {}) {
    const { category, isSystem } = filters;

    let sql = 'SELECT * FROM prompt_templates WHERE 1=1';
    const params = [];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    if (isSystem !== undefined) {
      sql += ' AND is_system = ?';
      params.push(isSystem ? 1 : 0);
    }

    sql += ' ORDER BY is_system DESC, usage_count DESC, created_at DESC';

    const templates = await this.db.all(sql, params);

    // 解析 variables JSON
    return templates.map(template => ({
      ...template,
      variables: template.variables ? JSON.parse(template.variables) : [],
      is_system: Boolean(template.is_system),
    }));
  }

  /**
   * 根据 ID 获取模板
   * @param {string} id - 模板 ID
   * @returns {Promise<Object|null>} 模板对象
   */
  async getTemplateById(id) {
    const template = await this.db.get(
      'SELECT * FROM prompt_templates WHERE id = ?',
      [id]
    );

    if (!template) {
      return null;
    }

    return {
      ...template,
      variables: template.variables ? JSON.parse(template.variables) : [],
      is_system: Boolean(template.is_system),
    };
  }

  /**
   * 更新模板
   * @param {string} id - 模板 ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>} 更新后的模板
   */
  async updateTemplate(id, updates) {
    const template = await this.getTemplateById(id);

    if (!template) {
      throw new Error('模板不存在');
    }

    if (template.is_system) {
      throw new Error('系统模板不能修改');
    }

    const {
      name,
      description,
      template: templateText,
      variables,
      category,
    } = updates;

    const fields = [];
    const params = [];

    if (name !== undefined) {
      fields.push('name = ?');
      params.push(name);
    }

    if (description !== undefined) {
      fields.push('description = ?');
      params.push(description);
    }

    if (templateText !== undefined) {
      fields.push('template = ?');
      params.push(templateText);
    }

    if (variables !== undefined) {
      fields.push('variables = ?');
      params.push(JSON.stringify(variables));
    }

    if (category !== undefined) {
      fields.push('category = ?');
      params.push(category);
    }

    fields.push('updated_at = ?');
    params.push(Date.now());

    params.push(id);

    await this.db.run(
      `UPDATE prompt_templates SET ${fields.join(', ')} WHERE id = ?`,
      params
    );

    return this.getTemplateById(id);
  }

  /**
   * 删除模板
   * @param {string} id - 模板 ID
   * @returns {Promise<boolean>} 是否成功
   */
  async deleteTemplate(id) {
    const template = await this.getTemplateById(id);

    if (!template) {
      throw new Error('模板不存在');
    }

    if (template.is_system) {
      throw new Error('系统模板不能删除');
    }

    await this.db.run('DELETE FROM prompt_templates WHERE id = ?', [id]);
    return true;
  }

  /**
   * 填充模板变量
   * @param {string} id - 模板 ID
   * @param {Object} values - 变量值对象
   * @returns {Promise<string>} 填充后的提示词
   */
  async fillTemplate(id, values) {
    const template = await this.getTemplateById(id);

    if (!template) {
      throw new Error('模板不存在');
    }

    let result = template.template;

    // 替换所有变量
    for (const [key, value] of Object.entries(values)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      result = result.replace(regex, value);
    }

    // 增加使用次数
    await this.incrementUsage(id);

    return result;
  }

  /**
   * 增加使用次数
   * @param {string} id - 模板 ID
   */
  async incrementUsage(id) {
    await this.db.run(
      'UPDATE prompt_templates SET usage_count = usage_count + 1 WHERE id = ?',
      [id]
    );
  }

  /**
   * 获取模板分类列表
   * @returns {Promise<Array>} 分类列表
   */
  async getCategories() {
    const result = await this.db.all(
      'SELECT DISTINCT category FROM prompt_templates ORDER BY category'
    );

    return result.map(row => row.category);
  }

  /**
   * 搜索模板
   * @param {string} query - 搜索关键词
   * @returns {Promise<Array>} 匹配的模板列表
   */
  async searchTemplates(query) {
    const templates = await this.db.all(
      `SELECT * FROM prompt_templates
       WHERE name LIKE ? OR description LIKE ? OR template LIKE ?
       ORDER BY usage_count DESC, created_at DESC`,
      [`%${query}%`, `%${query}%`, `%${query}%`]
    );

    return templates.map(template => ({
      ...template,
      variables: template.variables ? JSON.parse(template.variables) : [],
      is_system: Boolean(template.is_system),
    }));
  }

  /**
   * 获取统计信息
   * @returns {Promise<Object>} 统计数据
   */
  async getStatistics() {
    const total = await this.db.get(
      'SELECT COUNT(*) as count FROM prompt_templates'
    );

    const system = await this.db.get(
      'SELECT COUNT(*) as count FROM prompt_templates WHERE is_system = 1'
    );

    const custom = await this.db.get(
      'SELECT COUNT(*) as count FROM prompt_templates WHERE is_system = 0'
    );

    const byCategory = await this.db.all(
      'SELECT category, COUNT(*) as count FROM prompt_templates GROUP BY category'
    );

    const mostUsed = await this.db.all(
      'SELECT id, name, usage_count FROM prompt_templates ORDER BY usage_count DESC LIMIT 5'
    );

    return {
      total: total.count,
      system: system.count,
      custom: custom.count,
      byCategory: byCategory.reduce((acc, row) => {
        acc[row.category] = row.count;
        return acc;
      }, {}),
      mostUsed,
    };
  }

  /**
   * 导出模板
   * @param {string} id - 模板 ID
   * @returns {Promise<Object>} 导出数据
   */
  async exportTemplate(id) {
    const template = await this.getTemplateById(id);

    if (!template) {
      throw new Error('模板不存在');
    }

    return {
      version: '1.0',
      exported_at: new Date().toISOString(),
      template: {
        name: template.name,
        description: template.description,
        template: template.template,
        variables: template.variables,
        category: template.category,
      },
    };
  }

  /**
   * 导入模板
   * @param {Object} importData - 导入数据
   * @returns {Promise<Object>} 导入的模板
   */
  async importTemplate(importData) {
    if (!importData.template) {
      throw new Error('无效的导入数据');
    }

    const { name, description, template, variables, category } = importData.template;

    return await this.createTemplate({
      name,
      description,
      template,
      variables,
      category,
    });
  }
}

module.exports = PromptTemplateManager;
