"use client";

import Dashboard from "@/app/components/Dashboard";
import Slime from "@/app/components/Slime";
import {
  apiAdminLogin,
  apiAdminLogout,
  apiAdminStatus,
} from "@/lib/client";
import { useEffect, useState } from "react";

export default function AdminPage() {
  const [status, setStatus] = useState<"loading" | "out" | "in">("loading");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiAdminStatus()
      .then((ok) => setStatus(ok ? "in" : "out"))
      .catch(() => setStatus("out"));
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await apiAdminLogin(password);
      setPassword("");
      setStatus("in");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "로그인 실패");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await apiAdminLogout();
    setStatus("out");
  };

  if (status === "loading") {
    return <main className="p-8 text-sm text-zinc-500">확인 중...</main>;
  }

  if (status === "in") {
    return <Dashboard admin onLogout={logout} />;
  }

  return (
    <main className="mx-auto w-full max-w-340 p-5 sm:p-7">
      <div className="login-card panel p-7 flex flex-col items-center gap-4">
        <Slime size={56} />
        <div className="text-center">
          <div className="login-sub">Admin Access</div>
          <h1 className="login-title">관리자 로그인</h1>
        </div>
        <form onSubmit={login} className="w-full flex flex-col gap-3">
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            className="login-input"
          />
          {err && (
            <div className="text-xs text-red-300 text-center">{err}</div>
          )}
          <button
            type="submit"
            disabled={busy || password.length === 0}
            className="btn btn-primary w-full"
          >
            {busy ? "확인 중..." : "입장"}
          </button>
          <a
            href="/"
            className="text-xs text-zinc-500 hover:text-zinc-300 text-center"
          >
            ← 공개 페이지로
          </a>
        </form>
      </div>
    </main>
  );
}
