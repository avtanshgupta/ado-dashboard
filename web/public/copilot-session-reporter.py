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
import socket
import subprocess
import sys
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

CONFIG_DIR = Path.home() / ".config" / "ado-dashboard"
CONFIG_PATH = CONFIG_DIR / "reporter.yaml"
CONFIG_JSON_PATH = CONFIG_DIR / "reporter.json"
STATE_PATH = CONFIG_DIR / "reporter-state.json"
OS_INFO = "{} {}".format(platform.system(), platform.release()).strip()
COPILOT_KEYWORDS = ("copilot", "github-copilot", "copilot-cli")
REPORTER_NAMES = ("copilot-session-reporter.py",)
_CLI_VERSION = None


def machine_hostname():
    """Portable hostname for Unix, macOS, and Windows."""
    return platform.node() or socket.gethostname() or "unknown"


def run_cmd(args, timeout=5):
    """Run a command list and return stdout, or empty string on failure."""
    try:
        result = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            universal_newlines=True,
            timeout=timeout,
        )
        return result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError, ValueError):
        return ""


def cli_version():
    """Best-effort GitHub Copilot CLI version (cached, no error if absent).

    `copilot --version` prints a whole sentence, e.g.
    "GitHub Copilot CLI 1.0.74-1. Run 'copilot update'…" — extract just the
    version token so the dashboard shows "1.0.74-1", not the full line.
    """
    global _CLI_VERSION
    if _CLI_VERSION is None:
        raw = run_cmd(["copilot", "--version"]) or ""
        m = re.search(r"\d+\.\d+(?:\.\d+)?(?:-\w+)?", raw)
        _CLI_VERSION = m.group(0) if m else raw.strip()[:24]
    return _CLI_VERSION


def load_config():
    """Load config from YAML or JSON."""
    if CONFIG_PATH.exists() and HAS_YAML:
        with open(str(CONFIG_PATH)) as f:
            return yaml.safe_load(f)
    if CONFIG_JSON_PATH.exists():
        with open(str(CONFIG_JSON_PATH)) as f:
            return json.load(f)
    # Fallback to env vars
    url = os.environ.get("ADO_DASHBOARD_URL")
    key = os.environ.get("ADO_DASHBOARD_API_KEY")
    name = os.environ.get("ADO_DASHBOARD_MACHINE_NAME", machine_hostname())
    if not url or not key:
        sys.exit(
            "Config not found. Create {} or set "
            "ADO_DASHBOARD_URL and ADO_DASHBOARD_API_KEY env vars.".format(CONFIG_PATH)
        )
    return {"dashboard_url": url, "api_key": key, "machine_name": name}


def looks_like_copilot(text):
    lowered = (text or "").lower()
    return any(kw in lowered for kw in COPILOT_KEYWORDS) and not any(
        name in lowered for name in REPORTER_NAMES
    )


def first_pid(line):
    parts = (line or "").strip().split()
    return parts[0] if parts and parts[0].isdigit() else ""


def posix_process_lines_for_parent(pid, depth=4):
    """Return child process lines below pid, best-effort and bounded."""
    if not str(pid).isdigit() or depth <= 0:
        return []
    out = run_cmd(["pgrep", "-P", str(pid), "-a"])
    if not out:
        out = run_cmd(["ps", "--ppid", str(pid), "-o", "pid=,args="])
    lines = [line.strip() for line in out.splitlines() if line.strip()]
    for line in list(lines):
        child_pid = first_pid(line)
        if child_pid:
            lines.extend(posix_process_lines_for_parent(child_pid, depth - 1))
    return lines


def process_cwd(pid):
    """Best-effort cwd for a process without inspecting terminal contents."""
    if not str(pid).isdigit():
        return ""
    proc_cwd = Path("/proc") / str(pid) / "cwd"
    try:
        return os.readlink(str(proc_cwd))
    except (OSError, AttributeError):
        pass
    out = run_cmd(["pwdx", str(pid)])
    if ":" in out:
        return out.split(":", 1)[1].strip()
    return ""


def process_uptime_sec(pid):
    """Best-effort process elapsed time in seconds."""
    if not str(pid).isdigit() or platform.system().lower() == "windows":
        return None
    out = run_cmd(["ps", "-o", "etimes=", "-p", str(pid)])
    try:
        return int(out.strip())
    except (TypeError, ValueError):
        return None


def process_parent_pid(pid):
    if not str(pid).isdigit() or platform.system().lower() == "windows":
        return ""
    out = run_cmd(["ps", "-o", "ppid=", "-p", str(pid)])
    return out.strip().split()[0] if out.strip() else ""


def process_args(pid):
    if not str(pid).isdigit() or platform.system().lower() == "windows":
        return ""
    return run_cmd(["ps", "-o", "args=", "-p", str(pid)])


def has_multiplexer_ancestor(pid):
    """Avoid double-counting bare processes already found under tmux/screen."""
    seen = set()
    current = str(pid)
    for _ in range(12):
        if not current or current in seen or current == "1":
            return False
        seen.add(current)
        parent = process_parent_pid(current)
        if not parent:
            return False
        args = process_args(parent).lower()
        if "tmux" in args or "screen" in args:
            return True
        current = parent
    return False


