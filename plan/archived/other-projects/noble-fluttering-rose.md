# 文书制作功能完善实施计划

## 一、项目概述

**目标**: 将Demo中专业的文书制作功能（基于Word模板+书签替换机制）完整集成到当前农业执法系统中，替换现有的简单文书编辑功能。

**技术方案**:
- PDF转换: Apache POI + docx4j（开源方案）
- 组件迁移: 一次性迁移全部52个文书组件
- 功能策略: 完全替换现有DocumentForm简单编辑模式
- 实施顺序: 后端优先，确保基础设施稳固后再进行前端开发

## 二、实施阶段

### 阶段一：后端基础设施建设（优先级最高）

#### 1.1 迁移核心工具类

**新建目录**: `agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/util/word/`

**迁移文件**:
- `CustomXWPFDocument.java` - Word文档书签替换核心类（3,465行）
- `XWPFDocumentUtil.java` - Word文档工具类
- `XWPFDocumentFooterUtil.java` - 页脚处理工具类

**代码调整要点**:
1. 包名修改: `com.joly.company.utils` → `com.haoting.enforcement.util.word`
2. 依赖清理:
   - 移除 `com.joly.common.utils.FileUtils`，使用Spring的ResourceUtils或自实现
   - 替换 `sun.misc.BASE64Decoder` 为 `java.util.Base64`（Java 8+标准）
   - 将 `com.alibaba.fastjson` 改为 `com.alibaba.fastjson2`
3. 字符集处理: 确保UTF-8编码一致性

**关键文件路径**:
- `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/util/word/CustomXWPFDocument.java`
- `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/util/word/XWPFDocumentUtil.java`
- `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/util/word/XWPFDocumentFooterUtil.java`

#### 1.2 更新Maven依赖

**修改文件**: `C:/code/agricultural/agricultural-enforcement-backend/pom.xml`

**新增依赖**:
```xml
<!-- docx4j for Word to PDF conversion -->
<dependency>
    <groupId>org.docx4j</groupId>
    <artifactId>docx4j-JAXB-ReferenceImpl</artifactId>
    <version>11.4.9</version>
</dependency>

<!-- POI扩展 - 支持VML图形 -->
<dependency>
    <groupId>org.apache.poi</groupId>
    <artifactId>ooxml-schemas</artifactId>
    <version>1.4</version>
</dependency>

<!-- Apache Commons Codec (Base64处理) -->
<dependency>
    <groupId>commons-codec</groupId>
    <artifactId>commons-codec</artifactId>
</dependency>
```

#### 1.3 配置文件路径管理

**修改文件**: `C:/code/agricultural/agricultural-enforcement-backend/src/main/resources/application.yml`

**新增配置**:
```yaml
# 文书模板配置
document:
  # Word模板根目录
  template-path: ${user.dir}/templates/word/2024
  # 生成文件存储目录
  output-path: ${user.dir}/storage/documents
  # 临时文件目录
  temp-path: ${user.dir}/storage/temp
```

**新建配置类**: `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/config/DocumentConfig.java`

#### 1.4 创建模板管理实体

**新建文件**: `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/entity/DocumentTemplate.java`

**字段设计**:
- id, templateCode, templateName, fileName
- filePath, documentType, bookmarkConfig (JSON)
- sortOrder, status
- createTime, updateTime, createBy, updateBy, deleted

**新建Mapper**: `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/mapper/DocumentTemplateMapper.java`

#### 1.5 数据库表设计

**修改文件**: `C:/code/agricultural/agricultural-enforcement-backend/src/main/resources/sql/schema.sql`

**新增表**: `document_template`（模板管理表）

**扩展表**: `case_document`（新增字段）
- template_code VARCHAR(50) - 使用的模板编码
- form_data LONGTEXT - 表单数据JSON
- pdf_path VARCHAR(500) - PDF文件路径
- auditor_id BIGINT - 审核人ID
- auditor_name VARCHAR(50) - 审核人姓名
- audit_time DATETIME - 审核时间

#### 1.6 实现模板管理服务

**新建文件**:
- `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/service/DocumentTemplateService.java`
- `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/service/impl/DocumentTemplateServiceImpl.java`

