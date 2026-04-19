# 마후 에이전트 (Lineage Classic Slime Race Agent)

리니지 클래식 슬라임 경주 화면을 감시해서 **라인업**과 **우승 결과**를
서버에 자동 전송하는 Windows 전용 프로그램.

## 설치 & 실행 (권장 방식)

1. **Python 3.12**를 설치하세요.
   - [python.org/downloads/release/python-3120/](https://www.python.org/downloads/release/python-3120/)
   - 설치 화면에서 **"Add Python to PATH"** 체크박스를 켜야 합니다.
   - 설치 후 `cmd`에서 `python --version` → `Python 3.12.x` 나와야 OK.

2. 이 `agent/` 폴더를 **한글이 없는 경로**에 두세요 (예: `C:\agent`).

3. **`start.bat` 더블클릭**.
   - 처음 실행이면 `.venv` 가상환경을 만들고 패키지(torch, easyocr 등)를
     다운로드·설치합니다. 5~10분 소요.
   - 설치가 끝나면 자동으로 `agent.py`가 실행되면서 설정 창이 뜹니다.
4. 설정 창에 입력/지정:
   - **서버 URL** — 예: `https://lineage-slime-race.hsweb.pics`
   - **에이전트 토큰** — 사이트 `/admin` → "에이전트 설정" 패널에서 복사
   - **레인 1~5 위치** — 각 레인의 슬라임 출발 지점에 마우스를 올려놓고
     [3초 후 저장] 버튼을 순서대로 클릭 (1번 레인 = 좌하단)
   - **대화창 영역** — 마후 메시지가 나오는 채팅 영역을 드래그로 지정
5. [설정 저장] → 자동으로 감시 시작. 콘솔에 이벤트 로그가 찍힙니다.
6. 앞으로는 **`start.bat` 더블클릭**만 하면 저장된 설정으로 바로 감시 시작.

## 설정 다시 하기

- 같은 폴더의 **`config.json`** 파일 삭제 후 `start.bat` 재실행
- 또는 `start.bat --setup`

## 파일 설명

| 파일 | 용도 |
|-----|------|
| `start.bat` | **평소에 쓰는 실행 파일.** 처음 실행 시 자동 설치, 이후엔 바로 실행 |
| `agent.py` | 본체 스크립트 |
| `requirements.txt` | Python 패키지 버전 고정 |
| `config.json` | 저장된 설정 (자동 생성) |
| `agent.log` | 이벤트·에러 로그 (자동 생성) |
| `build.bat` | **선택 사항.** `.exe` 파일을 만들고 싶을 때만 사용. torch/easyocr 조합이 PyInstaller와 호환성 문제가 있어 권장하지 않음 |

## 동작 요약

- 1~2초마다 5개 레인의 **노란 슬라임**을 색상 체크.
- 슬라임이 나타나면 → 각 레인으로 마우스 이동 → 툴팁(`#번호 이름`) OCR →
  라인업을 서버에 `POST /api/races/ingest` (type: lineup).
- 대화창을 주기적으로 OCR → `마후: 제 N회 게임의 우승자는 "#M 이름" 입니다!`
  메시지가 잡히면 우승자 정보를 서버에 `POST /api/races/ingest` (type: winner).

## 문제 해결

- **Python이 설치되어 있지 않습니다** — python.org에서 3.12 설치 (PATH 추가 필수)
- **의존성 설치 실패** — 폴더 경로에 한글이 있는지 확인. 한글 없는 경로로 옮기고 재시도
- **라인업 OCR이 이상한 글자** — 해상도·자간에 따라 툴팁 폭이 달라짐.
  `config.json`을 텍스트 편집기로 열어 `tooltip_bbox` 값 조정
- **마후 메시지가 안 잡힘** — 대화창 영역이 마후 메시지가 나오는 줄을 포함하는지 확인.
  `config.json` 삭제 후 재설정
- **마우스가 다른 창으로 움직임** — 게임 창이 움직였을 때 좌표가 틀어짐.
  `config.json` 삭제 후 재설정
- **에러 발생 시** — 같은 폴더의 `agent.log` 마지막 부분 복사해서 개발자에게 전달
