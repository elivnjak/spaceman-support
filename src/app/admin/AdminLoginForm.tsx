"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

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
    <Card className="mb-8 border-accent/30 bg-accent/5">
      <h2 className="mb-2 text-lg font-medium text-ink">
        Staff sign in required
      </h2>
      <p className="mb-4 text-sm text-muted">
        Enter your admin or editor credentials to access the admin tools.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <label className="min-w-[200px] flex-1">
          <span className="sr-only">Admin email</span>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="username"
          />
        </label>
        <label className="min-w-[200px] flex-1">
          <span className="sr-only">Admin password</span>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
          />
        </label>
        <Button type="submit" disabled={loading} variant="accent">
          {loading ? "Checking..." : "Login"}
        </Button>
      </form>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