**核心方法**:
- `getTemplates(Integer documentType)` - 获取模板列表
- `getByCode(String templateCode)` - 根据编码获取模板
- `saveTemplate()` / `updateTemplate()` - 模板管理

#### 1.7 扩展DocumentService

**修改文件**:
- `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/service/DocumentService.java`
- `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/service/impl/DocumentServiceImpl.java`

**新增方法**:
```java
// 基于模板生成文书
Long generateFromTemplate(String templateCode, Map<String, Object> formData, Long caseId);

// 导出Word（基于书签替换）
byte[] exportWordByTemplate(Long documentId);

// Word转PDF（使用docx4j）
byte[] convertToPdf(Long documentId);
```

**核心实现逻辑**:
1. 根据templateCode加载模板
2. 创建文书记录（保存formData为JSON）
3. 复制模板到临时目录
4. 调用CustomXWPFDocument.runMap()进行书签替换
5. 使用docx4j转换为PDF
6. 保存文件路径到数据库

#### 1.8 扩展DocumentController

**修改文件**: `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/controller/DocumentController.java`

**新增端点**:
```java
POST /document/create-from-template    // 基于模板创建文书
GET  /document/templates               // 获取模板列表
GET  /document/{id}/export/word-template  // 导出Word（模板版）
POST /document/{id}/convert-pdf        // 转换为PDF
```

### 阶段二：Word模板部署

#### 2.1 创建模板目录结构

**创建目录**: `C:/code/agricultural/agricultural-enforcement-backend/templates/word/2024/`

**迁移53个模板文件**:
从 `C:/code/agricultural/文书制作demo/wordTemplate/*.docx` 复制到上述目录

**模板清单**（部分）:
- 立案不予立案审批表2024版.docx
- 询问笔录2024版.docx
- 现场检查（勘验）笔录2024版.docx
- 行政处罚决定书2024版本.docx
- 行政处罚事先告知书（适用听证案件）2024版.docx
- ... (共53个)

#### 2.2 初始化模板数据

**创建SQL脚本**: `C:/code/agricultural/agricultural-enforcement-backend/src/main/resources/sql/data/document_templates.sql`

**插入53条模板记录**，示例：
```sql
INSERT INTO document_template (template_code, template_name, file_name, document_type, sort_order) VALUES
('doc1', '指定管辖通知书', '指定管辖通知书2024版.docx', 1, 1),
('doc2', '现场检查笔录', '现场检查（勘验）笔录2024版.docx', 2, 2),
('doc3', '询问笔录', '询问笔录2024版.docx', 3, 3),
...
('doc27', '行政处罚决定书', '行政处罚决定书2024版本.docx', 6, 27);
```

#### 2.3 编写模板文档

**创建**: `C:/code/agricultural/agricultural-enforcement-backend/templates/word/2024/README.md`

记录每个模板的书签清单和使用说明（用于开发参考）

### 阶段三：前端组件集成

#### 3.1 创建新目录结构

**新建目录**:
```
agricultural-enforcement-frontend/src/views/document/
  making/                      # 新增：专业文书制作
    DocumentMaking.vue         # 主制作页面
    components/                # 文书组件库
      Doc1.vue                 # 指定管辖通知书
      Doc2.vue                 # 现场检查笔录
      Doc3.vue                 # 询问笔录
      ... (共52个组件)
```

#### 3.2 迁移主制作页面

**新建文件**: `C:/code/agricultural/agricultural-enforcement-frontend/src/views/document/making/DocumentMaking.vue`

**改造来源**: `C:/code/agricultural/文书制作demo/vue前端/documentMaking/views/documentMakingEasyModule.vue`

**改造要点**:
1. 简化业务类型选择（仅保留农业执法2024版）
2. 调整API调用为当前项目的document API
3. 集成案件选择组件（从当前项目）
4. 调整样式为Element Plus风格
5. 优化文书组件动态加载逻辑

**核心功能**:
- 模板选择下拉框（从后端API加载）
- 案件关联（自动填充部分字段）
- 动态加载对应的文书组件
- 表单数据收集与提交
- 文书预览功能
- 保存草稿/提交审核

