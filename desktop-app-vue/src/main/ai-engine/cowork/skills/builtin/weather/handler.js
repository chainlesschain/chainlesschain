/**
 * Weather Skill Handler
 *
 * Queries current weather and forecasts using the wttr.in free API.
 * No API key required. Returns structured weather data with temperature,
 * conditions, humidity, wind, and more.
 */

const { logger } = require("../../../../../utils/logger.js");
const https = require("https");

const _deps = { https };

const WTTR_HOST = "wttr.in";

module.exports = {
  _deps,
  async init(skill) {
    logger.info("[Weather] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    if (!parsed.location) {
      return {
        success: false,
        action: parsed.action,
        error: "Location required. Usage: current <location> or forecast <location> [--days N]",
      };
    }

    try {
      switch (parsed.action) {
        case "current": return await handleCurrent(parsed.location);
        case "forecast": return await handleForecast(parsed.location, parsed.days);
        default: return { success: false, error: `Unknown action: ${parsed.action}. Use: current, forecast` };
      }
    } catch (error) {
      logger.error("[Weather] Error:", error);
      return { success: false, action: parsed.action, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") return { action: "current", location: "", days: 3 };
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  let action = "current";
  let locationParts = [];

  const daysMatch = trimmed.match(/--days\s+(\d+)/);
  const days = daysMatch ? Math.min(parseInt(daysMatch[1], 10), 7) : 3;

  // Clean out flags from parts
  const cleanParts = trimmed.replace(/--days\s+\d+/g, "").trim().split(/\s+/);

  if (["current", "forecast"].includes(cleanParts[0]?.toLowerCase())) {
    action = cleanParts[0].toLowerCase();
    locationParts = cleanParts.slice(1);
  } else {
    // No action specified; treat all as location, default to current
    locationParts = cleanParts;
    if (daysMatch) action = "forecast";
  }

  const location = locationParts.filter((p) => p.length > 0).join(" ");

  return { action, location, days };
}

async function handleCurrent(location) {
  const data = await fetchWeather(location);
  if (!data) {
    return { success: false, action: "current", error: `Could not fetch weather for "${location}". Check the location name.`, message: `Could not fetch weather for "${location}".` };
  }

  const current = data.current_condition && data.current_condition[0];
  if (!current) {
    return { success: false, action: "current", error: `No weather data available for "${location}".`, message: `No weather data available for "${location}".` };
  }

  const areaName = getAreaName(data);
  const country = getCountry(data);

  const weather = {
    location: areaName,
    country,
    temperature_c: parseInt(current.temp_C, 10),
    temperature_f: parseInt(current.temp_F, 10),
    feels_like_c: parseInt(current.FeelsLikeC, 10),
    feels_like_f: parseInt(current.FeelsLikeF, 10),
    description: current.weatherDesc?.[0]?.value || "Unknown",
    humidity: parseInt(current.humidity, 10),
    wind_speed_kmh: parseInt(current.windspeedKmph, 10),
    wind_speed_mph: parseInt(current.windspeedMiles, 10),
    wind_direction: current.winddir16Point || "",
    wind_degree: parseInt(current.winddirDegree, 10),
    visibility_km: parseInt(current.visibility, 10),
    cloud_cover: parseInt(current.cloudcover, 10),
    pressure_mb: parseInt(current.pressure, 10),
    uv_index: parseInt(current.uvIndex, 10),
    precipitation_mm: parseFloat(current.precipMM) || 0,
    observation_time: current.observation_time || "",
  };

  const tempStr = `${weather.temperature_c}°C (${weather.temperature_f}°F)`;
  const feelsStr = `feels like ${weather.feels_like_c}°C`;

  return {
    success: true,
    action: "current",
    location: areaName,
    weather,
    result: weather,
    message: `${areaName}, ${country}: ${weather.description}, ${tempStr} (${feelsStr}). Humidity ${weather.humidity}%, Wind ${weather.wind_speed_kmh} km/h ${weather.wind_direction}. UV index ${weather.uv_index}.`,
  };
}

async function handleForecast(location, days) {
  const data = await fetchWeather(location);
  if (!data) {
    return { success: false, action: "forecast", error: `Could not fetch forecast for "${location}". Check the location name.`, message: `Could not fetch forecast for "${location}".` };
  }

  const weatherData = data.weather;
  if (!weatherData || !Array.isArray(weatherData)) {
    return { success: false, action: "forecast", error: `No forecast data available for "${location}".`, message: `No forecast data available for "${location}".` };
  }

  const areaName = getAreaName(data);
  const country = getCountry(data);

  const forecast = weatherData.slice(0, days).map((day) => {
    const hourly = day.hourly || [];
    // Get midday conditions (index 4 = noon in wttr.in 8-hour slots)
    const midday = hourly[4] || hourly[Math.floor(hourly.length / 2)] || hourly[0] || {};

    return {
      date: day.date,
      max_temp_c: parseInt(day.maxtempC, 10),
      max_temp_f: parseInt(day.maxtempF, 10),
      min_temp_c: parseInt(day.mintempC, 10),
      min_temp_f: parseInt(day.mintempF, 10),
      avg_temp_c: Math.round((parseInt(day.maxtempC, 10) + parseInt(day.mintempC, 10)) / 2),
      description: midday.weatherDesc?.[0]?.value || "Unknown",
      humidity: parseInt(midday.humidity || day.hourly?.[0]?.humidity || "0", 10),
      wind_speed_kmh: parseInt(midday.windspeedKmph || "0", 10),
      wind_direction: midday.winddir16Point || "",
      chance_of_rain: parseInt(midday.chanceofrain || "0", 10),
      chance_of_snow: parseInt(midday.chanceofsnow || "0", 10),
      uv_index: parseInt(day.uvIndex || midday.uvIndex || "0", 10),
      sunrise: day.astronomy?.[0]?.sunrise || "",
      sunset: day.astronomy?.[0]?.sunset || "",
      total_snow_cm: parseFloat(day.totalSnow_cm) || 0,
    };
  });

  const summaryLines = forecast.map((d) => {
    const date = d.date;
    return `${date}: ${d.description}, ${d.min_temp_c}-${d.max_temp_c}°C, rain ${d.chance_of_rain}%`;
  });

  return {
    success: true,
    action: "forecast",
    location: areaName,
    country,
    days: forecast.length,
    forecast,
    result: { location: areaName, country, forecast },
    message: `${days}-day forecast for ${areaName}, ${country}:\n${summaryLines.join("\n")}`,
  };
}

function getAreaName(data) {
  const nearest = data.nearest_area?.[0];
  if (!nearest) return "Unknown";
  return nearest.areaName?.[0]?.value || nearest.region?.[0]?.value || "Unknown";
}

function getCountry(data) {
  const nearest = data.nearest_area?.[0];
  if (!nearest) return "";
  return nearest.country?.[0]?.value || "";
}

function fetchWeather(location) {
  const encodedLocation = encodeURIComponent(location);
  const urlPath = `/${encodedLocation}?format=j1`;

  return new Promise((resolve) => {
    const options = {
      hostname: WTTR_HOST,
      path: urlPath,
      method: "GET",
      headers: {
        "User-Agent": "ChainlessChain/1.2.0",
        Accept: "application/json",
      },
      timeout: 10000,
    };

    const req = _deps.https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          logger.warn("[Weather] API returned status %d for location: %s", res.statusCode, location);
          resolve(null);
          return;
        }

        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (err) {
          logger.warn("[Weather] Failed to parse response for %s: %s", location, err.message);
          resolve(null);
        }
      });
    });

    req.on("error", (err) => {
      logger.warn("[Weather] Request failed for %s: %s", location, err.message);
      resolve(null);
    });

    req.on("timeout", () => {
      req.destroy();
      logger.warn("[Weather] Request timed out for %s", location);
      resolve(null);
    });

    req.end();
  });
}
