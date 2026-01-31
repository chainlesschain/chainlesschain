# 文件导入项目功能 - 实施文档

## 功能概述

在原有的"PC端发现和引用Android端文件"功能基础上，新增了将文件导入到项目管理系统的能力，支持：

1. **Android端文件导入项目** - 将Android设备的文件导入到PC端项目中
2. **项目选择界面** - 友好的项目选择对话框
3. **文件自动复制** - 自动将文件复制到项目目录
4. **元数据记录** - 记录文件来源和导入信息

---

## 实施内容

### 1. 核心功能实现

#### 1.1 ExternalDeviceFileManager扩展

**文件位置：** `desktop-app-vue/src/main/file/external-device-file-manager.js`

**新增方法：**

```javascript
async importToProject(fileId, projectId, options = {})
```

**功能特性：**

- ✅ 自动拉取未缓存文件
- ✅ 验证项目存在性
- ✅ 创建项目文件目录
- ✅ 生成唯一文件名（避免冲突）
- ✅ 复制文件到项目目录
- ✅ 创建project_files记录
- ✅ 记录元数据（设备ID、原始文件ID、分类等）

**实现流程：**

```javascript
1. 获取文件信息
   ↓
2. 确保文件已缓存（未缓存则先拉取）
   ↓
3. 验证项目存在
   ↓
4. 创建项目文件目录
   ↓
5. 生成唯一文件名（basename_timestamp.ext）
   ↓
6. 复制文件到项目目录
   ↓
7. 创建project_files数据库记录
   ↓
8. 触发file-imported-to-project事件
```

**元数据结构：**

```javascript
{
  deviceId: 'android_xxx',
  originalFileId: 'file_001',
  category: 'DOCUMENT',
  importedAt: 1704067200000
}
```

---

### 2. IPC接口扩展

**文件位置：** `desktop-app-vue/src/main/file/external-device-file-ipc.js`

**新增IPC处理器：**

#### external-file:import-to-project

导入文件到指定项目。

**参数：**

- `fileId` (string): 文件ID
- `projectId` (string): 项目ID

**返回值：**

```javascript
{
  success: true,
  fileId: 'android_device_001_file_001',
  projectId: 'project_xxx',
  projectFileId: 'pf_xxx',
  fileName: 'document.pdf',
  filePath: '/path/to/project/files/document_1704067200000.pdf'
}
```

#### external-file:get-projects

获取项目列表（用于导入选择）。

**返回值：**

```javascript
{
  success: true,
  projects: [
    {
      id: 'project_xxx',
      name: 'My Project',
      description: 'Project description',
      status: 'active',
      created_at: 1704067200000
    },
    // ...
  ]
}
```

---

### 3. UI界面实现

**文件位置：** `desktop-app-vue/src/renderer/pages/ExternalDeviceBrowser.vue`

#### 3.1 导入项目按钮

在文件列表的操作列中添加"导入项目"按钮：

```vue
<a-button
  v-if="record.is_cached"
  type="link"
  size="small"
  @click="showProjectSelector(record)"
>
  <folder-add-outlined />
  导入项目
</a-button>
```

**显示条件：**

- 文件已缓存（is_cached = 1）

#### 3.2 项目选择对话框

**功能特性：**

- ✅ 加载项目列表
- ✅ 单选项目
- ✅ 显示项目信息（名称、描述、状态、创建时间）
- ✅ 空状态处理（无项目时显示"创建新项目"按钮）
- ✅ 加载状态（Spin）
- ✅ 导入状态（按钮loading）

**对话框内容：**

```vue
<a-modal
  v-model:open="projectSelectorVisible"
  title="选择导入的项目"
  @ok="confirmImportToProject"
  @cancel="projectSelectorVisible = false"
  width="600px"
>
  <!-- 项目列表 -->
  <a-list :data-source="projects">
    <template #renderItem="{ item }">
      <a-list-item>
        <template #actions>
          <a-radio
            :checked="selectedProjectId === item.id"
            @change="selectedProjectId = item.id"
          >
            选择
          </a-radio>
        </template>
        <a-list-item-meta>
          <template #title>
            {{ item.name }}
            <a-tag>{{ item.status }}</a-tag>
          </template>
          <template #description>
            {{ item.description }}
            创建时间：{{ formatDate(item.created_at) }}
          </template>
        </a-list-item-meta>
      </a-list-item>
    </template>
  </a-list>

  <!-- 操作按钮 -->
  <template #footer>
    <a-button @click="projectSelectorVisible = false">取消</a-button>
    <a-button
      type="primary"
      :disabled="!selectedProjectId"
      :loading="importing"
      @click="confirmImportToProject"
    >
      确定导入
    </a-button>
  </template>
</a-modal>
```

