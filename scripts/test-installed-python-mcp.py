"""Verify installed wheel MCP identity, tool preservation, clean stdio and EOF shutdown."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile


def check(executable, version):
    """Run both advertised modes using the installed command without global Node on PATH."""
    results = []
    names_by_mode = []
    for mode in [[], ["--compat", "platformio-mcp-python"]]:
        with tempfile.TemporaryDirectory(prefix="pio-wheel-mcp-") as working:
            environment = os.environ.copy()
            environment.update(PATH=str(executable.parent), PIO_MCP_NO_BROWSER="true", PIO_MCP_DISABLE_DASHBOARD="true", PIO_MCP_DATA_DIR=working)
            messages = [
                {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"installed-wheel-acceptance","version":"1"}}},
                {"jsonrpc":"2.0","method":"notifications/initialized"},
                {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
            ]
            completed = subprocess.run([str(executable),"--disable-dashboard",*mode],input="".join(json.dumps(item)+"\n" for item in messages),capture_output=True,text=True,env=environment,cwd=working,timeout=30)
            if completed.returncode != 0:
                raise AssertionError(f"Installed server failed: {completed.stderr}")
            replies = [json.loads(line) for line in completed.stdout.splitlines()]
            by_id = {item.get("id"):item for item in replies if "id" in item}
            assert by_id[1]["result"]["serverInfo"]["version"] == version
            tools = by_id[2]["result"]["tools"]
            names = {item["name"] for item in tools}
            assert len(names) == len(tools), "Duplicate advertised tools"
            assert {"deps_check","project_envs"}.issubset(names)
            names_by_mode.append(names)
            results.append({"mode":"compatibility" if mode else "normal","serverVersion":version,"tools":sorted(names),"exitCode":completed.returncode,"stdout":"JSON messages only","shutdown":"EOF"})
    assert names_by_mode[0].issubset(names_by_mode[1]), "Compatibility mode removed canonical tools"
    assert "pio_deps_check" in names_by_mode[1]
    return {"schemaVersion":1,"scope":"installed wheel MCP handshake, tool listing and EOF shutdown; no hardware operations", "results":results}


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("executable",type=Path)
    parser.add_argument("version")
    parser.add_argument("evidence",type=Path)
    args=parser.parse_args()
    evidence=check(args.executable.resolve(),args.version)
    args.evidence.write_text(json.dumps(evidence,indent=2)+"\n")
    print(json.dumps([{ "mode":r["mode"],"tools":len(r["tools"]),"exitCode":r["exitCode"]} for r in evidence["results"]]))
