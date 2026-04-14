@echo off
SETLOCAL ENABLEDELAYEDEXPANSION
TITLE AI Hygiene Companion — One-Time Setup

echo.
echo  =====================================================
echo   AI Hygiene Companion — One-Time Setup
echo  =====================================================
echo.

:: ── 1. Check Python ──────────────────────────────────────────────────────
python --version >nul 2>&1
IF ERRORLEVEL 1 (
    echo  [ERROR] Python is not installed or not in PATH.
    echo.
    echo  Please install Python 3.10+ from: https://www.python.org/downloads/
    echo  Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

FOR /F "tokens=*" %%v IN ('python --version 2^>^&1') DO SET PY_VER=%%v
echo  [OK] %PY_VER% detected
echo.

:: ── 2. Install Python dependencies ───────────────────────────────────────
echo  [1/4] Installing Python dependencies...
echo        (This may take several minutes on first run)
echo.
pip install -r "%~dp0requirements.txt" --quiet
IF ERRORLEVEL 1 (
    echo.
    echo  [ERROR] pip install failed.
    echo  Possible causes:
    echo    - No internet connection
    echo    - pip is outdated (run: python -m pip install --upgrade pip)
    echo    - Conflicting packages
    echo.
    pause
    exit /b 1
)
echo  [OK] Dependencies installed
echo.

:: ── 3. Configure Native Messaging host path ───────────────────────────────
echo  [2/4] Configuring Native Messaging host...
set "HOST_PY=%~dp0host.py"
set "JSON_PATH=%~dp0com.ai_hygiene.json"

:: Use Python to do safe JSON editing (avoids batch escaping nightmares)
python -c ^
"import json, sys; ^
d = json.load(open(sys.argv[1])); ^
d['path'] = sys.argv[2]; ^
json.dump(d, open(sys.argv[1], 'w'), indent=2)" ^
"%JSON_PATH%" "%HOST_PY%"

IF ERRORLEVEL 1 (
    echo  [ERROR] Failed to update com.ai_hygiene.json
    pause
    exit /b 1
)
echo  [OK] host.py path set in manifest
echo.

:: ── 4. Register Windows Registry key ─────────────────────────────────────
echo  [3/4] Registering with Chrome (Windows Registry)...
REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ai_hygiene" ^
    /ve /t REG_SZ /d "%JSON_PATH%" /f >nul

IF ERRORLEVEL 1 (
    echo  [ERROR] Registry write failed. Try running as Administrator.
    pause
    exit /b 1
)
echo  [OK] Registry key written
echo.

:: ── 5. Prompt for Extension ID ───────────────────────────────────────────
echo  [4/4] Final step — Extension ID
echo.
echo  You need to enter your Chrome Extension ID so the backend bridge
echo  knows which extension is allowed to connect.
echo.
echo  To find your Extension ID:
echo    1. Open Chrome and go to: chrome://extensions
echo    2. Enable "Developer Mode" (top-right toggle)
echo    3. Find "AI Hygiene Companion" and copy the ID shown below it
echo       (looks like: abcdefghijklmnopqrstuvwxyz123456)
echo.
set /p EXT_ID="  Paste Extension ID here: "

IF "!EXT_ID!"=="" (
    echo.
    echo  [SKIP] No Extension ID entered. You can edit com.ai_hygiene.json manually later.
    echo         Replace EXTENSION_ID_PLACEHOLDER with your actual Extension ID.
) ELSE (
    python -c ^
"import json, sys; ^
d = json.load(open(sys.argv[1])); ^
d['allowed_origins'] = ['chrome-extension://' + sys.argv[2] + '/']; ^
json.dump(d, open(sys.argv[1], 'w'), indent=2)" ^
"%JSON_PATH%" "!EXT_ID!"

    IF ERRORLEVEL 1 (
        echo  [ERROR] Failed to write Extension ID to manifest.
    ) ELSE (
        echo  [OK] Extension ID saved
    )
)

echo.
echo  =====================================================
echo   Setup Complete!
echo  =====================================================
echo.
echo  Next steps:
echo    1. Open Chrome → chrome://extensions
echo    2. Find "AI Hygiene Companion" → click "Reload"
echo    3. The backend will auto-start in a new terminal window
echo    4. Wait ~60 seconds for all 7 models to load
echo.
echo  The terminal window shows:
echo    - Live NPU/GPU load bar
echo    - Model loading status (7 models, ~400 MB total)
echo    - Inference activity in real-time
echo.
pause
