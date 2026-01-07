# UI功能验证指南

**测试日期**: 2026-01-07
**应用版本**: v0.20.0
**测试内容**: 职业专用Prompt模板、技能和工具的UI展示验证

---

## 🎯 测试目标

验证24个新增的职业专用Prompt模板能够正确显示在用户界面中，并且分类筛选、变量替换等功能正常工作。

---

## ✅ 前置条件

1. **应用已启动**: 开发服务器运行在 `http://localhost:5173/`
2. **Electron窗口已打开**: 应该能看到ChainlessChain的主界面
3. **数据库已初始化**: 首次启动会自动初始化数据库并注册内置模板

---

## 📋 验证步骤

### 第一步：访问Prompt模板页面

1. **启动应用**（如果还未启动）:
   ```bash
   cd desktop-app-vue
   npm run dev
   ```

2. **定位到AI Prompts页面**:
   - 在主界面左侧导航栏找到"AI助手"或"Prompts"菜单项
   - 点击进入Prompt模板管理页面

### 第二步：验证职业分类按钮

在Prompt页面底部，你应该能看到**分类筛选按钮**，包括：

**预期显示的分类按钮** (共13个):
- ✅ 写作
- ✅ 营销
- ✅ Excel
- ✅ 简历
- ✅ PPT
- 🆕 **医疗** (新增)
- 🆕 **法律** (新增)
- ✅ 教育
- ✅ 研究
- ✅ 生活
- ✅ 播客
- ✅ 设计
- ✅ 网页

**验证要点**:
- [ ] "医疗"按钮显示正常
- [ ] "法律"按钮显示正常
- [ ] 按钮样式一致，可点击

### 第三步：验证医疗类模板

1. **点击"医疗"分类按钮**
2. **预期显示的模板** (7个):
   - 病历记录助手
   - 诊断辅助分析
   - 医学文献摘要
   - 用药指导生成
   - 医学术语解释
   - 病例讨论记录
   - 医疗报告解读

**验证要点**:
- [ ] 至少显示3个建议卡片（前3个模板）
- [ ] 模板名称显示正确
- [ ] 点击模板卡片能填充到输入框

### 第四步：验证法律类模板

1. **点击"法律"分类按钮**
2. **预期显示的模板** (7个):
   - 案件分析助手
   - 法律意见书撰写
   - 合同审查清单
   - 诉讼策略规划
   - 法律咨询记录
   - 判例检索分析
   - 法律文书校对

**验证要点**:
- [ ] 模板列表切换正常
- [ ] 没有显示其他分类的模板（如医疗模板）
- [ ] 模板描述清晰准确

### 第五步：验证教育类模板

1. **点击"教育"分类按钮**
2. **预期显示的新模板** (7个):
   - 课程大纲生成
   - 教学反思记录
   - 学生评价生成
   - 作业批改辅助
   - 考试命题助手
   - 家长沟通模板
   - 教研活动记录

**验证要点**:
- [ ] 新旧教育模板都能正常显示
- [ ] 分类筛选准确

### 第六步：验证研究类模板

1. **点击"研究"分类按钮**
2. **预期显示的新模板** (3个):
   - 研究问题提炼
   - 实验设计方案
   - 数据分析解读

**验证要点**:
- [ ] 研究类模板数量正确
- [ ] 模板内容与科研场景匹配

### 第七步：测试模板使用流程

选择任意一个职业模板（建议使用"病历记录助手"）:

1. **点击模板卡片**
2. **验证输入框填充**:
   - [ ] 模板描述或提示词自动填充到文本框
   - [ ] 字符计数显示正确

3. **点击"发送"按钮**:
   - [ ] 能够创建新的对话
   - [ ] 跳转到AI聊天页面
   - [ ] 显示成功提示消息

### 第八步：验证模板变量系统

由于当前UI使用的是简化版Prompt展示，变量替换功能需要通过IPC调用测试：

**打开开发者工具** (Electron窗口中按 `Cmd+Option+I` 或 `Ctrl+Shift+I`):