#### 3.3 批量迁移文书组件（52个）

**迁移规则**:
```
文书制作demo/vue前端/documentMaking/components_ny_2024/doc1.vue
  → agricultural-enforcement-frontend/src/views/document/making/components/Doc1.vue
```

**改造要点**（对每个组件）:
1. 组件命名规范化（doc1 → Doc1，符合Vue 3命名约定）
2. 移除Demo特定依赖
3. 调整为Element Plus组件
4. 添加props接收案件数据（caseData）
5. 实现自动填充逻辑（从案件数据映射到表单）
6. 添加表单验证规则
7. 使用v-model双向绑定表单数据

**组件清单**（完整52个）:
- Doc1.vue - 指定管辖通知书
- Doc2.vue - 现场检查笔录
- Doc3.vue - 询问笔录
- Doc4.vue - 证据提取单
- Doc5.vue - 抽样取证凭证
- Doc6.vue - 证据先行登记保存通知书
- Doc7.vue - 先行登记保存物品处理通知书
- ... (共52个，完整列表见Demo)

**示例改造**（Doc3.vue - 询问笔录）:
- 被询问人信息自动从案件当事人填充
- 询问时间默认当前时间
- 执法人员从登录用户获取
- 表单字段完整验证

#### 3.4 更新文书列表页

**修改文件**: `C:/code/agricultural/agricultural-enforcement-frontend/src/views/document/DocumentList.vue`

**调整内容**:
- 移除"创建文书"按钮的简单编辑跳转
- 改为跳转到新的DocumentMaking页面
- 列表增加"模板名称"列显示
- 操作列调整为：预览、下载Word、下载PDF、删除

#### 3.5 删除旧的DocumentForm

**删除文件**: `C:/code/agricultural/agricultural-enforcement-frontend/src/views/document/DocumentForm.vue`（简单编辑模式，不再需要）

#### 3.6 更新路由配置

**修改文件**: `C:/code/agricultural/agricultural-enforcement-frontend/src/router/index.js`

**调整路由**:
```javascript
{
  path: 'document/list',
  name: 'DocumentList',
  component: () => import('@/views/document/DocumentList.vue'),
  meta: { title: '文书列表' }
},
{
  path: 'document/making/:caseId?',
  name: 'DocumentMaking',
  component: () => import('@/views/document/making/DocumentMaking.vue'),
  meta: { title: '文书制作' }
}
```

#### 3.7 更新API封装

**修改文件**: `C:/code/agricultural/agricultural-enforcement-frontend/src/api/document.js`

**新增API方法**:
```javascript
// 获取模板列表
export function getTemplates(documentType)

// 基于模板创建文书
export function createFromTemplate(data)

// 导出Word（模板版本）
export function exportWordByTemplate(id)

// 转换为PDF
export function convertToPdf(id)
```

### 阶段四：菜单和权限配置

#### 4.1 更新菜单配置

如果项目有单独的菜单配置文件，更新菜单项：
- 保持"文书管理"菜单
- "文书列表"链接到DocumentList
- 移除旧的"创建文书"菜单项

#### 4.2 权限配置

确保文书制作相关权限正确配置：
- `document:create` - 创建文书
- `document:audit` - 审核文书
- `document:export` - 导出文书

### 阶段五：测试与优化

#### 5.1 单元测试

**新建测试类**:
- `CustomXWPFDocumentTest.java` - 测试书签替换功能
- `DocumentServiceTest.java` - 测试文书生成逻辑
- `DocumentControllerTest.java` - 测试API端点

#### 5.2 集成测试

**测试场景**:
1. 模板加载测试
2. 书签替换正确性测试
3. 图片插入测试
4. 表格填充测试
5. PDF转换质量测试
6. 完整流程测试（创建-审核-导出）

#### 5.3 性能优化

- 模板文件缓存
- PDF转换异步化（大文件）
- 临时文件定期清理

## 三、关键技术实现要点

### 3.1 CustomXWPFDocument代码调整

