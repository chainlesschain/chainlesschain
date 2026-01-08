/**
 * E2E测试 - 项目详情页文件管理面板
 *
 * 覆盖点：
 * 1. 文件管理Modal可以按文件类型筛选
 * 2. 文件卡片点击、预览、下载、删除操作流程
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, login } from './helpers';
import {
  createAndOpenProject,
  createTestFile,
  waitForProjectDetailLoad,
  refreshFileList,
  openFileManageModal,
  switchFileManageTab,
  getFileManageModalFileNames,
  clickFileCardInModal,
  triggerFileCardAction,
} from './project-detail-helpers';

const FILTER_PREFIX = 'FM-E2E-FILTER-';
const ACTION_PREFIX = 'FM-E2E-ACTION-';

test.describe('项目详情页 - 文件管理面板', () => {
  test('文件管理面板支持按类型筛选', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      const project = await createAndOpenProject(window, {
        name: '文件筛选测试',
        description: '验证文件管理Modal的筛选',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      const files = [
        { fileName: `${FILTER_PREFIX}plan.md`, content: '# 计划', fileType: 'markdown' },
        { fileName: `${FILTER_PREFIX}slides.pptx`, content: 'PPT内容', fileType: 'ppt' },
        { fileName: `${FILTER_PREFIX}dashboard.xlsx`, content: 'Excel内容', fileType: 'excel' },
        { fileName: `${FILTER_PREFIX}script.ts`, content: 'console.log("code");', fileType: 'code' },
        { fileName: `${FILTER_PREFIX}diagram.png`, content: 'fake image data', fileType: 'image' },
        { fileName: `${FILTER_PREFIX}preview.html`, content: '<h1>页面</h1>', fileType: 'web' },
      ];

      for (const file of files) {
        await createTestFile(window, project.id, file);
      }

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      const modalOpened = await openFileManageModal(window);
      expect(modalOpened).toBe(true);

      const allNames = await getFileManageModalFileNames(window, FILTER_PREFIX);
      const expectedNames = files.map(item => item.fileName).sort();
      expect([...allNames].sort()).toEqual(expectedNames);

      const tabExpectations = [
        { label: 'PPT', names: [`${FILTER_PREFIX}slides.pptx`] },
        { label: 'Excel', names: [`${FILTER_PREFIX}dashboard.xlsx`] },
        { label: '代码', names: [`${FILTER_PREFIX}script.ts`] },
        { label: '图片', names: [`${FILTER_PREFIX}diagram.png`] },
        { label: '文档', names: [`${FILTER_PREFIX}plan.md`] },
        { label: '网页', names: [`${FILTER_PREFIX}preview.html`] },
      ];

      for (const tab of tabExpectations) {
        const switched = await switchFileManageTab(window, tab.label);
        expect(switched).toBe(true);

        const names = await getFileManageModalFileNames(window, FILTER_PREFIX);
        expect(names).toEqual(tab.names);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('文件管理面板支持文件操作', async () => {
    const { app, window } = await launchElectronApp();

    try {
      await login(window);
      await window.waitForTimeout(1000);

      const project = await createAndOpenProject(window, {
        name: '文件操作测试',
        description: '验证文件管理Modal的操作功能',
        project_type: 'markdown',
      });

      await waitForProjectDetailLoad(window);

      const actionFiles = [
        { role: 'open', fileName: `${ACTION_PREFIX}open.md`, content: '# 打开测试', fileType: 'markdown' },
        { role: 'preview', fileName: `${ACTION_PREFIX}preview.docx`, content: '预览内容', fileType: 'doc' },
        { role: 'download', fileName: `${ACTION_PREFIX}download.txt`, content: '下载内容', fileType: 'doc' },
        { role: 'delete', fileName: `${ACTION_PREFIX}delete.ts`, content: 'const removed = true;', fileType: 'code' },
      ];

      for (const file of actionFiles) {
        await createTestFile(window, project.id, file);
      }

      await refreshFileList(window);
      await window.waitForTimeout(1000);

      // Step 1: 直接点击卡片打开文件
      expect(await openFileManageModal(window)).toBe(true);
      const openTarget = actionFiles.find(item => item.role === 'open');
      expect(openTarget).toBeTruthy();

      const clicked = await clickFileCardInModal(window, openTarget!.fileName);
      expect(clicked).toBe(true);

      await window.waitForTimeout(800);
      const modalAfterOpen = await window.$('.ant-modal:has-text("文件")');
      expect(modalAfterOpen).toBeNull();

      await window.waitForFunction((fileName) => {
        const breadcrumb = document.querySelector('[data-testid="toolbar-breadcrumb"]');
        return breadcrumb?.textContent?.includes(fileName);
      }, openTarget!.fileName);

      // 切换到编辑模式，后续验证预览操作会切换回预览
      const editRadio = await window.$('.ant-radio-button-wrapper:has-text("编辑")');
      if (editRadio) {
        await editRadio.click();
        await window.waitForTimeout(300);
      }

      // Step 2: 使用预览操作
      expect(await openFileManageModal(window)).toBe(true);
      const previewTarget = actionFiles.find(item => item.role === 'preview');
      expect(previewTarget).toBeTruthy();

      const previewed = await triggerFileCardAction(window, previewTarget!.fileName, '预览');
      expect(previewed).toBe(true);

      await window.waitForTimeout(600);
      const previewRadio = await window.$('.ant-radio-button-wrapper-checked:has-text("预览")');
      expect(previewRadio).toBeTruthy();

      await window.waitForFunction((fileName) => {
        const breadcrumb = document.querySelector('[data-testid="toolbar-breadcrumb"]');
        return breadcrumb?.textContent?.includes(fileName);
      }, previewTarget!.fileName);

      // Step 3: 下载操作 - mock saveAs，验证调用
      expect(await openFileManageModal(window)).toBe(true);
      await window.evaluate(() => {
        (window as any).__downloadCalls = [];
        const original = (window as any).electronAPI?.file?.saveAs;
        (window as any).__originalSaveAs = original;
        if ((window as any).electronAPI?.file) {
          (window as any).electronAPI.file.saveAs = async (filePath: string) => {
            (window as any).__downloadCalls.push(filePath);
            return { success: true, filePath: `/tmp/mock-download-${Date.now()}` };
          };
        }
      });

      const downloadTarget = actionFiles.find(item => item.role === 'download');
      expect(downloadTarget).toBeTruthy();

      const downloaded = await triggerFileCardAction(window, downloadTarget!.fileName, '下载');
      expect(downloaded).toBe(true);

      const downloadCalls = await window.evaluate(() => (window as any).__downloadCalls || []);
      expect(downloadCalls.some((path: string) => path?.includes(downloadTarget!.fileName))).toBe(true);

      await window.evaluate(() => {
        if ((window as any).__originalSaveAs) {
          (window as any).electronAPI.file.saveAs = (window as any).__originalSaveAs;
        }
      });

      // Step 4: 删除操作并确认
      expect(await openFileManageModal(window)).toBe(true);
      const deleteTarget = actionFiles.find(item => item.role === 'delete');
      expect(deleteTarget).toBeTruthy();

      const deleteMenuClicked = await triggerFileCardAction(window, deleteTarget!.fileName, '删除');
      expect(deleteMenuClicked).toBe(true);

      const confirmButton = await window.$('.ant-modal-confirm .ant-btn-primary:has-text("删除")');
      expect(confirmButton).toBeTruthy();
      await confirmButton?.click();

      await window.waitForTimeout(1000);
      const remainingNames = await getFileManageModalFileNames(window, ACTION_PREFIX);
      expect(remainingNames).not.toContain(deleteTarget!.fileName);
    } finally {
      await closeElectronApp(app);
    }
  });
});
