import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import {
  SessionState,
  JournalConfig,
  JournalEntry,
  AgentMessage,
} from "../types";
import { shouldCompress, performCompression } from "../journal";

/**
 * Create the read_journal_entries native tool
 * This tool reads the full contents of one or more journal entries
 */
export function createReadJournalEntriesTool(
  workspacePath: string,
  queueMessage: (msg: AgentMessage) => void
) {
  return {
    name: "read_journal_entries",
    description:
      "Read the full contents of one or more journal entries to retrieve detailed context from previous work. IMPORTANT: Only use this tool when there are explicit journal entries referenced in your conversation context (e.g., 'Journal Entry 0', 'Entry 1', etc.). Do NOT use this tool speculatively or to search for journals - it should only be called when you have confirmed journal entry indices.",
    inputSchema: z.object({
      entryIndices: z
        .array(z.number().min(0))
        .describe("Array of journal entry indices to read"),
    }),
    execute: async ({ entryIndices }: { entryIndices: number[] }) => {
      const contents: string[] = [];

      for (const entryIndex of entryIndices) {
        const journalPath = path.join(
          workspacePath,
          `.journal/entry-${entryIndex}.md`
        );

        if (!fs.existsSync(journalPath)) {
          contents.push(
            `# Entry ${entryIndex}: Not found\n\nThis journal entry does not exist or has no content.`
          );
        } else {
          const markdown = fs.readFileSync(journalPath, "utf-8");
          contents.push(`# Entry ${entryIndex}\n\n${markdown}`);
        }
      }

      // Send SSE message
      queueMessage({
        type: "journal_entries_read",
        entryIndices,
      });

      // Combine all entries with separators
      return contents.join("\n\n---\n\n");
    },
  };
}

/**
 * Create the addJournalEntry custom tool
 * This tool creates a new journal entry with the given title and markdown content
 * Attaches the journal to the last user or assistant message
 */
export function createAddJournalEntryTool(
  sessionState: SessionState,
  config: JournalConfig,
  workspacePath: string,
  queueMessage: (msg: AgentMessage) => void
) {
  return async (title: string, markdown: string) => {
    // Create new journal entry
    const entryIndex = sessionState.journalEntries.length;
    const filePath = `.journal/entry-${entryIndex}.md`;

    const entry: JournalEntry = {
      index: entryIndex,
      title,
      compressed: false,
      filePath,
    };

    sessionState.journalEntries.push(entry);

    // Attach journal to last user/assistant message
    if (sessionState.lastUserOrAssistantMessage) {
      const existingJournals =
        sessionState.messageToJournals.get(
          sessionState.lastUserOrAssistantMessage
        ) || [];
      sessionState.messageToJournals.set(
        sessionState.lastUserOrAssistantMessage,
        [...existingJournals, entryIndex]
      );
    }

    // Create journal file with title and content
    const journalDir = path.join(workspacePath, ".journal");
    fs.mkdirSync(journalDir, { recursive: true });

    const fullContent = `# ${title}\n\n${markdown.trim()}\n`;
    fs.writeFileSync(path.join(workspacePath, filePath), fullContent);

    // Send SSE message
    queueMessage({
      type: "journal_entry_created",
      entryIndex,
      title,
    });

    // NOTE: We don't check for compression here - it will happen when new user/assistant messages arrive
  };
}
