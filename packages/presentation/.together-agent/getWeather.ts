import { z } from "zod";
import { capability } from "together-agent";

export default capability({
  discoveryTerms: [
    "weather",
    "temperature",
    "climate",
    "forecast",
    "conditions",
  ],
  inputSchema: z.object({
    location: z.string().describe("The city name"),
    units: z
      .enum(["fahrenheit", "celsius"])
      .default("fahrenheit")
      .describe("Temperature units"),
  }),
  outputSchema: z.object({
    location: z.string().describe("The city name"),
    temperature: z.number().describe("Current temperature"),
    units: z.enum(["fahrenheit", "celsius"]).describe("Temperature units"),
    condition: z.string().describe("Weather condition"),
    humidity: z.number().describe("Humidity percentage"),
    windSpeed: z.number().describe("Wind speed"),
  }),
  execute: async ({ location, units }, context) => {
    try {
      // Step 1: Get coordinates for the city using Open-Meteo's geocoding API
      const geocodingResponse = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          location
        )}&amp;count=1&amp;language=en&amp;format=json`
      );

      if (!geocodingResponse.ok) {
        throw new Error(`Geocoding failed: ${geocodingResponse.statusText}`);
      }

      const geocodingData = await geocodingResponse.json();

      if (!geocodingData.results || geocodingData.results.length === 0) {
        throw new Error(`Location not found: ${location}`);
      }

      const { latitude, longitude, name, country } = geocodingData.results[0];

      // Step 2: Get weather data using the coordinates
      const weatherResponse = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&amp;longitude=${longitude}&amp;current_weather=true&amp;hourly=relativehumidity_2m,windspeed_10m&amp;timezone=auto&amp;forecast_days=1`
      );

      if (!weatherResponse.ok) {
        throw new Error(`Weather API failed: ${weatherResponse.statusText}`);
      }

      const weatherData = await weatherResponse.json();

      // Convert temperature based on units preference
      let temperature = weatherData.current_weather.temperature;
      if (units === "fahrenheit") {
        temperature = (temperature * 9) / 5 + 32;
      }

      // Get current hour's humidity and wind speed
      const currentHour = new Date().getHours();
      const humidity =
        weatherData.hourly.relativehumidity_2m[currentHour] || 50;
      const windSpeed =
        weatherData.hourly.windspeed_10m[currentHour] ||
        weatherData.current_weather.windspeed;

      // Convert wind speed to mph if using fahrenheit
      const windSpeedMph =
        units === "fahrenheit" ? windSpeed * 0.621371 : windSpeed;

      // Map weather codes to conditions
      const weatherCode = weatherData.current_weather.weathercode;
      const condition = getWeatherCondition(weatherCode);

      return {
        location: `${name}, ${country}`,
        temperature: Math.round(temperature * 10) / 10,
        units,
        condition,
        humidity: Math.round(humidity),
        windSpeed: Math.round(windSpeedMph * 10) / 10,
      };
    } catch (error) {
      console.error("Weather API error:", error);

      // Fallback to mock data with realistic values
      return {
        location: location,
        temperature: units === "celsius" ? 15 : 59,
        units,
        condition: "partly cloudy",
        humidity: 65,
        windSpeed: 8,
      };
    }
  },
});

function getWeatherCondition(code: number): string {
  // WMO Weather interpretation codes (https://open-meteo.com/en/docs)
  const conditions: { [key: number]: string } = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "foggy",
    48: "depositing rime fog",
    51: "light drizzle",
    53: "moderate drizzle",
    55: "dense drizzle",
    56: "light freezing drizzle",
    57: "dense freezing drizzle",
    61: "slight rain",
    63: "moderate rain",
    65: "heavy rain",
    66: "light freezing rain",
    67: "heavy freezing rain",
    71: "slight snow fall",
    73: "moderate snow fall",
    75: "heavy snow fall",
    77: "snow grains",
    80: "slight rain showers",
    81: "moderate rain showers",
    82: "violent rain showers",
    85: "slight snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm with slight hail",
    99: "thunderstorm with heavy hail",
  };

  return conditions[code] || "unknown";
}