```javascript
// 在控制台执行以下代码

// 1. 获取所有医疗模板
const medicalTemplates = await window.electronAPI.promptTemplate.getAll({ category: 'medical' });
console.log('医疗模板数量:', medicalTemplates.length);
console.log('医疗模板列表:', medicalTemplates);

// 2. 测试模板变量填充（以病历记录为例）
const template = medicalTemplates.find(t => t.id === 'builtin-medical-record');
console.log('病历模板:', template);

// 3. 查看模板变量定义
const variables = JSON.parse(template.variables || '[]');
console.log('模板变量:', variables);

// 4. 填充模板
const filledPrompt = await window.electronAPI.promptTemplate.fill(template.id, {
  patientName: '张三',
  gender: '男',
  age: '45',
  visitDate: '2026-01-07',
  chiefComplaint: '胸痛3天',
  presentIllness: '患者3天前无明显诱因出现胸痛',
  pastHistory: '高血压病史5年'
});
console.log('填充后的Prompt:', filledPrompt);
```

**预期结果**:
- [ ] 能够获取到7个医疗模板
- [ ] 模板包含variables字段
- [ ] 填充功能返回正确的Prompt文本
- [ ] 变量被正确替换

---

## 🔍 技能和工具验证

### 验证技能管理界面

1. **定位到技能管理页面**:
   - 在设置或工具菜单中找到"技能管理"
   - 或通过搜索功能找到相关页面

2. **验证职业技能显示**:
   - [ ] 能看到16个新增的职业技能
   - [ ] 技能按职业分类（医疗、法律、教育、科研各4个）
   - [ ] 技能图标和描述显示正常

### 验证工具管理界面

1. **定位到工具管理页面**
2. **验证职业工具显示**:
   - [ ] 能看到20个新增的职业工具
   - [ ] 工具参数定义完整
   - [ ] 工具描述清晰

### 控制台验证技能-工具关联

在开发者工具控制台执行：

```javascript
// 获取医学诊断辅助技能
const diagnosticSkill = await window.electronAPI.skillTool.getSkill('skill_medical_diagnosis');
console.log('诊断技能:', diagnosticSkill);
console.log('关联的工具:', diagnosticSkill.tools);

// 获取关联的工具详情
for (const toolName of diagnosticSkill.tools) {
  const tool = await window.electronAPI.skillTool.getTool(toolName);
  console.log(`工具 ${toolName}:`, tool);
}
```

**预期结果**:
- [ ] 技能包含tools数组
- [ ] 所有工具都能正确查询到
- [ ] 工具参数schema定义完整

---

## 📊 统计信息验证

在开发者工具控制台执行：

```javascript
// 获取Prompt模板统计信息
const stats = await window.electronAPI.promptTemplate.getStatistics();
console.log('模板统计:', stats);

// 预期看到:
// {
//   total: 34+, // 原有10个 + 新增24个
//   system: 34+,
//   custom: 0,
//   byCategory: {
//     medical: 7,
//     legal: 7,
//     education: 7+,
//     research: 3+,
//     ...
//   },
//   mostUsed: [...]
// }

// 获取分类列表
const categories = await window.electronAPI.promptTemplate.getCategories();
console.log('分类列表:', categories);
// 应该包含: medical, legal, education, research
```

---

## 🐛 常见问题排查

### 问题1: 看不到"医疗"和"法律"分类按钮

**可能原因**: UI文件未重新编译

**解决方案**:
```bash
# 停止开发服务器 (Ctrl+C)
# 重新启动
cd desktop-app-vue
npm run dev
```

### 问题2: 点击分类按钮后没有模板显示

**可能原因**: 数据库未正确初始化

**解决方案**:
```bash
# 运行数据库初始化测试
cd desktop-app-vue
node test-database-registration.js

# 如果测试失败，检查数据库文件
ls -la data/chainlesschain.db
```

### 问题3: 模板数量不对

