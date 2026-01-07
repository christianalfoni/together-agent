import { z } from "zod";

export default {
  description:
    "Get weather forecast temperature climate atmospheric conditions meteorology for any location city place region area. Check current real-time temperature degrees fahrenheit celsius hot cold warm cool. Find precipitation rain snow drizzle hail showers storms thunderstorms. Check wind speed direction gusts. Get humidity moisture levels atmospheric pressure. See sky conditions clear cloudy overcast sunny foggy. Weather forecast outdoor outside conditions feels-like apparent temperature wind-chill heat-index. Check if raining snowing storming sunny cloudy. Get weather report for cities towns regions countries worldwide global international locations geographic places.",
  inputSchema: z.object({
    location: z.string().describe("The city name"),
  }),
  execute: async ({ location }: { location: string }, context?: any) => {
    // First, geocode the location to get coordinates
    const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      location.toLowerCase()
    )}&count=1&language=en&format=json`;
    const geocodeResponse = await fetch(geocodeUrl);
    const geocodeData = (await geocodeResponse.json()) as any;

    if (!geocodeData.results || geocodeData.results.length === 0) {
      throw new Error(`Location "${location}" not found`);
    }

    const { latitude, longitude, name, country } = geocodeData.results[0];

    // Get current weather for the coordinates
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;
    const weatherResponse = await fetch(weatherUrl);
    const weatherData = (await weatherResponse.json()) as any;

    const current = weatherData.current;

    // Map weather codes to conditions
    const weatherCodeMap: Record<number, string> = {
      0: "Clear sky",
      1: "Mainly clear",
      2: "Partly cloudy",
      3: "Overcast",
      45: "Foggy",
      48: "Depositing rime fog",
      51: "Light drizzle",
      53: "Moderate drizzle",
      55: "Dense drizzle",
      61: "Slight rain",
      63: "Moderate rain",
      65: "Heavy rain",
      71: "Slight snow",
      73: "Moderate snow",
      75: "Heavy snow",
      77: "Snow grains",
      80: "Slight rain showers",
      81: "Moderate rain showers",
      82: "Violent rain showers",
      85: "Slight snow showers",
      86: "Heavy snow showers",
      95: "Thunderstorm",
      96: "Thunderstorm with slight hail",
      99: "Thunderstorm with heavy hail",
    };

    const condition = weatherCodeMap[current.weather_code] || "Unknown";

    return {
      location: `${name}, ${country}`,
      temperature: current.temperature_2m,
      feelsLike: current.apparent_temperature,
      condition,
      humidity: current.relative_humidity_2m,
      windSpeed: current.wind_speed_10m,
      precipitation: current.precipitation,
      units: {
        temperature: "°F",
        windSpeed: "mph",
        precipitation: "inch",
      },
    };
  },
};
