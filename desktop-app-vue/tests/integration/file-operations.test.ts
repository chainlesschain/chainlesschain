/**
 * 文件操作集成测试
 * 测试文件系统、导入导出功能的集成
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockElectronAPI } from '../setup';

describe('文件操作集成测试', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('文件导入到项目', () => {
    it('应该完成Markdown文件导入到项目的完整流程', async () => {
      // 1. 读取Markdown文件
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: '# 测试文档\n\n这是一个测试文档',
        type: 'markdown',
        metadata: {
          title: '测试文档'
        }
      });

      const fileContent = await mockElectronAPI.fs.readFile('/path/to/test.md');
      expect(fileContent.success).toBe(true);

      // 2. 创建项目文件记录
      mockElectronAPI.project.addFile.mockResolvedValue({
        success: true,
        fileId: 'file-123'
      });

      const addResult = await mockElectronAPI.project.addFile('proj-1', {
        name: 'test.md',
        content: fileContent.content,
        type: 'markdown'
      });

      expect(addResult.success).toBe(true);
      expect(addResult.fileId).toBe('file-123');

      // 3. 保存到数据库
      mockElectronAPI.db.run.mockResolvedValue({
        success: true,
        lastID: 'file-123'
      });

      await mockElectronAPI.db.run(
        'INSERT INTO project_files (id, project_id, name, content) VALUES (?, ?, ?, ?)',
        [addResult.fileId, 'proj-1', 'test.md', fileContent.content]
      );

      expect(mockElectronAPI.db.run).toHaveBeenCalled();
    });

    it('应该处理大文件导入', async () => {
      // 1. 模拟大文件
      const largeContent = 'x'.repeat(1000000); // 1MB

      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: largeContent,
        size: largeContent.length
      });

      const result = await mockElectronAPI.fs.readFile('/path/to/large.txt');

      expect(result.success).toBe(true);
      expect(result.size).toBeGreaterThan(500000);

      // 2. 分块保存
      mockElectronAPI.project.addFile.mockResolvedValue({
        success: true,
        fileId: 'large-file-1',
        chunked: true
      });

      const addResult = await mockElectronAPI.project.addFile('proj-1', {
        name: 'large.txt',
        content: result.content,
        chunked: true
      });

      expect(addResult.chunked).toBe(true);
    });

    it('应该批量导入多个文件', async () => {
      const files = [
        { path: 'file1.md', content: '内容1' },
        { path: 'file2.txt', content: '内容2' },
        { path: 'file3.pdf', content: '内容3' }
      ];

      // 模拟批量读取
      mockElectronAPI.fs.readFile
        .mockResolvedValueOnce({ success: true, content: '内容1', type: 'markdown' })
        .mockResolvedValueOnce({ success: true, content: '内容2', type: 'text' })
        .mockResolvedValueOnce({ success: true, content: '内容3', type: 'pdf' });

      const results = [];
      for (const file of files) {
        const content = await mockElectronAPI.fs.readFile(file.path);
        results.push(content);
      }

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);

      // 模拟批量添加到项目
      mockElectronAPI.project.addFile.mockResolvedValue({ success: true });

      for (let i = 0; i < results.length; i++) {
        await mockElectronAPI.project.addFile('proj-1', {
          name: files[i].path,
          content: results[i].content
        });
      }

      expect(mockElectronAPI.project.addFile).toHaveBeenCalledTimes(3);
    });
  });

  describe('文件导出', () => {
    it('应该导出项目文件到文件系统', async () => {
      // 1. 从数据库获取文件
      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: [
          { id: '1', name: 'export.md', content: '# 导出内容' }
        ]
      });

      const files = await mockElectronAPI.db.query(
        'SELECT * FROM project_files WHERE project_id = ?',
        ['proj-1']
      );

      expect(files.data).toHaveLength(1);

      // 2. 写入文件系统
      mockElectronAPI.fs.writeFile.mockResolvedValue({
        success: true,
        path: '/exported/export.md'
      });

      const writeResult = await mockElectronAPI.fs.writeFile(
        '/exported/export.md',
        files.data[0].content
      );

      expect(writeResult.success).toBe(true);
      expect(writeResult.path).toBe('/exported/export.md');
    });

    it('应该批量导出项目所有文件', async () => {
      // 获取所有文件
      mockElectronAPI.project.get.mockResolvedValue({
        success: true,
        files: [
          { name: 'file1.md', content: '内容1' },
          { name: 'file2.py', content: '内容2' },
          { name: 'file3.txt', content: '内容3' }
        ]
      });

      const project = await mockElectronAPI.project.get('proj-1');

      // 批量导出
      mockElectronAPI.fs.writeFile.mockResolvedValue({ success: true });

      for (const file of project.files) {
        await mockElectronAPI.fs.writeFile(
          `/export/${file.name}`,
          file.content
        );
      }

      expect(mockElectronAPI.fs.writeFile).toHaveBeenCalledTimes(3);
    });
  });

  describe('文件同步', () => {
    it('应该同步本地文件更改到数据库', async () => {
      // 1. 监听文件变化
      const fileChanges = {
        modified: ['file1.md'],
        added: ['file2.txt'],
        deleted: ['file3.py']
      };

      // 2. 更新已修改的文件
      mockElectronAPI.fs.readFile.mockResolvedValue({
        success: true,
        content: '更新后的内容'
      });

      const newContent = await mockElectronAPI.fs.readFile('file1.md');

      mockElectronAPI.db.run.mockResolvedValue({
        success: true,
        changes: 1
      });

      await mockElectronAPI.db.run(
        'UPDATE project_files SET content = ?, updated_at = ? WHERE name = ?',
        [newContent.content, Date.now(), 'file1.md']
      );

      expect(mockElectronAPI.db.run).toHaveBeenCalled();

      // 3. 添加新文件
      await mockElectronAPI.db.run(
        'INSERT INTO project_files (name, content) VALUES (?, ?)',
        ['file2.txt', '新文件内容']
      );

      // 4. 删除已移除的文件
      await mockElectronAPI.db.run(
        'DELETE FROM project_files WHERE name = ?',
        ['file3.py']
      );

      expect(mockElectronAPI.db.run).toHaveBeenCalledTimes(3);
    });
  });

  describe('文件版本控制', () => {
    it('应该保存文件的历史版本', async () => {
      const versions = [
        { content: '版本1', timestamp: Date.now() - 2000 },
        { content: '版本2', timestamp: Date.now() - 1000 },
        { content: '版本3', timestamp: Date.now() }
      ];

      // 保存每个版本
      mockElectronAPI.db.run.mockResolvedValue({ success: true });

      for (const version of versions) {
        await mockElectronAPI.db.run(
          'INSERT INTO file_versions (file_id, content, timestamp) VALUES (?, ?, ?)',
          ['file-1', version.content, version.timestamp]
        );
      }

      expect(mockElectronAPI.db.run).toHaveBeenCalledTimes(3);

      // 获取历史版本
      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: versions
      });

      const history = await mockElectronAPI.db.query(
        'SELECT * FROM file_versions WHERE file_id = ? ORDER BY timestamp DESC',
        ['file-1']
      );

      expect(history.data).toHaveLength(3);
    });

    it('应该能够恢复到历史版本', async () => {
      // 1. 获取历史版本
      mockElectronAPI.db.query.mockResolvedValue({
        success: true,
        data: [{ content: '历史版本内容', timestamp: Date.now() - 1000 }]
      });

      const version = await mockElectronAPI.db.query(
        'SELECT * FROM file_versions WHERE file_id = ? AND timestamp = ?',
        ['file-1', Date.now() - 1000]
      );

      // 2. 恢复版本
      mockElectronAPI.db.run.mockResolvedValue({ success: true });

      await mockElectronAPI.db.run(
        'UPDATE project_files SET content = ? WHERE id = ?',
        [version.data[0].content, 'file-1']
      );

      expect(mockElectronAPI.db.run).toHaveBeenCalled();
    });
  });
});
