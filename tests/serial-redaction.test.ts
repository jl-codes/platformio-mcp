/** Framed serial secret filtering; no device or transport access. */
import { describe, expect, it } from "vitest";
import { SerialLineRedactor } from "../src/core/serial/serial-redaction.js";
describe("serial line redaction", () => {
  it("redacts known credential assignments in partial and completed lines", () => {
    const redactor = new SerialLineRedactor();
    expect(redactor.preview("wifi_password=sec").text).not.toContain("sec");
    expect(redactor.commit("wifi_password=secret").text).toBe(
      "[REDACTED_SECRET]",
    );
    expect(redactor.commit("ready 🙂")).toEqual({
      text: "ready 🙂",
      redacted: false,
    });
  });
  it("hides multiline PEM content before its closing delimiter arrives", () => {
    const redactor = new SerialLineRedactor();
    redactor.commit("-----BEGIN PRIVATE KEY-----");
    for (const secret of ["base64-one", "base64-two", ""]) {
      expect(redactor.preview(secret).text).toBe("[REDACTED_SECRET]");
      expect(redactor.commit(secret).text).toBe("[REDACTED_SECRET]");
    }
    expect(redactor.commit("-----END PRIVATE KEY----- ready").text).toBe(
      "[REDACTED_SECRET] ready",
    );
    expect(redactor.commit("normal").redacted).toBe(false);
  });
  it("does not commit a block transition on repeated partial previews", () => {
    const redactor = new SerialLineRedactor();
    const text = "-----BEGIN CERTIFICATE-----";
    expect(redactor.preview(text)).toEqual(redactor.preview(text));
    expect(redactor.preview("normal").redacted).toBe(false);
    redactor.commit(text);
    expect(redactor.preview("normal").redacted).toBe(true);
  });
  it("handles complete and adjacent blocks within a single line", () => {
    const redactor = new SerialLineRedactor();
    const block =
      "-----BEGIN EC PRIVATE KEY-----secret-----END EC PRIVATE KEY-----";
    expect(redactor.commit(`before ${block}${block} after`).text).toBe(
      "before [REDACTED_SECRET][REDACTED_SECRET] after",
    );
    expect(redactor.commit("ready").redacted).toBe(false);
  });
  it("does not end a private-key block at a mismatched certificate delimiter", () => {
    const redactor = new SerialLineRedactor();
    redactor.commit("-----BEGIN RSA PRIVATE KEY-----");
    redactor.commit("-----END CERTIFICATE-----");
    expect(redactor.commit("secret").text).toBe("[REDACTED_SECRET]");
    redactor.commit("-----END RSA PRIVATE KEY-----");
    expect(redactor.commit("ready").text).toBe("ready");
  });
  it("requires bounded framed input", () => {
    const redactor = new SerialLineRedactor();
    expect(() => redactor.commit("x\ny")).toThrow();
    expect(() => redactor.commit("x".repeat(65537))).toThrow();
  });
});
