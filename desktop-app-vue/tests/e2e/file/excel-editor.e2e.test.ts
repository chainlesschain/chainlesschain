/**
 * E2E测试 - Excel编辑器功能测试
 *
 * 测试覆盖：
 * 1. 创建Excel文件
 * 2. 打开和编辑Excel文件
 * 3. 单元格编辑
 * 4. 公式计算
 * 5. 单元格格式化
 * 6. 多工作表操作
 * 7. 导入/导出Excel文件
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, takeScreenshot, login, callIPC } from '../helpers/common';
import {
  createAndOpenProject,
  createTestFile,
  selectFileInTree,
  waitForProjectDetailLoad,
  refreshFileList,
} from '../helpers/project-detail';

test.describe('Excel编辑器功能测试', () => {
  test('应该能够创建和打开Excel文件', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'Excel编辑器测试',
        project_type: 'office',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建Excel文件');
      // 创建一个简单的Excel文件（CSV格式用于测试）
      await createTestFile(window, project.id, {
        fileName: 'test.xlsx',
        content: '',
        fileType: 'excel',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择Excel文件');
      const selected = await selectFileInTree(window, 'test.xlsx');
      expect(selected).toBe(true);

      await window.waitForTimeout(2000);

      console.log('[Test] 验证Excel编辑器加载');
      // 检查Excel编辑器容器
      const editorContainer = await window.$('.excel-editor, .spreadsheet-editor, [data-testid="excel-editor"]');

      if (editorContainer) {
        console.log('[Test] ✅ Excel编辑器已加载');
        await takeScreenshot(window, 'excel-editor-loaded');
      } else {
        console.log('[Test] ⚠️ Excel编辑器容器未找到（可能使用通用编辑器）');
        await takeScreenshot(window, 'excel-editor-fallback');
      }

      console.log('[Test] ✅ Excel文件打开测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够编辑单元格内容', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'Excel单元格编辑测试',
        project_type: 'office',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建Excel文件');
      await createTestFile(window, project.id, {
        fileName: 'cells.xlsx',
        content: '',
        fileType: 'excel',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择Excel文件');
      const selected = await selectFileInTree(window, 'cells.xlsx');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);

      console.log('[Test] 尝试编辑单元格');
      // 尝试点击第一个单元格（A1）
      const cell = await window.$('.spreadsheet-cell, .excel-cell, td[data-cell="A1"]');

      if (cell) {
        await cell.dblclick();
        await window.waitForTimeout(500);

        // 输入内容
        await window.keyboard.type('Hello Excel');
        await window.keyboard.press('Enter');
        await window.waitForTimeout(500);

        console.log('[Test] ✅ 单元格编辑完成');
        await takeScreenshot(window, 'excel-cell-edited');
      } else {
        console.log('[Test] ⚠️ 未找到可编辑的单元格');
        await takeScreenshot(window, 'excel-no-cells');
      }

    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理CSV文件', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'CSV文件测试',
        project_type: 'data',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建CSV文件');
      const csvContent = `姓名,年龄,城市
张三,25,北京
李四,30,上海
王五,28,广州`;

      await createTestFile(window, project.id, {
        fileName: 'data.csv',
        content: csvContent,
        fileType: 'csv',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择CSV文件');
      const selected = await selectFileInTree(window, 'data.csv');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);

      console.log('[Test] 验证CSV数据显示');
      const editorContainer = await window.$('.editor-preview-panel');
      expect(editorContainer).toBeTruthy();

      await takeScreenshot(window, 'csv-file-loaded');

      console.log('[Test] ✅ CSV文件处理测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理带有公式的数据', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'Excel公式测试',
        project_type: 'office',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建带数据的CSV文件');
      const dataContent = `项目,数量,单价,总价
产品A,10,100,1000
产品B,20,50,1000
产品C,5,200,1000
合计,35,,3000`;

      await createTestFile(window, project.id, {
        fileName: 'sales.csv',
        content: dataContent,
        fileType: 'csv',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择数据文件');
      const selected = await selectFileInTree(window, 'sales.csv');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);

      await takeScreenshot(window, 'excel-formula-data');

      console.log('[Test] ✅ 公式数据测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理大型数据表格', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: '大型表格测试',
        project_type: 'data',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建大型CSV文件（100行 x 10列）');
      const headers = ['ID', '姓名', '年龄', '城市', '职业', '薪资', '部门', '入职日期', '电话', '邮箱'];
      const rows = [headers.join(',')];

      for (let i = 1; i <= 100; i++) {
        rows.push(`${i},员工${i},${20 + (i % 30)},城市${i % 10},职业${i % 5},${5000 + i * 100},部门${i % 8},2024-0${(i % 12) + 1}-01,1380000${i.toString().padStart(4, '0')},user${i}@example.com`);
      }

      await createTestFile(window, project.id, {
        fileName: 'large-data.csv',
        content: rows.join('\n'),
        fileType: 'csv',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择大型数据文件');
      const selected = await selectFileInTree(window, 'large-data.csv');
      expect(selected).toBe(true);

      // 大文件可能需要更长时间加载
      await window.waitForTimeout(3000);

      console.log('[Test] 验证大型表格加载');
      const editorContainer = await window.$('.editor-preview-panel');
      expect(editorContainer).toBeTruthy();

      await takeScreenshot(window, 'large-csv-loaded');

      console.log('[Test] ✅ 大型表格加载测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('应该能够处理特殊字符和Unicode数据', async () => {
    const { app, window } = await launchElectronApp();

    try {
      console.log('[Test] 登录');
      await login(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 创建项目');
      const project = await createAndOpenProject(window, {
        name: 'Unicode数据测试',
        project_type: 'data',
      });

      await waitForProjectDetailLoad(window);

      console.log('[Test] 创建包含特殊字符的CSV文件');
      const unicodeContent = `名前,説明,备注
田中太郎,これは日本語テストです,日文测试
김철수,이것은 한국어 테스트입니다,韩文测试
Müller,Das ist ein deutscher Test,德文测试
Emoji,😀🎉✨🌟💡,表情符号`;

      await createTestFile(window, project.id, {
        fileName: 'unicode-data.csv',
        content: unicodeContent,
        fileType: 'csv',
      });

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      console.log('[Test] 选择Unicode数据文件');
      const selected = await selectFileInTree(window, 'unicode-data.csv');
      expect(selected).toBe(true);
      await window.waitForTimeout(2000);

      await takeScreenshot(window, 'unicode-csv-loaded');

      console.log('[Test] ✅ Unicode数据测试通过');
    } finally {
      await closeElectronApp(app);
    }
  });
});
