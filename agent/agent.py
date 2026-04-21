"""
Mahu Agent — 리니지 클래식 슬라임 경주 자동 감지/전송 에이전트.

동작 요약:
  1. 저장된 5개 레인 좌표에서 "노란 슬라임" 색상이 감지되면 경기 시작으로 간주
  2. 각 레인 좌표로 마우스를 옮겨 툴팁이 뜨는 걸 OCR로 읽어 라인업을 수집
     → 서버로 POST (type: "lineup")
  3. 대화창 영역을 계속 OCR해서 `마후: … 우승자는 "#N 이름" 입니다!` 라인을 찾으면
     → 서버로 POST (type: "winner")
"""

from __future__ import annotations

import difflib
import hashlib
import json
import logging
import os
import re
import ssl
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Optional

# Windows Python은 시스템 인증서 저장소를 기본 참조하지 않아서
# urllib 기반 HTTPS 다운로드(easyocr 모델 등)가 SSL_CERT_VERIFY_FAILED로 실패함.
# certifi 번들을 기본 HTTPS 컨텍스트로 고정.
try:
    import certifi  # type: ignore

    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
    ssl._create_default_https_context = lambda *a, **kw: _SSL_CTX  # type: ignore[assignment]
    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
    os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
except Exception:
    pass

import tkinter as tk
from tkinter import messagebox

import numpy as np
import pyautogui
import requests
from PIL import Image, ImageEnhance, ImageFilter

# mss / easyocr / pyautogui는 import 시 초기화 비용이 있음.
# easyocr은 Agent 인스턴스 만들 때 한 번만 로드.
import mss


# --------------------------------------------------------------------------- #
# 설정 파일
# --------------------------------------------------------------------------- #

CONFIG_NAME = "config.json"


def config_path() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(sys.executable).parent
    else:
        base = Path(__file__).parent
    return base / CONFIG_NAME


def load_config() -> Optional[dict]:
    p = config_path()
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:
        return None


def save_config(cfg: dict) -> None:
    config_path().write_text(
        json.dumps(cfg, indent=2, ensure_ascii=False), "utf-8"
    )


DEFAULT_TOOLTIP_BBOX = {"dx": -220, "dy": -180, "w": 440, "h": 220}


# --------------------------------------------------------------------------- #
# Setup GUI — Tkinter
# --------------------------------------------------------------------------- #


class SetupWindow:
    def __init__(self, initial: Optional[dict] = None):
        self.result: Optional[dict] = None

        self.root = tk.Tk()
        self.root.title("Mahu Agent 설정")
        self.root.geometry("560x680")
        self.root.resizable(False, False)

        cfg = initial or {}

        body = tk.Frame(self.root, padx=18, pady=16)
        body.pack(fill="both", expand=True)

        tk.Label(
            body,
            text="Mahu Agent 설정",
            font=("", 14, "bold"),
        ).pack(anchor="w")
        tk.Label(
            body,
            text="서버 주소·토큰·레인 5개·대화창 영역을 지정하세요.",
            fg="#6b7280",
        ).pack(anchor="w", pady=(0, 12))

        # Server URL
        tk.Label(body, text="서버 URL").pack(anchor="w")
        self.server_var = tk.StringVar(value=cfg.get("server_url", ""))
        tk.Entry(body, textvariable=self.server_var).pack(fill="x", pady=(2, 10))

        # Token
        tk.Label(body, text="에이전트 토큰").pack(anchor="w")
        self.token_var = tk.StringVar(value=cfg.get("token", ""))
        tk.Entry(body, textvariable=self.token_var, show="•").pack(
            fill="x", pady=(2, 12)
        )

        # Lanes
        tk.Label(
            body, text="레인 위치 (1번 = 좌하단)", font=("", 10, "bold")
        ).pack(anchor="w")
        tk.Label(
            body,
            text="각 레인의 출발 지점에 마우스를 올리고 [3초 후 저장] 클릭",
            fg="#6b7280",
            font=("", 9),
        ).pack(anchor="w", pady=(0, 4))

        self.lane_vars: list[dict] = []
        self.lane_labels: list[tk.StringVar] = []
        existing_lanes = cfg.get("lanes") or [{} for _ in range(5)]
        for i in range(5):
            row = tk.Frame(body)
            row.pack(fill="x", pady=2)
            tk.Label(row, text=f"{i+1}번 레인", width=9, anchor="w").pack(
                side="left"
            )
            lv = existing_lanes[i] if i < len(existing_lanes) else {}
            self.lane_vars.append(dict(lv))
            sv = tk.StringVar(
                value=self._lane_repr(lv) if lv else "미지정"
            )
            self.lane_labels.append(sv)
            tk.Label(
                row, textvariable=sv, width=18, fg="#8b9aa8", anchor="w"
            ).pack(side="left")
            tk.Button(
                row,
                text="3초 후 저장",
                command=lambda idx=i: self._capture_lane(idx),
            ).pack(side="left")

        # Dialog area
        tk.Label(body, text="대화창 영역", font=("", 10, "bold")).pack(
            anchor="w", pady=(16, 0)
        )
        self.dialog = dict(cfg.get("dialog") or {}) or None
        self.dialog_label = tk.StringVar(value=self._dialog_repr())
        tk.Label(body, textvariable=self.dialog_label, fg="#8b9aa8").pack(
            anchor="w", pady=(2, 4)
        )
        tk.Button(
            body, text="드래그해서 영역 지정", command=self._capture_dialog
        ).pack(anchor="w")

        # Buttons
        footer = tk.Frame(body)
        footer.pack(side="bottom", fill="x", pady=(24, 0))
        tk.Button(footer, text="취소", command=self._cancel, width=10).pack(
            side="right", padx=(6, 0)
        )
        tk.Button(
            footer, text="저장", command=self._save, width=10
        ).pack(side="right")

    @staticmethod
    def _lane_repr(lv: dict) -> str:
        if not lv:
            return "미지정"
        return f"({lv.get('x')}, {lv.get('y')})"

    def _dialog_repr(self) -> str:
        if not self.dialog:
            return "미지정"
        d = self.dialog
        return f"x={d['x']}  y={d['y']}  w={d['w']}  h={d['h']}"

    def _capture_lane(self, idx: int) -> None:
        self.lane_labels[idx].set("3초 후...")

        def do():
            for remaining in (3, 2, 1):
                self.lane_labels[idx].set(f"{remaining}초 후...")
                time.sleep(1)
            pos = pyautogui.position()
            self.lane_vars[idx] = {"x": int(pos.x), "y": int(pos.y)}
            self.lane_labels[idx].set(self._lane_repr(self.lane_vars[idx]))

        threading.Thread(target=do, daemon=True).start()

    def _capture_dialog(self) -> None:
        self.root.withdraw()
        overlay = tk.Toplevel()
        overlay.attributes("-fullscreen", True)
        overlay.attributes("-alpha", 0.3)
        overlay.configure(bg="black")
        overlay.attributes("-topmost", True)

        canvas = tk.Canvas(
            overlay, cursor="cross", bg="black", highlightthickness=0
        )
        canvas.pack(fill="both", expand=True)

        state = {"start": None, "rect": None}

        def on_down(e):
            state["start"] = (e.x_root, e.y_root)
            if state["rect"]:
                canvas.delete(state["rect"])

        def on_move(e):
            if state["start"]:
                x0, y0 = state["start"]
                x1, y1 = e.x_root, e.y_root
                if state["rect"]:
                    canvas.delete(state["rect"])
                state["rect"] = canvas.create_rectangle(
                    min(x0, x1),
                    min(y0, y1),
                    max(x0, x1),
                    max(y0, y1),
                    outline="#fbbf24",
                    width=2,
                )

        def on_up(e):
            if not state["start"]:
                return
            x0, y0 = state["start"]
            x1, y1 = e.x_root, e.y_root
            w, h = abs(x1 - x0), abs(y1 - y0)
            if w < 10 or h < 10:
                overlay.destroy()
                self.root.deiconify()
                return
            self.dialog = {
                "x": int(min(x0, x1)),
                "y": int(min(y0, y1)),
                "w": int(w),
                "h": int(h),
            }
            self.dialog_label.set(self._dialog_repr())
            overlay.destroy()
            self.root.deiconify()

        canvas.bind("<Button-1>", on_down)
        canvas.bind("<B1-Motion>", on_move)
        canvas.bind("<ButtonRelease-1>", on_up)

        def cancel(e=None):
            overlay.destroy()
            self.root.deiconify()

        overlay.bind("<Escape>", cancel)

    def _save(self) -> None:
        url = self.server_var.get().strip().rstrip("/")
        token = self.token_var.get().strip()
        if not url:
            messagebox.showerror("오류", "서버 URL을 입력하세요.")
            return
        if not token:
            messagebox.showerror("오류", "토큰을 입력하세요.")
            return
        for i, lv in enumerate(self.lane_vars):
            if not lv or "x" not in lv or "y" not in lv:
                messagebox.showerror("오류", f"{i+1}번 레인 위치를 지정하세요.")
                return
        if not self.dialog:
            messagebox.showerror("오류", "대화창 영역을 드래그해서 지정하세요.")
            return

        self.result = {
            "server_url": url,
            "token": token,
            "lanes": self.lane_vars,
            "dialog": self.dialog,
            "poll_interval_sec": 1.5,
            "hover_wait_ms": 280,
            "tooltip_bbox": DEFAULT_TOOLTIP_BBOX,
        }
        self.root.destroy()

    def _cancel(self) -> None:
        self.result = None
        self.root.destroy()

    def run(self) -> Optional[dict]:
        self.root.mainloop()
        return self.result


