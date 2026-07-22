#!/usr/bin/env python3
"""
Copilot CLI Session Reporter
Detects running GitHub Copilot CLI agents and sends heartbeat to the dashboard.

Setup (all from the dashboard — Settings → Agents):
  1. Click "Generate API key" and then "Download reporter.json".
  2. Move it into place:
       mkdir -p ~/.config/ado-dashboard
       mv ~/Downloads/reporter.json ~/.config/ado-dashboard/reporter.json
  3. Schedule this script via cron (every minute):
       ( crontab -l 2>/dev/null; echo "* * * * * python3 $HOME/copilot-session-reporter.py" ) | crontab -

Config lives at ~/.config/ado-dashboard/reporter.json (or reporter.yaml if PyYAML
is installed), e.g.:
    { "dashboard_url": "https://ado-dashboard.azurewebsites.net",
      "api_key": "adok_…", "machine_name": "VM-A" }

Only collects metadata. NO secrets, NO terminal content, NO transcripts.
"""

import json
import os
import platform
import re
import subprocess
import sys
import time
from pathlib import Path

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

try:
    from urllib.request import Request, urlopen
    from urllib.error import URLError, HTTPError
except ImportError:
    sys.exit("Python 3 with urllib required")

OS_INFO = f"{platform.system()} {platform.release()}".strip()
_CLI_VERSION = None


def cli_version():
    """Best-effort GitHub Copilot CLI version (cached, no error if absent).

    `copilot --version` prints a whole sentence, e.g.
    "GitHub Copilot CLI 1.0.74-1. Run 'copilot update'…" — extract just the
    version token so the dashboard shows "1.0.74-1", not the full line.
    """
    global _CLI_VERSION
    if _CLI_VERSION is None:
        raw = run_cmd("copilot --version 2>/dev/null") or ""
        m = re.search(r"\d+\.\d+(?:\.\d+)?(?:-\w+)?", raw)
        _CLI_VERSION = m.group(0) if m else raw.strip()[:24]
    return _CLI_VERSION


CONFIG_PATH = Path.home() / ".config" / "ado-dashboard" / "reporter.yaml"
CONFIG_JSON_PATH = Path.home() / ".config" / "ado-dashboard" / "reporter.json"


def load_config():
    """Load config from YAML or JSON."""
    if CONFIG_PATH.exists() and HAS_YAML:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    if CONFIG_JSON_PATH.exists():
        with open(CONFIG_JSON_PATH) as f:
            return json.load(f)
    # Fallback to env vars
    url = os.environ.get("ADO_DASHBOARD_URL")
    key = os.environ.get("ADO_DASHBOARD_API_KEY")
    name = os.environ.get("ADO_DASHBOARD_MACHINE_NAME", os.uname().nodename)
    if not url or not key:
        sys.exit(
            f"Config not found. Create {CONFIG_PATH} or set "
            "ADO_DASHBOARD_URL and ADO_DASHBOARD_API_KEY env vars."
        )
    return {"dashboard_url": url, "api_key": key, "machine_name": name}


def run_cmd(cmd, timeout=5):
    """Run a shell command and return stdout, or empty string on failure."""
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return ""


def detect_copilot_sessions():
    """Detect running Copilot CLI processes and their tmux sessions."""
    sessions = []

    # Detect tmux sessions
    tmux_output = run_cmd("tmux list-sessions -F '#{session_name}' 2>/dev/null")
    if not tmux_output:
        return sessions

    tmux_sessions = [s.strip() for s in tmux_output.split("\n") if s.strip()]

    for tmux_session in tmux_sessions:
        # Get panes in this session and check for copilot processes
        panes = run_cmd(
            f"tmux list-panes -t '{tmux_session}' -F '#{{pane_pid}}:#{{pane_current_path}}' 2>/dev/null"
        )
        if not panes:
            continue

        for pane_info in panes.split("\n"):
            pane_info = pane_info.strip()
            if not pane_info or ":" not in pane_info:
                continue

            parts = pane_info.split(":", 1)
            if len(parts) != 2:
                continue
            pane_pid, cwd = parts

            # Check if this pane (or its children) runs a copilot process
            children = run_cmd(
                f"pgrep -P {pane_pid} -a 2>/dev/null || ps --ppid {pane_pid} -o pid,args 2>/dev/null"
            )
            is_copilot = any(
                kw in (children or "").lower()
                for kw in ["copilot", "github-copilot", "copilot-cli"]
            )
            if not is_copilot:
                continue

            # Capture the copilot process pid (first matching child line).
            copilot_pid = ""
            for line in (children or "").splitlines():
                if any(kw in line.lower() for kw in ["copilot", "github-copilot", "copilot-cli"]):
                    first = line.split()[:1]
                    if first and first[0].isdigit():
                        copilot_pid = first[0]
                    break

            # Get git info from the working directory
            repo = ""
            branch = ""
            if cwd and os.path.isdir(cwd):
                remote = run_cmd(f"git -C '{cwd}' remote get-url origin 2>/dev/null")
                if remote:
                    # Extract repo name from URL
                    match = re.search(r"/([^/]+?)(?:\.git)?$", remote)
                    repo = match.group(1) if match else remote
                branch = run_cmd(
                    f"git -C '{cwd}' rev-parse --abbrev-ref HEAD 2>/dev/null"
                )

            # Metadata is non-identifying: process id, CLI version, OS. No secrets.
            metadata = {
                k: v
                for k, v in {"pid": copilot_pid, "version": cli_version(), "os": OS_INFO}.items()
                if v
            }

            sessions.append({
                "sessionId": tmux_session,
                "cwd": cwd,
                "repo": repo,
                "branch": branch,
                "agentType": "copilot-cli",
                "status": "active",
                "metadata": metadata,
            })

    return sessions


def send_heartbeat(config, session_data):
    """Send heartbeat to the dashboard API."""
    url = config["dashboard_url"].rstrip("/") + "/api/agents/heartbeat"
    payload = {
        "machineId": config.get("machine_name", os.uname().nodename),
        "machineName": config.get("machine_name", os.uname().nodename),
        **session_data,
    }

    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config['api_key']}",
        "X-Requested-With": "XMLHttpRequest",
    }

    req = Request(url, data=data, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except (URLError, HTTPError) as e:
        print(f"[reporter] heartbeat failed: {e}", file=sys.stderr)
        return False


def main():
    config = load_config()
    sessions = detect_copilot_sessions()

    if not sessions:
        # Send a single "no sessions" signal so the dashboard knows we're alive
        # but idle. Only if configured to do so.
        if config.get("heartbeat_when_idle"):
            send_heartbeat(config, {
                "sessionId": "idle",
                "status": "idle",
                "repo": "",
                "branch": "",
                "cwd": "",
                "agentType": "copilot-cli",
            })
        return

    success = 0
    for session in sessions:
        if send_heartbeat(config, session):
            success += 1

    print(f"[reporter] sent {success}/{len(sessions)} heartbeats")


if __name__ == "__main__":
    main()
