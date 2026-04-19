@echo off
setlocal enableextensions
cd /d "%~dp0"

echo ================================================
echo   Mahu Agent Builder
echo ================================================
echo.

where python >nul 2>&1
if errorlevel 1 goto nopython

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
pip install -r requirements.txt
if errorlevel 1 goto depfail
pip install pyinstaller >nul

echo [4/4] Building executable...
if exist build rd /s /q build
if exist dist rd /s /q dist
if exist mahu-agent.spec del mahu-agent.spec

pyinstaller --noconfirm --onefile --name mahu-agent --collect-all easyocr --collect-submodules pyautogui agent.py
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
echo [ERROR] Python 3.10 or higher is not installed.
echo         Install from https://www.python.org/downloads/
echo         Check "Add Python to PATH" during installation.
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

:buildfail
echo [ERROR] PyInstaller build failed. See messages above.
pause
exit /b 1
