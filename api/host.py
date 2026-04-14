#!/usr/bin/env python3
"""
host.py — AI Hygiene Native Messaging Host
============================================
Chrome extension communicates with this script via stdin/stdout using the
Chrome Native Messaging protocol (4-byte LE length prefix + JSON payload).

This script:
1. Receives START / STOP / PING messages from the extension background.ts
2. Manages the FastAPI server process (main.py) lifecycle
3. Opens the server in a visible CMD terminal window so the user can see
   the NPU monitor bar and model loading status

Registered via: HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ai_hygiene
"""

from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
import time

# Path to main.py (same directory as this file)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MAIN_PY = os.path.join(SCRIPT_DIR, "main.py")

server_process: subprocess.Popen | None = None


# ---------------------------------------------------------------------------
# Native Messaging I/O (length-prefixed JSON on stdout/stdin)
# ---------------------------------------------------------------------------
def send_message(msg: dict) -> None:
    """Send a JSON message to Chrome via stdout (length-prefixed)."""
    raw = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(raw)))
    sys.stdout.buffer.write(raw)
    sys.stdout.buffer.flush()


def read_message() -> dict | None:
    """Read one JSON message from Chrome via stdin (length-prefixed)."""
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    length = struct.unpack("<I", raw_len)[0]
    if length == 0 or length > 1_000_000:
        return None
    raw = sys.stdin.buffer.read(length)
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# Backend process management
# ---------------------------------------------------------------------------
def is_server_running() -> bool:
    """True if the server subprocess is still alive."""
    if server_process is None:
        return False
    return server_process.poll() is None


def start_server() -> dict:
    """Spawn the FastAPI server in a new visible terminal window."""
    global server_process
    if is_server_running():
        return {"status": "already_running", "pid": server_process.pid}  # type: ignore[union-attr]

    try:
        # On Windows open a new console window for the server (so the NPU bar is visible)
        server_process = subprocess.Popen(
            ["cmd.exe", "/k", f"python \"{MAIN_PY}\" & pause"],
            creationflags=subprocess.CREATE_NEW_CONSOLE,
            cwd=SCRIPT_DIR,
        )
        # Brief wait to detect immediate crash
        time.sleep(0.8)
        if server_process.poll() is not None:
            return {"status": "failed", "error": "Process exited immediately. Check Python and dependencies."}
        return {"status": "started", "pid": server_process.pid}
    except Exception as exc:
        return {"status": "error", "error": str(exc)}


def stop_server() -> dict:
    """Terminate the server process."""
    global server_process
    if not is_server_running():
        server_process = None
        return {"status": "stopped"}
    try:
        server_process.terminate()  # type: ignore[union-attr]
        server_process.wait(timeout=5)
    except Exception:
        try:
            server_process.kill()  # type: ignore[union-attr]
        except Exception:
            pass
    server_process = None
    return {"status": "stopped"}


# ---------------------------------------------------------------------------
# Main message loop
# ---------------------------------------------------------------------------
def main() -> None:
    while True:
        msg = read_message()
        if msg is None:
            # Chrome closed the connection (e.g. extension unloaded)
            stop_server()
            break

        action = msg.get("action", "").upper()

        if action == "START":
            result = start_server()
            send_message(result)

        elif action == "STOP":
            result = stop_server()
            send_message(result)

        elif action == "PING":
            send_message({
                "status": "ok",
                "server_running": is_server_running(),
                "pid": server_process.pid if is_server_running() else None,
            })

        elif action == "STATUS":
            send_message({
                "status": "ok",
                "server_running": is_server_running(),
                "pid": server_process.pid if is_server_running() else None,
            })

        else:
            send_message({"status": "error", "error": f"Unknown action: {action}"})


if __name__ == "__main__":
    main()
