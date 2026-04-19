"use client";

import { apiGetIngestToken } from "@/lib/client";
import { useCallback, useEffect, useState } from "react";

export default function AgentPanel() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean>(true);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const serverUrl =
    typeof window !== "undefined" ? window.location.origin : "";

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiGetIngestToken();
      setToken(res.token);
      setConfigured(res.configured);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && token === null) load();
  }, [open, token, load]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="panel overflow-hidden">
      <button
        type="button"
        className="panel-head w-full"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          <span>에이전트 설정</span>
          <span className="chip">
            {configured ? "연결 가능" : "토큰 미설정"}
          </span>
        </span>
        <span className={`past-chevron ${open ? "open" : ""}`}>›</span>
      </button>

      {open && (
        <div className="p-4 flex flex-col gap-3 text-sm">
          <p className="text-xs text-zinc-400 leading-relaxed">
            PC에 설치한 에이전트(mahu-agent.exe)에 아래 서버 주소와 토큰을
            붙여넣으세요. 에이전트가 경기 라인업과 우승 결과를 자동으로 서버에
            전송합니다.
          </p>

          <div className="agent-field">
            <span className="field-label">서버 주소</span>
            <div className="flex gap-2">
              <input
                readOnly
                value={serverUrl}
                className="agent-readonly"
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                className="btn"
                onClick={() => copy(serverUrl)}
              >
                복사
              </button>
            </div>
          </div>

          <div className="agent-field">
            <span className="field-label">에이전트 토큰</span>
            {loading ? (
              <div className="text-xs text-zinc-500">불러오는 중...</div>
            ) : err ? (
              <div className="text-xs text-red-300">{err}</div>
            ) : !configured ? (
              <div className="text-xs text-amber-300 leading-relaxed">
                서버에 INGEST_TOKEN 환경변수가 설정되지 않았습니다. 서버 관리자가
                .env.production에 토큰을 추가하고 재배포하면 활성화됩니다.
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  readOnly
                  type="text"
                  value={token ?? ""}
                  className="agent-readonly agent-token"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => copy(token ?? "")}
                  disabled={!token}
                >
                  {copied ? "복사됨" : "복사"}
                </button>
              </div>
            )}
          </div>

          <div className="agent-hints text-[11px] text-zinc-500 leading-relaxed">
            <div className="font-semibold text-zinc-400 mb-1">사용법</div>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>
                GitHub 레포의 <code className="agent-code">agent/</code> 폴더를
                내려받아 Windows PC에 둡니다.
              </li>
              <li>
                <code className="agent-code">build.bat</code>을 더블클릭 →
                2~3분 뒤 <code className="agent-code">dist/mahu-agent.exe</code>
                가 생성됩니다.
              </li>
              <li>
                exe 실행 → 위 서버 주소와 토큰을 붙여넣고, 레인 5개 위치와
                대화창 영역을 한 번 지정합니다.
              </li>
              <li>
                이후 경기 시작이 감지되면 라인업·우승 결과가 자동으로 들어옵니다.
              </li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