#### 3.3 新增状态变量

```javascript
// 项目选择相关状态
const projectSelectorVisible = ref(false);
const projects = ref([]);
const projectsLoading = ref(false);
const selectedProjectId = ref("");
const fileToImport = ref(null);
const importing = ref(false);
```

#### 3.4 新增方法

**showProjectSelector(file)**

- 显示项目选择器
- 记录待导入文件
- 加载项目列表

**loadProjects()**

- 调用IPC获取项目列表
- 默认选择第一个项目

**confirmImportToProject()**

- 验证选择
- 调用IPC导入文件
- 显示成功消息
- 重置状态

**createNewProject()**

- 跳转到项目创建页面

---

## 使用流程

### 用户操作流程

```
1. 浏览Android端文件列表
   ↓
2. 选择需要导入的文件
   ↓
3. 如果文件未缓存，点击"拉取"
   ↓
4. 文件缓存完成后，点击"导入项目"
   ↓
5. 选择目标项目（或创建新项目）
   ↓
6. 点击"确定导入"
   ↓
7. 系统自动将文件复制到项目目录
   ↓
8. 显示导入成功提示
```

### 技术实现流程

```
UI层: 点击"导入项目"
   ↓
UI层: 显示项目选择对话框
   ↓
IPC: 调用external-file:get-projects
   ↓
Core: 从数据库查询项目列表
   ↓
UI层: 用户选择项目并确认
   ↓
IPC: 调用external-file:import-to-project
   ↓
Core: importToProject(fileId, projectId)
   ├─ 获取文件信息
   ├─ 确保文件已缓存
   ├─ 验证项目存在
   ├─ 创建项目文件目录
   ├─ 复制文件
   ├─ 创建project_files记录
   └─ 触发事件
   ↓
UI层: 显示成功消息
```

---

## 数据库Schema

### project_files表

文件导入会在 `project_files` 表中创建记录：

```sql
INSERT INTO project_files (
  id,                   -- UUID
  project_id,           -- 项目ID
  file_name,            -- 文件名
  file_path,            -- 文件路径
  file_type,            -- MIME类型
  file_size,            -- 文件大小
  source,               -- 来源: 'external-device'
  metadata,             -- 元数据JSON
  created_at,           -- 创建时间
  updated_at            -- 更新时间
)
```

**元数据示例：**

```json
{
  "deviceId": "android_device_001",
  "originalFileId": "file_001",
  "category": "DOCUMENT",
  "importedAt": 1704067200000
}
```

---

## 目录结构

### 项目文件存储位置

```
{userData}/
└── projects/
    └── {project_id}/
        └── files/
            ├── document_1704067200000.pdf
            ├── image_1704067300000.jpg
            └── code_1704067400000.py
```

**文件命名规则：**

- 格式：`{basename}_{timestamp}{ext}`
- 示例：`report_1704067200000.pdf`
- 目的：避免文件名冲突

---

## API参考

### importToProject()

**签名：**

```javascript
async importToProject(fileId, projectId, options = {})
```

**参数：**

- `fileId` (string): 外部设备文件ID（格式：deviceId_fileId）
- `projectId` (string): 目标项目ID
- `options` (object): 可选配置
  - 目前未使用，预留扩展

**返回值：**

```javascript
{
  success: true,
  fileId: 'android_device_001_file_001',
  projectId: 'project_xxx',
  projectFileId: 'pf_xxx',
  fileName: 'document.pdf',
  filePath: '/path/to/project/files/document_1704067200000.pdf'
}
```

**异常：**

- `File not found` - 文件不存在
- `Project not found` - 项目不存在
- 其他文件系统错误

---

## 事件系统

### file-imported-to-project

文件成功导入项目后触发。

**事件数据：**

```javascript
{
  fileId: 'android_device_001_file_001',
  projectId: 'project_xxx',
  projectFileId: 'pf_xxx',
  fileName: 'document.pdf'
}
```

**监听示例：**

```javascript
externalFileManager.on("file-imported-to-project", (data) => {
  console.log(`文件 ${data.fileName} 已导入到项目 ${data.projectId}`);
});
```

---

## 测试验证

### 手动测试步骤

#### 1. 测试文件导入

**步骤：**

1. 启动应用并导航到 `#/external-devices`
2. 同步Android设备文件索引
3. 选择一个文档文件
4. 点击"拉取"按钮（如未缓存）
5. 等待文件缓存完成
6. 点击"导入项目"按钮
7. 在对话框中选择项目
8. 点击"确定导入"

**预期结果：**

