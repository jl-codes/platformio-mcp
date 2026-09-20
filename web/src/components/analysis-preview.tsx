/** Readable bounded firmware-analysis evidence inside the existing command feed. */
import React from "react";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const label = (value: unknown) =>
  typeof value === "string" ? value.slice(0, 384) : "";

/** Display server-projected rows as text, without HTML interpretation or file navigation. */
export default function AnalysisPreview({ response }: { response: unknown }) {
  const analysis = object(object(response).analysis);
  if (
    !["frames", "symbols"].includes(String(analysis.kind)) ||
    !Array.isArray(analysis.rows)
  )
    return null;
  const frames = analysis.kind === "frames";
  const rows = analysis.rows.slice(0, 20).map(object);
  return (
    <section
      aria-label="Firmware analysis"
      style={{ marginBottom: 12, overflowWrap: "anywhere" }}
    >
      <h4 style={{ margin: "8px 0" }}>
        {frames ? "Decoded frames" : "Largest symbols"}
      </h4>
      <p>{label(analysis.note)}</p>
      {rows.length === 0 ? (
        <p>No analysis rows were returned.</p>
      ) : (
        <ol style={{ paddingLeft: 22 }}>
          {rows.map((row, index) => (
            <li key={index} style={{ marginBottom: 8 }}>
              <strong>{label(row.name) || "Unknown symbol"}</strong>{" "}
              <code>{label(row.address)}</code>{" "}
              {frames ? (
                <span>{row.resolved === true ? "Resolved" : "Unresolved"}</span>
              ) : (
                <span>
                  {typeof row.size === "number" &&
                  Number.isSafeInteger(row.size) &&
                  row.size >= 0
                    ? `${row.size} bytes`
                    : "Size unknown"}
                </span>
              )}
              {label(row.file) && (
                <div>
                  {label(row.file)}
                  {typeof row.line === "number" &&
                  Number.isSafeInteger(row.line) &&
                  row.line > 0
                    ? `:${row.line}`
                    : ""}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {analysis.truncated === true && (
        <p>
          Showing the first {rows.length} reported rows. The full result is
          available to the requesting client.
        </p>
      )}
      {typeof analysis.elfSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(analysis.elfSha256) && (
          <p>
            ELF SHA-256: <code>{analysis.elfSha256}</code>
          </p>
        )}
    </section>
  );
}
