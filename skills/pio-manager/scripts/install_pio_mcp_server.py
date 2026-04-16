#!/usr/bin/env python3
import os
import subprocess
import json
import sys

def main():
    repo_url = "https://github.com/matthewmcneill/platformio-mcp.git"
    
    # Path resolution
    workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
    tools_dir = os.path.join(workspace_root, "tools")
    mcp_dir = os.path.join(tools_dir, "platformio-mcp")
    
    print("[*] Ensuring tools directory exists...")
    os.makedirs(tools_dir, exist_ok=True)
    
    # Clone logic
    if not os.path.exists(mcp_dir):
        print(f"[*] Cloning {repo_url} into {mcp_dir}...")
        try:
            subprocess.run(["git", "clone", repo_url, "platformio-mcp"], cwd=tools_dir, check=True)
        except subprocess.CalledProcessError as e:
            print(f"[!] Failed to clone repository: {e}")
            sys.exit(1)
    else:
        print("[*] platformio-mcp already exists. Pulling latest...")
        try:
            subprocess.run(["git", "pull"], cwd=mcp_dir, check=True)
        except subprocess.CalledProcessError as e:
            print(f"[!] Warning: Failed to pull latest updates: {e}")
            
    # NPM install and build
    print("[*] Installing Node dependencies and building...")
    try:
        subprocess.run(["npm", "install"], cwd=mcp_dir, check=True)
        subprocess.run(["npm", "run", "build"], cwd=mcp_dir, check=True)
    except subprocess.CalledProcessError as e:
        print(f"[!] Failed to build the MCP server. Do you have npm installed? Error: {e}")
        sys.exit(1)
        
    # Inject config
    print("[*] Injecting configuration into ~/.gemini/antigravity/mcp.json...")
    config_path = os.path.expanduser("~/.gemini/antigravity/mcp.json")
    
    mcp_config = {
        "mcpServers": {}
    }
    
    if os.path.exists(config_path):
        try:
            with open(config_path, "r") as f:
                content = f.read().strip()
                if content:
                    mcp_config = json.loads(content)
        except json.JSONDecodeError:
            print("[!] Warning: ~/.gemini/antigravity/mcp.json is malformed. Overwriting it.")
            pass
            
    if "mcpServers" not in mcp_config:
        mcp_config["mcpServers"] = {}
        
    build_index = os.path.join(mcp_dir, "build", "index.js")
    mcp_config["mcpServers"]["platformio"] = {
        "command": "node",
        "args": [build_index]
    }
    
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    
    try:
        with open(config_path, "w") as f:
            json.dump(mcp_config, f, indent=2)
    except IOError as e:
        print(f"[!] Failed to write config to {config_path}: {e}")
        sys.exit(1)
        
    print("[+] Successfully installed and configured platformio-mcp!")
    print("[!] IMPORTANT: The AI agent or user must completely restart the agent process for the new MCP configuration to be picked up.")
    print("\n[*] NOTE: AI agent skills are optionally available in the 'skills/pio-manager' directory.")
    print("    Copy these guidelines into your agent's .agents/skills/ or equivalent rules directory to radically improve hardware autonomy.")

if __name__ == "__main__":
    main()