**Base64解码替换**:
```java
// 旧代码（sun.misc已弃用）
BASE64Decoder decoder = new BASE64Decoder();
byte[] pictureData = decoder.decodeBuffer(imgurl);

// 新代码（Java 8+ 标准）
byte[] pictureData = Base64.getDecoder().decode(imgurl);
```

**FastJSON升级**:
```java
// 旧代码
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;

// 新代码
import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
```

### 3.2 docx4j PDF转换实现

```java
public byte[] convertToPdf(String docxPath) throws Exception {
    // 加载Word文档
    WordprocessingMLPackage wordMLPackage = WordprocessingMLPackage.load(new File(docxPath));

    // 配置PDF输出
    Docx4J.toPDF(wordMLPackage, new FileOutputStream(pdfPath));

    // 读取PDF字节
    return Files.readAllBytes(Paths.get(pdfPath));
}
```

### 3.3 文书组件数据绑定

```vue
<template>
  <el-form :model="formData" label-width="120px">
    <el-form-item label="被询问人：" prop="p_name" required>
      <el-input v-model="formData.p_name" />
    </el-form-item>
    <!-- 其他字段 -->
  </el-form>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  modelValue: Object,
  caseData: Object  // 案件数据
})

const emit = defineEmits(['update:modelValue'])

const formData = ref(props.modelValue || {})

// 监听案件数据，自动填充
watch(() => props.caseData, (newData) => {
  if (newData) {
    formData.value.p_name = newData.partyName
    formData.value.p_tel = newData.contactPhone
    // ... 其他映射
  }
}, { deep: true, immediate: true })

// 双向绑定
watch(formData, (newVal) => {
  emit('update:modelValue', newVal)
}, { deep: true })
</script>
```

## 四、关键文件清单

### 需要创建的文件（后端）

1. `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/util/word/CustomXWPFDocument.java`
2. `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/util/word/XWPFDocumentUtil.java`
3. `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/util/word/XWPFDocumentFooterUtil.java`
4. `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/entity/DocumentTemplate.java`
5. `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/mapper/DocumentTemplateMapper.java`
6. `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/service/DocumentTemplateService.java`
7. `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/service/impl/DocumentTemplateServiceImpl.java`
8. `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/config/DocumentConfig.java`

### 需要修改的文件（后端）

1. `C:/code/agricultural/agricultural-enforcement-backend/pom.xml`
2. `C:/code/agricultural/agricultural-enforcement-backend/src/main/resources/application.yml`
3. `C:/code/agricultural/agricultural-enforcement-backend/src/main/resources/sql/schema.sql`
4. `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/controller/DocumentController.java`
5. `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/service/DocumentService.java`
6. `C:/code/agricultural/agricultural-enforcement-backend/src/main/java/com/haoting/enforcement/service/impl/DocumentServiceImpl.java`

### 需要创建的文件（前端）

1. `C:/code/agricultural/agricultural-enforcement-frontend/src/views/document/making/DocumentMaking.vue`
2. `C:/code/agricultural/agricultural-enforcement-frontend/src/views/document/making/components/Doc1.vue` 至 `Doc52.vue`（52个文件）

### 需要修改的文件（前端）

1. `C:/code/agricultural/agricultural-enforcement-frontend/src/router/index.js`
2. `C:/code/agricultural/agricultural-enforcement-frontend/src/api/document.js`
3. `C:/code/agricultural/agricultural-enforcement-frontend/src/views/document/DocumentList.vue`

### 需要删除的文件（前端）

1. `C:/code/agricultural/agricultural-enforcement-frontend/src/views/document/DocumentForm.vue`

### 需要复制的资源

1. 从 `C:/code/agricultural/文书制作demo/wordTemplate/` 复制53个.docx模板到 `C:/code/agricultural/agricultural-enforcement-backend/templates/word/2024/`

## 五、实施顺序（按天计划）

### 第1天：后端基础（核心工具类）
- [x] 创建util/word目录
- [ ] 迁移CustomXWPFDocument.java并调整
- [ ] 迁移XWPFDocumentUtil.java
- [ ] 迁移XWPFDocumentFooterUtil.java
- [ ] 更新pom.xml添加依赖
- [ ] 编译测试，确保无错误

