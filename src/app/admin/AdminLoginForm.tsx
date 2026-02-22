"use client";

import { useState } from "react";

export function AdminLoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
      window.location.href = next && next.startsWith("/admin") ? next : "/admin";
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-950/30"
    >
      <h2 className="mb-2 text-lg font-medium text-amber-800 dark:text-amber-200">
        Admin sign in required
      </h2>
      <p className="mb-4 text-sm text-amber-700 dark:text-amber-300">
        Enter your admin credentials to access Documents, Labels, and other admin pages.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[200px]">
          <span className="sr-only">Admin email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@admin.com"
            className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            autoComplete="username"
          />
        </label>
        <label className="flex-1 min-w-[200px]">
          <span className="sr-only">Admin password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full rounded border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            autoComplete="current-password"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-amber-600 px-4 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {loading ? "Checking…" : "Unlock"}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
