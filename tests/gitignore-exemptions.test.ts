import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

/**
 * .gitignore relies on `!` exemptions AFTER broad patterns (last match wins).
 * An alphabetical re-sort once moved every `!` line above the pattern it was
 * exempting, silently ignoring shipped files -- including paths listed in
 * package.json "files". This pins the exemptions that matter.
 */
describe(".gitignore exemptions", () => {
  const mustNotBeIgnored = [
    ".agents/skills/pio-manager/SKILL.md",
    ".agents/plugins/marketplace.json",
    "plugins/platformio-mcp/.mcp.json",
    ".vscode/settings.json",
  ];

  it.each(mustNotBeIgnored)("does not ignore %s", (file) => {
    // check-ignore exits 0 when the path IS ignored, 1 when it is not.
    let ignored = false;
    try {
      execFileSync("git", ["check-ignore", "-q", "--no-index", file], {
        stdio: "ignore",
      });
      ignored = true;
    } catch {
      ignored = false;
    }
    expect(
      ignored,
      `${file} is ignored -- a .gitignore exemption is broken`,
    ).toBe(false);
  });

  it("does ignore build artifacts and agent worktrees", () => {
    for (const file of ["x.tgz", ".claude/worktrees/anything"]) {
      let ignored = false;
      try {
        execFileSync("git", ["check-ignore", "-q", "--no-index", file], {
          stdio: "ignore",
        });
        ignored = true;
      } catch {}
      expect(ignored, `${file} should be ignored`).toBe(true);
    }
  });
});
