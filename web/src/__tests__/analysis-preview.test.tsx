/** Analysis previews remain bounded, readable and inert within dashboard history. */
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import AnalysisPreview from "../components/analysis-preview";
afterEach(cleanup);
it("renders resolved and unresolved evidence as text, with identity limits", () => {
  const { container } = render(
    <AnalysisPreview
      response={{
        analysis: {
          kind: "frames",
          note: "Selected ELF does not verify running firmware.",
          rows: [
            {
              name: "<script>bad()</script>",
              address: "0x1234",
              resolved: false,
              file: "main.cpp",
              line: 8,
            },
          ],
          elfSha256: "a".repeat(64),
        },
      }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Decoded frames" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Unresolved")).toBeInTheDocument();
  expect(screen.getByText("<script>bad()</script>")).toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText("main.cpp:8")).toBeInTheDocument();
});
it("shows bounded symbol sizes and a truncation qualifier", () => {
  render(
    <AnalysisPreview
      response={{
        analysis: {
          kind: "symbols",
          rows: Array.from({ length: 40 }, (_, index) => ({
            name: `symbol${index}`,
            size: 42,
          })),
          truncated: true,
        },
      }}
    />,
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(20);
  expect(
    screen.getByRole("heading", { name: "Largest symbols" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Showing the first 20/)).toBeInTheDocument();
});
it("does not claim analysis for ordinary or malformed ledger responses", () => {
  const { container } = render(
    <AnalysisPreview
      response={{ success: true, analysis: { kind: "frames", rows: null } }}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});
