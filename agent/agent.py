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


DEFAULT_TOOLTIP_BBOX = {"dx": -90, "dy": -55, "w": 180, "h": 40}


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


# 마후 라인 패턴. OCR이 글자를 흘려도 "마X" + 숫자 + "회" + 우승/씌스/승자 + 번호 + 이름 순서만 맞으면 매칭.
MAHU_PATTERN = re.compile(
    r"마\S{0,2}\s*[:：]?.*?제\s*(\d+)\s*회.*?(?:우승|우{1,2}승|승자).*?[#＃]?\s*(\d+)\s+([^\s\"'“”]+)"
)

# 아만 사전 알림 패턴. "아만: 경기 시작 N분전" 스타일.
# OCR이 "아만" 일부를 놓치거나 "경기" 위치가 흔들려도 잡도록 관대하게.
AMAN_PREMATCH_PATTERN = re.compile(
    r"아\S{0,2}\s*[:：]?.*?경\S*\s*시작.*?(\d+)\s*분\s*전"
)
# "아만: 시작!" 본격 시작 신호
AMAN_START_PATTERN = re.compile(
    r"아\S{0,2}\s*[:：]?\s*시\s*작\s*[!！.]?"
)

DEBUG_OCR = os.environ.get("AGENT_DEBUG_OCR", "").strip().lower() not in (
    "",
    "0",
    "false",
    "no",
)


def _preprocess_for_ocr(img: np.ndarray, scale: int = 3) -> np.ndarray:
    """작은 픽셀 글자를 OCR에 먹이기 전에 확대 + 대비/샤픈."""
    h, w = img.shape[:2]
    if h == 0 or w == 0:
        return img
    pil = Image.fromarray(img)
    pil = pil.resize((w * scale, h * scale), Image.LANCZOS)
    pil = ImageEnhance.Contrast(pil).enhance(1.7)
    pil = ImageEnhance.Sharpness(pil).enhance(1.6)
    pil = pil.filter(ImageFilter.DETAIL)
    return np.array(pil)


def _debug_dir() -> Path:
    if getattr(sys, "frozen", False):
        base = Path(sys.executable).parent
    else:
        base = Path(__file__).parent
    d = base / "debug"
    d.mkdir(exist_ok=True)
    return d


