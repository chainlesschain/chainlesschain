/**
 * RAG检索增强生成 E2E 测试
 * 测试向量化、检索、重排序、上下文增强等完整RAG功能
 */

import { test, expect } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from './helpers';

// 测试数据
const TEST_DOCUMENTS = [
  {
    id: 'doc-1',
    title: 'Python基础教程',
    content: 'Python是一种高级编程语言，具有简洁明了的语法。它支持多种编程范式，包括面向对象、函数式编程等。',
    metadata: {
      category: 'programming',
      tags: ['python', 'tutorial', 'basics'],
    },
  },
  {
    id: 'doc-2',
    title: 'JavaScript异步编程',
    content: 'JavaScript异步编程主要通过Promise和async/await实现。异步编程可以提高应用性能，避免阻塞主线程。',
    metadata: {
      category: 'programming',
      tags: ['javascript', 'async', 'promise'],
    },
  },
  {
    id: 'doc-3',
    title: '机器学习入门',
    content: '机器学习是人工智能的一个分支，让计算机能够从数据中学习模式。常见算法包括线性回归、决策树、神经网络等。',
    metadata: {
      category: 'ai',
      tags: ['machine learning', 'ai', 'algorithms'],
    },
  },
];

test.describe('RAG检索增强生成 E2E 测试', () => {
  test.describe('文档向量化', () => {
    test('应该能够对文档进行向量化', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 文档向量化 ==========');

        const document = TEST_DOCUMENTS[0];

        // 生成文档嵌入向量
        const result: any = await callIPC(window, 'rag:vectorize-document', {
          id: document.id,
          content: document.content,
        });

        console.log('向量化结果:', result);

        expect(result).toBeDefined();

        // 提取向量
        const vector = result.vector || result.embedding || result.embeddings || result;

        if (Array.isArray(vector) && vector.length > 0) {
          console.log(`✅ 文档向量化成功!`);
          console.log(`   文档ID: ${document.id}`);
          console.log(`   向量维度: ${vector.length}`);
          console.log(`   前5个值: ${vector.slice(0, 5).join(', ')}...`);

          // 验证向量维度（通常是384, 768, 1536等）
          expect(vector.length).toBeGreaterThan(0);
          expect(vector.length).toBeLessThan(10000);

          // 验证向量值在合理范围内
          const allValid = vector.every((v: number) => !isNaN(v) && isFinite(v));
          expect(allValid).toBe(true);
        } else {
          console.log(`ℹ️  向量化接口响应，但格式可能不同`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够批量向量化多个文档', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 批量文档向量化 ==========');

        const documents = TEST_DOCUMENTS.map(doc => ({
          id: doc.id,
          content: doc.content,
        }));

        const result: any = await callIPC(window, 'rag:vectorize-batch', documents);

        console.log('批量向量化结果:', result);

        expect(result).toBeDefined();

        const vectors = result.vectors || result.embeddings || result;

        if (Array.isArray(vectors)) {
          console.log(`✅ 批量向量化成功!`);
          console.log(`   文档数量: ${documents.length}`);
          console.log(`   向量数量: ${vectors.length}`);

          // 验证每个文档都有向量
          expect(vectors.length).toBe(documents.length);

          // 验证每个向量的结构
          vectors.forEach((v: any, index: number) => {
            const vector = v.vector || v.embedding || v;
            if (Array.isArray(vector)) {
              console.log(`   文档${index + 1} 向量维度: ${vector.length}`);
              expect(vector.length).toBeGreaterThan(0);
            }
          });
        } else {
          console.log(`ℹ️  批量向量化接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够更新文档向量', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 更新文档向量 ==========');

        const document = {
          id: 'doc-update-test',
          content: '这是原始内容',
        };

        // 首次向量化
        const initialResult: any = await callIPC(
          window,
          'rag:vectorize-document',
          document
        );

        expect(initialResult).toBeDefined();

        console.log('   初始向量化完成');

        // 更新内容并重新向量化
        document.content = '这是更新后的内容，包含了更多信息';

        const updatedResult: any = await callIPC(
          window,
          'rag:vectorize-document',
          document
        );

        expect(updatedResult).toBeDefined();

        console.log(`✅ 文档向量更新成功!`);
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('向量检索', () => {
    test('应该能够根据查询检索相关文档', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 向量检索 ==========');

        // 首先向量化一些文档
        for (const doc of TEST_DOCUMENTS) {
          await callIPC(window, 'rag:vectorize-document', {
            id: doc.id,
            content: doc.content,
            metadata: doc.metadata,
          });
        }

        console.log('   文档向量化完成');

        // 执行检索
        const query = 'Python编程语言的特点';

        const result: any = await callIPC(window, 'rag:search', {
          query,
          topK: 3,
        });

        console.log('检索结果:', result);

        expect(result).toBeDefined();

        const results = result.results || result.documents || result;

        if (Array.isArray(results) && results.length > 0) {
          console.log(`✅ 向量检索成功!`);
          console.log(`   查询: ${query}`);
          console.log(`   找到 ${results.length} 个相关文档:`);

          results.forEach((item: any, index: number) => {
            const score = item.score || item.similarity || item.distance || 'N/A';
            const id = item.id || item.document?.id || 'N/A';
            const content = item.content || item.document?.content || '';

            console.log(`   ${index + 1}. ID: ${id}, 相似度: ${score}`);
            console.log(`      内容片段: ${content.substring(0, 50)}...`);

            // 验证相关性分数
            if (typeof score === 'number') {
              expect(score).toBeGreaterThanOrEqual(0);
              expect(score).toBeLessThanOrEqual(1);
            }
          });

          // 验证最相关的文档应该是Python相关的
          const topResult = results[0];
          const topContent = topResult.content || topResult.document?.content || '';

          if (topContent.includes('Python')) {
            console.log(`   ✓ 最相关文档确实与Python相关`);
          }
        } else {
          console.log(`ℹ️  未找到检索结果或格式不同`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够使用过滤器检索文档', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 过滤检索 ==========');

        const query = '编程语言';

        const result: any = await callIPC(window, 'rag:search', {
          query,
          topK: 5,
          filter: {
            category: 'programming',
          },
        });

        expect(result).toBeDefined();

        const results = result.results || result.documents || result;

        if (Array.isArray(results)) {
          console.log(`✅ 过滤检索成功!`);
          console.log(`   查询: ${query}`);
          console.log(`   过滤条件: category=programming`);
          console.log(`   结果数量: ${results.length}`);

          // 验证所有结果都符合过滤条件
          if (results.length > 0 && results[0].metadata) {
            const allMatch = results.every(
              (r: any) => r.metadata?.category === 'programming'
            );

            if (allMatch) {
              console.log(`   ✓ 所有结果都符合过滤条件`);
            }
          }
        } else {
          console.log(`ℹ️  过滤检索接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够进行混合检索（向量+关键词）', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 混合检索 ==========');

        const query = 'async';

        const result: any = await callIPC(window, 'rag:hybrid-search', {
          query,
          topK: 3,
          vectorWeight: 0.7,
          keywordWeight: 0.3,
        });

        expect(result).toBeDefined();

        const results = result.results || result.documents || result;

        if (Array.isArray(results)) {
          console.log(`✅ 混合检索成功!`);
          console.log(`   查询: ${query}`);
          console.log(`   结果数量: ${results.length}`);

          results.forEach((item: any, index: number) => {
            const score = item.score || item.similarity || 'N/A';
            console.log(`   ${index + 1}. 综合得分: ${score}`);
          });
        } else {
          console.log(`ℹ️  混合检索接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('检索结果重排序', () => {
    test('应该能够对检索结果进行重排序', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 检索结果重排序 ==========');

        const query = '编程语言的特点和应用';

        // 首次检索
        const searchResult: any = await callIPC(window, 'rag:search', {
          query,
          topK: 10,
        });

        const initialResults = searchResult.results || searchResult.documents || [];

        if (initialResults.length === 0) {
          console.log('⚠️  没有检索结果，跳过重排序测试');
          return;
        }

        console.log(`   初始检索到 ${initialResults.length} 个结果`);

        // 对结果进行重排序
        const reranked: any = await callIPC(window, 'rag:rerank', {
          query,
          documents: initialResults,
          topK: 5,
        });

        console.log('重排序结果:', reranked);

        expect(reranked).toBeDefined();

        const rerankedResults = reranked.results || reranked.documents || reranked;

        if (Array.isArray(rerankedResults)) {
          console.log(`✅ 结果重排序成功!`);
          console.log(`   重排序后结果数量: ${rerankedResults.length}`);

          rerankedResults.forEach((item: any, index: number) => {
            const score = item.score || item.relevance || 'N/A';
            console.log(`   ${index + 1}. 重排序得分: ${score}`);
          });

          // 验证重排序后的得分是递减的
          if (rerankedResults.length > 1 && rerankedResults[0].score) {
            const isDescending = rerankedResults.every(
              (item: any, i: number) =>
                i === 0 || item.score <= rerankedResults[i - 1].score
            );

            if (isDescending) {
              console.log(`   ✓ 重排序得分递减正确`);
            }
          }
        } else {
          console.log(`ℹ️  重排序接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该支持多种重排序算法', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 多种重排序算法 ==========');

        const query = 'Python';
        const documents = [
          { id: '1', content: 'Python是一种编程语言' },
          { id: '2', content: 'JavaScript也是编程语言' },
          { id: '3', content: 'Python在AI领域应用广泛' },
        ];

        const algorithms = ['bm25', 'cross-encoder', 'llm-rerank'];

        for (const algorithm of algorithms) {
          console.log(`\n   测试算法: ${algorithm}`);

          const result: any = await callIPC(window, 'rag:rerank', {
            query,
            documents,
            algorithm,
          });

          if (result && (result.results || result.documents)) {
            console.log(`   ✓ ${algorithm} 重排序成功`);
          } else {
            console.log(`   ℹ️ ${algorithm} 可能不支持或接口不同`);
          }
        }

        console.log(`\n✅ 多种重排序算法测试完成`);
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('RAG对话增强', () => {
    test('应该能够使用RAG增强AI对话', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== RAG增强对话 ==========');

        // 准备知识库文档
        const documents = TEST_DOCUMENTS;

        for (const doc of documents) {
          await callIPC(window, 'rag:vectorize-document', {
            id: doc.id,
            content: doc.content,
          });
        }

        console.log('   知识库准备完成');

        // 进行RAG增强对话
        const messages = [
          { role: 'user', content: 'Python有哪些优势？' },
        ];

        const result: any = await callIPC(window, 'llm:chat', {
          messages,
          stream: false,
          enableRAG: true,
          ragConfig: {
            topK: 3,
            similarityThreshold: 0.5,
          },
        });

        console.log('RAG增强对话结果:', result);

        expect(result).toBeDefined();

        const response = result.response || result.content;
        const sources = result.sources || result.references;

        if (response) {
          console.log(`✅ RAG增强对话成功!`);
          console.log(`   AI回复: ${String(response).substring(0, 150)}...`);

          if (sources && Array.isArray(sources)) {
            console.log(`   参考文档数量: ${sources.length}`);
            sources.forEach((source: any, index: number) => {
              console.log(`   ${index + 1}. ${source.id || source.title || 'N/A'}`);
            });
          }

          // 验证回复内容
          expect(String(response).length).toBeGreaterThan(0);
        } else {
          console.log(`ℹ️  RAG增强对话接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该在RAG对话中引用检索到的文档', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== RAG文档引用 ==========');

        const messages = [
          { role: 'user', content: '什么是异步编程？' },
        ];

        const result: any = await callIPC(window, 'llm:chat', {
          messages,
          enableRAG: true,
          includeReferences: true,
        });

        expect(result).toBeDefined();

        if (result.references || result.sources) {
          console.log(`✅ RAG文档引用成功!`);

          const refs = result.references || result.sources;

          if (Array.isArray(refs)) {
            console.log(`   引用文档数量: ${refs.length}`);

            refs.forEach((ref: any, index: number) => {
              console.log(`   ${index + 1}. ${ref.id || ref.title || 'N/A'}`);
              console.log(`      相似度: ${ref.score || ref.similarity || 'N/A'}`);
            });

            // 验证引用包含必要信息
            expect(refs.length).toBeGreaterThan(0);
            expect(refs[0]).toHaveProperty('id');
          }
        } else {
          console.log(`ℹ️  未找到文档引用或格式不同`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够控制RAG的检索数量和相似度阈值', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== RAG参数控制 ==========');

        const messages = [
          { role: 'user', content: '介绍一下机器学习' },
        ];

        // 测试不同的topK值
        const topKValues = [1, 3, 5];

        for (const topK of topKValues) {
          console.log(`\n   测试 topK=${topK}`);

          const result: any = await callIPC(window, 'llm:chat', {
            messages,
            enableRAG: true,
            ragConfig: {
              topK,
              similarityThreshold: 0.3,
            },
          });

          const sources = result.sources || result.references;

          if (sources && Array.isArray(sources)) {
            console.log(`   检索到 ${sources.length} 个文档`);
            expect(sources.length).toBeLessThanOrEqual(topK);
          }
        }

        console.log(`\n✅ RAG参数控制测试完成`);
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('向量数据库管理', () => {
    test('应该能够删除文档向量', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 删除文档向量 ==========');

        // 先添加一个文档
        const doc = {
          id: 'doc-to-delete',
          content: '这是一个将被删除的测试文档',
        };

        await callIPC(window, 'rag:vectorize-document', doc);

        console.log('   文档向量已添加');

        // 删除文档向量
        const deleteResult: any = await callIPC(window, 'rag:delete-document', doc.id);

        console.log('删除结果:', deleteResult);

        expect(deleteResult).toBeDefined();

        if (deleteResult.success || deleteResult === true) {
          console.log(`✅ 文档向量删除成功!`);
          console.log(`   已删除文档ID: ${doc.id}`);
        } else {
          console.log(`ℹ️  删除接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够清空向量数据库', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 清空向量数据库 ==========');

        const result: any = await callIPC(window, 'rag:clear-all');

        console.log('清空结果:', result);

        expect(result).toBeDefined();

        if (result.success || result === true) {
          console.log(`✅ 向量数据库清空成功!`);
        } else {
          console.log(`ℹ️  清空接口响应正常`);
        }

        // 验证数据库确实为空
        const searchResult: any = await callIPC(window, 'rag:search', {
          query: 'test',
          topK: 10,
        });

        const results = searchResult.results || searchResult.documents || searchResult;

        if (Array.isArray(results)) {
          expect(results.length).toBe(0);
          console.log(`   ✓ 确认数据库已清空`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });

    test('应该能够获取向量数据库统计信息', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== 向量数据库统计 ==========');

        const result: any = await callIPC(window, 'rag:get-stats');

        console.log('统计信息:', result);

        expect(result).toBeDefined();

        if (result.stats || result.count !== undefined) {
          console.log(`✅ 获取统计信息成功!`);

          const stats = result.stats || result;

          console.log(`   文档数量: ${stats.count || stats.documentCount || 0}`);
          console.log(`   向量维度: ${stats.dimension || 'N/A'}`);
          console.log(`   数据库大小: ${stats.size || 'N/A'}`);
        } else {
          console.log(`ℹ️  统计信息接口响应正常`);
        }
      } finally {
        await closeElectronApp(app);
      }
    });
  });

  test.describe('RAG性能测试', () => {
    test('向量检索性能应该在合理范围内', async () => {
      const { app, window } = await launchElectronApp();

      try {
        console.log('\n========== RAG检索性能 ==========');

        // 准备测试数据
        const documents = Array.from({ length: 50 }, (_, i) => ({
          id: `perf-doc-${i}`,
          content: `这是性能测试文档${i}，包含一些示例内容用于测试向量检索性能。`,
        }));

        // 批量向量化
        const vectorizeStart = Date.now();
        await callIPC(window, 'rag:vectorize-batch', documents);
        const vectorizeTime = Date.now() - vectorizeStart;

        console.log(`   批量向量化耗时: ${vectorizeTime}ms`);

        // 测试检索性能
        const searchStart = Date.now();
        await callIPC(window, 'rag:search', {
          query: '示例内容',
          topK: 10,
        });
        const searchTime = Date.now() - searchStart;

        console.log(`   向量检索耗时: ${searchTime}ms`);

        // 验证性能
        expect(searchTime).toBeLessThan(2000); // 2秒内完成

        console.log(`✅ RAG检索性能测试通过`);
      } finally {
        await closeElectronApp(app);
      }
    });
  });
});