**验证方法**:
```bash
# 运行完整功能测试
cd desktop-app-vue
node test-professional-features.js

# 检查输出是否显示:
# ✓ Prompt模板: 24个职业专用模板
# ✓ Skills技能: 16个职业专用技能
# ✓ Tools工具: 20个职业专用工具
```

### 问题4: 开发者工具中找不到 electronAPI

**可能原因**: Preload脚本未正确加载

**解决方案**:
1. 检查控制台是否有错误信息
2. 确认 `window.electronAPI` 对象存在：
   ```javascript
   console.log('electronAPI:', window.electronAPI);
   ```

---

## ✅ 验证完成清单

完成以下所有项目即表示验证成功：

### UI显示验证
- [ ] "医疗"分类按钮显示
- [ ] "法律"分类按钮显示
- [ ] 医疗模板显示（7个）
- [ ] 法律模板显示（7个）
- [ ] 教育模板显示（7个）
- [ ] 研究模板显示（3个）

### 功能验证
- [ ] 分类切换正常
- [ ] 模板点击填充输入框
- [ ] 发送消息创建对话
- [ ] 变量替换功能正常
- [ ] 技能列表显示完整
- [ ] 工具列表显示完整

### 数据验证
- [ ] 模板总数 ≥ 34 (10原有 + 24新增)
- [ ] 技能总数 ≥ 62 (46原有 + 16新增)
- [ ] 工具总数 ≥ 320 (300原有 + 20新增)
- [ ] 分类统计准确

---

## 📸 截图建议

建议截取以下界面截图以记录验证结果：

1. **分类按钮全景图**: 显示所有13个分类按钮
2. **医疗模板列表**: 点击"医疗"后的界面
3. **法律模板列表**: 点击"法律"后的界面
4. **教育模板列表**: 点击"教育"后的界面
5. **研究模板列表**: 点击"研究"后的界面
6. **控制台统计信息**: 显示模板统计数据
7. **技能管理界面**: 显示新增技能列表
8. **工具管理界面**: 显示新增工具列表

---

## 📝 验证报告模板

验证完成后，可以使用以下模板记录结果：

```markdown
# UI验证报告

**验证时间**: [填写时间]
**验证人员**: [填写姓名]
**应用版本**: v0.20.0

## 验证结果

### Prompt模板UI
- 医疗分类按钮: ✅ 通过 / ❌ 失败
- 法律分类按钮: ✅ 通过 / ❌ 失败
- 医疗模板显示: ✅ 通过 / ❌ 失败 (数量: ___)
- 法律模板显示: ✅ 通过 / ❌ 失败 (数量: ___)
- 教育模板显示: ✅ 通过 / ❌ 失败 (数量: ___)
- 研究模板显示: ✅ 通过 / ❌ 失败 (数量: ___)

### 功能测试
- 分类切换: ✅ 通过 / ❌ 失败
- 模板点击: ✅ 通过 / ❌ 失败
- 创建对话: ✅ 通过 / ❌ 失败
- 变量替换: ✅ 通过 / ❌ 失败

### 数据统计
- 模板总数: ___ (预期 ≥ 34)
- 技能总数: ___ (预期 ≥ 62)
- 工具总数: ___ (预期 ≥ 320)

## 发现的问题

[列出验证过程中发现的任何问题]

## 建议

[提出改进建议]
```

---

## 🎉 验证成功标志

当以下所有条件满足时，即可认为UI验证成功：

1. ✅ 所有分类按钮正常显示和工作
2. ✅ 24个职业模板都能正确显示
3. ✅ 分类筛选准确无误
4. ✅ 模板点击和使用流程顺畅
5. ✅ 变量替换功能正常
6. ✅ 控制台API调用正常
7. ✅ 统计数据准确

---

**祝验证顺利！** 🚀

如有任何问题，请参考以下文档：
- `PROFESSIONAL_FEATURES_IMPLEMENTATION.md` - 实施文档
- `PROFESSIONAL_FEATURES_TEST_REPORT.md` - 测试报告
- `PROFESSIONAL_FEATURES_DEPLOYMENT_SUMMARY.md` - 部署总结
