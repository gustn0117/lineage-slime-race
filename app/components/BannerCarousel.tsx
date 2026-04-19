"use client";

import { Banner } from "@/lib/types";
import { useEffect, useState } from "react";

type Props = {
  banners: Banner[];
  intervalMs?: number;
};

export default function BannerCarousel({ banners, intervalMs = 5000 }: Props) {
  const active = banners
    .filter((b) => b.enabled && b.imageUrl)
    .sort((a, b) => a.order - b.order);

  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (active.length <= 1) return;
    const t = setInterval(
      () => setIdx((i) => (i + 1) % active.length),
      intervalMs
    );
    return () => clearInterval(t);
  }, [active.length, intervalMs]);

  useEffect(() => {
    if (idx >= active.length) setIdx(0);
  }, [active.length, idx]);

  if (active.length === 0) {
    return (
      <div className="banner banner-placeholder" aria-hidden>
        <span>AD · 광고 영역</span>
      </div>
    );
  }

  const cur = active[idx] ?? active[0];
  const inner = (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={cur.imageUrl}
      alt={cur.title ?? ""}
      className="banner-img"
      loading="lazy"
    />
  );

  return (
    <div className="banner">
      {cur.linkUrl ? (
        <a
          href={cur.linkUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="banner-link"
        >
          {inner}
        </a>
      ) : (
        inner
      )}
      {active.length > 1 && (
        <div className="banner-dots">
          {active.map((_, i) => (
            <button
              key={i}
              type="button"
              className={i === idx ? "active" : ""}
              onClick={() => setIdx(i)}
              aria-label={`배너 ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
