# Bug Fix: Projects with Null root_path

## Problem Description

Document-type projects were being created without a `root_path` set in the database, causing file operations to fail. This occurred when:

1. A document project was created with **zero files**
2. The project creation logic only set `root_path` when files were present

### Error Symptoms

When trying to access project files, the application would display:
```
[Main] ⚠️  项目没有根路径！
[Main] 可能原因：
[Main]   1. 项目创建时未设置路径
[Main]   2. 数据库迁移导致字段丢失
[Main]   3. 项目记录损坏
```

### Root Cause

The project creation code had a conditional check:
```javascript
if (projectType === 'document' && accumulatedData.files.length > 0) {
  // Only set root_path here
}
```

This meant projects with **zero files** never got their `root_path` set.

## Solution

### Changes Made

#### 1. Streaming Project Creation (`index.js:4861-4905`)
- **Before**: `root_path` was only set if files existed
- **After**: `root_path` is always set for document-type projects, regardless of file count
- Creates the project directory immediately after project creation
- Sets `root_path` before attempting to write files

#### 2. Non-Streaming Project Creation (`index.js:4723-4746`)
- Added similar logic to ensure `root_path` is set for all document projects
- Creates project directory structure even when no files are present

#### 3. Repair Utility (`index.js:5132-5177`)
- Added new IPC handler `project:repair-root-path`
- Can fix existing projects that have `null` root_path
- Only works for document-type projects
- Creates the directory and updates the database

#### 4. Preload API (`preload/index.js:464`)
- Exposed `repairRootPath(projectId)` method to renderer process
- Allows frontend to trigger repairs

## Usage

### For New Projects
The fix is automatic - all new document projects will have their `root_path` set correctly.

### For Existing Broken Projects

#### Option 1: Batch Repair All Projects (Recommended)
Use the batch repair function to fix **all** broken projects at once:

```javascript
// In developer console (F12)
const result = await window.electronAPI.project.repairAllRootPaths();
console.log(result);
// Output:
// {
//   success: true,
//   message: "修复完成：成功 5 个，失败 0 个",
//   fixed: 5,
//   failed: 0,
//   details: [
//     { id: "xxx", name: "项目1", status: "fixed", rootPath: "C:\\..." },
//     ...
//   ]
// }
```

**Steps:**
1. Open ChainlessChain application
2. Press `F12` to open Developer Tools
3. Go to **Console** tab
4. Paste the command above and press Enter
5. Check the results

#### Option 2: Repair Single Project
If you only need to fix one specific project:

```javascript
// In renderer process or developer console
const result = await window.electronAPI.project.repairRootPath(projectId);
console.log(result); // { success: true, message: '修复成功', rootPath: '...' }
```

### Quick Start Guide
See `scripts/repair-all-projects.js` for detailed instructions on batch repair.

## Testing

### Test New Project Creation
1. Create a new document-type project
2. Check that `root_path` is set in the database:
   ```sql
   SELECT id, name, root_path, project_type FROM projects;
   ```
3. Verify the directory exists in the file system

### Test Repair Function
1. Identify a project with `root_path = null`
2. Call `repairRootPath(projectId)`
3. Verify the directory is created and database is updated
4. Confirm file operations now work

## Files Modified

- `desktop-app-vue/src/main/index.js` (3 locations)
  - Line 4861-4905: Streaming project creation fix
  - Line 4723-4746: Non-streaming project creation fix
  - Line 5132-5177: Repair utility
- `desktop-app-vue/src/preload/index.js` (1 location)
  - Line 464: Added `repairRootPath` API

## Related Issues

This fix addresses the issue where:
- Project file trees couldn't be displayed
- File operations failed with "no root path" errors
- Document projects appeared broken in the UI

## Prevention

The fix ensures that:
1. **All** document-type projects get a `root_path` at creation time
2. Empty projects (0 files) are handled correctly
3. The directory structure is created proactively
4. A repair utility exists for fixing legacy data

## Notes

- Only affects document-type projects (web/data projects may have different storage patterns)
- The fix is backward compatible - existing projects can be repaired
- No database migration required - repairs can be done on-demand
- The project directory is created even if empty, ensuring consistency
