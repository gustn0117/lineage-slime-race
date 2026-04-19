"use client";

import {
  apiDeleteBanner,
  apiPatchBanner,
  apiSaveBanner,
} from "@/lib/client";
import { Banner } from "@/lib/types";
import { useState } from "react";

type Props = {
  banners: Banner[];
  onChange: (banners: Banner[]) => void;
};

export default function BannerAdmin({ banners, onChange }: Props) {
  const [open, setOpen] = useState(true);
  const [imageUrl, setImageUrl] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sorted = [...banners].sort((a, b) => a.order - b.order);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!imageUrl.trim()) {
      setErr("이미지 URL을 입력하세요.");
      return;
    }
    setBusy(true);
    try {
      const saved = await apiSaveBanner({
        imageUrl: imageUrl.trim(),
        linkUrl: linkUrl.trim() || undefined,
        title: title.trim() || undefined,
        enabled: true,
      });
      onChange([...banners, saved]);
      setImageUrl("");
      setLinkUrl("");
      setTitle("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  };

  const patch = async (id: string, p: Partial<Banner>) => {
    const prev = banners;
    onChange(banners.map((b) => (b.id === id ? { ...b, ...p } : b)));
    try {
      const saved = await apiPatchBanner(id, p);
      onChange(prev.map((b) => (b.id === id ? saved : b)));
    } catch {
      onChange(prev);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("배너를 삭제할까요?")) return;
    const prev = banners;
    onChange(banners.filter((b) => b.id !== id));
    try {
      await apiDeleteBanner(id);
    } catch {
      onChange(prev);
    }
  };

  const move = async (id: string, dir: -1 | 1) => {
    const idx = sorted.findIndex((b) => b.id === id);
    const tgt = idx + dir;
    if (idx < 0 || tgt < 0 || tgt >= sorted.length) return;
    const a = sorted[idx];
    const b = sorted[tgt];
    await Promise.all([
      patch(a.id, { order: b.order }),
      patch(b.id, { order: a.order }),
    ]);
  };

  return (
    <div className="panel overflow-hidden">
      <button
        type="button"
        className="panel-head w-full"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <span>배너 관리</span>
          <span className="chip">{banners.length}개</span>
        </span>
        <span className={`past-chevron ${open ? "open" : ""}`}>›</span>
      </button>

      {open && (
        <div className="p-4 flex flex-col gap-4">
          <form
            onSubmit={add}
            className="flex flex-col gap-2 rounded-lg border border-white/8 bg-black/30 p-3"
          >
            <label className="field">
              이미지 URL *
              <input
                type="url"
                required
                placeholder="https://..."
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            </label>
            <label className="field">
              클릭 시 이동할 URL (선택)
              <input
                type="url"
                placeholder="https://..."
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
            </label>
            <label className="field">
              제목 (선택 · 대체텍스트)
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            {err && <div className="text-xs text-red-300">{err}</div>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="btn btn-primary"
              >
                {busy ? "추가 중..." : "배너 추가"}
              </button>
            </div>
          </form>

          <div className="flex flex-col gap-2">
            {sorted.length === 0 && (
              <div className="text-xs text-zinc-500 text-center py-3">
                등록된 배너가 없습니다.
              </div>
            )}
            {sorted.map((b, i) => (
              <div key={b.id} className="banner-admin-row">
                <div className="banner-admin-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={b.imageUrl} alt={b.title ?? ""} />
                </div>
                <div className="banner-admin-body">
                  <div className="flex items-center gap-2">
                    <label className="banner-toggle">
                      <input
                        type="checkbox"
                        checked={b.enabled}
                        onChange={(e) =>
                          patch(b.id, { enabled: e.target.checked })
                        }
                      />
                      <span>{b.enabled ? "노출 ON" : "숨김"}</span>
                    </label>
                    <span className="text-[10px] text-zinc-500 tabular-nums">
                      order {b.order}
                    </span>
                  </div>
                  <div className="banner-admin-fields">
                    <input
                      type="url"
                      value={b.imageUrl}
                      onChange={(e) =>
                        patch(b.id, { imageUrl: e.target.value })
                      }
                      placeholder="이미지 URL"
                    />
                    <input
                      type="url"
                      value={b.linkUrl ?? ""}
                      onChange={(e) =>
                        patch(b.id, { linkUrl: e.target.value })
                      }
                      placeholder="링크 URL (선택)"
                    />
                    <input
                      type="text"
                      value={b.title ?? ""}
                      onChange={(e) => patch(b.id, { title: e.target.value })}
                      placeholder="제목 (선택)"
                    />
                  </div>
                </div>
                <div className="banner-admin-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => move(b.id, -1)}
                    disabled={i === 0}
                    title="위로"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => move(b.id, 1)}
                    disabled={i === sorted.length - 1}
                    title="아래로"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => remove(b.id)}
                    title="삭제"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
