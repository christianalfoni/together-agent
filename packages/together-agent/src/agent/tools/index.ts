import { z } from "zod";
import { discoverToolsInMemory } from "./discover_tools";
import { executeTools } from "./execute_code";
import { CustomCapabilityDefinition } from "../../index";

export function createCapabilities(
  capabilities: Record<string, CustomCapabilityDefinition>,
  addJournalEntry?: (title: string, markdown: string) => Promise<void>,
  getExecutionContext?: () => Record<string, any>,
  updateExecutionContext?: (newContext: Record<string, any>) => void,
  getDiscoveredTools?: () => Set<string>
) {
  return {
    discover_capabilities: {
      description: `Discover capabilities available for use in execute_code via the capabilities object.

CRITICAL: When starting a task, think about ALL the capabilities you'll need for the COMPLETE workflow.
- Analyze the full task: what capabilities are involved? (e.g., email, weather, database, files, etc.)
- Use comprehensive, cross-domain search terms in ONE call to find ALL capabilities needed for the complete task
- Example: "Send weather via email" requires weather AND email capabilities → use terms: "weather temperature forecast email send message"
- The search will match terms across ALL available capabilities, so include keywords for every capability you need
- Only after discovering ALL necessary capabilities should you proceed to execute_code

Think ahead: what will I need at each step of this task? Include search terms for ALL of it.`,
      inputSchema: z.object({
        terms: z.string().describe("Comprehensive search terms covering ALL capabilities needed for the complete task (e.g., 'weather forecast email send' for weather-to-email task). Include keywords for every capability domain you'll need."),
      }),
      execute: async ({ terms }: { terms: string }) => {
        const alreadyDiscovered = getDiscoveredTools?.() || new Set();
        return discoverToolsInMemory(terms, capabilities, alreadyDiscovered);
      },
    },
    execute_code: {
      description: `Execute JavaScript code with access to asynchronous capabilities.

## Execution Environment
The ONLY custom global variable available is:
- **capabilities** - Object containing all discovered capabilities and addJournalEntry()

Standard JavaScript globals are available (Array, JSON, Math, Date, String, Number, Object, Promise, Map, Set, etc.)

All capability calls via capabilities must be awaited. Access capabilities as functions: capabilities.capabilityName(args)

## IMPORTANT Restrictions
- **NO imports or require()** - These will NOT work. Use capabilities to access discovered capabilities only.
- **NO external modules** - Only use standard JavaScript and discovered capabilities via capabilities.

## State Persistence Across Executions
Returned object keys automatically become available as global variables in subsequent executions:
- Return \`{ userData, emailData }\` → next execution can use \`userData\` and \`emailData\` directly
- This creates a persistent workspace where data flows between executions
- Only top-level keys from returned objects become globals (nested objects remain nested)

## Return Value
- MUST return a JSON-serializable object (use the outputSchema of capabilities to structure your response)
- DO NOT return markdown strings - return structured data objects
- The data you return will be formatted by you in your text response to the user

## Journaling - CRITICAL for Context Retrieval
ALWAYS call capabilities.addJournalEntry() with COMPREHENSIVE details in the second argument:
- Include ALL relevant data, variables, results, and computed values
- Include input parameters, intermediate results, and final outputs
- Include error details if any occurred
- Include metrics, counts, IDs, names - any data that provides context
- Use markdown formatting (lists, code blocks, headings) to structure complex data
- The more detail you include, the better future context retrieval will work

## Example Code

\`\`\`js
// First execution - fetch and return data
const userResult = await capabilities.getUserData({ userId: 123 })

await capabilities.addJournalEntry('Retrieved user data for analysis', \`
## User Data Retrieved
- **User ID**: 123
- **Name**: \${userResult.name}
- **Email**: \${userResult.email}
- **Status**: \${userResult.status}
- **Last Login**: \${userResult.lastLogin}

### Full Response
\\\`\\\`\\\`json
\${JSON.stringify(userResult, null, 2)}
\\\`\\\`\\\`
\`)

return { userData: userResult } // userData becomes available in next execution
\`\`\`

\`\`\`js
// Second execution - userData is now available as a global!
// No need to fetch again, just use it directly
const emailResult = await capabilities.sendEmail({
  to: userData.email,  // Using userData from previous execution
  subject: \`Hello \${userData.name}\`
})

await capabilities.addJournalEntry('Sent email to user', \`
## Email Sent
- **Recipient**: \${userData.email}
- **Name**: \${userData.name}
- **Subject**: Hello \${userData.name}
- **Email ID**: \${emailResult.emailId}
- **Status**: \${emailResult.status}
\`)

return { userData, emailResult } // Both now available in next execution
\`\`\`

- Always use await
- ALWAYS journal with comprehensive details
- Return objects with descriptive keys - they become globals
- Leverage state persistence to build on previous executions

\`\`\`js
const [weatherData, locationData] = await Promise.all([
  capabilities.getWeather({ city: 'Seattle' }),
  capabilities.getLocation({ city: 'Seattle' })
])

// GOOD - Include all relevant data from both results
await capabilities.addJournalEntry('Fetched weather and location data', \`
## Weather Data for Seattle
- **Temperature**: \${weatherData.temperature}°F
- **Condition**: \${weatherData.condition}
- **Humidity**: \${weatherData.humidity}%
- **Wind Speed**: \${weatherData.windSpeed} mph

## Location Data
- **Coordinates**: (\${locationData.lat}, \${locationData.lng})
- **Timezone**: \${locationData.timezone}
- **Population**: \${locationData.population}

### Complete Results
\\\`\\\`\\\`json
\${JSON.stringify({ weatherData, locationData }, null, 2)}
\\\`\\\`\\\`
\`)

return { weatherData, locationData }
\`\`\`

- Favour parallel tool calling
- ALWAYS journal with ALL data variables and results
- Return structured JSON data

\`\`\`js
const rawData = await capabilities.fetchData({ source: 'api' })
const processed = rawData.items.filter(item => item.active).map(item => ({
  id: item.id,
  name: item.name,
  score: item.value * 1.5
}))

// GOOD - Include input data, processing logic, and results
await capabilities.addJournalEntry('Processed API data', \`
## Data Processing Complete

### Input
- **Source**: api
- **Raw items**: \${rawData.items.length}
- **Raw data size**: \${JSON.stringify(rawData).length} bytes

### Processing
- Filtered to active items only
- Applied 1.5x score multiplier
- Mapped to simplified structure

### Output
- **Processed items**: \${processed.length}
- **Sample items**:
\\\`\\\`\\\`json
\${JSON.stringify(processed.slice(0, 3), null, 2)}
\\\`\\\`\\\`

### All Processed IDs
\${processed.map(p => \`- \${p.id}: \${p.name} (score: \${p.score})\`).join('\\n')}
\`)

return { processed, totalCount: processed.length }
\`\`\`

- Favour composing multiple capabilities
- ALWAYS journal with comprehensive context including variables, data, and execution details
- Return structured data from execute_code
`,
      inputSchema: z.object({
        code: z
          .string()
          .describe(
            "JavaScript code to execute. Use the 'capabilities' global to access discovered capabilities. Must return a JSON-serializable object."
          ),
      }),
      execute: async ({ code }: { code: string }) => {
        const currentContext = getExecutionContext?.() || {};
        const execution = await executeTools(code, capabilities, addJournalEntry, currentContext);

        // If there's an error, return as JSON
        if (execution.error) {
          return JSON.stringify({ error: execution.error });
        }

        // Merge the result into execution context if it's an object
        // This makes returned values available as globals in future executions
        // IMPORTANT: Filter out reserved names to avoid overwriting built-in globals
        if (
          execution.result &&
          typeof execution.result === 'object' &&
          !Array.isArray(execution.result) &&
          updateExecutionContext
        ) {
          const RESERVED_NAMES = ['capabilities', 'addJournalEntry'];
          const filteredResult = Object.fromEntries(
            Object.entries(execution.result).filter(([key]) => !RESERVED_NAMES.includes(key))
          );

          updateExecutionContext?.({
            ...currentContext,
            ...filteredResult,
          });
        }

        // Return the result as JSON string
        return JSON.stringify(execution.result || {});
      },
    },
  };
}
