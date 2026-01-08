# 浏览器控制台诊断脚本

**使用方法**: 在Electron应用中按 Cmd+Option+I (macOS) 或 Ctrl+Shift+I (Windows) 打开开发者工具，然后在Console标签中逐步执行以下代码。

---

## 🔍 诊断步骤

### 步骤1: 检查electronAPI是否可用

```javascript
console.log('=== 步骤1: 检查electronAPI ===');
if (window.electronAPI) {
  console.log('✅ electronAPI 存在');
  console.log('可用的API:', Object.keys(window.electronAPI));
} else {
  console.error('❌ electronAPI 不存在！preload脚本可能未加载');
}
```

**预期输出**: 应该看到 `✅ electronAPI 存在` 和一个API列表

---

### 步骤2: 检查promptTemplate API

```javascript
console.log('\n=== 步骤2: 检查promptTemplate API ===');
if (window.electronAPI && window.electronAPI.promptTemplate) {
  console.log('✅ promptTemplate API 存在');
  console.log('可用的方法:', Object.keys(window.electronAPI.promptTemplate));
} else {
  console.error('❌ promptTemplate API 不存在！');
}
```

**预期输出**: 应该看到 `getAll`, `fill` 等方法

---

### 步骤3: 获取所有模板

```javascript
console.log('\n=== 步骤3: 获取所有模板 ===');
try {
  const allTemplates = await window.electronAPI.promptTemplate.getAll();
  console.log(`✅ 成功获取模板，总数: ${allTemplates.length}`);

  // 显示前5个模板
  console.log('\n前5个模板:');
  allTemplates.slice(0, 5).forEach((t, i) => {
    console.log(`  ${i+1}. ${t.name} (${t.category})`);
  });

  // 按分类统计
  console.log('\n按分类统计:');
  const categories = {};
  allTemplates.forEach(t => {
    categories[t.category] = (categories[t.category] || 0) + 1;
  });
  Object.entries(categories).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}个`);
  });

  // 保存到全局变量供后续使用
  window._allTemplates = allTemplates;
  console.log('\n💡 已保存到 window._allTemplates');

} catch (error) {
  console.error('❌ 获取模板失败:', error);
}
```

**预期输出**: 应该看到34个模板，包含medical、legal、education、research分类

---

### 步骤4: 检查职业专用模板

```javascript
console.log('\n=== 步骤4: 检查职业专用模板 ===');
if (!window._allTemplates) {
  console.error('❌ 请先执行步骤3');
} else {
  const professionalCategories = ['medical', 'legal', 'education', 'research'];

  professionalCategories.forEach(category => {
    const templates = window._allTemplates.filter(t => t.category === category);
    const emoji = category === 'medical' ? '🏥' :
                  category === 'legal' ? '⚖️' :
                  category === 'education' ? '👨‍🏫' : '🔬';

    console.log(`\n${emoji} ${category}: ${templates.length}个模板`);
    templates.forEach(t => {
      console.log(`  - ${t.name}`);
    });
  });
}
```

**预期输出**:
```
🏥 medical: 7个模板
  - 病历记录助手
  - 诊断辅助分析
  - 医学文献摘要
  - 用药指导生成
  - 医学术语解释
  - 病例讨论记录
  - 医疗报告解读

⚖️ legal: 7个模板
  - 案件分析助手
  - 法律意见书撰写
  - 合同审查清单
  - 诉讼策略规划
  - 法律咨询记录
  - 判例检索分析
  - 法律文书校对

👨‍🏫 education: 7个模板
  - 课程大纲生成
  - 教学反思记录
  - 学生评价生成
  - 作业批改辅助
  - 考试命题助手
  - 家长沟通模板
  - 教研活动记录

🔬 research: 3个模板
  - 研究问题提炼
  - 实验设计方案
  - 数据分析解读
```

---

### 步骤5: 测试模板填充功能

```javascript
console.log('\n=== 步骤5: 测试模板填充功能 ===');
if (!window._allTemplates) {
  console.error('❌ 请先执行步骤3');
} else {
  const medicalTemplate = window._allTemplates.find(t => t.category === 'medical');

  if (medicalTemplate) {
    console.log(`测试模板: ${medicalTemplate.name}`);
    console.log(`模板ID: ${medicalTemplate.id}`);

    try {
      // 解析变量
      const variables = medicalTemplate.variables ? JSON.parse(medicalTemplate.variables) : [];
      console.log(`变量数量: ${variables.length}`);

      if (variables.length > 0) {
        // 创建示例值
        const exampleValues = {};
        variables.forEach(varName => {
          exampleValues[varName] = `[示例${varName}]`;
        });

        console.log('示例变量值:', exampleValues);

        // 调用填充API
        const filledPrompt = await window.electronAPI.promptTemplate.fill(
          medicalTemplate.id,
          exampleValues
        );

        console.log('✅ 填充成功！');
        console.log('填充后的内容（前200字符）:');
        console.log(filledPrompt.substring(0, 200) + '...');

      } else {
        console.log('该模板没有变量，直接使用模板内容');
        console.log('模板内容（前200字符）:');
        console.log(medicalTemplate.template.substring(0, 200) + '...');
      }

    } catch (error) {
      console.error('❌ 填充失败:', error);
    }
  } else {
    console.error('❌ 未找到医疗模板');
  }
}
```

**预期输出**: 应该成功填充模板并显示内容

---

### 步骤6: 检查Vue组件状态（在新建项目页面）

**首先导航到**: 项目管理 → 我的项目 → 新建项目 → AI辅助创建

**然后在控制台执行**:

```javascript
console.log('\n=== 步骤6: 检查Vue组件状态 ===');

// 查找AIProjectCreator组件实例
const app = document.querySelector('#app').__vueParentComponent;
console.log('Vue app:', app ? '✅ 找到' : '❌ 未找到');

// 尝试查找promptTemplates数据
// 注意：这需要在正确的页面上执行
console.log('\n💡 请确认您在"新建项目"页面');
console.log('💡 页面URL应该包含 "projects" 或类似路径');
console.log('💡 如果看到"职业专用模板"标题，说明组件已加载');
```

---

## 🔍 诊断结果分析

### 场景1: 步骤1或2失败

**问题**: electronAPI未加载
**原因**: preload脚本问题
**解决**: 重启应用

### 场景2: 步骤3返回0个模板或少于34个模板

**问题**: 数据库中模板数量不足
**解决**: 运行初始化脚本
```bash
cd desktop-app-vue
node initialize-prompt-templates.js
```

### 场景3: 步骤3返回34个模板，但步骤4显示职业模板数量为0

**问题**: 分类名称不匹配
**解决**: 检查数据库中的category字段是否正确

### 场景4: 所有步骤都成功，但UI仍不显示

**问题**: Vue组件未正确更新或条件渲染问题
**解决**:
1. 清除缓存并重新构建
2. 检查filteredPromptTemplates计算属性
3. 在浏览器中强制刷新（Cmd+Shift+R）

---

## 📝 提交诊断结果

请将上述步骤的输出结果发送给开发者，包括：
1. 每个步骤是✅还是❌
2. 模板总数
3. 职业专用模板数量（medical, legal, education, research）
4. 任何错误消息

这将帮助快速定位问题！
