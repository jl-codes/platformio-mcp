/** Capture frozen upstream MCP input contracts by parsing literals, never executing server code. */
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";
const revision = "40e12ccb8e85fcaf33b46c50b6d832665728e773";
const source = execFileSync("git", ["show", `${revision}:src/index.ts`], {
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});
const tree = ts.createSourceFile(
  "index.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS,
);
const constants = new Map();
for (const statement of tree.statements)
  if (
    ts.isVariableStatement(statement) &&
    statement.declarationList.flags & ts.NodeFlags.Const
  )
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.initializer)
        constants.set(declaration.name.text, declaration.initializer);
const resolving = new Set();
/** Accept only literal syntax from the frozen tool table. */
function literal(node) {
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))
    return literal(node.expression);
  if (ts.isIdentifier(node) && constants.has(node.text)) {
    if (resolving.has(node.text)) throw new Error("Cyclic contract constant");
    resolving.add(node.text);
    try {
      return literal(constants.get(node.text));
    } finally {
      resolving.delete(node.text);
    }
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isObjectLiteralExpression(node))
    return Object.fromEntries(
      node.properties.map((property) => {
        if (!ts.isPropertyAssignment(property))
          throw new Error("Non-literal property in frozen tool contract");
        const name = property.name;
        if (!ts.isIdentifier(name) && !ts.isStringLiteral(name))
          throw new Error("Non-literal property key");
        return [name.text, literal(property.initializer)];
      }),
    );
  throw new Error(
    `Unsupported literal syntax: ${node.getText(tree).slice(0, 100)}`,
  );
}
let definitions;
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === "toolDefinitions"
  )
    definitions = literal(node.initializer);
  ts.forEachChild(node, visit);
}
visit(tree);
if (!definitions || definitions.length !== 42)
  throw new Error("Expected 42 frozen upstream tools");
const output =
  JSON.stringify(
    {
      schemaVersion: 1,
      repository: "jl-codes/platformio-mcp",
      revision,
      sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
      method: "Static TypeScript literal parsing; server code not executed",
      tools: definitions.map(({ name, inputSchema }) => ({
        name,
        inputSchema,
      })),
    },
    null,
    2,
  ) + "\n";
const target = "docs/reviews/platformio-product-contracts.json";
if (process.argv.includes("--check")) {
  if (fs.readFileSync(target, "utf8").replaceAll("\r\n", "\n") !== output)
    throw new Error("Frozen product contracts differ; regenerate and review");
} else fs.writeFileSync(target, output, "utf8");
console.log(`${definitions.length} frozen product tool contracts verified.`);
