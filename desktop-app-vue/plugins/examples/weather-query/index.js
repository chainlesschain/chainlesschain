/**
 * 天气查询插件
 * 提供实时天气和天气预报功能
 */

// 模拟天气数据（实际应用中应调用真实天气API）
const mockWeatherData = {
  '北京': {
    current: { temp: 15, weather: '晴', humidity: 45, wind: 12 },
    forecast: [
      { date: '2025-12-31', tempMax: 18, tempMin: 8, weather: '多云' },
      { date: '2026-01-01', tempMax: 16, tempMin: 6, weather: '晴' },
      { date: '2026-01-02', tempMax: 14, tempMin: 4, weather: '阴' }
    ]
  },
  '上海': {
    current: { temp: 22, weather: '阴', humidity: 68, wind: 8 },
    forecast: [
      { date: '2025-12-31', tempMax: 24, tempMin: 18, weather: '小雨' },
      { date: '2026-01-01', tempMax: 23, tempMin: 17, weather: '阴' },
      { date: '2026-01-02', tempMax: 25, tempMin: 19, weather: '多云' }
    ]
  },
  '广州': {
    current: { temp: 28, weather: '晴', humidity: 72, wind: 6 },
    forecast: [
      { date: '2025-12-31', tempMax: 30, tempMin: 24, weather: '晴' },
      { date: '2026-01-01', tempMax: 29, tempMin: 23, weather: '多云' },
      { date: '2026-01-02', tempMax: 31, tempMin: 25, weather: '晴' }
    ]
  }
};

/**
 * 查询当前天气
 * @param {Object} params - 参数
 * @param {string} params.city - 城市名称
 * @param {string} params.units - 温度单位
 * @returns {Promise<Object>}
 */
async function weatherCurrent(params) {
  const { city, units = 'metric' } = params;

  console.log(`[WeatherPlugin] 查询当前天气: ${city}`);

  try {
    // 查找城市数据
    const cityData = mockWeatherData[city];

    if (!cityData) {
      return {
        success: false,
        error: `未找到城市"${city}"的天气数据`
      };
    }

    const data = cityData.current;

    // 如果使用华氏度,进行转换
    const temperature = units === 'imperial'
      ? (data.temp * 9/5 + 32).toFixed(1)
      : data.temp;

    return {
      success: true,
      city: city,
      temperature: parseFloat(temperature),
      temperatureUnit: units === 'imperial' ? '°F' : '°C',
      weather: data.weather,
      humidity: data.humidity,
      windSpeed: data.wind,
      updateTime: new Date().toISOString()
    };
  } catch (error) {
    console.error('[WeatherPlugin] 查询天气失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 查询天气预报
 * @param {Object} params - 参数
 * @param {string} params.city - 城市名称
 * @param {number} params.days - 预报天数
 * @returns {Promise<Object>}
 */
async function weatherForecast(params) {
  const { city, days = 3 } = params;

  console.log(`[WeatherPlugin] 查询天气预报: ${city}, ${days}天`);

  try {
    const cityData = mockWeatherData[city];

    if (!cityData) {
      return {
        success: false,
        error: `未找到城市"${city}"的天气数据`
      };
    }

    // 限制预报天数
    const validDays = Math.min(Math.max(days, 1), cityData.forecast.length);
    const forecast = cityData.forecast.slice(0, validDays);

    return {
      success: true,
      city: city,
      days: validDays,
      forecast: forecast.map(item => ({
        ...item,
        tempMaxUnit: '°C',
        tempMinUnit: '°C'
      })),
      updateTime: new Date().toISOString()
    };
  } catch (error) {
    console.error('[WeatherPlugin] 查询预报失败:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 插件激活钩子
 */
async function activate(context) {
  console.log('[WeatherPlugin] 插件已激活');

  // 注册工具处理函数
  context.registerTool('weather_current', weatherCurrent);
  context.registerTool('weather_forecast', weatherForecast);

  // 可以在这里初始化配置、连接API等
  const config = context.getConfig();
  console.log('[WeatherPlugin] 配置:', config);
}

/**
 * 插件停用钩子
 */
async function deactivate(context) {
  console.log('[WeatherPlugin] 插件已停用');
  // 清理资源
}

// 导出插件接口
module.exports = {
  activate,
  deactivate
};