# --------------------------------------------------------------------------- #
# Agent
# --------------------------------------------------------------------------- #


# 마후 우승 패턴. 접두(마후) 요구 안 함 — OCR이 '마루','마두' 등으로 흘려도 됨.
# 구조: "제 <회차>회" + '우X자' + (선택 # or 6 오탐) + 번호 + 이름 + '입X다'.
# 이름은 공백 포함 가능 ('캐논 보이', '엘븐 애로우' 등) — 입X다 앵커까지 lazy 캡처.
# 말미 '입X다' 앵커로 엉뚱한 '1 입배' 같은 걸 잡는 걸 방지.
MAHU_PATTERN = re.compile(
    r"제\s*(\d+)\s*회.*?우\S{0,2}자.*?[\"'“”]?\s*[#＃6@]?\s*(\d{1,4})\s+"
    r"(\S.*?)\s*[\"'“”]?\s*입\S{0,2}다"
)

# 아만 "경기 시작 N분전" — 접두(아만) 요구 없이 핵심 문구로만 매칭.
AMAN_PREMATCH_PATTERN = re.compile(
    r"경\S{0,2}\s*시\S{0,1}\s*작.*?(\d+)\s*분\s*전"
)

# 아만 "시작!" — 경기 본격 시작. 재시도 루프 중단 신호.
# "시작" 앞뒤에 흐릿한 문자 허용.
AMAN_START_PATTERN = re.compile(
    r"[:：]\s*시\s*작\s*[!！.\?:;]"
)

DEBUG_OCR = os.environ.get("AGENT_DEBUG_OCR", "").strip().lower() not in (
    "",
    "0",
    "false",
    "no",
)


def _preprocess_for_ocr(img: np.ndarray, scale: float = 3.0) -> np.ndarray:
    """작은 픽셀 글자를 OCR에 먹이기 전에 확대 + 대비/샤픈."""
    h, w = img.shape[:2]
    if h == 0 or w == 0:
        return img
    pil = Image.fromarray(img)
    pil = pil.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    pil = ImageEnhance.Contrast(pil).enhance(1.7)
    pil = ImageEnhance.Sharpness(pil).enhance(1.6)
    pil = pil.filter(ImageFilter.DETAIL)
    # 미세 노이즈 제거
    pil = pil.filter(ImageFilter.MedianFilter(3))
    return np.array(pil)


def _preprocess_binary(img: np.ndarray, scale: int = 5, threshold: int = 180) -> np.ndarray:
    """흰색(밝은) 글자만 남기고 이진화한 뒤 NEAREST 업스케일.
    게임 UI 텍스트처럼 배경 대비가 높은 밝은 글자에 효과적.
    threshold는 180으로 상향 → 흰색 계열 텍스트만 남기고 색있는 채팅·배경 제거.
    """
    h, w = img.shape[:2]
    if h == 0 or w == 0:
        return img
    if img.ndim == 3:
        # 최대 채널값 = 픽셀의 밝기 (흰색 계열일수록 크다)
        gray = img.max(axis=2)
    else:
        gray = img
    binary = np.where(gray > threshold, 255, 0).astype(np.uint8)
    pil = Image.fromarray(binary, mode="L").convert("RGB")
    pil = pil.resize((w * scale, h * scale), Image.NEAREST)
    return np.array(pil)


