@echo off
setlocal enableextensions
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

if not exist .venv (
  echo [1/4] Creating virtual environment...
  python -m venv .venv
  if errorlevel 1 goto venvfail
) else (
  echo [1/4] Reusing existing virtual environment.
)

call .venv\Scripts\activate.bat

echo [2/4] Upgrading pip...
python -m pip install --upgrade pip wheel setuptools >nul

echo [3/4] Installing dependencies. First run takes several minutes.
pip install --only-binary=:all: -r requirements.txt
if errorlevel 1 (
  echo [WARN] wheel-only install failed. Retrying with source fallback...
  pip install -r requirements.txt
  if errorlevel 1 goto depfail
)
pip install pyinstaller >nul

echo [4/4] Building executable...
if exist build rd /s /q build
if exist dist rd /s /q dist
if exist mahu-agent.spec del mahu-agent.spec

pyinstaller --noconfirm --onefile --name mahu-agent --collect-all easyocr --collect-submodules pyautogui --exclude-module torch._dynamo --exclude-module torch._numpy --exclude-module torch.distributed --exclude-module torch.testing --exclude-module torch.onnx agent.py
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
