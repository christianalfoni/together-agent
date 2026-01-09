import { tool } from "together-agent";
import { z } from "zod";

export default tool({
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
  execute: async ({ location, units }) => {
    // Your weather API call would go here
    return {
      location,
      temperature: units === "celsius" ? 8 : 46,
      units,
      condition: "partly cloudy",
      humidity: 72,
      windSpeed: 15,
    };
  },
});