def _auto_crop_text(
    img: np.ndarray,
    bright_threshold: int = 200,
    min_cols: int = 5,
    merge_gap: int = 6,
) -> np.ndarray:
    """이미지에서 '최하단' 텍스트 밴드만 남기고 크롭.

    툴팁은 항상 cursor 바로 위(=캡처의 아래쪽)에 뜨므로, 상단의 Login 바,
    [진행자] 라벨, 캐릭터 이름 등 UI 텍스트 노이즈는 제외하고 가장 하단의
    텍스트 덩어리만 골라낸다.
    """
    h, w = img.shape[:2]
    if h == 0 or w == 0:
        return img
    gray = img.max(axis=2) if img.ndim == 3 else img
    bright = gray > bright_threshold

    row_counts = bright.sum(axis=1)
    has_text = row_counts >= min_cols

    # 연속된 밝은 row 를 밴드로 묶고, merge_gap 이하로 가까운 밴드는 합침
    bands: list[list[int]] = []
    start: Optional[int] = None
    for i, t in enumerate(has_text):
        if t and start is None:
            start = i
        elif not t and start is not None:
            bands.append([start, i - 1])
            start = None
    if start is not None:
        bands.append([start, len(has_text) - 1])

    if not bands:
        return img

    merged: list[list[int]] = [bands[0]]
    for band in bands[1:]:
        if band[0] - merged[-1][1] <= merge_gap:
            merged[-1][1] = band[1]
        else:
            merged.append(band)

    # 최하단 밴드 선택
    top, bottom = merged[-1]
    pad = 4
    top = max(0, top - pad)
    bottom = min(h, bottom + pad + 1)

    # 해당 밴드 내에서만 열(column) 범위 추출
    band_region = bright[top:bottom]
    col_counts = band_region.sum(axis=0)
    text_cols = np.where(col_counts >= 1)[0]
    if len(text_cols) == 0:
        return img[top:bottom, :]

    left = max(0, int(text_cols[0]) - pad)
    right = min(w, int(text_cols[-1]) + pad + 1)
    return img[top:bottom, left:right]


def _preprocess_grayscale(img: np.ndarray, scale: float = 5.0) -> np.ndarray:
    """채도 제거 + 강한 대비. 이진화가 너무 공격적일 때 중간 옵션."""
    h, w = img.shape[:2]
    if h == 0 or w == 0:
        return img
    pil = Image.fromarray(img).convert("L")  # grayscale
    pil = pil.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    pil = ImageEnhance.Contrast(pil).enhance(2.2)
    pil = ImageEnhance.Sharpness(pil).enhance(2.0)
    pil = pil.convert("RGB")
    return np.array(pil)


# EasyOCR detection 임계값. 기본보다 약간만 완화 (너무 낮추면 detection이
# 많아져서 오히려 느려짐).
OCR_DETECTION_KWARGS = {
    "text_threshold": 0.6,  # 기본 0.7
    "low_text": 0.35,  # 기본 0.4
    "contrast_ths": 0.08,  # 기본 0.1
}


# 슬라임 툴팁용 화이트리스트: 한글 음절 + 숫자 + '#' + 공백 + 영문 (영문 이름 슬라임 대비)
_TOOLTIP_ALLOWLIST = (
    "#0123456789 "
    + "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    + "".join(chr(i) for i in range(0xAC00, 0xD7A4))
)

# 공식 슬라임 로스터. OCR 결과 보정의 레퍼런스.
# 사용자 제공: 현재 운영 중인 슬라임 전체 목록.
CANONICAL_SLIMES: list[str] = [
    "슈팅스타",
    "세인트라이트",
    "엘븐애로우",
    "사이하",
    "라이트닝",
    "이븐스타",
    "펠컨",
    "호크윈드",
    "뷸렛",
    "가버너",
    "가디안",
    "글루디아",
    "레이디호크",
    "마이베이비",
    "마키아벨리",
    "슈퍼블랙",
    "영이글",
    "젤리피쉬",
    "캐논 보이",
    "펌블",
]

# 한글 자모 분해용
_CHOSUNG = list("ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ")
_JUNGSUNG = list("ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ")
_JONGSUNG = [""] + list("ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ")