def git_info(cwd):
    """Best-effort non-sensitive repo name and branch for a working directory."""
    repo = ""
    branch = ""
    if cwd and os.path.isdir(cwd):
        remote = run_cmd(["git", "-C", cwd, "remote", "get-url", "origin"])
        if remote:
            match = re.search(r"[/\\:]([^/\\:]+?)(?:\.git)?$", remote)
            repo = match.group(1) if match else remote
        branch = run_cmd(["git", "-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"])
    return repo, branch


def base_metadata(pid, extra=None):
    """Non-identifying metadata only: process counters, version, OS. No content."""
    metadata = {"version": cli_version(), "os": OS_INFO}
    if pid:
        metadata["pid"] = str(pid)
    uptime = process_uptime_sec(pid)
    if uptime is not None:
        metadata["uptimeSec"] = uptime
    if extra:
        metadata.update({k: v for k, v in extra.items() if v not in (None, "")})
    return {k: v for k, v in metadata.items() if v not in (None, "")}


def session_payload(session_id, cwd, pid, metadata=None):
    repo, branch = git_info(cwd)
    return {
        "sessionId": str(session_id),
        "cwd": cwd or "",
        "repo": repo,
        "branch": branch,
        "agentType": "copilot-cli",
        "status": "active",
        "metadata": base_metadata(pid, metadata),
    }


def collect_tmux_sessions():
    """Detect Copilot CLI sessions running inside tmux."""
    sessions = []
    output = run_cmd(["tmux", "list-sessions", "-F", "#{session_name}"])
    tmux_sessions = [s.strip() for s in output.splitlines() if s.strip()]
    for tmux_session in tmux_sessions:
        panes = run_cmd([
            "tmux",
            "list-panes",
            "-t",
            tmux_session,
            "-F",
            "#{pane_pid}:#{pane_current_path}",
        ])
        pane_infos = [p.strip() for p in panes.splitlines() if p.strip() and ":" in p]
        for pane_info in pane_infos:
            pane_pid, cwd = pane_info.split(":", 1)
            children = posix_process_lines_for_parent(pane_pid)
            matches = [line for line in children if looks_like_copilot(line)]
            if not matches:
                continue
            copilot_pid = first_pid(matches[0])
            sessions.append(session_payload(
                tmux_session,
                cwd,
                copilot_pid,
                {"collector": "tmux", "paneCount": len(pane_infos), "agentCount": len(matches)},
            ))
    return sessions


def collect_screen_sessions():
    """Detect Copilot CLI sessions running inside GNU screen."""
    sessions = []
    output = run_cmd(["screen", "-ls"])
    for line in output.splitlines():
        match = re.search(r"\s*(\d+)\.([^\s]+)", line)
        if not match:
            continue
        screen_pid = match.group(1)
        screen_name = match.group(2)
        children = posix_process_lines_for_parent(screen_pid)
        matches = [child for child in children if looks_like_copilot(child)]
        if not matches:
            continue
        copilot_pid = first_pid(matches[0])
        cwd = process_cwd(copilot_pid) or process_cwd(screen_pid)
        sessions.append(session_payload(
            "screen:{}".format(screen_name),
            cwd,
            copilot_pid,
            {"collector": "screen", "agentCount": len(matches), "screenPid": screen_pid},
        ))
    return sessions


def collect_bare_posix_sessions():
    """Detect Copilot CLI processes not owned by tmux/screen."""
    sessions = []
    output = run_cmd(["pgrep", "-af", "copilot"])
    if not output:
        output = run_cmd(["ps", "-eo", "pid=,args="])
    for line in output.splitlines():
        if not looks_like_copilot(line):
            continue
        pid = first_pid(line)
        if not pid or has_multiplexer_ancestor(pid):
            continue
        cwd = process_cwd(pid)
        sessions.append(session_payload(
            "process:{}".format(pid),
            cwd,
            pid,
            {"collector": "process", "agentCount": 1},
        ))
    return sessions


def collect_bare_windows_sessions():
    """Detect Copilot CLI processes on Windows without requiring extra packages."""
    sessions = []
    output = run_cmd([
        "wmic",
        "process",
        "where",
        "name like '%copilot%'",
        "get",
        "ProcessId,CommandLine",
        "/FORMAT:LIST",
    ])
    blocks = [b for b in re.split(r"\r?\n\r?\n", output) if b.strip()]
    for block in blocks:
        pid_match = re.search(r"ProcessId=(\d+)", block)
        command_match = re.search(r"CommandLine=(.*)", block)
        if not pid_match or not looks_like_copilot(command_match.group(1) if command_match else block):
            continue
        pid = pid_match.group(1)
        sessions.append(session_payload(
            "process:{}".format(pid),
            "",
            pid,
            {"collector": "process", "agentCount": 1},
        ))
    if sessions:
        return sessions

    tasklist = run_cmd(["tasklist", "/FO", "CSV", "/NH"])
    for line in tasklist.splitlines():
        if not looks_like_copilot(line):
            continue
        parts = [p.strip().strip('"') for p in line.split('","')]
        if len(parts) < 2 or not parts[1].isdigit():
            continue
        pid = parts[1]
        sessions.append(session_payload(
            "process:{}".format(pid),
            "",
            pid,
            {"collector": "process", "agentCount": 1},
        ))
    return sessions


