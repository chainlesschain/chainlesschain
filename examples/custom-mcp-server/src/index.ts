#!/usr/bin/env node

/**
 * Weather MCP Server - 示例自定义MCP服务器
 *
 * 提供天气查询功能，展示如何创建自定义MCP服务器
 *
 * @author ChainlessChain Team
 * @license MIT
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { weatherTools, handleWeatherTool } from "./tools/weather.js";
import { weatherPrompts, getPromptContent } from "./prompts/weather-prompts.js";
import { logger } from "./utils/logger.js";
import { config } from "./config.js";

// 创建MCP服务器实例
const server = new Server(
  {
    name: "weather-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {}, // 提供工具
      resources: {}, // 提供资源
      prompts: {}, // 提供提示词模板
    },
  },
);

/**
 * 处理 tools/list 请求
 * 返回服务器提供的所有工具列表
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  logger.info("Handling tools/list request");

  return {
    tools: weatherTools,
  };
});

/**
 * 处理 tools/call 请求
 * 调用指定的工具并返回结果
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  logger.info("Handling tools/call request", { tool: name, args });

  try {
    // 路由到对应的工具处理器
    if (name.startsWith("weather_")) {
      return await handleWeatherTool(name, args || {});
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    logger.error("Tool execution failed", { tool: name, error });
    throw error;
  }
});

/**
 * 处理 resources/list 请求
 * 返回服务器提供的资源列表
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  logger.info("Handling resources/list request");

  return {
    resources: [
      {
        uri: "weather://cities",
        name: "支持的城市列表",
        mimeType: "application/json",
        description: "获取所有支持天气查询的城市列表",
      },
      {
        uri: "weather://api-status",
        name: "API状态",
        mimeType: "text/plain",
        description: "查看天气API的当前状态",
      },
    ],
  };
});

/**
 * 处理 resources/read 请求
 * 读取指定资源的内容
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  logger.info("Handling resources/read request", { uri });

  if (uri === "weather://cities") {
    const cities = [
      "北京",
      "上海",
      "广州",
      "深圳",
      "杭州",
      "成都",
      "重庆",
      "武汉",
      "西安",
      "南京",
    ];

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ cities, count: cities.length }, null, 2),
        },
      ],
    };
  }

  if (uri === "weather://api-status") {
    const status = {
      service: "运行中",
      uptime: process.uptime(),
      requestsHandled: 0, // 实际应用中可以跟踪
      lastCheck: new Date().toISOString(),
    };

    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: `天气API状态\n\n服务状态: ${status.service}\n运行时间: ${Math.floor(status.uptime)}秒\n最后检查: ${status.lastCheck}`,
        },
      ],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

/**
 * 处理 prompts/list 请求
 * 返回服务器提供的提示词模板列表
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  logger.info("Handling prompts/list request");

  return {
    prompts: weatherPrompts,
  };
});

/**
 * 处理 prompts/get 请求
 * 获取指定提示词的内容
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  logger.info("Handling prompts/get request", { name, args });

  try {
    const messages = getPromptContent(name, args || {});
    return { messages };
  } catch (error) {
    logger.error("Prompt retrieval failed", { name, error });
    throw error;
  }
});

/**
 * 启动服务器
 */
async function main() {
  try {
    logger.info("Starting Weather MCP Server", { config });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.info("Weather MCP Server started successfully");
    logger.info(
      `API Key configured: ${config.apiKey ? "Yes" : "No (using mock data)"}`,
    );
  } catch (error) {
    logger.error("Failed to start server", error);
    process.exit(1);
  }
}

// 优雅关闭
process.on("SIGINT", async () => {
  logger.info("Shutting down server");
  await server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Shutting down server");
  await server.close();
  process.exit(0);
});

// 启动服务器
main();
