import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "web/**",
      // vitest treats CLI path args as substring filters, so `vitest run tests`
      // also matches tests/ inside any checked-out worktree under .claude/ --
      // including an agent's worktree that is mid-mutation.
      "**/.claude/**",
      "**/.worktrees/**",
    ],
    fileParallelism: false,
  },
});
