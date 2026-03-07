"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

export function AdminLoginForm({ next }: { next?: string }) {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const notice = (() => {
    if (searchParams.get("unauthorized") === "1") {
      return {
        tone: "warning",
        message: "Please sign in to continue.",
      } as const;
    }

    switch (searchParams.get("notice")) {
      case "password-reset":
        return {
          tone: "success",
          message: "Your password has been reset. You can sign in with your new password.",
        } as const;
      case "password-changed":
        return {
          tone: "success",
          message: "Your password has been updated successfully.",
        } as const;
      default:
        return null;
    }
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Invalid credentials");
        return;
      }

      if (data.forcePasswordChange) {
        window.location.href = "/admin/profile?required=1";
        return;
      }

      window.location.href = next && next.startsWith("/admin") ? next : "/admin";
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4">
          <Image
            src="/kuhlberg-logo.webp"
            alt="Kuhlberg logo"
            width={160}
            height={48}
            className="h-12 w-auto"
            priority
          />
        </div>
        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {notice && (
              <p
                className={
                  notice.tone === "success"
                    ? "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-300"
                    : "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300"
                }
              >
                {notice.message}
              </p>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Email</span>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="username"
                required
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between gap-3 text-sm font-medium text-ink">
                <span>Password</span>
                <Link
                  href="/admin/forgot-password"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Forgot password?
                </Link>
              </span>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={loading} variant="accent" className="w-full">
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
