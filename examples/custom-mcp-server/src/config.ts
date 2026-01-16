/**
 * 服务器配置
 */

export interface WeatherServerConfig {
  apiKey?: string;
  timeout: number;
  logLevel: "debug" | "info" | "warn" | "error";
  logPath: string;
}

/**
 * 从环境变量或默认值加载配置
 */
export const config: WeatherServerConfig = {
  apiKey: process.env.WEATHER_API_KEY,
  timeout: parseInt(process.env.WEATHER_TIMEOUT || "30000", 10),
  logLevel: (process.env.LOG_LEVEL as any) || "info",
  logPath: process.env.LOG_PATH || ".logs/weather-mcp-server.log",
};
