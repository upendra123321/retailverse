#!/usr/bin/env python3
"""Cross-platform dev launcher: runs the FastAPI backend (:8000) and the Vite
frontend (:5173) together, streaming both logs with [backend]/[frontend]
prefixes, and shuts both down cleanly on Ctrl+C.

Usage (macOS/Linux):   python3 scripts/dev.py
Usage (Windows):       python scripts/dev.py

Run `python scripts/setup.py` first if you haven't already (creates the venv,
installs deps, copies .env).
"""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import threading
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VENV_DIR = REPO_ROOT / ".venv"
IS_WINDOWS = os.name == "nt"


def venv_python() -> Path:
    return VENV_DIR / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")


def npm_executable() -> str:
    npm = shutil.which("npm")
    if npm is None:
        raise SystemExit("npm not found on PATH. Install Node.js 18+ and re-run.")
    return npm


def stream_output(proc: subprocess.Popen, prefix: str) -> None:
    assert proc.stdout is not None
    for line in iter(proc.stdout.readline, ""):
        if not line:
            break
        print(f"[{prefix}] {line.rstrip()}", flush=True)


def main() -> None:
    py = venv_python()
    if not py.exists():
        raise SystemExit(f"Virtualenv not found at {VENV_DIR}. Run `python scripts/setup.py` first.")

    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        print("!! No .env found - Agent Mode LLM calls will fail. Run scripts/setup.py first.")

    backend_cmd = [str(py), "-m", "uvicorn", "backend.app.main:app", "--reload", "--port", "8000"]
    frontend_cmd = [npm_executable(), "run", "dev"]

    print(f"$ {' '.join(backend_cmd)}  (cwd={REPO_ROOT})")
    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    frontend_dir = REPO_ROOT / "frontend"
    print(f"$ {' '.join(frontend_cmd)}  (cwd={frontend_dir})")
    frontend_proc = subprocess.Popen(
        frontend_cmd,
        cwd=frontend_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        shell=IS_WINDOWS,  # npm ships as npm.cmd on Windows; shell=True resolves it
    )

    threads = [
        threading.Thread(target=stream_output, args=(backend_proc, "backend"), daemon=True),
        threading.Thread(target=stream_output, args=(frontend_proc, "frontend"), daemon=True),
    ]
    for t in threads:
        t.start()

    def shutdown(*_args) -> None:
        print("\nShutting down backend + frontend...")
        for proc in (backend_proc, frontend_proc):
            if proc.poll() is None:
                proc.terminate()
        for proc in (backend_proc, frontend_proc):
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    if not IS_WINDOWS:
        signal.signal(signal.SIGTERM, shutdown)

    print("\nBoth servers starting - open http://localhost:5173 once the frontend log shows 'ready'.")
    print("Press Ctrl+C to stop both.\n")

    try:
        while True:
            if backend_proc.poll() is not None:
                print(f"[backend] exited with code {backend_proc.returncode}")
                shutdown()
            if frontend_proc.poll() is not None:
                print(f"[frontend] exited with code {frontend_proc.returncode}")
                shutdown()
            for t in threads:
                t.join(timeout=0.5)
                if not t.is_alive():
                    pass
            if not any(t.is_alive() for t in threads):
                break
    except KeyboardInterrupt:
        shutdown()


if __name__ == "__main__":
    main()
