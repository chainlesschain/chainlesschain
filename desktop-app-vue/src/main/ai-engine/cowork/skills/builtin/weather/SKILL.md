---
name: weather
display-name: Weather
description: Weather queries - get current weather, forecasts, and weather alerts for any location worldwide
version: 1.2.0
category: productivity
user-invocable: true
tags: [weather, forecast, temperature, climate, wttr, conditions]
capabilities: [current-weather, weather-forecast, location-lookup]
handler: ./handler.js
os: [win32, darwin, linux]
tools: [weather-current, weather-forecast]
instructions: |
  Use this skill when the user asks about weather conditions, forecasts,
  or temperature for any location. Uses the wttr.in free API (no API key
  required). Supports current conditions and multi-day forecasts.
  Returns structured data with temperature, conditions, humidity, and wind.
examples:
  - input: "current London"
    action: current
  - input: "forecast Tokyo --days 3"
    action: forecast
  - input: "current New York"
    action: current
  - input: "forecast Paris --days 5"
    action: forecast
input-schema:
  type: string
  description: "Action (current or forecast) followed by location name"
output-schema:
  type: object
  properties:
    success: { type: boolean }
    action: { type: string }
    location: { type: string }
    weather: { type: object }
    forecast: { type: array }
    message: { type: string }
model-hints:
  context-window: small
  capability: text
cost: free
author: ChainlessChain
license: MIT
---

# Weather

Get current weather and forecasts for any location worldwide.

## Usage

```
/weather current <location>
/weather forecast <location> [--days N]
```

## Actions

| Action | Description |
| --- | --- |
| `current` | Get current weather conditions for a location |
| `forecast` | Get multi-day weather forecast (default 3 days) |

## Data Returned

- Temperature (Celsius and Fahrenheit)
- Weather description and conditions
- Humidity percentage
- Wind speed and direction
- Visibility
- Precipitation chance
- UV index

## Examples

- Current weather: `/weather current San Francisco`
- 5-day forecast: `/weather forecast Berlin --days 5`
- Simple query: `/weather London`

## API

Uses [wttr.in](https://wttr.in) - a free weather service. No API key required.
