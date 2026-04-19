@echo off
setlocal enableextensions enabledelayedexpansion
cd /d "%~dp0"

echo ================================================
echo   Mahu Agent Builder
echo ================================================
echo.

where python >nul 2>&1
if errorlevel 1 goto nopython

python -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)" >nul 2>&1
if errorlevel 1 goto badversion

echo "%~dp0" | findstr /R /C:"[^ -~]" >nul
if not errorlevel 1 (
  echo [WARN] Current path contains non-ASCII characters:
  echo        %~dp0
  echo        This can break some Python build tools.
  echo        Recommended: move this folder to a path with English only,
  echo        for example  C:\agent\
  echo.
  echo Press any key to continue anyway, or close this window to abort.
  pause >nul
)

:: ----------------------------------------------------------------------- ::
:: Detect requirements.txt change by hashing it and stashing the hash in   ::
:: .venv\.req-hash. If it differs, nuke .venv and install fresh.           ::
:: ----------------------------------------------------------------------- ::

set "REQ_HASH="
for /f "skip=1 tokens=* delims=" %%H in ('certutil -hashfile requirements.txt MD5') do (
  if not defined REQ_HASH set "REQ_HASH=%%H"
)
set "REQ_HASH=!REQ_HASH: =!"

set "HASH_FILE=.venv\.req-hash"
set "NEED_FRESH=0"

if not exist .venv set "NEED_FRESH=1"
if exist "!HASH_FILE!" (
  set /p OLD_HASH=<"!HASH_FILE!"
  if not "!OLD_HASH!"=="!REQ_HASH!" set "NEED_FRESH=1"
) else (
  if exist .venv set "NEED_FRESH=1"
)

if "!NEED_FRESH!"=="1" (
  if exist .venv (
    echo [1/4] requirements.txt changed - recreating virtual environment...
    rd /s /q .venv
  ) else (
    echo [1/4] Creating virtual environment...
  )
  python -m venv .venv
  if errorlevel 1 goto venvfail
) else (
  echo [1/4] Reusing existing virtual environment.
)

call .venv\Scripts\activate.bat

echo [2/4] Upgrading pip...
python -m pip install --upgrade pip wheel setuptools >nul

if "!NEED_FRESH!"=="1" (
  echo [3/4] Installing dependencies. First run takes 5-10 minutes.
  pip install --prefer-binary -r requirements.txt
  if errorlevel 1 goto depfail
  pip install pyinstaller >nul
  > "!HASH_FILE!" echo !REQ_HASH!
) else (
  echo [3/4] Dependencies already installed.
  pip show pyinstaller >nul 2>&1
  if errorlevel 1 pip install pyinstaller >nul
)

echo [4/4] Building executable... (5-10 minutes)
if exist build rd /s /q build
if exist dist rd /s /q dist
if exist mahu-agent.spec del mahu-agent.spec

pyinstaller --noconfirm --onefile --name mahu-agent --collect-all easyocr --collect-all torch --collect-submodules pyautogui agent.py
if errorlevel 1 goto buildfail

echo.
echo ================================================
echo  BUILD SUCCESS
echo ================================================
echo   Output: %cd%\dist\mahu-agent.exe
echo.
pause
exit /b 0

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
echo         Python 3.14+ has no pre-built wheels for numpy/torch/easyocr yet.
echo         Install 3.12 from https://www.python.org/downloads/release/python-3120/
echo         and make sure python --version shows 3.12.x.
pause
exit /b 1

:venvfail
echo [ERROR] Failed to create virtual environment.
pause
exit /b 1

:depfail
echo [ERROR] Failed to install dependencies. See messages above.
echo        If an error mentions UnicodeDecodeError or meson, move this
echo        folder to an ASCII-only path (e.g. C:\agent) and try again.
pause
exit /b 1

:buildfail
echo [ERROR] PyInstaller build failed. See messages above.
pause
exit /b 1
