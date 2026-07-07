@echo off
REM Builds the local Python environment and installs Electron deps.
cd /d "%~dp0"

echo == YT Transcribe setup ==

where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo !! ffmpeg is required but not found.
  echo    Install it from https://www.gyan.dev/ffmpeg/builds/ and add it to PATH.
  exit /b 1
)

echo -- Building Python environment...
python -m venv python\.venv
call python\.venv\Scripts\activate.bat
python -m pip install --upgrade pip -q
pip install -r python\requirements.txt -q
call deactivate

echo -- Installing Electron...
call npm install

echo.
echo Setup complete.
echo   Run the app:      npm start
echo   Build installer:  npm run dist
