import { z } from "zod";

export default (env) => ({
  description:
    "Search the web internet online for information data facts research. Find lookup browse query websites pages articles documentation docs API reference manual guide tutorial examples code snippets. Get current recent latest up-to-date real-time news events updates announcements releases versions. Check availability status pricing costs specifications specs features comparisons reviews ratings. Discover resources tools libraries packages frameworks repositories GitHub StackOverflow forums discussions communities blogs posts. Look up technical questions how-to instructions installation setup configuration deployment troubleshooting errors bugs issues solutions fixes workarounds. Research products services companies organizations people profiles contact information social media links URLs websites domains. Fetch external online web-based internet information that requires browsing searching querying the web.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    count: z
      .number()
      .optional()
      .describe("Number of results to return (default: 5, max: 20)"),
  }),
  execute: async ({ query, count = 5 }) => {
    const apiKey = env.BRAVE_SEARCH_API_KEY;

    if (!apiKey) {
      throw new Error("BRAVE_SEARCH_API_KEY environment variable is required");
    }

    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
      query
    )}&count=${Math.min(count, 20)}`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Brave Search API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    // Extract and format the results
    const results = data.web?.results || [];

    return {
      query: data.query?.original || query,
      results: results.map((result) => ({
        title: result.title,
        url: result.url,
        description: result.description,
        // Some results may have extra metadata
        age: result.age,
        language: result.language,
      })),
      // Include some metadata about the search
      totalResults: results.length,
    };
  },
});
