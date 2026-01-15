import { z } from "zod";
import { tool } from "together-agent";

export default tool({
  discoveryTerms: [
    "weather",
    "temperature",
    "forecast",
    "conditions",
    "climate",
    "get weather",
    "fetch weather",
    "weather data",
    "current weather",
    "weather report",
    "meteorology",
    "atmospheric",
    "humidity",
    "wind",
    "precipitation"
  ],
  inputSchema: z.object({
    city: z.string().describe("City name to get weather for"),
    units: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("Temperature units to return")
  }),
  outputSchema: z.object({
    city: z.string(),
    temperature: z.number(),
    condition: z.string(),
    humidity: z.number(),
    windSpeed: z.number(),
    units: z.string(),
    timestamp: z.string()
  }),
  execute: async (input, context) => {
    console.log(`Getting weather for ${input.city} in ${input.units}...`);
    
    try {
      // Mock weather data for different cities
      const mockWeatherData = {
        "new york": {
          temperature: input.units === "celsius" ? 22 : 72,
          condition: "Partly Cloudy",
          humidity: 65,
          windSpeed: 12
        },
        "london": {
          temperature: input.units === "celsius" ? 15 : 59,
          condition: "Rainy",
          humidity: 80,
          windSpeed: 8
        },
        "tokyo": {
          temperature: input.units === "celsius" ? 28 : 82,
          condition: "Sunny",
          humidity: 70,
          windSpeed: 5
        },
        "paris": {
          temperature: input.units === "celsius" ? 18 : 64,
          condition: "Cloudy",
          humidity: 75,
          windSpeed: 10
        },
        "sydney": {
          temperature: input.units === "celsius" ? 25 : 77,
          condition: "Clear",
          humidity: 60,
          windSpeed: 15
        }
      };
      
      // Default weather data for unknown cities
      const defaultWeather = {
        temperature: input.units === "celsius" ? 20 : 68,
        condition: "Fair",
        humidity: 50,
        windSpeed: 10
      };
      
      // Get weather data for the requested city (case insensitive)
      const cityKey = input.city.toLowerCase();
      const weatherData = (mockWeatherData as any)[cityKey] || defaultWeather;
      
      const result = {
        city: input.city,
        temperature: weatherData.temperature,
        condition: weatherData.condition,
        humidity: weatherData.humidity,
        windSpeed: weatherData.windSpeed,
        units: input.units,
        timestamp: new Date().toISOString()
      };
      
      console.log(`Weather retrieved for ${input.city}: ${weatherData.temperature}°${input.units === "celsius" ? "C" : "F"}, ${weatherData.condition}`);
      
      return result;
    } catch (error: any) {
      throw new Error(`Failed to get weather: ${error.message}`);
    }
  },
});