class Agent:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        # 인식률을 위해 최소값 강제
        self.cfg["hover_wait_ms"] = max(int(self.cfg.get("hover_wait_ms", 500)), 500)
        tb = self.cfg.get("tooltip_bbox", DEFAULT_TOOLTIP_BBOX)
        if tb.get("w", 0) < 220 or tb.get("h", 0) < 48:
            self.cfg["tooltip_bbox"] = {"dx": -110, "dy": -60, "w": 220, "h": 50}

        print("[init] EasyOCR 로드 중... (최초 실행 시 모델 다운로드로 1~2분 소요)")
        import easyocr  # 지연 import

        self.reader = easyocr.Reader(["ko", "en"], gpu=False, verbose=False)
        self.sct = mss.mss()
        self.last_lineup_sig: Optional[str] = None
        self.last_winner_key: Optional[str] = None
        self.seen_lines: set[str] = set()
        # 실패한 레인 재시도를 위한 부분 라인업
        self.partial_lineup: dict[int, dict] = {}
        # 스레드 안전: 읽기는 한 번에 한 스레드만
        self._ocr_lock = threading.Lock()
        self._stop_event = threading.Event()
        self._dialog_thread: Optional[threading.Thread] = None
        # 아만이 "경기 시작 N분전" 외친 시각 → 메인 루프가 라인업 스캔 시작
        self.aman_trigger_ts: Optional[float] = None
        # 서버에 있는 알려진 슬라임 이름 목록 (OCR 오타 보정용)
        self.known_slimes: list[str] = []
        self._fetch_known_slimes()

        if DEBUG_OCR:
            print(f"[init] AGENT_DEBUG_OCR 켜짐. 캡처 결과를 {_debug_dir()} 에 저장합니다.")
        print("[init] 준비 완료.")

    def _fetch_known_slimes(self) -> None:
        try:
            r = requests.get(
                f"{self.cfg['server_url']}/api/races/slime-names",
                timeout=5,
            )
            if r.ok:
                self.known_slimes = r.json().get("names", []) or []
                print(
                    f"[init] 서버에서 알려진 슬라임 {len(self.known_slimes)}마리 로드"
                )
        except Exception as e:
            print(f"[warn] 슬라임 이름 목록 로드 실패: {e}")

    def _correct_name(self, raw: str) -> str:
        """EasyOCR 결과를 알려진 슬라임 이름과 가장 가까운 값으로 보정."""
        if not raw or not self.known_slimes:
            return raw
        # cutoff 0.5 = 반절 정도 유사하면 매칭. 너무 낮추면 오매칭 위험.
        matches = difflib.get_close_matches(
            raw, self.known_slimes, n=1, cutoff=0.5
        )
        if not matches:
            return raw
        best = matches[0]
        if best != raw:
            print(f"      [autocorrect] '{raw}' → '{best}'")
        return best

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

    def _ocr(self, img: np.ndarray, tag: str = "", scale: int = 3) -> str:
        processed = _preprocess_for_ocr(img, scale=scale)
        try:
            with self._ocr_lock:
                lines = self.reader.readtext(
                    processed, detail=0, paragraph=True
                )
        except Exception as e:
            print(f"  [ocr error] {e}")
            return ""
        text = " ".join(l.strip() for l in lines if l).strip()
        if DEBUG_OCR and tag:
            self._dbg_save(f"{tag}-raw", img)
            self._dbg_save(f"{tag}-proc", processed, text)
        return text

    def _parse_tooltip(self, text: str) -> tuple[Optional[int], str]:
        t = text.replace("#", "# ").replace("＃", "# ")
        m = re.search(r"#\s*(\d+)\s*[.,]?\s*([^\s#]+)", t)
        if m:
            return int(m.group(1)), m.group(2).strip()
        m2 = re.search(r"(\d+)\s+([^\s#]+)", t)
        if m2:
            return int(m2.group(1)), m2.group(2).strip()
        return None, t.strip()

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
        text = self._ocr(img, tag=f"lane{lane_no}")
        num, name = self._parse_tooltip(text)
        ok = num is not None and name and len(name) >= 2
        status = "OK" if ok else "MISS"
        print(f"    레인{lane_no}: '{text}' → #{num} {name} [{status}]")
        if not ok:
            return None
        corrected = self._correct_name(name)
        return {"lane": lane_no, "slime": corrected, "number": num}

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
        try:
            r = requests.post(
                f"{self.cfg['server_url']}/api/races/ingest",
                headers={
                    "Authorization": f"Bearer {self.cfg['token']}",
                    "Content-Type": "application/json",
                },
                json={"type": "lineup", "lanes": lanes},
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
        processed = _preprocess_for_ocr(img, scale=2)
        try:
            with self._ocr_lock:
                lines = self.reader.readtext(
                    processed, detail=0, paragraph=False
                )
        except Exception as e:
            print(f"  [dialog ocr error] {e}")
            return

        # 한 줄로 병합된 OCR 결과에서 마후 패턴도 찾을 수 있도록 join된 버전도 사용
        joined = " ".join(l.strip() for l in lines if l).strip()

        if DEBUG_OCR:
            self._dbg_save("dialog-raw", img)
            self._dbg_save("dialog-proc", processed, joined)

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
                if self.aman_trigger_ts is None:
                    print(f"  [아만] 경기 시작 {minutes}분 전 알림 → 라인업 스캔 트리거")
                    self.aman_trigger_ts = time.time()
                break

        # 마후 우승 결과
        for line in candidates:
            m = MAHU_PATTERN.search(line)
            if m:
                round_no = int(m.group(1))
                num = int(m.group(2))
                name = m.group(3).strip()
                self._handle_winner(round_no, num, name, line)
                # 우승 확정 후 트리거 초기화 (다음 경기용)
                self.aman_trigger_ts = None
                break

        # 매 스캔마다 OCR이 본 것을 항상 짧게 로그 (디버깅)
        if new_lines:
            print(f"  [dialog] {len(new_lines)}줄: {(' | '.join(new_lines))[:200]}")

        if len(self.seen_lines) > 300:
            self.seen_lines = set(list(self.seen_lines)[-150:])

    def _handle_winner(
        self, round_no: int, num: int, name: str, raw: str
    ) -> None:
        key = f"{round_no}:{num}:{name}"
        if key == self.last_winner_key:
            return
        self.last_winner_key = key
        print(f"  [마후] {round_no}회 우승: #{num} {name}")
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
                    "winnerName": name,
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
        dialog_interval = float(self.cfg.get("dialog_interval_sec", 0.3))
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

        # 대화창 OCR은 별도 스레드에서 계속 돌림 → 우승자 메시지 즉시 감지
        self._dialog_thread = threading.Thread(
            target=self._dialog_loop, daemon=True, name="dialog-ocr"
        )
        self._dialog_thread.start()
        print("[loop] 대화창 감시 스레드 시작 (0.3초 간격)")

        while True:
            try:
                has_slime = self._any_lane_has_slime()
                # 아만 알림 이후 ~3분 동안은 "곧 경기" 상태로 간주
                aman_active = (
                    self.aman_trigger_ts is not None
                    and (time.time() - self.aman_trigger_ts) < 180
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
                    # 아직 안 찬 레인만 다시 호버
                    if not lineup_sent:
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
