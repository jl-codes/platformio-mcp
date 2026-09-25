"""Capture pinned Python tool input contracts without importing or executing reference code.

Usage: python scripts/capture-reference-contracts.py --source-dir PATH [--check]
The source directory must contain the hash-matched tools/<module>.py contents
as <module>.py files. This is contract evidence, not behavioral acceptance.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def schema_for(node):
    """Translate the reference's explicit supported annotations; fail on new syntax."""
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return {"anyOf": [schema_for(node.left), schema_for(node.right)]}
    if isinstance(node, ast.Constant) and node.value is None:
        return {"type": "null"}
    if isinstance(node, ast.Name) and node.id in {"str", "int", "float", "bool"}:
        return {"type": {"str": "string", "int": "integer", "float": "number", "bool": "boolean"}[node.id]}
    if isinstance(node, ast.Subscript) and isinstance(node.value, ast.Name) and node.value.id == "list":
        return {"type": "array", "items": schema_for(node.slice)}
    raise ValueError(f"Unsupported parameter annotation: {ast.unparse(node)}")


def literal_default(node, constants):
    """Resolve only literal expressions and literal module constants, never eval/import."""
    if isinstance(node, ast.Name):
        node = constants[node.id]
    return ast.literal_eval(node)


def capture(source_dir):
    """Verify source identity and derive all frozen input contracts and direct return evidence."""
    baseline = json.loads((ROOT / "docs/reviews/platformio-parity-baseline.json").read_text(encoding="utf-8-sig"))
    cache = {}
    tools = []
    for item in baseline["tools"]:
        module = item["module"]
        if module not in cache:
            data = (source_dir / f"{module}.py").read_bytes()
            if hashlib.sha256(data).hexdigest() != item["sourceSha256"]:
                raise ValueError(f"Reference source hash mismatch: {module}")
            tree = ast.parse(data.decode("utf-8"))
            functions = {node.name: node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))}
            constants = {target.id: node.value for node in tree.body if isinstance(node, ast.Assign) for target in node.targets if isinstance(target, ast.Name)}
            cache[module] = functions, constants
        functions, constants = cache[module]
        function = functions[item["referenceTool"]]
        if ast.unparse(function.args) != item["parameters"]:
            raise ValueError(f"Signature mismatch: {function.name}")
        if function.args.vararg or function.args.kwarg or function.args.kwonlyargs or function.args.posonlyargs:
            raise ValueError(f"New parameter kind requires explicit review: {function.name}")
        properties = {}
        required = []
        defaults_offset = len(function.args.args) - len(function.args.defaults)
        for index, arg in enumerate(function.args.args):
            spec = schema_for(arg.annotation)
            if index < defaults_offset:
                required.append(arg.arg)
            else:
                spec["default"] = literal_default(function.args.defaults[index - defaults_offset], constants)
            properties[arg.arg] = spec
        # Follow local helpers to capture literal return branches. Delegated/external
        # result shapes still require behavioral fixtures and explicit manual review.
        pending = [function.name]
        visited = set()
        returns = []
        dependencies = set()
        while pending:
            name = pending.pop()
            if name in visited:
                continue
            visited.add(name)
            for node in ast.walk(functions[name]):
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    if node.func.id in functions:
                        pending.append(node.func.id)
                    else:
                        dependencies.add(node.func.id)
                if isinstance(node, ast.Return) and isinstance(node.value, ast.Dict):
                    keys = [key.value for key in node.value.keys if isinstance(key, ast.Constant) and isinstance(key.value, str)]
                    returns.append({"function": name, "line": node.lineno, "literalKeys": keys, "hasExpansion": any(key is None for key in node.value.keys)})
        tools.append({
            "requirementId": item["requirementId"], "referenceTool": function.name,
            "canonicalAction": item["canonicalAction"], "sourceUrl": item["sourceUrl"],
            "sourceSha256": item["sourceSha256"],
            "inputSchema": {"type": "object", "properties": properties, "required": required, "additionalProperties": False},
            "returnEvidence": sorted(returns, key=lambda row: (row["function"], row["line"])),
            "externalDependencies": sorted(dependencies),
            "behavioralAcceptance": "not_run",
        })
    if len(tools) != 40 or len({item["referenceTool"] for item in tools}) != 40:
        raise ValueError("Expected exactly the frozen 40 distinct tools")
    return {
        "schemaVersion": 1, "referenceSha": baseline["referenceSha"],
        "method": "Hash-verified AST analysis; no reference code imported or executed.",
        "limitations": ["Literal return keys are branch evidence, not complete output schemas.", "Delegated results and runtime failures require behavioral fixtures.", "Unknown compatibility parameters are rejected intentionally; this is stricter than permissive argument handling."],
        "tools": tools,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    rendered = json.dumps(capture(args.source_dir), indent=2, ensure_ascii=False) + "\n"
    destination = ROOT / "docs/reviews/platformio-reference-contracts.json"
    if args.check:
        if destination.read_text(encoding="utf-8") != rendered:
            raise SystemExit("Reference contracts are stale; regenerate and review the diff.")
    else:
        destination.write_text(rendered, encoding="utf-8")
    print("Verified all 40 input contracts against pinned source hashes.")


if __name__ == "__main__":
    main()
