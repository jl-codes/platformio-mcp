/**
 * Stateful redaction for framed serial text, including incomplete multiline PEM blocks.
 * Provides SerialLineRedactor; framing and bounded storage remain the session buffer's responsibility.
 */
import { redactSecretsInText } from "../policy/redact.js";
import { PlatformIOError } from "../../utils/errors.js";

const marker = "[REDACTED_SECRET]";
const begin =
  /-----BEGIN ((?:RSA |EC |OPENSSH )?PRIVATE KEY|CERTIFICATE)-----/i;

/** Redaction result reports filtering separately from byte loss or transport truncation. */
export interface SerialRedactedLine {
  text: string;
  redacted: boolean;
}

/**
 * One instance belongs to one serial stream. Preview never advances state, so repeated cursor reads are stable.
 * Commit each completed line exactly once, before eviction; PEM state then survives ring-buffer eviction.
 * This detects known textual secret formats, not arbitrary unknown secret values.
 */
export class SerialLineRedactor {
  private insidePem: string | undefined;

  /** Render a bounded partial line without committing its state. */
  preview(line: string): SerialRedactedLine {
    return this.render(line, false);
  }

  /** Redact and commit one complete CR/LF-free line, maintaining multiline block state. */
  commit(line: string): SerialRedactedLine {
    return this.render(line, true);
  }

  private render(line: string, commit: boolean): SerialRedactedLine {
    if (
      typeof line !== "string" ||
      Buffer.byteLength(line) > 65536 ||
      /[\r\n]/.test(line)
    )
      throw new PlatformIOError(
        "Invalid serial redaction line.",
        "SERIAL_REDACTION_INPUT_INVALID",
      );
    let pending = this.insidePem;
    let rest = line;
    let text = "";
    while (rest.length) {
      if (pending) {
        const delimiter = `-----END ${pending}-----`;
        const finish = rest.toUpperCase().indexOf(delimiter);
        text += marker;
        if (finish < 0) {
          rest = "";
          break;
        }
        rest = rest.slice(finish + delimiter.length);
        pending = undefined;
      } else {
        const start = begin.exec(rest);
        if (!start) {
          text += redactSecretsInText(rest);
          rest = "";
          break;
        }
        text += redactSecretsInText(rest.slice(0, start.index));
        rest = rest.slice(start.index + start[0].length);
        pending = start[1].toUpperCase();
        if (!rest.length) text += marker;
      }
    }
    if (!line && pending) text = marker;
    if (commit) this.insidePem = pending;
    return { text, redacted: text !== line };
  }
}
