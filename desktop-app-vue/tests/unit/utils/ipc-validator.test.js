/**
 * IPC 输入参数验证器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  z,
  uuidSchema,
  nonEmptyString,
  safePathSchema,
  paginationSchema,
  projectIdSchema,
  projectCreateSchema,
  projectUpdateSchema,
  projectListSchema,
  fileUpdateSchema,
  fileCreateSchema,
  sessionCreateSchema,
  messageSchema,
  gitBranchSchema,
  noteSchema,
  noteSearchSchema,
  withValidation,
  withMultiValidation,
  formatZodError
} from '../../../src/main/utils/ipc-validator.js';

describe('IPC Validator', () => {
  describe('基础 Schema', () => {
    describe('uuidSchema', () => {
      it('应该接受有效的 UUID', () => {
        const validUuid = '550e8400-e29b-41d4-a716-446655440000';
        expect(() => uuidSchema.parse(validUuid)).not.toThrow();
      });

      it('应该拒绝无效的 UUID', () => {
        expect(() => uuidSchema.parse('not-a-uuid')).toThrow();
        expect(() => uuidSchema.parse('123')).toThrow();
        expect(() => uuidSchema.parse('')).toThrow();
      });
    });

    describe('nonEmptyString', () => {
      it('应该接受非空字符串', () => {
        expect(() => nonEmptyString.parse('hello')).not.toThrow();
        expect(() => nonEmptyString.parse('a')).not.toThrow();
      });

      it('应该拒绝空字符串', () => {
        expect(() => nonEmptyString.parse('')).toThrow();
      });
    });

    describe('safePathSchema', () => {
      it('应该接受安全的相对路径', () => {
        expect(() => safePathSchema.parse('src/index.js')).not.toThrow();
        expect(() => safePathSchema.parse('README.md')).not.toThrow();
        expect(() => safePathSchema.parse('path/to/file.txt')).not.toThrow();
      });

      it('应该拒绝路径遍历', () => {
        expect(() => safePathSchema.parse('../secret.txt')).toThrow();
        expect(() => safePathSchema.parse('path/../other')).toThrow();
        expect(() => safePathSchema.parse('..\\secret.txt')).toThrow();
      });

      it('应该拒绝绝对路径', () => {
        expect(() => safePathSchema.parse('/etc/passwd')).toThrow();
        expect(() => safePathSchema.parse('C:\\Windows\\System32')).toThrow();
      });

      it('应该拒绝空路径', () => {
        expect(() => safePathSchema.parse('')).toThrow();
      });
    });

    describe('paginationSchema', () => {
      it('应该接受有效的分页参数', () => {
        const result = paginationSchema.parse({
          offset: 10,
          limit: 20,
          sortBy: 'createdAt',
          sortOrder: 'asc'
        });

        expect(result.offset).toBe(10);
        expect(result.limit).toBe(20);
        expect(result.sortBy).toBe('createdAt');
        expect(result.sortOrder).toBe('asc');
      });

      it('应该填充默认值', () => {
        const result = paginationSchema.parse({});

        expect(result.offset).toBe(0);
        expect(result.limit).toBe(50);
        expect(result.sortOrder).toBe('desc');
      });

      it('应该拒绝无效的 limit', () => {
        expect(() => paginationSchema.parse({ limit: 0 })).toThrow();
        expect(() => paginationSchema.parse({ limit: 1001 })).toThrow();
        expect(() => paginationSchema.parse({ limit: -1 })).toThrow();
      });

      it('应该拒绝负数 offset', () => {
        expect(() => paginationSchema.parse({ offset: -1 })).toThrow();
      });
    });
  });

  describe('项目相关 Schema', () => {
    describe('projectCreateSchema', () => {
      it('应该接受有效的项目创建参数', () => {
        const result = projectCreateSchema.parse({
          name: 'My Project',
          description: 'A test project',
          projectType: 'web'
        });

        expect(result.name).toBe('My Project');
        expect(result.description).toBe('A test project');
        expect(result.projectType).toBe('web');
      });

      it('应该填充默认的项目类型', () => {
        const result = projectCreateSchema.parse({ name: 'Project' });
        expect(result.projectType).toBe('web');
      });

      it('应该拒绝空项目名称', () => {
        expect(() => projectCreateSchema.parse({ name: '' })).toThrow();
      });

      it('应该拒绝过长的项目名称', () => {
        const longName = 'a'.repeat(101);
        expect(() => projectCreateSchema.parse({ name: longName })).toThrow();
      });

      it('应该拒绝无效的项目类型', () => {
        expect(() =>
          projectCreateSchema.parse({
            name: 'Project',
            projectType: 'invalid'
          })
        ).toThrow();
      });
    });

    describe('projectUpdateSchema', () => {
      it('应该接受部分更新', () => {
        const result = projectUpdateSchema.parse({
          name: 'New Name'
        });

        expect(result.name).toBe('New Name');
        expect(result.description).toBeUndefined();
      });

      it('应该接受空对象', () => {
        const result = projectUpdateSchema.parse({});
        expect(result).toEqual({});
      });
    });

    describe('projectListSchema', () => {
      it('应该接受完整的查询参数', () => {
        const result = projectListSchema.parse({
          offset: 0,
          limit: 10,
          userId: 'user-123',
          projectType: 'web',
          search: 'test'
        });

        expect(result.userId).toBe('user-123');
        expect(result.search).toBe('test');
      });
    });
  });

  describe('文件相关 Schema', () => {
    describe('fileCreateSchema', () => {
      it('应该接受有效的文件创建参数', () => {
        const result = fileCreateSchema.parse({
          path: 'src/index.js',
          content: 'console.log("hello")'
        });

        expect(result.path).toBe('src/index.js');
        expect(result.encoding).toBe('utf-8');
      });

      it('应该接受 base64 编码', () => {
        const result = fileCreateSchema.parse({
          path: 'image.png',
          content: 'base64data',
          encoding: 'base64'
        });

        expect(result.encoding).toBe('base64');
      });

      it('应该拒绝危险路径', () => {
        expect(() =>
          fileCreateSchema.parse({
            path: '../../../etc/passwd',
            content: 'hack'
          })
        ).toThrow();
      });
    });

    describe('fileUpdateSchema', () => {
      it('应该接受有效的更新参数', () => {
        const result = fileUpdateSchema.parse({
          content: 'new content',
          version: 5
        });

        expect(result.content).toBe('new content');
        expect(result.version).toBe(5);
      });

      it('应该填充默认编码', () => {
        const result = fileUpdateSchema.parse({ content: 'test' });
        expect(result.encoding).toBe('utf-8');
      });
    });
  });

  describe('会话相关 Schema', () => {
    describe('messageSchema', () => {
      it('应该接受有效的消息', () => {
        const result = messageSchema.parse({
          content: 'Hello, world!',
          role: 'user'
        });

        expect(result.content).toBe('Hello, world!');
        expect(result.role).toBe('user');
      });

      it('应该填充默认角色', () => {
        const result = messageSchema.parse({ content: 'test' });
        expect(result.role).toBe('user');
      });

      it('应该拒绝空消息', () => {
        expect(() => messageSchema.parse({ content: '' })).toThrow();
      });

      it('应该拒绝无效角色', () => {
        expect(() =>
          messageSchema.parse({ content: 'test', role: 'invalid' })
        ).toThrow();
      });
    });

    describe('sessionCreateSchema', () => {
      it('应该接受有效的会话创建参数', () => {
        const result = sessionCreateSchema.parse({
          title: 'Test Session',
          model: 'gpt-4',
          systemPrompt: 'You are a helpful assistant.'
        });

        expect(result.title).toBe('Test Session');
        expect(result.model).toBe('gpt-4');
      });

      it('应该接受空对象', () => {
        const result = sessionCreateSchema.parse({});
        expect(result).toEqual({});
      });
    });
  });

  describe('Git 相关 Schema', () => {
    describe('gitBranchSchema', () => {
      it('应该接受有效的分支名', () => {
        expect(() => gitBranchSchema.parse('main')).not.toThrow();
        expect(() => gitBranchSchema.parse('feature/new-feature')).not.toThrow();
        expect(() => gitBranchSchema.parse('release-1.0.0')).not.toThrow();
      });

      it('应该拒绝以 - 开头的分支名', () => {
        expect(() => gitBranchSchema.parse('-invalid')).toThrow();
      });

      it('应该拒绝以 .lock 结尾的分支名', () => {
        expect(() => gitBranchSchema.parse('branch.lock')).toThrow();
      });

      it('应该拒绝包含非法字符的分支名', () => {
        expect(() => gitBranchSchema.parse('branch name')).toThrow();
        expect(() => gitBranchSchema.parse('branch~1')).toThrow();
        expect(() => gitBranchSchema.parse('branch^2')).toThrow();
        expect(() => gitBranchSchema.parse('branch:ref')).toThrow();
      });

      it('应该拒绝包含 .. 的分支名', () => {
        expect(() => gitBranchSchema.parse('branch..name')).toThrow();
      });
    });
  });

  describe('知识库相关 Schema', () => {
    describe('noteSchema', () => {
      it('应该接受有效的笔记', () => {
        const result = noteSchema.parse({
          title: 'My Note',
          content: 'Note content here',
          tags: ['tag1', 'tag2']
        });

        expect(result.title).toBe('My Note');
        expect(result.tags).toEqual(['tag1', 'tag2']);
      });

      it('应该拒绝空标题', () => {
        expect(() =>
          noteSchema.parse({ title: '', content: 'content' })
        ).toThrow();
      });

      it('应该限制标签数量', () => {
        const tooManyTags = Array(21).fill('tag');
        expect(() =>
          noteSchema.parse({
            title: 'Note',
            content: 'content',
            tags: tooManyTags
          })
        ).toThrow();
      });
    });

    describe('noteSearchSchema', () => {
      it('应该接受有效的搜索参数', () => {
        const result = noteSearchSchema.parse({
          query: 'search term',
          limit: 10,
          useRAG: true
        });

        expect(result.query).toBe('search term');
        expect(result.limit).toBe(10);
        expect(result.useRAG).toBe(true);
      });

      it('应该填充默认值', () => {
        const result = noteSearchSchema.parse({ query: 'test' });

        expect(result.limit).toBe(20);
        expect(result.useRAG).toBe(true);
      });

      it('应该拒绝空查询', () => {
        expect(() => noteSearchSchema.parse({ query: '' })).toThrow();
      });
    });
  });

  describe('验证中间件', () => {
    describe('withValidation', () => {
      it('应该验证并传递有效参数', async () => {
        const handler = vi.fn().mockResolvedValue({ success: true });
        const schema = z.object({ name: z.string() });
        const wrapped = withValidation(schema)(handler);

        const result = await wrapped({}, { name: 'test' });

        expect(result).toEqual({ success: true });
        expect(handler).toHaveBeenCalledWith({}, { name: 'test' });
      });

      it('应该填充默认值', async () => {
        const handler = vi.fn().mockResolvedValue({ success: true });
        const schema = z.object({
          name: z.string(),
          count: z.number().default(10)
        });
        const wrapped = withValidation(schema)(handler);

        await wrapped({}, { name: 'test' });

        expect(handler).toHaveBeenCalledWith({}, { name: 'test', count: 10 });
      });

      it('应该对无效参数抛出 ValidationError', async () => {
        const handler = vi.fn();
        const schema = z.object({ name: z.string().min(1) });
        const wrapped = withValidation(schema, { enableLogging: false })(
          handler
        );

        await expect(wrapped({}, { name: '' })).rejects.toThrow();
        expect(handler).not.toHaveBeenCalled();
      });

      it('应该验证指定索引的参数', async () => {
        const handler = vi.fn().mockResolvedValue({ success: true });
        const schema = z.string().min(1);
        const wrapped = withValidation(schema, { argIndex: 1 })(handler);

        await wrapped({}, 'ignored', 'validated');

        expect(handler).toHaveBeenCalledWith({}, 'ignored', 'validated');
      });
    });

    describe('withMultiValidation', () => {
      it('应该验证多个参数', async () => {
        const handler = vi.fn().mockResolvedValue({ success: true });
        const schemas = {
          0: z.string().uuid(),
          1: z.object({ name: z.string() })
        };
        const wrapped = withMultiValidation(schemas)(handler);

        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        await wrapped({}, uuid, { name: 'test' });

        expect(handler).toHaveBeenCalledWith({}, uuid, { name: 'test' });
      });

      it('应该收集所有验证错误', async () => {
        const handler = vi.fn();
        const schemas = {
          0: z.string().uuid(),
          1: z.object({ name: z.string().min(1) })
        };
        const wrapped = withMultiValidation(schemas, { enableLogging: false })(
          handler
        );

        await expect(wrapped({}, 'invalid-uuid', { name: '' })).rejects.toThrow(
          /参数0.*参数1/
        );
        expect(handler).not.toHaveBeenCalled();
      });
    });

    describe('formatZodError', () => {
      it('应该格式化 Zod 错误', () => {
        const schema = z.object({
          name: z.string().min(1, '名称不能为空'),
          age: z.number().min(0, '年龄不能为负数')
        });

        try {
          schema.parse({ name: '', age: -1 });
        } catch (error) {
          const formatted = formatZodError(error);

          expect(formatted.errors).toContain('name: 名称不能为空');
          expect(formatted.errors).toContain('age: 年龄不能为负数');
          expect(formatted.message).toContain('名称不能为空');
          expect(formatted.message).toContain('年龄不能为负数');
        }
      });

      it('应该处理根级别错误', () => {
        const schema = z.string().min(1, '字符串不能为空');

        try {
          schema.parse('');
        } catch (error) {
          const formatted = formatZodError(error);

          expect(formatted.errors).toContain('字符串不能为空');
        }
      });
    });
  });
});
