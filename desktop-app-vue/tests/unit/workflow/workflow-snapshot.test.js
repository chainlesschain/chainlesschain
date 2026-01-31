/**
 * 工作流快照系统测试
 *
 * @version 0.27.0
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WorkflowSnapshot,
  SnapshotManager,
  SnapshotType,
} from '../../../src/main/workflow/workflow-snapshot.js';
import fs from 'fs/promises';
import path from 'path';

describe('WorkflowSnapshot 快照类测试', () => {
  let snapshot;

  beforeEach(() => {
    snapshot = new WorkflowSnapshot('stage-1', '需求分析');
  });

  test('应该正确创建快照对象', () => {
    expect(snapshot.stageId).toBe('stage-1');
    expect(snapshot.stageName).toBe('需求分析');
    expect(snapshot.type).toBe(SnapshotType.FULL);
    expect(snapshot.timestamp).toBeGreaterThan(0);
  });

  test('应该能够捕获上下文快照', () => {
    const context = {
      projectId: 'proj-123',
      userId: 'user-456',
      settings: {
        theme: 'dark',
        language: 'zh-CN',
      },
    };

    const success = snapshot.captureContext(context);

    expect(success).toBe(true);
    expect(snapshot.contextSnapshot).toEqual(context);
    expect(snapshot.contextSnapshot).not.toBe(context); // 应该是深拷贝
  });

  test('应该能够恢复上下文快照', () => {
    const context = {
      projectId: 'proj-123',
      data: { count: 42 },
    };

    snapshot.captureContext(context);
    const restored = snapshot.restoreContext();

    expect(restored).toEqual(context);
    expect(restored).not.toBe(context); // 应该是深拷贝
  });

  test('上下文快照应该是深拷贝', () => {
    const context = {
      nested: { value: 'original' },
    };

    snapshot.captureContext(context);

    // 修改原始对象
    context.nested.value = 'modified';

    // 快照应该保持原值
    expect(snapshot.contextSnapshot.nested.value).toBe('original');
  });

  test('应该正确获取快照信息', () => {
    const context = { test: 'data' };
    snapshot.captureContext(context);

    const info = snapshot.getInfo();

    expect(info.id).toBe(snapshot.id);
    expect(info.stageId).toBe('stage-1');
    expect(info.stageName).toBe('需求分析');
    expect(info.hasContext).toBe(true);
    expect(info.hasFilesystem).toBe(false);
    expect(info.hasDatabase).toBe(false);
  });
});

describe('WorkflowSnapshot 文件系统快照测试', () => {
  let snapshot;
  let testDir;
  let backupDir;
  let testFiles;

  beforeEach(async () => {
    snapshot = new WorkflowSnapshot('stage-1', '需求分析');

    // 创建测试目录
    testDir = path.join(process.cwd(), 'tests', 'temp', 'snapshot-test-' + Date.now());
    backupDir = path.join(testDir, 'backups');

    await fs.mkdir(testDir, { recursive: true });

    // 创建测试文件
    testFiles = [
      path.join(testDir, 'file1.txt'),
      path.join(testDir, 'file2.txt'),
    ];

    await fs.writeFile(testFiles[0], 'Content 1', 'utf-8');
    await fs.writeFile(testFiles[1], 'Content 2', 'utf-8');
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略清理错误
    }
  });

  test('应该能够备份文件', async () => {
    const success = await snapshot.captureFilesystem(testFiles, backupDir);

    expect(success).toBe(true);
    expect(snapshot.filesystemSnapshot).toBeTruthy();
    expect(snapshot.filesystemSnapshot.files.length).toBe(2);
    expect(snapshot.fileCount).toBe(2);
    expect(snapshot.size).toBeGreaterThan(0);
  });

  test('备份的文件应该可以访问', async () => {
    await snapshot.captureFilesystem(testFiles, backupDir);

    for (const fileInfo of snapshot.filesystemSnapshot.files) {
      const exists = await fs.access(fileInfo.backupPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(fileInfo.backupPath, 'utf-8');
      expect(content).toBeTruthy();
    }
  });

  test('应该能够恢复文件', async () => {
    await snapshot.captureFilesystem(testFiles, backupDir);

    // 修改原始文件
    await fs.writeFile(testFiles[0], 'Modified content', 'utf-8');
    await fs.writeFile(testFiles[1], 'Modified content 2', 'utf-8');

    // 恢复文件
    const success = await snapshot.restoreFilesystem();

    expect(success).toBe(true);

    // 验证文件已恢复
    const content1 = await fs.readFile(testFiles[0], 'utf-8');
    const content2 = await fs.readFile(testFiles[1], 'utf-8');

    expect(content1).toBe('Content 1');
    expect(content2).toBe('Content 2');
  });

  test('应该能够清理快照', async () => {
    await snapshot.captureFilesystem(testFiles, backupDir);

    const backupPath = snapshot.filesystemSnapshot.backupDir;
    const existsBefore = await fs.access(backupPath).then(() => true).catch(() => false);
    expect(existsBefore).toBe(true);

    await snapshot.cleanup();

    const existsAfter = await fs.access(backupPath).then(() => true).catch(() => false);
    expect(existsAfter).toBe(false);
  });
});

describe('WorkflowSnapshot 数据库快照测试', () => {
  let snapshot;
  let mockDatabase;

  beforeEach(() => {
    snapshot = new WorkflowSnapshot('stage-1', '需求分析');

    // Mock 数据库
    const testData = {
      users: [
        { id: 1, name: 'Alice', age: 30 },
        { id: 2, name: 'Bob', age: 25 },
      ],
      projects: [
        { id: 1, name: 'Project A', status: 'active' },
        { id: 2, name: 'Project B', status: 'completed' },
      ],
    };

    mockDatabase = {
      db: {
        prepare: vi.fn((sql) => ({
          all: vi.fn(() => {
            if (sql.includes('users')) {
              return testData.users;
            }
            if (sql.includes('projects')) {
              return testData.projects;
            }
            return [];
          }),
          run: vi.fn(),
        })),
      },
    };
  });

  test('应该能够创建数据库快照', async () => {
    const tables = ['users', 'projects'];
    const success = await snapshot.captureDatabase(mockDatabase, tables);

    expect(success).toBe(true);
    expect(snapshot.databaseSnapshot).toBeTruthy();
    expect(snapshot.databaseSnapshot.tables.users).toBeTruthy();
    expect(snapshot.databaseSnapshot.tables.projects).toBeTruthy();
    expect(snapshot.databaseSnapshot.tables.users.rowCount).toBe(2);
    expect(snapshot.databaseSnapshot.tables.projects.rowCount).toBe(2);
  });

  test('应该能够恢复数据库状态', async () => {
    const tables = ['users', 'projects'];
    await snapshot.captureDatabase(mockDatabase, tables);

    const success = await snapshot.restoreDatabase(mockDatabase);

    expect(success).toBe(true);
    expect(mockDatabase.db.prepare).toHaveBeenCalled();
  });

  test('数据库未初始化时应该返回false', async () => {
    const success = await snapshot.captureDatabase(null, ['users']);

    expect(success).toBe(false);
  });
});

describe('SnapshotManager 快照管理器测试', () => {
  let snapshotManager;
  let testBackupDir;

  beforeEach(async () => {
    testBackupDir = path.join(process.cwd(), 'tests', 'temp', 'snapshots-' + Date.now());
    await fs.mkdir(testBackupDir, { recursive: true });

    snapshotManager = new SnapshotManager({
      backupDir: testBackupDir,
      maxSnapshots: 3,
    });
  });

  afterEach(async () => {
    await snapshotManager.cleanupAll();
    try {
      await fs.rm(testBackupDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略
    }
  });

  test('应该能够创建快照', async () => {
    const context = { projectId: 'proj-123' };

    const snapshot = await snapshotManager.createSnapshot('stage-1', '需求分析', {
      context,
    });

    expect(snapshot).toBeTruthy();
    expect(snapshot.stageId).toBe('stage-1');
    expect(snapshot.stageName).toBe('需求分析');
    expect(snapshot.contextSnapshot).toEqual(context);
  });

  test('应该能够恢复快照', async () => {
    const context = { data: 'test' };

    await snapshotManager.createSnapshot('stage-1', '需求分析', { context });

    const result = await snapshotManager.restoreSnapshot('stage-1');

    expect(result.success).toBe(true);
    expect(result.context).toEqual(context);
  });

  test('恢复不存在的快照应该失败', async () => {
    const result = await snapshotManager.restoreSnapshot('non-existent');

    expect(result.success).toBe(false);
    expect(result.error).toBe('快照不存在');
  });

  test('应该能够删除快照', async () => {
    await snapshotManager.createSnapshot('stage-1', '需求分析', {
      context: { test: 'data' },
    });

    const snapshotsBefore = snapshotManager.getAllSnapshots();
    expect(snapshotsBefore.length).toBe(1);

    await snapshotManager.deleteSnapshot('stage-1');

    const snapshotsAfter = snapshotManager.getAllSnapshots();
    expect(snapshotsAfter.length).toBe(0);
  });

  test('应该自动清理旧快照', async () => {
    // 创建4个快照（超过maxSnapshots=3）
    for (let i = 1; i <= 4; i++) {
      await snapshotManager.createSnapshot(`stage-${i}`, `阶段${i}`, {
        context: { index: i },
      });
      // 等待一小段时间确保时间戳不同
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const snapshots = snapshotManager.getAllSnapshots();

    // 应该只保留最新的3个
    expect(snapshots.length).toBe(3);

    // 最旧的stage-1应该被清理
    const hasStage1 = snapshots.some((s) => s.stageId === 'stage-1');
    expect(hasStage1).toBe(false);

    // stage-2, stage-3, stage-4 应该保留
    const hasStage4 = snapshots.some((s) => s.stageId === 'stage-4');
    expect(hasStage4).toBe(true);
  });

  test('应该能够获取所有快照信息', async () => {
    await snapshotManager.createSnapshot('stage-1', '阶段1', {
      context: { a: 1 },
    });
    await snapshotManager.createSnapshot('stage-2', '阶段2', {
      context: { b: 2 },
    });

    const snapshots = snapshotManager.getAllSnapshots();

    expect(snapshots.length).toBe(2);
    expect(snapshots[0].stageId).toBeTruthy();
    expect(snapshots[0].hasContext).toBe(true);
  });

  test('应该能够清理所有快照', async () => {
    await snapshotManager.createSnapshot('stage-1', '阶段1', {
      context: { a: 1 },
    });
    await snapshotManager.createSnapshot('stage-2', '阶段2', {
      context: { b: 2 },
    });

    expect(snapshotManager.getAllSnapshots().length).toBe(2);

    await snapshotManager.cleanupAll();

    expect(snapshotManager.getAllSnapshots().length).toBe(0);
  });
});

describe('快照和恢复完整流程测试', () => {
  let snapshotManager;
  let testDir;
  let testFile;

  beforeEach(async () => {
    testDir = path.join(process.cwd(), 'tests', 'temp', 'flow-test-' + Date.now());
    await fs.mkdir(testDir, { recursive: true });

    testFile = path.join(testDir, 'test.txt');
    await fs.writeFile(testFile, 'Original content', 'utf-8');

    snapshotManager = new SnapshotManager({
      backupDir: path.join(testDir, 'backups'),
    });
  });

  afterEach(async () => {
    await snapshotManager.cleanupAll();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // 忽略
    }
  });

  test('完整的快照和恢复流程', async () => {
    // 1. 创建快照（包含上下文和文件）
    const context = {
      projectId: 'proj-123',
      version: 1,
    };

    await snapshotManager.createSnapshot('stage-1', '需求分析', {
      context,
      filePaths: [testFile],
    });

    // 2. 模拟阶段执行（修改数据）
    context.version = 2;
    await fs.writeFile(testFile, 'Modified content', 'utf-8');

    // 3. 恢复快照
    const result = await snapshotManager.restoreSnapshot('stage-1');

    expect(result.success).toBe(true);
    expect(result.context.version).toBe(1);
    expect(result.filesystemRestored).toBe(true);

    // 4. 验证文件已恢复
    const content = await fs.readFile(testFile, 'utf-8');
    expect(content).toBe('Original content');
  });
});
