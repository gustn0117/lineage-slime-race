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

import hashlib
import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Optional

import tkinter as tk
from tkinter import messagebox

import numpy as np
import pyautogui
import requests

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


MAHU_PATTERN = re.compile(
    r"마후.*?제\s*(\d+)\s*회.*?우승자는\s*[\"'“”]?\s*#?\s*(\d+)\s+(\S[^\"'“”]*?)[\"'“”]?\s*입니다"
)


class Agent:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        print("[init] EasyOCR 로드 중... (최초 실행 시 모델 다운로드로 1~2분 소요)")
        import easyocr  # 지연 import

        self.reader = easyocr.Reader(["ko", "en"], gpu=False, verbose=False)
        self.sct = mss.mss()
        self.last_lineup_sig: Optional[str] = None
        self.last_winner_key: Optional[str] = None
        self.seen_lines: set[str] = set()
        print("[init] 준비 완료.")

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

    def _ocr(self, img: np.ndarray) -> str:
        try:
            lines = self.reader.readtext(img, detail=0, paragraph=True)
        except Exception as e:
            print(f"  [ocr error] {e}")
            return ""
        return " ".join(l.strip() for l in lines if l).strip()

    def _parse_tooltip(self, text: str) -> tuple[Optional[int], str]:
        t = text.replace("#", "# ")
        m = re.search(r"#\s*(\d+)\s+(\S.*)", t)
        if m:
            return int(m.group(1)), m.group(2).strip()
        m2 = re.search(r"(\d+)\s+(\S.*)", t)
        if m2:
            return int(m2.group(1)), m2.group(2).strip()
        return None, t.strip()

    def _scan_lineup(self) -> list[dict]:
        results: list[dict] = []
        tb = self.cfg.get("tooltip_bbox", DEFAULT_TOOLTIP_BBOX)
        hover_ms = self.cfg.get("hover_wait_ms", 280)
        for i, lane in enumerate(self.cfg["lanes"]):
            pyautogui.moveTo(lane["x"], lane["y"], duration=0.08)
            time.sleep(hover_ms / 1000)
            img = self._grab_rgb(
                lane["x"] + tb["dx"],
                lane["y"] + tb["dy"],
                tb["w"],
                tb["h"],
            )
            text = self._ocr(img)
            num, name = self._parse_tooltip(text)
            print(f"    레인{i+1}: '{text}' → #{num} {name}")
            results.append({"lane": i + 1, "slime": name, "number": num})
        pyautogui.moveTo(10, 10, duration=0.15)
        return results

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

    def _scan_dialog(self) -> None:
        d = self.cfg["dialog"]
        img = self._grab_rgb(d["x"], d["y"], d["w"], d["h"])
        try:
            lines = self.reader.readtext(img, detail=0, paragraph=False)
        except Exception as e:
            print(f"  [dialog ocr error] {e}")
            return

        for raw in lines:
            line = raw.strip()
            if not line:
                continue
            key = hashlib.md5(line.encode("utf-8")).hexdigest()
            if key in self.seen_lines:
                continue
            self.seen_lines.add(key)

            m = MAHU_PATTERN.search(line)
            if m:
                round_no = int(m.group(1))
                num = int(m.group(2))
                name = m.group(3).strip()
                self._handle_winner(round_no, num, name, line)

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

    def loop(self) -> None:
        interval = float(self.cfg.get("poll_interval_sec", 1.5))
        running = False
        scanned = False

        while True:
            try:
                has_slime = self._any_lane_has_slime()
                if has_slime and not scanned:
                    print(f"[{time.strftime('%H:%M:%S')}] 경기 시작 감지 → 라인업 스캔")
                    lineup = self._scan_lineup()
                    self._send_lineup(lineup)
                    scanned = True
                    running = True
                elif not has_slime and running:
                    print(f"[{time.strftime('%H:%M:%S')}] 경기 종료 감지 → 대기")
                    running = False
                    scanned = False

                self._scan_dialog()
            except KeyboardInterrupt:
                print("\n중단 요청. 종료합니다.")
                return
            except Exception as e:
                print(f"[loop error] {e}")

            time.sleep(interval)


# --------------------------------------------------------------------------- #
# Entry
# --------------------------------------------------------------------------- #


def main() -> int:
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
    print("=" * 60)
    print("창을 닫거나 Ctrl+C 로 종료됩니다.")
    print()

    agent = Agent(cfg)
    try:
        agent.loop()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
