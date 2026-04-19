@echo off
setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"

title Mahu Agent

where python >nul 2>&1
if errorlevel 1 goto nopython

python -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)" >nul 2>&1
if errorlevel 1 goto badversion

set "REQ_HASH="
for /f "skip=1 tokens=* delims=" %%H in ('certutil -hashfile requirements.txt MD5') do (
  if not defined REQ_HASH set "REQ_HASH=%%H"
)
set "REQ_HASH=!REQ_HASH: =!"

set "HASH_FILE=.venv\.req-hash"
set "NEED_INSTALL=0"

if not exist .venv set "NEED_INSTALL=1"
if exist "!HASH_FILE!" (
  set /p OLD_HASH=<"!HASH_FILE!"
  if not "!OLD_HASH!"=="!REQ_HASH!" set "NEED_INSTALL=1"
) else (
  if exist .venv set "NEED_INSTALL=1"
)

if "!NEED_INSTALL!"=="1" (
  if exist .venv (
    echo Dependencies changed. Rebuilding virtual environment...
    rd /s /q .venv
  ) else (
    echo First run. Creating virtual environment...
  )
  python -m venv .venv
  if errorlevel 1 goto venvfail
  call .venv\Scripts\activate.bat
  echo Upgrading pip...
  python -m pip install --upgrade pip wheel setuptools >nul
  echo Installing dependencies. This takes 5-10 minutes on first run...
  pip install --prefer-binary -r requirements.txt
  if errorlevel 1 goto depfail
  > "!HASH_FILE!" echo !REQ_HASH!
  echo.
  echo Dependencies ready.
  echo.
) else (
  call .venv\Scripts\activate.bat
)

python agent.py %*
set EXITCODE=%ERRORLEVEL%

echo.
echo (Agent exited with code %EXITCODE%. Press any key to close this window.)
pause >nul
exit /b %EXITCODE%

:nopython
echo [ERROR] Python is not installed.
echo         Install Python 3.12 from https://www.python.org/downloads/
echo         and check "Add Python to PATH" during installation.
pause
exit /b 1

:badversion
echo [ERROR] Unsupported Python version.
python --version
echo         Supported: Python 3.10 - 3.13 (recommended: 3.12).
pause
exit /b 1

:venvfail
echo [ERROR] Failed to create virtual environment.
pause
exit /b 1

:depfail
echo [ERROR] Failed to install dependencies. See messages above.
pause
exit /b 1
