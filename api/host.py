"""Native Messaging host to start/stop backend server."""

from __future__ import annotations

import json
import os
import struct
import subprocess
import sys
from typing import Any

server_process: subprocess.Popen[Any] | None = None
LOG_PATH = os.path.join(os.path.dirname(__file__), "backend.log")


def send(msg: dict[str, Any]) -> None:
    raw = json.dumps(msg).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("I", len(raw)))
    sys.stdout.buffer.write(raw)
    sys.stdout.buffer.flush()


def read_message() -> dict[str, Any] | None:
    raw_len = sys.stdin.buffer.read(4)
    if not raw_len or len(raw_len) < 4:
        return None
    msg_len = struct.unpack("I", raw_len)[0]
    payload = sys.stdin.buffer.read(msg_len)
    return json.loads(payload.decode("utf-8"))


def start_backend() -> dict[str, Any]:
    global server_process
    if server_process and server_process.poll() is None:
        return {"status": "already_running", "pid": server_process.pid}

    cwd = os.path.dirname(__file__)
    try:
        log_file = open(LOG_PATH, "a", encoding="utf-8")
        server_process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
            cwd=cwd,
            stdout=log_file,
            stderr=log_file,
            stdin=subprocess.DEVNULL,
        )
    except Exception as exc:
        return {"status": "error", "message": f"backend_spawn_failed: {exc}"}

    # Give the process a moment to fail fast (missing dependencies, syntax errors, etc.)
    import time

    time.sleep(0.7)
    if server_process.poll() is not None:
        return {"status": "error", "message": "backend_exited_early", "log_path": LOG_PATH}
    return {"status": "started", "pid": server_process.pid, "log_path": LOG_PATH}


def stop_backend() -> dict[str, Any]:
    global server_process
    if server_process and server_process.poll() is None:
        server_process.terminate()
    server_process = None
    return {"status": "stopped"}


while True:
    message = read_message()
    if message is None:
        break

    action = message.get("action")
    if action == "START":
        send(start_backend())
    elif action == "STOP":
        send(stop_backend())
    elif action == "PING":
        running = server_process is not None and server_process.poll() is None
        send({"status": "ok", "server_running": running})
    else:
        send({"status": "error", "message": "unknown_action"})
