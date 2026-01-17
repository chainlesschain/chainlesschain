/**
 * 提示词模板
 *
 * MCP Prompts 功能允许服务器提供预定义的提示词模板
 */

import { Prompt } from "@modelcontextprotocol/sdk/types.js";

/**
 * 天气相关的提示词模板
 */
export const weatherPrompts: Prompt[] = [
  {
    name: "weather_report",
    description: "生成一份详细的天气报告",
    arguments: [
      {
        name: "city",
        description: "城市名称",
        required: true,
      },
      {
        name: "language",
        description: "报告语言 (zh/en)",
        required: false,
      },
    ],
  },
  {
    name: "travel_advice",
    description: "基于天气情况提供旅行建议",
    arguments: [
      {
        name: "destination",
        description: "目的地城市",
        required: true,
      },
      {
        name: "date",
        description: "出行日期 (YYYY-MM-DD)",
        required: false,
      },
    ],
  },
  {
    name: "weather_comparison",
    description: "比较两个城市的天气情况",
    arguments: [
      {
        name: "city1",
        description: "第一个城市",
        required: true,
      },
      {
        name: "city2",
        description: "第二个城市",
        required: true,
      },
    ],
  },
];

/**
 * 获取提示词内容
 *
 * @param name - 提示词名称
 * @param args - 提示词参数
 * @returns 提示词消息内容
 */
export function getPromptContent(
  name: string,
  args: Record<string, string>,
): { role: "user" | "assistant"; content: { type: "text"; text: string } }[] {
  switch (name) {
    case "weather_report": {
      const { city, language = "zh" } = args;
      const prompt =
        language === "zh"
          ? `请为${city}生成一份详细的天气报告，包括：
1. 当前天气状况
2. 温度和湿度
3. 风力和风向
4. 空气质量
5. 穿衣建议
6. 出行建议

请使用结构化的格式输出。`
          : `Please generate a detailed weather report for ${city}, including:
1. Current weather conditions
2. Temperature and humidity
3. Wind speed and direction
4. Air quality
5. Clothing recommendations
6. Travel suggestions

Please use a structured format.`;

      return [
        {
          role: "user",
          content: { type: "text", text: prompt },
        },
      ];
    }

    case "travel_advice": {
      const { destination, date } = args;
      const dateInfo = date ? `出行日期：${date}` : "近期出行";

      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `我计划去${destination}旅行（${dateInfo}）。请根据天气情况提供以下建议：
1. 是否适合出行
2. 需要携带的物品
3. 穿着建议
4. 注意事项
5. 备选方案

请查询${destination}的天气信息后给出建议。`,
          },
        },
      ];
    }

    case "weather_comparison": {
      const { city1, city2 } = args;

      return [
        {
          role: "user",
          content: {
            type: "text",
            text: `请比较${city1}和${city2}两个城市的天气情况：
1. 当前温度对比
2. 天气状况对比
3. 空气质量对比
4. 哪个城市更适合户外活动

请使用表格形式展示对比结果。`,
          },
        },
      ];
    }

    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
