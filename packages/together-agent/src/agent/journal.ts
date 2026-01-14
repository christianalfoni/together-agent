import { SessionState, JournalConfig, JournalEntry, AgentMessage } from "./types";

/**
 * Check if compression should be triggered based on token threshold
 */
export function shouldCompress(
  sessionState: SessionState,
  config: JournalConfig
): boolean {
  return sessionState.lastPromptTokens > config.contextSizeThreshold;
}

/**
 * Perform compression by removing tool messages and inserting journal listings
 * Keeps all user and assistant messages, compresses tool results
 */
export function performCompression(
  sessionState: SessionState,
  config: JournalConfig,
  queueMessage: (msg: AgentMessage) => void
): void {
  const newMessages: any[] = [];
  const compressedJournalIndices: number[] = [];

  // Iterate through messages, keeping user/assistant and removing tool messages
  for (const message of sessionState.messages) {
    if (message.role === "user" || message.role === "assistant") {
      // Keep user and assistant messages
      newMessages.push(message);

      // Check if this message has journals attached
      const journalIndices = sessionState.messageToJournals.get(message);
      if (journalIndices && journalIndices.length > 0) {
        // Get uncompressed journals for this message
        const uncompressedJournals = journalIndices
          .map((idx) => sessionState.journalEntries[idx])
          .filter((entry) => entry && !entry.compressed);

        if (uncompressedJournals.length > 0) {
          // Create journal listing message
          const journalListingContent =
            "Journal entries from this work:\n" +
            uncompressedJournals
              .map((e) => `- Entry ${e.index}: ${e.title}`)
              .join("\n") +
            "\n\nUse read_journal_entries({ entryIndices: [" +
            uncompressedJournals.map((e) => e.index).join(", ") +
            "] }) to retrieve details.";

          const journalMessage: any = {
            role: "assistant",
            content: journalListingContent,
          };

          newMessages.push(journalMessage);

          // Mark these journals as compressed
          uncompressedJournals.forEach((entry) => {
            entry.compressed = true;
            compressedJournalIndices.push(entry.index);
          });
        }
      }
    }
    // Skip tool messages entirely
  }

  // Replace messages array
  sessionState.messages = newMessages;

  // Send compression SSE message if journals were compressed
  if (compressedJournalIndices.length > 0) {
    queueMessage({
      type: "context_compressed",
      journalEntries: compressedJournalIndices.map((idx) => {
        const entry = sessionState.journalEntries[idx];
        return {
          index: entry.index,
          title: entry.title,
        };
      }),
    });
  }
}
