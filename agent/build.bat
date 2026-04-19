@echo off
setlocal enableextensions
cd /d "%~dp0"

echo ================================================
echo   Mahu Agent Builder
echo ================================================
echo.

:: Python 확인
python --version >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python 이 설치되어 있지 않습니다.
  echo         https://www.python.org/downloads/ 에서 3.10 이상 설치 후
  echo         "Add to PATH" 체크박스를 꼭 선택하세요.
  pause
  exit /b 1
)

:: 가상환경 준비
if not exist .venv (
  echo [1/4] 가상환경 생성...
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] 가상환경 생성 실패.
    pause
    exit /b 1
  )
) else (
  echo [1/4] 기존 가상환경 사용.
)

call .venv\Scripts\activate.bat

echo [2/4] pip 업그레이드...
python -m pip install --upgrade pip wheel setuptools >nul

echo [3/4] 의존성 설치 (최초 1회는 수 분 소요)...
pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] 의존성 설치 실패.
  pause
  exit /b 1
)
pip install pyinstaller >nul

echo [4/4] 빌드 중...
if exist build rd /s /q build
if exist dist rd /s /q dist
if exist mahu-agent.spec del mahu-agent.spec

pyinstaller ^
  --noconfirm ^
  --onefile ^
  --name mahu-agent ^
  --collect-all easyocr ^
  --collect-submodules pyautogui ^
  agent.py
if errorlevel 1 (
  echo [ERROR] PyInstaller 빌드 실패.
  pause
  exit /b 1
)

echo.
echo ================================================
echo  BUILD SUCCESS
echo ================================================
echo   결과물: %cd%\dist\mahu-agent.exe
echo.
pause