def _to_jamo(s: str) -> str:
    """한글 음절을 초성+중성+종성 자모 문자열로 분해."""
    out = []
    for ch in s:
        code = ord(ch)
        if 0xAC00 <= code <= 0xD7A3:
            offset = code - 0xAC00
            out.append(_CHOSUNG[offset // 588])
            out.append(_JUNGSUNG[(offset % 588) // 28])
            jo = _JONGSUNG[offset % 28]
            if jo:
                out.append(jo)
        else:
            out.append(ch)
    return "".join(out)


def _debug_dir() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(sys.executable).parent
    else:
        base = Path(__file__).parent
    d = base / "debug"
    d.mkdir(exist_ok=True)
    return d


def _template_dir() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(sys.executable).parent
    else:
        base = Path(__file__).parent
    d = base / "templates"
    d.mkdir(exist_ok=True)
    return d


class Agent:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        # 인식률을 위해 최소값 강제
        self.cfg["hover_wait_ms"] = max(int(self.cfg.get("hover_wait_ms", 500)), 500)
        tb = self.cfg.get("tooltip_bbox", DEFAULT_TOOLTIP_BBOX)
        # 툴팁이 슬라임 바로 위에 떠서 bottom edge 에 걸쳐 글자 descender 가
        # 잘리는 문제 반복. 충분한 상하좌우 여유로 확장 + auto_crop 으로 깨끗하게
        # 추출. 440x220 보다 작으면 강제 업그레이드.
        if tb.get("w", 0) < 440 or tb.get("h", 0) < 220:
            self.cfg["tooltip_bbox"] = dict(DEFAULT_TOOLTIP_BBOX)
            print(
                f"[init] 툴팁 캡처 영역을 {self.cfg['tooltip_bbox']} 로 확장 (글씨 잘림 방지)"
            )

        print("[init] EasyOCR 로드 중... (최초 실행 시 모델 다운로드로 1~2분 소요)")
        import easyocr  # 지연 import

        # 툴팁·라인업 스캔용 리더
        self.reader = easyocr.Reader(["ko", "en"], gpu=False, verbose=False)
        # 대화창 전용 리더 (별도 인스턴스 → 메인 스레드와 완전 병행)
        print("[init] 대화창 전용 OCR 리더 추가 로드 중...")
        self.dialog_reader = easyocr.Reader(
            ["ko", "en"], gpu=False, verbose=False
        )
        self.sct = mss.mss()
        self.last_lineup_sig: Optional[str] = None
        # 최근 라인업을 서버에 보낸 시각. 짧은 간격(<3분)에 또 보내는 걸 방지.
        self.last_lineup_send_ts: Optional[float] = None
        # 우승자 dedup: 60초 윈도우 내에 같은 (번호, 보정된 이름)이
        # 재차 OCR로 잡혀도 한 번만 처리. 회차 번호는 OCR에 따라 585→535→585
        # 식으로 흔들리므로 dedup 키에서 제외.
        self.recent_winners: dict[str, float] = {}
        self.seen_lines: set[str] = set()
        # 실패한 레인 재시도를 위한 부분 라인업
        self.partial_lineup: dict[int, dict] = {}
        # 두 리더가 다르므로 락은 더 이상 필요 없음
        self._stop_event = threading.Event()
        self._dialog_thread: Optional[threading.Thread] = None
        # 아만이 "경기 시작 N분전" 외친 시각 → 메인 루프가 라인업 스캔 시작
        self.aman_trigger_ts: Optional[float] = None
        # 아만 "시작!" 감지 → 라인업 재시도 중단 신호
        self.race_started = False
        # OCR 오타 보정용 슬라임 이름 목록.
        # 기본은 CANONICAL_SLIMES (사용자가 준 공식 20마리), 서버에 추가 이름이 있으면 병합.
        self.known_slimes: list[str] = list(CANONICAL_SLIMES)
        self._fetch_known_slimes()
        print(f"[init] 보정 대상 슬라임 {len(self.known_slimes)}마리: {', '.join(self.known_slimes[:10])}...")

        # 템플릿 자동 수집 상태 보고.
        # auto-crop 으로 저장된 최신 템플릿은 폭·높이가 텍스트에 딱 맞아 비교적
        # 작음(대략 250x40 이내). 그보다 크면 예전의 잘린/원본 bbox 그대로
        # 저장된 파일이므로 삭제하고 재수집.
        tdir = _template_dir()
        removed = 0
        for p in list(tdir.glob("*.png")):
            try:
                with Image.open(p) as im:
                    if im.size[0] > 260 or im.size[1] > 70:
                        p.unlink()
                        removed += 1
            except Exception:
                p.unlink(missing_ok=True)
                removed += 1
        if removed:
            print(
                f"[init] 과거 잘린 템플릿 {removed}장 삭제, 재수집 예정"
            )
        saved_templates = {p.stem for p in tdir.glob("*.png")}
        missing = [
            s for s in CANONICAL_SLIMES
            if re.sub(r"\s+", "", s) not in saved_templates
        ]
        print(
            f"[init] 슬라임 템플릿 {len(saved_templates)}/{len(CANONICAL_SLIMES)} 수집됨 → {tdir}"
        )
        if missing:
            print(f"       아직 수집 안 된 슬라임: {', '.join(missing)}")
        else:
            print("       모든 슬라임 템플릿 수집 완료. 이 폴더 zip 으로 개발자에게 전달.")

        if DEBUG_OCR:
            print(f"[init] AGENT_DEBUG_OCR 켜짐. 캡처 결과를 {_debug_dir()} 에 저장합니다.")
        print("[init] 준비 완료.")

    def _fetch_known_slimes(self) -> None:
        """서버에 있는 슬라임 이름도 병합 (공식 리스트에 없는 새 이름 대비)."""
        try:
            r = requests.get(
                f"{self.cfg['server_url']}/api/races/slime-names",
                timeout=5,
            )
            if not r.ok:
                return
            server_names = r.json().get("names", []) or []
            canonical = set(self.known_slimes)
            extras: list[str] = []
            for name in server_names:
                if not name or name in canonical:
                    continue
                # 2글자 미만 or 특수문자 덩어리는 이전 OCR 쓰레기일 가능성 높음. 제외.
                if len(name) < 2 or not re.search(r"[가-힣]", name):
                    continue
                extras.append(name)
            if extras:
                self.known_slimes.extend(extras)
        except Exception as e:
            print(f"[warn] 서버 슬라임 이름 병합 실패: {e}")

    def _correct_name(self, raw: str) -> Optional[str]:
        """EasyOCR 결과를 알려진 슬라임 이름과 가장 가까운 값으로 보정.
        매칭 없으면 None 반환.

        핵심 규칙: 첫 음절 자모 유사도 >= 0.4 인 후보만 고려.
        예: '주텍스타'(ㅈㅜ...) vs '슈팅스타'(ㅅㅠ...) — 첫 음절 자모가 전혀
        달라 ratio 0. 후보에서 제외됨. '셰'(ㅅㅖ) vs '세'(ㅅㅔ)는 ratio 0.5
        라 통과. 슈팅↔이븐 같은 끝이 같은 이름끼리의 swap을 막음.
        """
        if not raw or not self.known_slimes:
            return None

        norm_raw = re.sub(r"\s+", "", raw)
        norm_map = {re.sub(r"\s+", "", s): s for s in self.known_slimes}
        norm_keys = list(norm_map.keys())

        if norm_raw in norm_map:
            best = norm_map[norm_raw]
            if best != raw:
                print(f"      [autocorrect] '{raw}' → '{best}'")
            return best

        if not norm_raw:
            return None

        # 첫 음절 자모 유사도 >= 0.3 인 후보만 남김.
        # 0.3 은 "평(ㅍㅕㅇ) vs 펌(ㅍㅓㅁ) = 0.33" 같은 경미한 변형 허용, 반면
        # "주(ㅈㅜ) vs 슈(ㅅㅠ) = 0" 처럼 첫 자음+모음 완전 다른 건 차단.
        raw_first_jamo = _to_jamo(norm_raw[0])
        eligible: list[str] = []
        for k in norm_keys:
            if not k:
                continue
            cand_first_jamo = _to_jamo(k[0])
            r = difflib.SequenceMatcher(
                None, raw_first_jamo, cand_first_jamo
            ).ratio()
            if r >= 0.3:
                eligible.append(k)
        if not eligible:
            return None

        # 1차: 음절 레벨 (eligible 내에서만)
        matches = difflib.get_close_matches(
            norm_raw, eligible, n=1, cutoff=0.35
        )
        if matches:
            best = norm_map[matches[0]]
            if best != raw:
                print(f"      [autocorrect:syl] '{raw}' → '{best}'")
            return best

        # 2차: 자모 레벨 (eligible 내에서만)
        raw_jamo = _to_jamo(norm_raw)
        best_key = None
        best_ratio = 0.0
        for key in eligible:
            r = difflib.SequenceMatcher(
                None, raw_jamo, _to_jamo(key)
            ).ratio()
            if r > best_ratio:
                best_ratio = r
                best_key = key
        if best_key and best_ratio >= 0.5:
            best = norm_map[best_key]
            print(
                f"      [autocorrect:jamo] '{raw}' → '{best}' (ratio={best_ratio:.2f})"
            )
            return best

        return None

    def _save_template(self, slime_name: str, img: np.ndarray, raw_name: str) -> None:
        """인식 성공률이 높은 케이스만 원본 툴팁 이미지를 템플릿으로 저장.
        나중에 개발자에게 templates/ 폴더 통째로 보내면 template matching 가능.

        저장 조건:
          - canonical 매칭된 이름과 raw OCR 이름의 유사도가 높아야 함
            (syllable ratio >= 0.75) → 노이즈 템플릿 방지.
          - 해당 슬라임 템플릿이 아직 없을 때만 저장 (최초 한 번).
        """
        if not slime_name:
            return
        norm_canon = re.sub(r"\s+", "", slime_name)
        norm_raw = re.sub(r"\s+", "", raw_name)
        if not norm_raw:
            return
        ratio = difflib.SequenceMatcher(None, norm_raw, norm_canon).ratio()
        if ratio < 0.75 and norm_raw != norm_canon:
            return  # OCR 결과가 너무 달라 템플릿으로 신뢰 불가
        path = _template_dir() / f"{norm_canon}.png"
        if path.exists():
            return  # 이미 템플릿 보유
        try:
            cropped = _auto_crop_text(img)
            Image.fromarray(cropped).save(path)
            print(
                f"      [template] '{slime_name}' 템플릿 저장됨 → {path.name} "
                f"({cropped.shape[1]}x{cropped.shape[0]})"
            )
        except Exception as e:
            print(f"      [template save error] {e}")

    def _dbg_save(self, name: str, img: np.ndarray, text: str = "") -> None:
        if not DEBUG_OCR:
            return
        try:
            ts = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
            Image.fromarray(img).save(_debug_dir() / f"{ts}_{name}.png")
            if text:
                (_debug_dir() / f"{ts}_{name}.txt").write_text(text, encoding="utf-8")
        except Exception:
            pass

    # ----- 색상 감지 ------------------------------------------------------ #

    @staticmethod
    def _is_slime_color(rgb: np.ndarray) -> bool:
        """노란/황갈색 슬라임 색 대략 판별."""
        r, g, b = float(rgb[0]), float(rgb[1]), float(rgb[2])
        if r < 130 or g < 100:
            return False
        if r < b + 20 or g < b:
            return False
        return True

    def _grab_rgb(self, left: int, top: int, width: int, height: int) -> np.ndarray:
        shot = self.sct.grab(
            {"left": left, "top": top, "width": width, "height": height}
        )
        arr = np.array(shot)  # BGRA
        return arr[:, :, [2, 1, 0]]  # BGR -> RGB

    def _lane_has_slime(self, lane: dict) -> bool:
        x, y = lane["x"], lane["y"]
        rgb = self._grab_rgb(x - 3, y - 3, 7, 7)
        avg = rgb.reshape(-1, 3).mean(axis=0)
        return self._is_slime_color(avg)

    def _any_lane_has_slime(self) -> bool:
        return any(self._lane_has_slime(l) for l in self.cfg["lanes"])

    # ----- 라인업 스캔 ---------------------------------------------------- #

    def _ocr(
        self,
        img: np.ndarray,
        tag: str = "",
        scale: float = 3.0,
        allowlist: Optional[str] = None,
        preprocess: str = "normal",
        decoder: str = "greedy",
    ) -> str:
        if preprocess == "binary":
            processed = _preprocess_binary(img, scale=int(scale))
        elif preprocess == "grayscale":
            processed = _preprocess_grayscale(img, scale=scale)
        else:
            processed = _preprocess_for_ocr(img, scale=scale)
        kwargs: dict = {
            "detail": 0,
            "paragraph": True,
            "decoder": decoder,
            **OCR_DETECTION_KWARGS,
        }
        if allowlist:
            kwargs["allowlist"] = allowlist
        try:
            lines = self.reader.readtext(processed, **kwargs)
        except Exception as e:
            print(f"  [ocr error] {e}")
            return ""
        text = " ".join(l.strip() for l in lines if l).strip()
        if DEBUG_OCR and tag:
            self._dbg_save(f"{tag}-raw", img)
            self._dbg_save(f"{tag}-proc-{preprocess}", processed, text)
        return text

    def _parse_tooltip(self, text: str) -> tuple[Optional[int], str]:
        t = text.replace("＃", "#").strip()
        # 앞쪽 '6' 또는 '@' + 숫자 → '#' 오탐 복구 (#14 → 614 같은 경우)
        t = re.sub(r"^\s*[6@8]\s*(\d)", r"#\1", t)
        # 중간 공백 정규화
        t = re.sub(r"\s+", " ", t)

        # 1) "#숫자 이름" (가장 일반적) — 이름은 최대 두 단어까지
        m = re.search(r"#\s*(\d{1,4})\s*[.,:]?\s*(\S+(?:\s+\S+)?)", t)
        if m:
            return int(m.group(1)), m.group(2).strip()

        # 2) 앞쪽에 잡음 글자(D, U, O 등) + 숫자 + 이름
        #    예: "3D 라이트님", "8 O0 라이트님", "사만8 O0 라이트님"
        m = re.search(r"(\d{1,4})\D{0,3}\s+(\S{2,}(?:\s+\S+)?)", t)
        if m:
            num = int(m.group(1))
            name = m.group(2).strip()
            # 이름 선두의 단발 영문/특수문자 잡음 제거
            name = re.sub(r"^[^\uAC00-\uD7A3a-zA-Z]+", "", name).strip()
            if name and len(name) >= 2:
                return num, name
        return None, t.strip()

    def _try_tooltip_ocr(
        self, img: np.ndarray, tag: str, preprocess: str, decoder: str
    ) -> tuple[Optional[int], str, Optional[str], str]:
        """한 번의 OCR 시도. (num, raw_name, corrected_or_None, raw_text) 반환."""
        # 배경 노이즈 제거: 텍스트(밝은 픽셀) 영역만 남김
        cropped = _auto_crop_text(img)
        text = self._ocr(
            cropped,
            tag=tag,
            scale=5,
            allowlist=_TOOLTIP_ALLOWLIST,
            preprocess=preprocess,
            decoder=decoder,
        )
        num, name = self._parse_tooltip(text)
        if num is None or not name or len(name) < 2:
            return None, name or "", None, text
        corrected = self._correct_name(name)
        return num, name, corrected, text

    def _scan_one_lane(self, lane_no: int, lane: dict) -> Optional[dict]:
        tb = self.cfg.get("tooltip_bbox", DEFAULT_TOOLTIP_BBOX)
        hover_ms = self.cfg.get("hover_wait_ms", 280)
        pyautogui.moveTo(lane["x"], lane["y"], duration=0.08)
        time.sleep(hover_ms / 1000)
        img = self._grab_rgb(
            lane["x"] + tb["dx"],
            lane["y"] + tb["dy"],
            tb["w"],
            tb["h"],
        )

        # 2단계 OCR 시도 (속도 우선):
        #   1) normal + greedy  (LANCZOS 업스케일 + 샤픈)
        #   2) binary + greedy  (흰색 이진화 fallback)
        # 각 시도가 canonical 매칭되면 즉시 채택.
        attempts = [
            ("normal", "greedy"),
            ("binary", "greedy"),
        ]
        last_num: Optional[int] = None
        last_name: str = ""
        last_text: str = ""
        for pre, dec in attempts:
            num, name, corrected, text = self._try_tooltip_ocr(
                img, f"lane{lane_no}-{pre}-{dec}", pre, dec
            )
            last_num, last_name, last_text = num, name, text
            if corrected is not None:
                print(
                    f"    레인{lane_no}: '{text}' → #{num} {name} [{pre}/{dec}] → {corrected}"
                )
                # 깨끗한 OCR 결과였으면 원본 툴팁 이미지를 템플릿으로 저장.
                # (첫 번째 시도가 성공한 경우 img는 원본 캡처 그대로.)
                self._save_template(corrected, img, name)
                return {"lane": lane_no, "slime": corrected, "number": num}

        # 모든 시도 실패
        if last_num is None:
            print(f"    레인{lane_no}: '{last_text}' → MISS")
        else:
            print(
                f"    레인{lane_no}: '{last_text}' → #{last_num} {last_name} [REJECTED - 로스터 외]"
            )
        return None

    def _scan_missing_lanes(self) -> None:
        """partial_lineup에서 아직 채워지지 않은 레인만 재시도."""
        missing = [
            (i + 1, lane)
            for i, lane in enumerate(self.cfg["lanes"])
            if (i + 1) not in self.partial_lineup
        ]
        if not missing:
            return
        print(f"  [retry] 미채움 레인 {[m[0] for m in missing]} 재스캔")
        for lane_no, lane in missing:
            got = self._scan_one_lane(lane_no, lane)
            if got:
                self.partial_lineup[lane_no] = got
        pyautogui.moveTo(10, 10, duration=0.15)

    def _full_lineup_or_none(self) -> Optional[list[dict]]:
        if len(self.partial_lineup) < len(self.cfg["lanes"]):
            return None
        return [self.partial_lineup[i + 1] for i in range(len(self.cfg["lanes"]))]

    def _send_lineup(self, lanes: list[dict]) -> None:
        sig = json.dumps(lanes, ensure_ascii=False, sort_keys=True)
        if sig == self.last_lineup_sig:
            return
        self.last_lineup_sig = sig
        self.last_lineup_send_ts = time.time()
        # 에이전트 로컬 시각으로 date/time 명시 → 서버 TZ가 UTC여도 한국 시간 반영
        now = time.localtime()
        date_str = time.strftime("%Y-%m-%d", now)
        time_str = time.strftime("%H:%M", now)
        try:
            r = requests.post(
                f"{self.cfg['server_url']}/api/races/ingest",
                headers={
                    "Authorization": f"Bearer {self.cfg['token']}",
                    "Content-Type": "application/json",
                },
                json={
                    "type": "lineup",
                    "date": date_str,
                    "time": time_str,
                    "lanes": lanes,
                },
                timeout=10,
            )
            if r.ok:
                print(f"  ✓ 라인업 전송 완료: {r.json().get('action')}")
            else:
                print(f"  ✗ 라인업 실패 [{r.status_code}] {r.text[:200]}")
        except Exception as e:
            print(f"  ✗ 라인업 전송 에러: {e}")

    # ----- 대화창 스캔 ---------------------------------------------------- #

    def _grab_rgb_with(
        self, sct, left: int, top: int, width: int, height: int
    ) -> np.ndarray:
        shot = sct.grab(
            {"left": left, "top": top, "width": width, "height": height}
        )
        arr = np.array(shot)
        return arr[:, :, [2, 1, 0]]

    def _scan_dialog(self, sct=None) -> None:
        sct = sct or self.sct
        d = self.cfg["dialog"]
        img = self._grab_rgb_with(sct, d["x"], d["y"], d["w"], d["h"])
        # 대화창은 단일 빠른 패스 — latency가 중요하므로 greedy + 기본 전처리만
        processed = _preprocess_for_ocr(img, scale=1.6)
        try:
            lines = self.dialog_reader.readtext(
                processed,
                detail=0,
                paragraph=False,
                decoder="greedy",
                **OCR_DETECTION_KWARGS,
            )
        except Exception as e:
            print(f"  [dialog ocr error] {e}")
            return

        # 한 줄로 병합된 OCR 결과에서 마후 패턴도 찾을 수 있도록 join된 버전도 사용
        joined = " ".join(l.strip() for l in lines if l).strip()

        if DEBUG_OCR:
            self._dbg_save("dialog-raw", img, joined)

        new_lines = []
        for raw in lines:
            line = raw.strip()
            if not line:
                continue
            key = hashlib.md5(line.encode("utf-8")).hexdigest()
            if key in self.seen_lines:
                continue
            self.seen_lines.add(key)
            new_lines.append(line)

        # 합친 전체 텍스트에서도 마후/아만 패턴 검색 (라인이 두 줄로 나뉘어 읽힐 때 대비)
        candidates = new_lines + [joined] if new_lines else []

        # 아만 사전 알림: 라인업 스캔 트리거
        for line in candidates:
            m = AMAN_PREMATCH_PATTERN.search(line)
            if m:
                minutes = int(m.group(1))
                now = time.time()
                # trigger가 없거나, 5분 넘게 오래됐으면(이전 경기 것이 남아있을 수 있음)
                # 새로 설정. 즉 매 경기마다 fresh aman 알림은 항상 반영됨.
                stale = (
                    self.aman_trigger_ts is None
                    or now - self.aman_trigger_ts > 300
                )
                if stale:
                    print(
                        f"  [아만] 경기 시작 {minutes}분 전 알림 → 라인업 스캔 트리거"
                    )
                    self.aman_trigger_ts = now
                break

        # 아만 "시작!" — 라인업 재시도 중단 신호
        for line in candidates:
            if AMAN_START_PATTERN.search(line) and not self.race_started:
                print("  [아만] 시작! → 라인업 재시도 중단, 현재 값으로 확정")
                self.race_started = True
                break

        # 마후 우승 결과
        for line in candidates:
            m = MAHU_PATTERN.search(line)
            if m:
                round_no = int(m.group(1))
                num = int(m.group(2))
                name = m.group(3).strip()
                # 이름 양끝에 '-', ',', '.', 따옴표, 파이프 등 OCR 잡음 제거
                name = re.sub(r"^[-_\.\,\|\!\?\"'“”]+", "", name)
                name = re.sub(r"[-_\.\,\|\!\?\"'“”]+$", "", name)
                name = name.strip()
                self._handle_winner(round_no, num, name, line)
                # 우승 확정 후 상태 초기화 (다음 경기용)
                self.aman_trigger_ts = None
                self.race_started = False
                break

        # 매 스캔마다 OCR이 본 것을 항상 짧게 로그 (디버깅)
        if new_lines:
            print(f"  [dialog] {len(new_lines)}줄: {(' | '.join(new_lines))[:200]}")

        if len(self.seen_lines) > 300:
            self.seen_lines = set(list(self.seen_lines)[-150:])

    def _handle_winner(
        self, round_no: int, num: int, name: str, raw: str
    ) -> None:
        corrected_name = self._correct_name(name)
        if corrected_name is None:
            # 로스터에 없는 이름 → OCR 오판 또는 채팅 잡음. 전송 보류.
            print(f"      [winner] '{name}' 은 로스터 외 이름 — 전송 보류")
            return
        if corrected_name != name:
            print(f"      [winner autocorrect] '{name}' → '{corrected_name}'")

        # 60초 dedup: round 번호 + (번호,이름) 양쪽으로 중복 차단.
        # 같은 회차가 다시 잡히면 첫 결과만 유효.
        now = time.time()
        self.recent_winners = {
            k: t for k, t in self.recent_winners.items() if now - t < 60
        }
        round_key = f"r:{round_no}"
        name_key = f"n:{num}:{corrected_name}"
        if round_key in self.recent_winners or name_key in self.recent_winners:
            return
        self.recent_winners[round_key] = now
        self.recent_winners[name_key] = now

        print(f"  [마후] {round_no}회 우승: #{num} {corrected_name}")
        # 클라이언트 로컬 시간도 같이 전송 → 서버 TZ 무관하게 fallback race도 한국 시간 사용
        now_struct = time.localtime()
        date_str = time.strftime("%Y-%m-%d", now_struct)
        time_str = time.strftime("%H:%M", now_struct)
        try:
            r = requests.post(
                f"{self.cfg['server_url']}/api/races/ingest",
                headers={
                    "Authorization": f"Bearer {self.cfg['token']}",
                    "Content-Type": "application/json",
                },
                json={
                    "type": "winner",
                    "round": round_no,
                    "winnerNumber": num,
                    "winnerName": corrected_name,
                    "date": date_str,
                    "time": time_str,
                },
                timeout=10,
            )
            if r.ok:
                data = r.json()
                print(f"  ✓ 우승자 확정 → 레인 {data.get('matchedLane')}")
            else:
                print(f"  ✗ 우승자 실패 [{r.status_code}] {r.text[:200]}")
        except Exception as e:
            print(f"  ✗ 우승자 전송 에러: {e}")

    # ----- 메인 루프 ------------------------------------------------------ #

    def _dialog_loop(self) -> None:
        """대화창 OCR 전용 스레드. 0.3초 간격으로 계속 훑는다."""
        try:
            sct = mss.mss()
        except Exception as e:
            print(f"[dialog thread] mss 초기화 실패: {e}")
            return
        dialog_interval = float(self.cfg.get("dialog_interval_sec", 0.05))
        while not self._stop_event.is_set():
            try:
                self._scan_dialog(sct)
            except Exception as e:
                print(f"[dialog thread error] {e}")
            self._stop_event.wait(dialog_interval)

    def loop(self) -> None:
        interval = float(self.cfg.get("poll_interval_sec", 1.0))
        running = False
        lineup_sent = False
        last_aman_ts: Optional[float] = None

        # 대화창 OCR은 별도 스레드에서 계속 돌림 → 우승자 메시지 즉시 감지
        self._dialog_thread = threading.Thread(
            target=self._dialog_loop, daemon=True, name="dialog-ocr"
        )
        self._dialog_thread.start()
        print("[loop] 대화창 감시 스레드 시작 (0.3초 간격)")

        while True:
            try:
                has_slime = self._any_lane_has_slime()
                aman_ts = self.aman_trigger_ts

                # 새 아만 알림이 들어왔으면 (이전 경기 상태가 남아있더라도)
                # 강제로 상태를 리셋하고 이번 회차를 새로 스캔한다.
                # 단, 직전에 라인업을 보낸 지 3분이 안 됐으면 같은 경기로 간주해서
                # 재송신하지 않음 (같은 경기 라인업이 두 번 저장되는 것 방지).
                if aman_ts is not None and aman_ts != last_aman_ts:
                    recent_send = (
                        self.last_lineup_send_ts is not None
                        and time.time() - self.last_lineup_send_ts < 180
                    )
                    if recent_send:
                        # 같은 경기로 간주 — aman_ts만 동기화하고 상태는 유지
                        last_aman_ts = aman_ts
                        print(
                            f"[{time.strftime('%H:%M:%S')}] 새 아만 알림이지만 최근 라인업 전송 있음 → 같은 경기로 간주, 리셋 생략"
                        )
                    else:
                        if last_aman_ts is not None:
                            print(
                                f"[{time.strftime('%H:%M:%S')}] 새 아만 알림 감지 → 이전 상태 리셋, 라인업 재스캔"
                            )
                        last_aman_ts = aman_ts
                        running = False
                        lineup_sent = False
                        self.partial_lineup = {}
                        self.race_started = False

                # 아만 알림 이후 ~3분 동안은 "곧 경기" 상태로 간주
                aman_active = (
                    aman_ts is not None and (time.time() - aman_ts) < 180
                )
                # 트리거 또는 노란 슬라임 감지 → 스캔 상태로 전환
                should_scan = aman_active or has_slime

                if should_scan:
                    if not running:
                        source = "아만 알림" if aman_active else "노란 픽셀"
                        print(
                            f"[{time.strftime('%H:%M:%S')}] 경기 준비 감지 ({source}) → 라인업 스캔 시작"
                        )
                        running = True
                        self.partial_lineup = {}
                        lineup_sent = False
                        self.race_started = False

                    if not lineup_sent:
                        if self.race_started:
                            # 시작 신호가 왔으면 더 이상 호버해봤자 슬라임이 이동 중.
                            # 지금까지 수집한 것만 보냄 (부분 라인업).
                            partial = []
                            for i in range(len(self.cfg["lanes"])):
                                ln = i + 1
                                partial.append(
                                    self.partial_lineup.get(
                                        ln, {"lane": ln, "slime": "", "number": None}
                                    )
                                )
                            got = sorted(self.partial_lineup.keys())
                            print(f"  [force-send] 시작 신호 수신. 확보 레인 {got} 로 전송.")
                            self._send_lineup(partial)
                            lineup_sent = True
                        else:
                            # 아직 시작 전 → 미채움 레인만 재스캔
                            self._scan_missing_lanes()
                            full = self._full_lineup_or_none()
                            if full:
                                self._send_lineup(full)
                                lineup_sent = True
                elif running:
                    # 슬라임이 안 보이면 경기 종료. 부분 라인업이라도 한 번 보냄.
                    if not lineup_sent and self.partial_lineup:
                        print(
                            f"  [warn] 경기 종료 직전까지 레인 {sorted(self.partial_lineup.keys())}만 확보됨. 부분 라인업 전송."
                        )
                        partial = []
                        for i in range(len(self.cfg["lanes"])):
                            ln = i + 1
                            partial.append(
                                self.partial_lineup.get(
                                    ln, {"lane": ln, "slime": "", "number": None}
                                )
                            )
                        self._send_lineup(partial)
                        lineup_sent = True
                    print(f"[{time.strftime('%H:%M:%S')}] 경기 종료 감지 → 대기")
                    running = False
                    self.partial_lineup = {}
                    lineup_sent = False
                    self.race_started = False
                    # 다음 경기의 '1분전' 알림을 새로 받도록 trigger도 clear
                    self.aman_trigger_ts = None
                    # 다음 경기 대비: 알려진 슬라임 이름 갱신
                    self._fetch_known_slimes()
            except KeyboardInterrupt:
                print("\n중단 요청. 종료합니다.")
                self._stop_event.set()
                return
            except Exception as e:
                print(f"[loop error] {e}")

            # 슬라임 있을 땐 짧은 간격으로 계속 재시도(겹친 캐릭터 비켜날 때까지),
            # 없을 땐 긴 간격으로 CPU 아낌
            time.sleep(interval if not running else 0.6)


# --------------------------------------------------------------------------- #
# Entry
# --------------------------------------------------------------------------- #


def log_path() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(sys.executable).parent
    else:
        base = Path(__file__).parent
    return base / "agent.log"


def setup_logging() -> None:
    """파일과 콘솔 양쪽에 로그를 남겨서 창이 닫혀도 원인 추적 가능."""
    fmt = logging.Formatter(
        "%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S"
    )
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    # 파일
    try:
        fh = logging.FileHandler(log_path(), mode="a", encoding="utf-8")
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except Exception:
        pass
    # 콘솔 (기본 stdout)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(sh)


def _run() -> int:
    # Windows DPI 인식 (멀티모니터/스케일링 시 좌표 안 어긋나게)
    if sys.platform.startswith("win"):
        try:
            import ctypes

            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass

    pyautogui.FAILSAFE = True  # 좌상단 모서리로 마우스 던지면 중단
    pyautogui.PAUSE = 0.0

    force_setup = "--setup" in sys.argv
    cfg = None if force_setup else load_config()

    if cfg is None:
        print("첫 실행입니다. 설정 창을 엽니다.")
        win = SetupWindow(initial=load_config())
        cfg = win.run()
        if cfg is None:
            print("설정이 취소되었습니다.")
            return 1
        save_config(cfg)
        print("설정 저장 완료.")

    print("=" * 60)
    print("  Mahu Agent")
    print("=" * 60)
    print(f"서버: {cfg['server_url']}")
    print("레인 좌표:")
    for i, l in enumerate(cfg["lanes"]):
        print(f"  {i+1}번: ({l['x']}, {l['y']})")
    d = cfg["dialog"]
    print(f"대화창: x={d['x']} y={d['y']} w={d['w']} h={d['h']}")
    print(f"로그 파일: {log_path()}")
    print("=" * 60)
    print("창을 닫거나 Ctrl+C 로 종료됩니다.")
    print()

    agent = Agent(cfg)
    try:
        agent.loop()
    except KeyboardInterrupt:
        pass
    return 0


def main() -> int:
    setup_logging()
    try:
        return _run()
    except SystemExit:
        raise
    except KeyboardInterrupt:
        return 0
    except Exception:
        tb = traceback.format_exc()
        print("\n" + "=" * 60)
        print("UNHANDLED ERROR — 다음 내용을 개발자에게 보내주세요:")
        print("=" * 60)
        print(tb)
        try:
            with log_path().open("a", encoding="utf-8") as f:
                f.write("\n[FATAL " + time.strftime("%Y-%m-%d %H:%M:%S") + "]\n")
                f.write(tb)
        except Exception:
            pass
        print("=" * 60)
        print(f"전체 로그: {log_path()}")
        print()
        try:
            input("이 창을 닫으려면 Enter 를 누르세요...")
        except EOFError:
            time.sleep(30)
        return 1


if __name__ == "__main__":
    sys.exit(main())
