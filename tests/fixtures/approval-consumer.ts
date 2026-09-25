/** Independent-process probe for approval consumption races; no hardware execution. */
import { consumeApproval } from "../../src/core/policy/approvals.js";
const [id, digest] = process.argv.slice(2);
for (let attempt = 0; attempt < 100; attempt++) {
  try {
    const result = consumeApproval(id, digest);
    process.stdout.write(result ? "consumed" : "unavailable");
    break;
  } catch (error) {
    if (
      (error as { code?: string }).code !== "APPROVAL_STORE_BUSY" ||
      attempt === 99
    )
      throw error;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
