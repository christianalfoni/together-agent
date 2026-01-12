import { z } from "zod";
import { tool } from "together-agent";
import simpleGit from "simple-git";
import path from "path";

export default tool({
  discoveryTerms: [
    "clone",
    "repository",
    "repo",
    "git",
    "github",
    "gitlab",
    "bitbucket",
    "download",
    "fetch",
    "pull",
    "checkout",
    "source",
    "code",
  ],
  inputSchema: z.object({
    url: z
      .string()
      .describe(
        "GitHub/GitLab/Bitbucket repository URL (e.g., https://github.com/user/repo)"
      ),
    name: z
      .string()
      .optional()
      .describe("Optional custom directory name for the cloned repo"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    path: z.string(),
    relativePath: z.string(),
    url: z.string(),
    message: z.string(),
  }),
  execute: async (input, context) => {
    const git = simpleGit();

    // Extract repo name from URL if custom name not provided
    const repoName =
      input.name || input.url.split("/").pop()?.replace(".git", "") || "repo";
    const clonePath = path.join(context.workspacePath, repoName);

    try {
      // Perform shallow clone (depth 1) to save time and space
      await git.clone(input.url, clonePath, ["--depth", "1"]);

      return {
        success: true,
        path: clonePath,
        relativePath: repoName,
        url: input.url,
        message: `Repository cloned to ${repoName}`,
      };
    } catch (error: any) {
      throw new Error(`Failed to clone repository: ${error.message}`);
    }
  },
});