def dedupe_sessions(sessions):
    """De-duplicate by session identity, then by cwd for overlapping collectors."""
    by_key = {}
    by_cwd = {}
    for session in sessions:
        sid = session.get("sessionId") or ""
        cwd = session.get("cwd") or ""
        key = (sid, cwd)
        if key in by_key:
            continue
        if cwd and cwd in by_cwd:
            existing = by_cwd[cwd]
            existing_meta = existing.setdefault("metadata", {})
            existing_meta["agentCount"] = max(
                int(existing_meta.get("agentCount") or 1),
                int((session.get("metadata") or {}).get("agentCount") or 1),
            )
            continue
        by_key[key] = session
        if cwd:
            by_cwd[cwd] = session
    return list(by_key.values())


def detect_copilot_sessions():
    """Detect running Copilot CLI sessions via tmux, screen, and bare processes."""
    collectors = [collect_tmux_sessions, collect_screen_sessions]
    if platform.system().lower() == "windows":
        collectors.append(collect_bare_windows_sessions)
    else:
        collectors.append(collect_bare_posix_sessions)

    sessions = []
    for collector in collectors:
        try:
            sessions.extend(collector())
        except Exception as exc:
            print("[reporter] collector {} failed: {}".format(collector.__name__, exc), file=sys.stderr)
    return dedupe_sessions(sessions)


def load_state():
    try:
        with open(str(STATE_PATH)) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def write_state(state):
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(str(STATE_PATH), "w") as f:
            json.dump(state, f, sort_keys=True, indent=2)
        return True
    except OSError as exc:
        print("[reporter] state write failed: {}".format(exc), file=sys.stderr)
        return False


def machine_sessions_from_state(state, machine_id):
    machines = state.get("machines") if isinstance(state.get("machines"), dict) else {}
    sessions = machines.get(machine_id, [])
    return sessions if isinstance(sessions, list) else []


def state_for_sessions(machine_id, sessions):
    return {
        "machines": {
            machine_id: [
                {
                    "sessionId": s.get("sessionId", ""),
                    "repo": s.get("repo", ""),
                    "branch": s.get("branch", ""),
                    "cwd": s.get("cwd", ""),
                    "agentType": s.get("agentType", "copilot-cli"),
                }
                for s in sessions
                if s.get("sessionId")
            ]
        }
    }


def ended_sessions(previous, current):
    current_ids = set(s.get("sessionId") for s in current if s.get("sessionId"))
    ended = []
    for item in previous:
        sid = item.get("sessionId") if isinstance(item, dict) else str(item)
        if sid and sid not in current_ids:
            payload = dict(item) if isinstance(item, dict) else {"sessionId": sid}
            payload.update({
                "status": "ended",
                "agentType": payload.get("agentType", "copilot-cli"),
                "metadata": {"endedByReporter": True, "os": OS_INFO},
            })
            ended.append(payload)
    return ended


def send_heartbeat(config, session_data):
    """Send heartbeat to the dashboard API."""
    url = config["dashboard_url"].rstrip("/") + "/api/agents/heartbeat"
    machine_name = config.get("machine_name") or machine_hostname()
    payload = {
        "machineId": machine_name,
        "machineName": machine_name,
    }
    payload.update(session_data)

    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer {}".format(config["api_key"]),
        "X-Requested-With": "XMLHttpRequest",
    }

    req = Request(url, data=data, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except (URLError, HTTPError) as e:
        print("[reporter] heartbeat failed: {}".format(e), file=sys.stderr)
        return False


def main():
    config = load_config()
    machine_id = config.get("machine_name") or machine_hostname()
    sessions = detect_copilot_sessions()
    state = load_state()
    previous = machine_sessions_from_state(state, machine_id)
    ended = ended_sessions(previous, sessions)

    success = 0
    total = len(sessions) + len(ended)
    for session in sessions:
        if send_heartbeat(config, session):
            success += 1
    for session in ended:
        if send_heartbeat(config, session):
            success += 1

    write_state(state_for_sessions(machine_id, sessions))

    if not sessions:
        # Send a single "no sessions" signal so the dashboard knows we're alive
        # but idle. Only if configured to do so.
        if config.get("heartbeat_when_idle"):
            total += 1
            if send_heartbeat(config, {
                "sessionId": "idle",
                "status": "idle",
                "repo": "",
                "branch": "",
                "cwd": "",
                "agentType": "copilot-cli",
            }):
                success += 1
        if total:
            print("[reporter] sent {}/{} heartbeats".format(success, total))
        return

    print("[reporter] sent {}/{} heartbeats".format(success, total))


if __name__ == "__main__":
    main()