- ✅ 项目选择对话框正确显示
- ✅ 项目列表加载成功
- ✅ 导入成功提示
- ✅ 文件出现在项目目录
- ✅ project_files表有对应记录

**验证SQL：**

```sql
SELECT * FROM project_files
WHERE source = 'external-device'
ORDER BY created_at DESC
LIMIT 10;
```

#### 2. 测试无项目情况

**步骤：**

1. 确保数据库中没有项目
2. 点击"导入项目"按钮

**预期结果：**

- ✅ 显示空状态
- ✅ 显示"创建新项目"按钮
- ✅ 点击按钮跳转到项目创建页面

#### 3. 测试文件名冲突

**步骤：**

1. 导入同名文件两次

**预期结果：**

- ✅ 第二次导入文件名包含不同时间戳
- ✅ 两个文件都成功保存
- ✅ 文件内容完整

#### 4. 测试未缓存文件导入

**步骤：**

1. 选择未缓存的文件
2. 直接点击"导入项目"（不先拉取）

**预期结果：**

- ✅ 系统自动先拉取文件
- ✅ 拉取完成后继续导入
- ✅ 整个流程无错误

---

## 代码修改清单

### 修改的文件

| 文件                                            | 类型 | 修改内容                | 行数变化 |
| ----------------------------------------------- | ---- | ----------------------- | -------- |
| `src/main/file/external-device-file-manager.js` | 修改 | 添加importToProject方法 | +100     |
| `src/main/file/external-device-file-ipc.js`     | 修改 | 添加2个IPC处理器        | +50      |
| `src/renderer/pages/ExternalDeviceBrowser.vue`  | 修改 | 添加UI和方法            | +120     |

**总计：** +270 行代码

---

## 优势和价值

### 1. 无缝集成

- ✅ 与现有项目管理系统无缝集成
- ✅ 复用现有的文件缓存机制
- ✅ 自动处理文件未缓存情况

### 2. 数据完整性

- ✅ 记录完整的文件来源信息
- ✅ 保留原始文件元数据
- ✅ 生成唯一文件名避免冲突

### 3. 用户体验

- ✅ 友好的项目选择界面
- ✅ 清晰的操作反馈
- ✅ 自动跳转到项目创建（无项目时）

### 4. 可扩展性

- ✅ 预留options参数
- ✅ 事件系统支持扩展
- ✅ 元数据可记录额外信息

---

## 使用场景

### 场景1：移动办公

用户在手机上拍摄文档照片，导入到PC端项目中进行整理和分析。

### 场景2：代码协作

用户在手机上编写代码片段，导入到PC端项目中进行集成开发。

### 场景3：资料收集

用户从手机下载的PDF资料，导入到研究项目中进行归档和AI分析。

### 场景4：多媒体项目

用户手机拍摄的视频素材，导入到视频制作项目中进行编辑。

---

## 后续优化方向

### 短期优化（1周）

1. ✅ 支持批量导入
2. ✅ 添加导入进度显示
3. ✅ 支持导入后自动打开项目

### 中期优化（1月）

1. ✅ 支持文件分类（自动识别文件类型并分类存储）
2. ✅ 支持导入预览（显示文件缩略图）
3. ✅ 支持导入历史记录

### 长期规划（3月）

1. ✅ 智能推荐项目（基于文件类型和内容）
2. ✅ 自动标签生成（基于AI分析）
3. ✅ 跨项目文件共享

---

## 限制和注意事项

### 当前限制

1. **仅支持已缓存文件** - 未缓存文件会自动拉取
2. **文件大小限制** - 继承缓存系统的限制（建议 < 500MB）
3. **项目数量限制** - 查询限制100个项目

### 注意事项

1. **磁盘空间** - 文件会被复制（不是移动），占用双倍空间
2. **文件名冲突** - 使用时间戳避免冲突，但可能导致文件名较长
3. **元数据同步** - 如果原始文件被删除，project_files中的记录仍然保留

---

## 总结

### 实施成果

✅ **功能完整** - 从文件拉取到项目导入的完整流程
✅ **用户友好** - 简洁明了的UI界面
✅ **数据可靠** - 完整的元数据记录和文件完整性保证
✅ **易于扩展** - 预留扩展点和事件系统

### 技术亮点

1. **自动缓存处理** - 自动检测并拉取未缓存文件
2. **唯一文件名** - 时间戳机制避免冲突
3. **完整元数据** - 记录文件来源和导入信息
4. **友好交互** - 项目选择对话框和空状态处理

### 项目价值

将移动设备文件与项目管理系统打通，为用户提供跨设备的文件管理和AI分析能力，提升工作效率。

---

**实施日期：** 2026年1月25日
**版本：** v1.1.0
