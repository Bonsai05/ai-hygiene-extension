@echo off
setlocal

echo === AI Hygiene Backend Setup ===
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found in PATH.
  pause
  exit /b 1
)

set API_DIR=%~dp0
set HOST_PATH=%API_DIR%host.cmd
set MANIFEST_PATH=%API_DIR%com.ai_hygiene.json

echo [1/4] Installing backend dependencies...
python -m pip install -r "%API_DIR%requirements.txt"
if errorlevel 1 (
  echo Failed to install Python dependencies.
  pause
  exit /b 1
)

echo [2/4] Detecting extension id...
set EXT_ID=
for /f "delims=" %%i in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "$m=Get-Content -Raw '%API_DIR%..\dist\manifest.json' | ConvertFrom-Json; if($m.key){ $k=[Convert]::FromBase64String($m.key); $sha=[System.Security.Cryptography.SHA256]::Create().ComputeHash($k); ($sha | ForEach-Object { [char](97 + ($_ -band 15)) }) -join '' }"') do set EXT_ID=%%i

if "%EXT_ID%"=="" (
  echo Could not compute extension id from manifest key.
  set /p EXT_ID=Please paste your extension ID from chrome://extensions: 
)

echo [3/4] Writing native host manifest...
python -c "import json,sys; p=sys.argv[1]; host=sys.argv[2].replace('\\','\\\\'); ext=sys.argv[3]; d=json.load(open(p,'r',encoding='utf-8')); d['path']=host; d['allowed_origins']=[f'chrome-extension://{ext}/']; json.dump(d,open(p,'w',encoding='utf-8'),indent=2)" "%MANIFEST_PATH%" "%HOST_PATH%" "%EXT_ID%"

echo [4/4] Registering Native Messaging host...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ai_hygiene" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul

echo.
echo Setup complete. Reload the unpacked extension.
pause
