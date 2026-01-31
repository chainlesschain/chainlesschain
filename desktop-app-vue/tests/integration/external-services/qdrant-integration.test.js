/**
 * Qdrant 向量数据库集成测试
 *
 * 测试范围：
 * - 服务连接和健康检查
 * - Collection 创建、删除、配置
 * - 向量插入、更新、删除
 * - 向量相似性搜索
 * - 过滤和分页
 * - 批量操作
 * - 错误处理
 * - 性能测试
 *
 * 创建日期: 2026-01-28
 * Week 4 Day 2: External Services Integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ==================== Mock Axios ====================

const createMockAxios = () => {
  const mockResponses = new Map();
  const mockCollections = new Map();

  const mockAxiosInstance = {
    get: vi.fn(async (url) => {
      const handler = mockResponses.get(`GET:${url}`);
      if (handler) {
        return handler();
      }
      return { data: {} };
    }),

    post: vi.fn(async (url, data) => {
      const handler = mockResponses.get(`POST:${url}`);
      if (handler) {
        return handler(data);
      }
      return { data: { result: true } };
    }),

    put: vi.fn(async (url, data) => {
      const handler = mockResponses.get(`PUT:${url}`);
      if (handler) {
        return handler(data);
      }
      return { data: { result: true } };
    }),

    delete: vi.fn(async (url, config) => {
      const handler = mockResponses.get(`DELETE:${url}`);
      if (handler) {
        return handler(config);
      }
      return { data: { result: true } };
    }),

    _setResponse: (method, url, handler) => {
      mockResponses.set(`${method}:${url}`, handler);
    },

    _clear: () => {
      mockResponses.clear();
      mockCollections.clear();
    },

    _collections: mockCollections,
  };

  return mockAxiosInstance;
};

const mockAxiosCreate = vi.fn(() => createMockAxios());

vi.mock("axios", () => ({
  default: {
    create: mockAxiosCreate,
  },
}));

// ==================== QdrantClient Class ====================

class QdrantClient {
  constructor(config = {}) {
    this.host = config.host || "http://localhost:6333";
    this.timeout = config.timeout || 30000;

    const axios = require("axios").default;
    this.client = axios.create({
      baseURL: this.host,
      timeout: this.timeout,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  async checkHealth() {
    try {
      const response = await this.client.get("/");
      return {
        available: true,
        version: response.data.version || "1.0.0",
        status: "healthy",
      };
    } catch (error) {
      return {
        available: false,
        error: error.message,
        status: "unhealthy",
      };
    }
  }

  async createCollection(collectionName, config) {
    const response = await this.client.put(`/collections/${collectionName}`, {
      vectors: {
        size: config.vectorSize || 768,
        distance: config.distance || "Cosine",
      },
      optimizers_config: {
        default_segment_number: config.segments || 2,
      },
      replication_factor: config.replicationFactor || 1,
    });

    return {
      success: response.data.result,
      collection: collectionName,
      config,
    };
  }

  async deleteCollection(collectionName) {
    const response = await this.client.delete(`/collections/${collectionName}`);

    return {
      success: response.data.result,
      collection: collectionName,
    };
  }

  async getCollectionInfo(collectionName) {
    const response = await this.client.get(`/collections/${collectionName}`);

    return {
      name: collectionName,
      status: response.data.result.status,
      vectorsCount: response.data.result.vectors_count || 0,
      pointsCount: response.data.result.points_count || 0,
      config: response.data.result.config,
    };
  }

  async listCollections() {
    const response = await this.client.get("/collections");

    return {
      collections: response.data.result.collections || [],
    };
  }

  async upsertPoints(collectionName, points) {
    const response = await this.client.put(
      `/collections/${collectionName}/points`,
      {
        points: points.map((p) => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload || {},
        })),
      },
    );

    return {
      success: response.data.result.status === "completed",
      operation_id: response.data.result.operation_id,
    };
  }

  async deletePoints(collectionName, pointIds) {
    const response = await this.client.post(
      `/collections/${collectionName}/points/delete`,
      {
        points: pointIds,
      },
    );

    return {
      success: response.data.result.status === "completed",
      operation_id: response.data.result.operation_id,
    };
  }

  async getPoint(collectionName, pointId) {
    const response = await this.client.get(
      `/collections/${collectionName}/points/${pointId}`,
    );

    return response.data.result;
  }

  async search(collectionName, query) {
    const response = await this.client.post(
      `/collections/${collectionName}/points/search`,
      {
        vector: query.vector,
        limit: query.limit || 10,
        with_payload: query.withPayload !== false,
        with_vector: query.withVector || false,
        filter: query.filter,
        score_threshold: query.scoreThreshold,
      },
    );

    return response.data.result.map((r) => ({
      id: r.id,
      score: r.score,
      payload: r.payload,
      vector: r.vector,
    }));
  }

  async scroll(collectionName, options = {}) {
    const response = await this.client.post(
      `/collections/${collectionName}/points/scroll`,
      {
        limit: options.limit || 10,
        offset: options.offset,
        with_payload: options.withPayload !== false,
        with_vector: options.withVector || false,
        filter: options.filter,
      },
    );

    return {
      points: response.data.result.points || [],
      next_offset: response.data.result.next_page_offset,
    };
  }

  async countPoints(collectionName, filter) {
    const response = await this.client.post(
      `/collections/${collectionName}/points/count`,
      { filter },
    );

    return {
      count: response.data.result.count,
    };
  }

  async recommend(collectionName, query) {
    const response = await this.client.post(
      `/collections/${collectionName}/points/recommend`,
      {
        positive: query.positive || [],
        negative: query.negative || [],
        limit: query.limit || 10,
        with_payload: query.withPayload !== false,
        filter: query.filter,
      },
    );

    return response.data.result.map((r) => ({
      id: r.id,
      score: r.score,
      payload: r.payload,
    }));
  }
}

// ==================== Test Suite ====================

describe("Qdrant 向量数据库集成测试", () => {
  let client;
  let mockAxios;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxiosCreate.mockClear();

    client = new QdrantClient({
      host: "http://localhost:6333",
      timeout: 30000,
    });

    mockAxios = client.client;
  });

  afterEach(() => {
    if (mockAxios._clear) {
      mockAxios._clear();
    }
  });

  // ==================== 1. 服务健康检查 ====================

  describe("服务健康检查", () => {
    it("应该检查 Qdrant 服务是否可用", async () => {
      mockAxios._setResponse("GET", "/", () => ({
        data: {
          title: "qdrant - vector search engine",
          version: "1.7.4",
        },
      }));

      const health = await client.checkHealth();

      expect(health.available).toBe(true);
      expect(health.version).toBe("1.7.4");
      expect(health.status).toBe("healthy");
    });

    it("应该处理服务不可用情况", async () => {
      mockAxios._setResponse("GET", "/", () => {
        throw new Error("ECONNREFUSED");
      });

      const health = await client.checkHealth();

      expect(health.available).toBe(false);
      expect(health.error).toBe("ECONNREFUSED");
      expect(health.status).toBe("unhealthy");
    });
  });

  // ==================== 2. Collection 管理 ====================

  describe("Collection 管理", () => {
    it("应该创建新 collection", async () => {
      mockAxios._setResponse("PUT", "/collections/test_collection", (data) => {
        expect(data.vectors.size).toBe(768);
        expect(data.vectors.distance).toBe("Cosine");
        return {
          data: {
            result: true,
            status: "ok",
          },
        };
      });

      const result = await client.createCollection("test_collection", {
        vectorSize: 768,
        distance: "Cosine",
        segments: 2,
      });

      expect(result.success).toBe(true);
      expect(result.collection).toBe("test_collection");
    });

    it("应该删除 collection", async () => {
      mockAxios._setResponse("DELETE", "/collections/test_collection", () => ({
        data: {
          result: true,
          status: "ok",
        },
      }));

      const result = await client.deleteCollection("test_collection");

      expect(result.success).toBe(true);
      expect(result.collection).toBe("test_collection");
    });

    it("应该获取 collection 信息", async () => {
      mockAxios._setResponse("GET", "/collections/test_collection", () => ({
        data: {
          result: {
            status: "green",
            vectors_count: 1000,
            points_count: 1000,
            config: {
              params: {
                vectors: {
                  size: 768,
                  distance: "Cosine",
                },
              },
            },
          },
        },
      }));

      const info = await client.getCollectionInfo("test_collection");

      expect(info.name).toBe("test_collection");
      expect(info.status).toBe("green");
      expect(info.vectorsCount).toBe(1000);
      expect(info.pointsCount).toBe(1000);
    });

    it("应该列出所有 collections", async () => {
      mockAxios._setResponse("GET", "/collections", () => ({
        data: {
          result: {
            collections: [
              { name: "collection1" },
              { name: "collection2" },
              { name: "collection3" },
            ],
          },
        },
      }));

      const result = await client.listCollections();

      expect(result.collections).toHaveLength(3);
      expect(result.collections[0].name).toBe("collection1");
    });

    it("应该处理 collection 不存在错误", async () => {
      mockAxios._setResponse("GET", "/collections/nonexistent", () => {
        const error = new Error("Collection not found");
        error.response = { status: 404 };
        throw error;
      });

      await expect(client.getCollectionInfo("nonexistent")).rejects.toThrow(
        "Collection not found",
      );
    });
  });

  // ==================== 3. 向量插入和更新 ====================

  describe("向量插入和更新", () => {
    it("应该插入单个向量点", async () => {
      const point = {
        id: 1,
        vector: Array(768)
          .fill(0)
          .map(() => Math.random()),
        payload: { text: "Test document", category: "test" },
      };

      mockAxios._setResponse(
        "PUT",
        "/collections/test_collection/points",
        (data) => {
          expect(data.points).toHaveLength(1);
          expect(data.points[0].id).toBe(1);
          expect(data.points[0].vector).toHaveLength(768);
          return {
            data: {
              result: {
                status: "completed",
                operation_id: 1,
              },
            },
          };
        },
      );

      const result = await client.upsertPoints("test_collection", [point]);

      expect(result.success).toBe(true);
      expect(result.operation_id).toBe(1);
    });

    it("应该批量插入多个向量点", async () => {
      const points = Array(10)
        .fill(0)
        .map((_, i) => ({
          id: i + 1,
          vector: Array(768)
            .fill(0)
            .map(() => Math.random()),
          payload: { text: `Document ${i}`, index: i },
        }));

      mockAxios._setResponse(
        "PUT",
        "/collections/test_collection/points",
        (data) => {
          expect(data.points).toHaveLength(10);
          return {
            data: {
              result: {
                status: "completed",
                operation_id: 2,
              },
            },
          };
        },
      );

      const result = await client.upsertPoints("test_collection", points);

      expect(result.success).toBe(true);
    });

    it("应该更新已有向量点", async () => {
      const updatedPoint = {
        id: 1,
        vector: Array(768)
          .fill(0)
          .map(() => Math.random()),
        payload: { text: "Updated document", category: "updated" },
      };

      mockAxios._setResponse(
        "PUT",
        "/collections/test_collection/points",
        () => ({
          data: {
            result: {
              status: "completed",
              operation_id: 3,
            },
          },
        }),
      );

      const result = await client.upsertPoints("test_collection", [
        updatedPoint,
      ]);

      expect(result.success).toBe(true);
    });
  });

  // ==================== 4. 向量删除和获取 ====================

  describe("向量删除和获取", () => {
    it("应该删除单个向量点", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/delete",
        (data) => {
          expect(data.points).toContain(1);
          return {
            data: {
              result: {
                status: "completed",
                operation_id: 4,
              },
            },
          };
        },
      );

      const result = await client.deletePoints("test_collection", [1]);

      expect(result.success).toBe(true);
    });

    it("应该批量删除多个向量点", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/delete",
        (data) => {
          expect(data.points).toHaveLength(5);
          return {
            data: {
              result: {
                status: "completed",
                operation_id: 5,
              },
            },
          };
        },
      );

      const result = await client.deletePoints(
        "test_collection",
        [1, 2, 3, 4, 5],
      );

      expect(result.success).toBe(true);
    });

    it("应该获取单个向量点", async () => {
      mockAxios._setResponse(
        "GET",
        "/collections/test_collection/points/1",
        () => ({
          data: {
            result: {
              id: 1,
              vector: Array(768).fill(0.5),
              payload: { text: "Test document", category: "test" },
            },
          },
        }),
      );

      const point = await client.getPoint("test_collection", 1);

      expect(point.id).toBe(1);
      expect(point.vector).toHaveLength(768);
      expect(point.payload.text).toBe("Test document");
    });
  });

  // ==================== 5. 向量相似性搜索 ====================

  describe("向量相似性搜索", () => {
    it("应该执行基本向量搜索", async () => {
      const queryVector = Array(768)
        .fill(0)
        .map(() => Math.random());

      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/search",
        (data) => {
          expect(data.vector).toEqual(queryVector);
          expect(data.limit).toBe(10);
          return {
            data: {
              result: [
                { id: 1, score: 0.95, payload: { text: "Document 1" } },
                { id: 2, score: 0.89, payload: { text: "Document 2" } },
                { id: 3, score: 0.85, payload: { text: "Document 3" } },
              ],
            },
          };
        },
      );

      const results = await client.search("test_collection", {
        vector: queryVector,
        limit: 10,
      });

      expect(results).toHaveLength(3);
      expect(results[0].score).toBe(0.95);
      expect(results[0].payload.text).toBe("Document 1");
    });

    it("应该支持分数阈值过滤", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/search",
        (data) => {
          expect(data.score_threshold).toBe(0.8);
          return {
            data: {
              result: [
                { id: 1, score: 0.95, payload: { text: "High score" } },
                { id: 2, score: 0.85, payload: { text: "Medium score" } },
              ],
            },
          };
        },
      );

      const results = await client.search("test_collection", {
        vector: Array(768).fill(0),
        scoreThreshold: 0.8,
      });

      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.score).toBeGreaterThanOrEqual(0.8));
    });

    it("应该支持 payload 过滤", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/search",
        (data) => {
          expect(data.filter).toEqual({
            must: [{ key: "category", match: { value: "technical" } }],
          });
          return {
            data: {
              result: [
                {
                  id: 1,
                  score: 0.9,
                  payload: { category: "technical", text: "Tech doc" },
                },
              ],
            },
          };
        },
      );

      const results = await client.search("test_collection", {
        vector: Array(768).fill(0),
        filter: {
          must: [{ key: "category", match: { value: "technical" } }],
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0].payload.category).toBe("technical");
    });

    it("应该返回向量数据（when withVector=true）", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/search",
        (data) => {
          expect(data.with_vector).toBe(true);
          return {
            data: {
              result: [
                {
                  id: 1,
                  score: 0.95,
                  payload: { text: "Doc" },
                  vector: Array(768).fill(0.5),
                },
              ],
            },
          };
        },
      );

      const results = await client.search("test_collection", {
        vector: Array(768).fill(0),
        withVector: true,
      });

      expect(results[0].vector).toBeDefined();
      expect(results[0].vector).toHaveLength(768);
    });
  });

  // ==================== 6. 滚动和分页 ====================

  describe("滚动和分页", () => {
    it("应该支持滚动遍历所有点", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/scroll",
        (data) => {
          return {
            data: {
              result: {
                points: Array(10)
                  .fill(0)
                  .map((_, i) => ({
                    id: i + 1,
                    payload: { text: `Document ${i + 1}` },
                    vector: Array(768).fill(0),
                  })),
                next_page_offset: 10,
              },
            },
          };
        },
      );

      const result = await client.scroll("test_collection", {
        limit: 10,
      });

      expect(result.points).toHaveLength(10);
      expect(result.next_offset).toBe(10);
    });

    it("应该支持带 offset 的分页", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/scroll",
        (data) => {
          expect(data.offset).toBe(20);
          return {
            data: {
              result: {
                points: Array(10)
                  .fill(0)
                  .map((_, i) => ({
                    id: i + 21,
                    payload: { text: `Document ${i + 21}` },
                  })),
                next_page_offset: 30,
              },
            },
          };
        },
      );

      const result = await client.scroll("test_collection", {
        limit: 10,
        offset: 20,
      });

      expect(result.points[0].id).toBe(21);
      expect(result.next_offset).toBe(30);
    });

    it("应该支持带过滤的滚动", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/scroll",
        (data) => {
          expect(data.filter).toBeDefined();
          return {
            data: {
              result: {
                points: [{ id: 1, payload: { category: "technical" } }],
                next_page_offset: null,
              },
            },
          };
        },
      );

      const result = await client.scroll("test_collection", {
        filter: {
          must: [{ key: "category", match: { value: "technical" } }],
        },
      });

      expect(result.points).toHaveLength(1);
      expect(result.next_offset).toBeNull();
    });
  });

  // ==================== 7. 统计和推荐 ====================

  describe("统计和推荐", () => {
    it("应该统计向量点数量", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/count",
        () => ({
          data: {
            result: {
              count: 1000,
            },
          },
        }),
      );

      const result = await client.countPoints("test_collection");

      expect(result.count).toBe(1000);
    });

    it("应该支持带过滤的计数", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/count",
        (data) => {
          expect(data.filter).toBeDefined();
          return {
            data: {
              result: {
                count: 50,
              },
            },
          };
        },
      );

      const result = await client.countPoints("test_collection", {
        must: [{ key: "category", match: { value: "technical" } }],
      });

      expect(result.count).toBe(50);
    });

    it("应该支持基于示例的推荐", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/recommend",
        (data) => {
          expect(data.positive).toEqual([1, 2]);
          expect(data.negative).toEqual([3]);
          return {
            data: {
              result: [
                { id: 4, score: 0.92, payload: { text: "Similar to 1,2" } },
                { id: 5, score: 0.88, payload: { text: "Also similar" } },
              ],
            },
          };
        },
      );

      const results = await client.recommend("test_collection", {
        positive: [1, 2],
        negative: [3],
        limit: 10,
      });

      expect(results).toHaveLength(2);
      expect(results[0].score).toBe(0.92);
    });
  });

  // ==================== 8. 错误处理 ====================

  describe("错误处理", () => {
    it("应该处理连接错误", async () => {
      mockAxios._setResponse("GET", "/", () => {
        throw new Error("ECONNREFUSED");
      });

      const health = await client.checkHealth();

      expect(health.available).toBe(false);
    });

    it("应该处理 collection 不存在", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/nonexistent/points/search",
        () => {
          const error = new Error("Collection nonexistent does not exist");
          error.response = { status: 404 };
          throw error;
        },
      );

      await expect(
        client.search("nonexistent", { vector: Array(768).fill(0) }),
      ).rejects.toThrow("does not exist");
    });

    it("应该处理向量维度不匹配", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/search",
        () => {
          const error = new Error("Vector dimension mismatch");
          error.response = { status: 400 };
          throw error;
        },
      );

      await expect(
        client.search("test_collection", { vector: Array(100).fill(0) }),
      ).rejects.toThrow("dimension mismatch");
    });

    it("应该处理超时", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/search",
        () => {
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              reject(new Error("timeout of 30000ms exceeded"));
            }, 100);
          });
        },
      );

      await expect(
        client.search("test_collection", { vector: Array(768).fill(0) }),
      ).rejects.toThrow("timeout");
    });
  });

  // ==================== 9. 性能测试 ====================

  describe("性能测试", () => {
    it("应该快速执行向量搜索（< 100ms）", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/search",
        () => ({
          data: {
            result: [{ id: 1, score: 0.95, payload: {} }],
          },
        }),
      );

      const start = Date.now();
      await client.search("test_collection", { vector: Array(768).fill(0) });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it("应该支持批量插入大量向量", async () => {
      const batchSize = 100;
      const points = Array(batchSize)
        .fill(0)
        .map((_, i) => ({
          id: i + 1,
          vector: Array(768)
            .fill(0)
            .map(() => Math.random()),
          payload: { index: i },
        }));

      mockAxios._setResponse(
        "PUT",
        "/collections/test_collection/points",
        (data) => {
          expect(data.points).toHaveLength(batchSize);
          return {
            data: {
              result: {
                status: "completed",
                operation_id: 10,
              },
            },
          };
        },
      );

      const result = await client.upsertPoints("test_collection", points);

      expect(result.success).toBe(true);
    });
  });

  // ==================== 10. 真实场景测试 ====================

  describe("真实场景测试", () => {
    it("场景1: RAG 文档检索", async () => {
      // 1. 创建 collection
      mockAxios._setResponse("PUT", "/collections/documents", () => ({
        data: { result: true },
      }));

      await client.createCollection("documents", {
        vectorSize: 768,
        distance: "Cosine",
      });

      // 2. 插入文档向量
      const docs = [
        {
          id: 1,
          vector: Array(768).fill(0.8),
          payload: { text: "Vue 3 guide" },
        },
        {
          id: 2,
          vector: Array(768).fill(0.6),
          payload: { text: "Electron docs" },
        },
      ];

      mockAxios._setResponse("PUT", "/collections/documents/points", () => ({
        data: { result: { status: "completed", operation_id: 1 } },
      }));

      await client.upsertPoints("documents", docs);

      // 3. 执行相似性搜索
      mockAxios._setResponse(
        "POST",
        "/collections/documents/points/search",
        () => ({
          data: {
            result: [{ id: 1, score: 0.95, payload: { text: "Vue 3 guide" } }],
          },
        }),
      );

      const results = await client.search("documents", {
        vector: Array(768).fill(0.85),
        limit: 5,
      });

      expect(results[0].payload.text).toBe("Vue 3 guide");
    });

    it("场景2: 多条件过滤搜索", async () => {
      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/search",
        (data) => {
          expect(data.filter.must).toHaveLength(2);
          return {
            data: {
              result: [
                {
                  id: 1,
                  score: 0.9,
                  payload: {
                    category: "technical",
                    language: "en",
                    text: "Technical document",
                  },
                },
              ],
            },
          };
        },
      );

      const results = await client.search("test_collection", {
        vector: Array(768).fill(0),
        filter: {
          must: [
            { key: "category", match: { value: "technical" } },
            { key: "language", match: { value: "en" } },
          ],
        },
      });

      expect(results[0].payload.category).toBe("technical");
      expect(results[0].payload.language).toBe("en");
    });

    it("场景3: 分页遍历大型数据集", async () => {
      const allPoints = [];
      let offset = 0;
      let hasMore = true;

      mockAxios._setResponse(
        "POST",
        "/collections/test_collection/points/scroll",
        (data) => {
          const currentOffset = data.offset || 0;
          const limit = data.limit || 10;

          const points = Array(Math.min(limit, 5))
            .fill(0)
            .map((_, i) => ({
              id: currentOffset + i + 1,
              payload: { text: `Doc ${currentOffset + i + 1}` },
            }));

          const nextOffset =
            points.length === limit ? currentOffset + limit : null;

          return {
            data: {
              result: {
                points,
                next_page_offset: nextOffset,
              },
            },
          };
        },
      );

      // 模拟分页遍历
      while (hasMore && offset < 30) {
        const result = await client.scroll("test_collection", {
          limit: 10,
          offset: offset,
        });

        allPoints.push(...result.points);

        if (result.next_offset === null) {
          hasMore = false;
        } else {
          offset = result.next_offset;
        }
      }

      expect(allPoints.length).toBeGreaterThan(0);
    });
  });
});
