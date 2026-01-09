# ChainlessChain 项目管理页面重构实施方案

## 概述

根据参考资料图片和系统设计文档,重新设计项目管理页面,实现**对话式AI工作流**。

## 用户确认的关键决策 ✅

1. **实施范围**: 全部4个阶段(UI重构 + AI引擎 + 文件处理引擎 + 项目存储)
2. **LLM选择**: 混合模式(简单任务用本地Ollama,复杂任务用云端API)
3. **文件引擎优先级**: Web开发引擎(HTML/CSS/JS)优先实现
4. **UI风格**: 100%按照参考图片实现(扣子空间风格)

## 核心设计原则

参考图片展示的"扣子空间"风格:
- 左侧导航栏(深灰色 #2B2D31, 200px宽)
- 中央对话区域(白色背景)
- 大型输入框(120px高,带@和附件按钮)
- 步骤展示(可折叠,进度指示)
- 浏览器预览(标签页切换)
- 版本历史(右侧抽屉)

## 实施阶段

### 阶段1: UI重构 (2-3周) ⭐

#### 核心新增组件 (18个)

**高优先级组件 (P0)**:
1. `ConversationInput.vue` - 大型对话输入框
   - 功能: @提及、附件上传、Ctrl+Enter提交
   - 样式: 120px最小高度,蓝色聚焦边框

2. `StepDisplay.vue` - AI执行步骤展示
   - 功能: 可折叠,显示步骤名称/状态/耗时
   - 样式: 卡片式,颜色编码(蓝色=运行中,绿色=完成,红色=失败)

3. `ProjectSidebar.vue` - 左侧导航栏
   - 功能: 项目分类(收藏夹/历史对话/新建按钮)
   - 样式: 深灰色背景,白色文字

4. `BrowserPreview.vue` - 浏览器预览界面
   - 功能: 模拟浏览器工具栏,缩放控制(50%-150%)
   - 样式: iframe嵌套

**中优先级组件 (P1)**:
5. `WelcomeHeader.vue` - 欢迎界面
6. `CategoryTabs.vue` - 类型标签栏
7. `ProjectCardsGrid.vue` - 项目卡片网格
8. `ConversationHistory.vue` - 对话历史
9. `FileSelectionModal.vue` - 文件选择弹框
10. `VersionHistoryDrawer.vue` - 版本历史抽屉

#### 页面重构 (3个)

**ProjectsPage.vue** - 重构为左侧导航+中央布局:
```vue
<div class="projects-page-wrapper">
  <ProjectSidebar />
  <div class="main-content">
    <WelcomeHeader v-if="!hasProjects" />
    <ConversationInput @submit="handleConversationalCreate" />
    <CategoryTabs v-model="activeCategory" />
    <ProjectCardsGrid :projects="filteredProjects" />
  </div>
</div>
```

**ProjectDetailPage.vue** - 重构为对话式界面:
```vue
<div class="project-detail-wrapper">
  <ProjectSidebar />
  <div class="conversation-area">
    <ConversationHistory :messages="messages" />
    <StepDisplay v-for="step in steps" :key="step.id" :step="step" />
    <ConversationInput @submit="handleUserMessage" />
  </div>
  <div class="preview-area">
    <a-tabs>
      <a-tab-pane key="preview">
        <BrowserPreview :url="previewUrl" />
      </a-tab-pane>
      <a-tab-pane key="code">
        <CodeEditor :file="currentFile" />
      </a-tab-pane>
    </a-tabs>
  </div>
  <VersionHistoryDrawer v-model:visible="showHistory" />
</div>
```

#### 颜色方案

```scss
// projects-theme.scss
$bg-primary: #FFFFFF;
$bg-secondary: #F5F5F5;
$sidebar-bg: #2B2D31;
$text-primary: #333333;
$text-secondary: #666666;
$accent-blue: #1677FF;
$accent-orange: #FF8C00;
$success: #52C41A;
$error: #FF4D4F;
```

---

### 阶段2: 对话式AI引擎基础 (2-3周)

#### 核心模块 (7个文件)

**1. ai-engine-manager.js** - AI引擎主管理器
```javascript
class AIEngineManager {
  async processUserInput(userInput, context, onStepUpdate) {
    // 1. 意图识别
    const intent = await this.intentClassifier.classify(userInput, context);

    // 2. 任务规划
    const plan = await this.taskPlanner.plan(intent, context);

    // 3. 执行任务步骤
    for (const step of plan.steps) {
      onStepUpdate({ ...step, status: 'running' });
      const result = await this.functionCaller.call(step.tool, step.params);
      onStepUpdate({ ...step, status: 'completed', result });
    }
  }
}
```

**2. intent-classifier.js** - 意图识别器
- 支持6种意图: CREATE_FILE, EDIT_FILE, QUERY_INFO, ANALYZE_DATA, EXPORT_FILE, DEPLOY_PROJECT
- 使用Few-shot Learning + 关键词规则

**3. task-planner.js** - 任务规划器
- 内置任务模板: create_html, create_document, analyze_data
- 动态规划(复杂任务使用LLM)

**4. function-caller.js** - Function Calling框架
- 工具注册与调用
- 内置工具: html_generator, css_generator, file_writer, file_reader

#### IPC集成 (修改 index.js)

```javascript
ipcMain.handle('ai:processInput', async (event, { input, context }) => {
  const onStepUpdate = (step) => {
    event.sender.send('ai:stepUpdate', step);
  };
  return await aiEngine.processUserInput(input, context, onStepUpdate);
});
```

---

### 阶段3: 文件处理引擎 (3-4周)

#### 3种核心引擎

**1. web-engine.js** - Web开发引擎
- HTML生成(Jinja2风格模板)
- CSS生成(Tailwind CSS)
- JavaScript代码生成
- 本地预览服务器(Express, localhost:3000)
- 5种模板: 博客/作品集/企业站/产品页/单页应用

**2. document-engine.js** - 文档处理引擎
- Word文档生成(通过Python python-docx)
- PDF导出(Puppeteer)
- Markdown渲染
- 3种模板: 商务报告/学术论文/用户手册

**3. data-engine.js** - 数据处理引擎
- Excel读写(ExcelJS)
- CSV处理(pandas via Python)
- 数据可视化(Chart.js)

---

### 阶段4: 项目存储完善 (2-3周)

#### 12个数据库表 (修改 database.js)

```sql
-- 核心4表
CREATE TABLE projects (id, name, project_type, description, status, root_path, created_at, updated_at);
CREATE TABLE project_files (id, project_id, file_path, file_type, file_size, git_commit_hash);
CREATE TABLE project_tasks (id, project_id, task_type, description, status, result_path);
CREATE TABLE project_conversations (id, project_id, role, content, tool_calls, created_at);

-- 其他8表
-- project_collaborators, project_comments, project_templates,
-- project_marketplace_listings, project_knowledge_links,
-- project_automation_rules, project_stats, project_logs
```

#### Git自动提交 (git-auto-commit.js)

```javascript
class GitAutoCommit {
  startAutoCommit() {
    // 每5分钟检查一次未提交的更改
    this.timer = setInterval(async () => {
      const status = await this.git.status();
      if (!status.isClean()) {
        await this.git.add('.');
        await this.git.commit(`Auto-commit: ${new Date().toLocaleString()}`);
      }
    }, 5 * 60 * 1000);
  }
}
```

#### 项目文件夹结构 (project-structure.js)

```javascript
// Web项目结构
web: [
  'src/index.html',
  'src/css/style.css',
  'src/js/script.js',
  'assets/images/',
  'README.md',
]
```

---

## 关键文件清单

### 必须创建的文件 (优先级P0)

**组件 (4个)**:
1. `desktop-app-vue/src/renderer/components/projects/ConversationInput.vue`
2. `desktop-app-vue/src/renderer/components/projects/StepDisplay.vue`
3. `desktop-app-vue/src/renderer/components/projects/ProjectSidebar.vue`
4. `desktop-app-vue/src/renderer/components/projects/BrowserPreview.vue`

**AI引擎 (4个)**:
5. `desktop-app-vue/src/main/ai-engine/ai-engine-manager.js`
6. `desktop-app-vue/src/main/ai-engine/intent-classifier.js`
7. `desktop-app-vue/src/main/ai-engine/task-planner.js`
8. `desktop-app-vue/src/main/ai-engine/function-caller.js`

**文件处理引擎 (3个)**:
9. `desktop-app-vue/src/main/engines/web-engine.js`
10. `desktop-app-vue/src/main/engines/document-engine.js`
11. `desktop-app-vue/src/main/engines/data-engine.js`

**存储系统 (2个)**:
12. `desktop-app-vue/src/main/project-structure.js`
13. `desktop-app-vue/src/main/git-auto-commit.js`

### 需要修改的文件 (5个)

14. `desktop-app-vue/src/renderer/pages/projects/ProjectsPage.vue` - 重构UI
15. `desktop-app-vue/src/renderer/pages/projects/ProjectDetailPage.vue` - 重构为对话式
16. `desktop-app-vue/src/main/index.js` - 添加AI引擎IPC handlers
17. `desktop-app-vue/src/main/database.js` - 添加12个项目表
18. `desktop-app-vue/src/stores/project.js` - 添加对话历史管理

---

## 验收标准

### 用户故事1: 对话式创建HTML项目

**场景**: 用户在项目列表页输入"帮我创建一个智能手表的产品介绍页面"

**验收标准**:
- ✅ AI识别意图为 create_file (HTML)
- ✅ 自动创建项目文件夹(src/, assets/, README.md)
- ✅ 生成包含产品介绍的HTML/CSS/JS(可运行)
- ✅ 本地预览服务器可访问(localhost:3000)
- ✅ 自动Git init并提交
- ✅ 步骤展示组件显示5个步骤并正确标记状态

### 用户故事2: 编辑现有文件

**场景**: 用户在项目详情页打开index.html,输入"把标题改成蓝色"

**验收标准**:
- ✅ AI识别意图为 edit_file
- ✅ 正确定位到<h1>标签并修改颜色
- ✅ 文件自动保存
- ✅ 预览界面实时刷新
- ✅ Git自动提交(提交信息包含"Edit: 把标题改成蓝色")

---

## 时间线

```
Week 1-3:   UI重构 (ConversationInput + StepDisplay + 页面重构)
Week 4-6:   AI引擎基础 (意图识别 + 任务规划 + Function Calling)
Week 7-10:  文件处理引擎 (Web + 文档 + 数据)
Week 11-13: 项目存储完善 (12个表 + Git自动提交)
```

**里程碑**:
- M1 (Week 3): UI重构完成
- M2 (Week 6): AI引擎可用
- M3 (Week 10): 核心引擎实现
- M4 (Week 13): 完整上线

---

## 风险与缓解

**高风险**:
1. AI生成质量不稳定 → 模板fallback + 云端大模型备用
2. 开发进度延期 → 优先级排序 + 敏捷开发 + 降低范围

**中风险**:
3. 本地LLM推理慢 → ✅已决策:使用混合模式,智能路由自动切换
4. UI偏离设计 → ✅已决策:完全按照参考图片实现,每周UI Review

---

## 下一步行动 (开始实施)

### 第1周任务 (优先级P0)

**Day 1-2: 创建核心UI组件**
1. 创建 `ConversationInput.vue` - 大型对话输入框
2. 创建 `StepDisplay.vue` - AI执行步骤展示
3. 创建 `ProjectSidebar.vue` - 左侧导航栏

**Day 3-4: 页面重构**
4. 重构 `ProjectsPage.vue` - 实现左侧导航+中央布局
5. 重构 `ProjectDetailPage.vue` - 实现对话式界面

**Day 5: AI引擎基础架构**
6. 创建 `ai-engine-manager.js` - AI引擎主管理器
7. 创建 `intent-classifier.js` - 意图识别器(基于Few-shot)
8. 修改 `index.js` - 添加AI引擎IPC handlers

### 第2周任务

**Web开发引擎实现**:
1. 创建 `web-engine.js` - HTML/CSS/JS生成器
2. 创建5种Web模板(博客、作品集、企业站、产品页、单页应用)
3. 创建 `preview-server.js` - 本地预览服务器(Express)

**数据库完善**:
4. 修改 `database.js` - 添加12个项目表
5. 创建 `project-structure.js` - 项目文件夹结构管理

### 验收检查点

**第3周末**: 完成阶段1(UI重构)
- ✅ 所有18个UI组件已创建
- ✅ 页面布局符合参考图片
- ✅ 对话输入框、步骤展示、浏览器预览可用

**第6周末**: 完成阶段2(AI引擎基础)
- ✅ NLU意图识别准确率>85%
- ✅ 简单任务(创建HTML)可通过对话完成
- ✅ 步骤展示实时更新

**第10周末**: 完成阶段3(Web开发引擎)
- ✅ Web引擎可生成可运行的HTML/CSS/JS
- ✅ 本地预览服务器可访问
- ✅ 5种Web模板可用

**第13周末**: 完成阶段4(项目存储)
- ✅ 12个数据库表完整实现
- ✅ Git自动提交机制运行正常
- ✅ 项目文件夹结构自动创建
