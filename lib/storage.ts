// 서버 전용. Supabase Storage REST API로 파일 업로드/삭제를 수행.
// .env.production (또는 환경 변수)에서 다음을 읽음:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_BANNER_BUCKET (기본값: lineage-slime-race-banners)

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BUCKET =
  process.env.SUPABASE_BANNER_BUCKET ?? "lineage-slime-race-banners";

function requireConfig() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Supabase 설정 누락: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 필요"
    );
  }
}

async function ensureBucket() {
  const head = await fetch(`${SUPABASE_URL}/storage/v1/bucket/${BUCKET}`, {
    headers: { Authorization: `Bearer ${SERVICE_KEY}` },
    cache: "no-store",
  });
  if (head.ok) return;
  const create = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: 10 * 1024 * 1024,
      allowed_mime_types: ["image/*"],
    }),
  });
  if (!create.ok) {
    const txt = await create.text();
    // 409 = 이미 존재 (경쟁 상황)
    if (create.status !== 409) {
      throw new Error(`버킷 생성 실패: ${create.status} ${txt}`);
    }
  }
}

function safeExt(name: string, fallback: string): string {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(name);
  if (m) return m[1].toLowerCase();
  return fallback;
}

function extFromContentType(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("svg")) return "svg";
  return "jpg";
}

export type UploadedImage = {
  url: string;
  path: string;
};

export async function uploadBannerImage(
  bytes: Uint8Array,
  contentType: string,
  originalName: string
): Promise<UploadedImage> {
  requireConfig();
  await ensureBucket();

  const ext = safeExt(originalName, extFromContentType(contentType));
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": contentType || "application/octet-stream",
        "x-upsert": "false",
      },
      body: bytes as unknown as BodyInit,
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`업로드 실패: ${res.status} ${txt}`);
  }

  return {
    url: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${key}`,
    path: key,
  };
}

export async function deleteBannerImage(path: string): Promise<void> {
  requireConfig();
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${SERVICE_KEY}` },
    }
  );
  if (!res.ok && res.status !== 404) {
    const txt = await res.text();
    throw new Error(`삭제 실패: ${res.status} ${txt}`);
  }
}

export function extractPath(publicUrl: string): string | null {
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
  if (publicUrl.startsWith(prefix)) {
    return publicUrl.slice(prefix.length);
  }
  return null;
}
