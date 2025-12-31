# 模板-技能-工具映射表

> 自动生成时间: 2025-12-31T04:17:25.658Z

## 映射规则

### writing

**默认技能**: `skill_content_creation`, `skill_document_processing`, `skill_template_application`

**默认工具**: `tool_word_generator`, `tool_template_renderer`, `tool_file_writer`

**执行引擎**: `word`

---

### ppt

**默认技能**: `skill_office_suite`, `skill_content_creation`

**默认工具**: `tool_ppt_generator`, `tool_ppt_slide_creator`, `tool_template_renderer`

**执行引擎**: `ppt`

---

### excel

**默认技能**: `skill_office_suite`, `skill_data_analysis`

**默认工具**: `tool_excel_generator`, `tool_excel_formula_builder`, `tool_excel_chart_creator`, `tool_template_renderer`

**执行引擎**: `excel`

---

### web

**默认技能**: `skill_web_development`, `skill_code_development`

**默认工具**: `tool_html_generator`, `tool_css_generator`, `tool_js_generator`, `tool_create_project_structure`

**执行引擎**: `web`

---

### code-project

**默认技能**: `skill_code_development`, `skill_project_management`

**默认工具**: `tool_create_project_structure`, `tool_git_init`, `tool_file_writer`

**执行引擎**: `code`

**子分类特殊配置**:

- **frontend**
  - 额外技能: `skill_web_development`
  - 额外工具: `tool_npm_project_setup`, `tool_package_json_builder`
- **backend**
  - 额外技能: `skill_code_development`
  - 额外工具: `tool_npm_project_setup`, `tool_dockerfile_generator`
- **python**
  - 额外技能: `skill_code_development`
  - 额外工具: `tool_python_project_setup`, `tool_requirements_generator`

---

### data-science

**默认技能**: `skill_data_science`, `skill_data_analysis`, `skill_code_development`

**默认工具**: `tool_data_preprocessor`, `tool_chart_generator`, `tool_python_project_setup`

**执行引擎**: `ml`

**子分类特殊配置**:

- **machine-learning**
  - 额外技能: `skill_data_science`
  - 额外工具: `tool_ml_model_trainer`, `tool_model_evaluator`, `tool_feature_engineer`
- **data-analysis**
  - 额外技能: `skill_data_analysis`
  - 额外工具: `tool_statistical_analyzer`, `tool_eda_generator`

---

### design

**默认技能**: `skill_image_processing`, `skill_ui_ux_design`

**默认工具**: `tool_image_editor`, `tool_color_palette_generator`, `tool_file_writer`

**执行引擎**: `design`

---

### video

**默认技能**: `skill_video_production`, `skill_content_creation`

**默认工具**: `tool_video_cutter`, `tool_video_merger`, `tool_file_writer`

**执行引擎**: `video`

---

### podcast

**默认技能**: `skill_audio_editing`, `skill_content_creation`

**默认工具**: `tool_audio_editor`, `tool_file_writer`

**执行引擎**: `audio`

---

### creative-writing

**默认技能**: `skill_content_creation`, `skill_document_processing`

**默认工具**: `tool_word_generator`, `tool_file_writer`, `tool_template_renderer`

**执行引擎**: `document`

---

### social-media

**默认技能**: `skill_content_creation`, `skill_seo_marketing`

**默认工具**: `tool_seo_optimizer`, `tool_keyword_extractor`, `tool_file_writer`

**执行引擎**: `default`

---

### marketing

**默认技能**: `skill_content_creation`, `skill_seo_marketing`

**默认工具**: `tool_seo_optimizer`, `tool_file_writer`, `tool_template_renderer`

**执行引擎**: `default`

---

### education

**默认技能**: `skill_content_creation`, `skill_document_processing`

**默认工具**: `tool_word_generator`, `tool_ppt_generator`, `tool_file_writer`

**执行引擎**: `document`

---

### legal

**默认技能**: `skill_document_processing`, `skill_content_creation`

**默认工具**: `tool_word_generator`, `tool_pdf_generator`, `tool_file_writer`

**执行引擎**: `document`

---

### ecommerce

**默认技能**: `skill_content_creation`, `skill_seo_marketing`

**默认工具**: `tool_file_writer`, `tool_excel_generator`, `tool_template_renderer`

**执行引擎**: `default`

---

### health

**默认技能**: `skill_content_creation`, `skill_document_processing`

**默认工具**: `tool_word_generator`, `tool_file_writer`

**执行引擎**: `document`

---

