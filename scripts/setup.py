#!/usr/bin/env python3
"""Cross-platform one-time project setup (macOS, Windows, Linux).

Usage:
    python scripts/setup.py          # macOS/Linux: python3 scripts/setup.py

What it does:
  1. Verifies the interpreter running this script is Python 3.10+ (the Azure
     SDK deps require it) and warns loudly if not, listing OS-specific fixes.
  2. Creates ./.venv if missing, using THIS interpreter (so whichever modern
     Python you invoked the script with becomes the backend's venv).
  3. Installs backend/requirements.txt into that venv.
  4. Copies .env.example -> .env if .env doesn't exist yet (never overwrites).
  5. Runs `npm install` in frontend/ if node_modules is missing.
  6. Regenerates backend/data/store_layout.json from convenience_store.glb.

Safe to re-run any time; every step is idempotent.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
VENV_DIR = REPO_ROOT / ".venv"
IS_WINDOWS = os.name == "nt"


def venv_python() -> Path:
    return VENV_DIR / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")


def run(cmd: list[str], **kwargs) -> None:
    print(f"$ {' '.join(str(c) for c in cmd)}")
    subprocess.run(cmd, check=True, cwd=kwargs.pop("cwd", REPO_ROOT), **kwargs)


def check_python_version() -> None:
    if sys.version_info < (3, 10):
        print(
            f"!! You're running Python {sys.version_info.major}.{sys.version_info.minor}, "
            "but backend dependencies (azure-ai-inference/azure-core) require Python 3.10+ "
            "(3.12 recommended).\n"
            "   macOS:   brew install python@3.12   then re-run: python3.12 scripts/setup.py\n"
            "   Windows: winget install Python.Python.3.12   (or download from python.org),\n"
            "            then re-run: py -3.12 scripts\\setup.py\n"
        )
        raise SystemExit(1)
    print(f"Using {sys.executable} (Python {sys.version.split()[0]}) - OK")


def ensure_venv() -> None:
    if venv_python().exists():
        print(f"Virtualenv already exists at {VENV_DIR}")
        return
    print(f"Creating virtualenv at {VENV_DIR} ...")
    run([sys.executable, "-m", "venv", str(VENV_DIR)])


def install_backend_deps() -> None:
    py = str(venv_python())
    run([py, "-m", "pip", "install", "--upgrade", "pip"])
    run([py, "-m", "pip", "install", "-r", str(REPO_ROOT / "backend" / "requirements.txt")])


def ensure_env_file() -> None:
    env_path = REPO_ROOT / ".env"
    example_path = REPO_ROOT / ".env.example"
    if env_path.exists():
        print(".env already exists - leaving it untouched")
        return
    shutil.copyfile(example_path, env_path)
    print(
        ".env created from .env.example - edit it and set a real LITE_LLM_API_KEY "
        "before using Agent Mode (manual navigation + eye tracking work without it)."
    )


def npm_executable() -> str:
    npm = shutil.which("npm")
    if npm is None:
        raise SystemExit(
            "npm not found on PATH. Install Node.js 18+ from https://nodejs.org "
            "(or via nvm / winget install OpenJS.NodeJS.LTS) and re-run this script."
        )
    return npm


def ensure_frontend_deps() -> None:
    # Always run `npm install` (it's fast/idempotent when already correct).
    # Never copy a node_modules/ folder between machines or OSes: native
    # optional deps (e.g. rollup/esbuild binaries) are platform-specific and
    # will crash Vite with a cryptic "Cannot find module @rollup/rollup-<arch>"
    # error if the folder was built on a different OS/CPU architecture.
    frontend_dir = REPO_ROOT / "frontend"
    run([npm_executable(), "install"], cwd=frontend_dir)


def regenerate_store_layout() -> None:
    py = str(venv_python())
    run([py, str(REPO_ROOT / "scripts" / "extract_store_layout.py")])


def main() -> None:
    print("=== Hackfest store walkthrough: setup ===")
    check_python_version()
    ensure_venv()
    install_backend_deps()
    ensure_env_file()
    ensure_frontend_deps()
    regenerate_store_layout()
    print(
        "\nSetup complete!\n"
        "  1. Edit .env and set a real LITE_LLM_API_KEY (ask a teammate) for Agent Mode.\n"
        "  2. Run: python scripts/dev.py   (starts backend :8000 + frontend :5173)\n"
        "  3. Open http://localhost:5173 in Chrome or Edge.\n"
    )


if __name__ == "__main__":
    main()