### 第2天：后端实体和数据库
- [ ] 创建DocumentTemplate实体
- [ ] 创建DocumentTemplateMapper
- [ ] 编写schema.sql（新增表和字段）
- [ ] 执行数据库更新
- [ ] 创建DocumentConfig配置类
- [ ] 更新application.yml

### 第3天：后端服务实现
- [ ] 实现DocumentTemplateService
- [ ] 扩展DocumentService（新增generateFromTemplate等方法）
- [ ] 实现书签替换集成逻辑
- [ ] 实现docx4j PDF转换
- [ ] 单元测试CustomXWPFDocument功能

### 第4天：后端Controller和模板部署
- [ ] 扩展DocumentController新增端点
- [ ] 创建templates/word/2024目录
- [ ] 复制53个Word模板文件
- [ ] 编写并执行模板初始化SQL
- [ ] 测试完整后端流程（模板加载-生成Word-转PDF）

### 第5-6天：前端主框架
- [ ] 创建making目录结构
- [ ] 迁移并改造DocumentMaking.vue主页面
- [ ] 更新document API封装
- [ ] 更新路由配置
- [ ] 实现模板选择和案件关联UI
- [ ] 测试前后端联调（模板列表加载）

### 第7-9天：前端组件迁移（批次一：1-20）
- [ ] 迁移Doc1-Doc10组件（第7天）
- [ ] 迁移Doc11-Doc20组件（第8天）
- [ ] 测试前20个组件的表单功能（第9天）
- [ ] 调整样式和验证规则

### 第10-12天：前端组件迁移（批次二：21-40）
- [ ] 迁移Doc21-Doc30组件（第10天）
- [ ] 迁移Doc31-Doc40组件（第11天）
- [ ] 测试组件功能（第12天）

### 第13-14天：前端组件迁移（批次三：41-52）
- [ ] 迁移Doc41-Doc52组件（第13天）
- [ ] 全面测试所有52个组件（第14天）
- [ ] 修复问题

### 第15天：UI完善和集成
- [ ] 更新DocumentList.vue
- [ ] 删除旧DocumentForm.vue
- [ ] 调整菜单配置
- [ ] 完善文书预览功能
- [ ] UI细节优化

### 第16-17天：全面测试
- [ ] 端到端测试（所有文书类型）
- [ ] 书签替换正确性验证
- [ ] PDF转换质量检查
- [ ] 性能测试和优化
- [ ] Bug修复

### 第18天：部署和文档
- [ ] 生产环境部署准备
- [ ] 编写用户手册
- [ ] 编写开发文档
- [ ] 培训和交接

**总工期**: 18天

## 六、风险控制

### 风险1：PDF转换质量问题
**应对**: docx4j转换效果测试，如果不满意可切换到LibreOffice命令行方案

### 风险2：52个组件迁移工作量超预期
**应对**: 已按3天一批次规划，可灵活调整每批数量

### 风险3：书签配置不完整或错误
**应对**: 逐个模板测试，建立书签文档，发现问题及时修正模板

### 风险4：案件数据自动填充映射复杂
**应对**: 建立统一的字段映射配置，提供默认映射和可定制映射

### 风险5：大文件PDF转换性能问题
**应对**: 实现异步转换机制，提供转换进度反馈

## 七、验收标准

1. ✅ 后端能成功加载53个Word模板
2. ✅ 书签替换功能正确（文本、图片、表格、复选框）
3. ✅ PDF转换质量符合要求（格式保真）
4. ✅ 前端52个文书组件功能完整
5. ✅ 案件数据自动填充正确
6. ✅ 文书审核流程正常
7. ✅ Word/PDF导出功能正常
8. ✅ 性能满足要求（单个文书生成<3秒）

## 八、后续优化建议

1. 模板在线编辑器（管理员可在线修改模板）
2. AI智能填充增强（更多字段自动识别）
3. 批量文书生成（一次生成多个关联文书）
4. 电子签章集成
5. 移动端支持（文书查看和审批）
6. 模板版本控制（支持模板历史版本）
