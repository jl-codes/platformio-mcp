import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

/** Interactive y/N approval prompt for policy decisions that require one. */
export async function promptApproval(reason: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      `Policy: approval required\nReason: ${reason}\nApprove? [y/N] `,
    );
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}
