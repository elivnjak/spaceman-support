"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { AdminUiRole } from "@/lib/auth";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

type NavItem = {
  href: string;
  label: string;
  adminOnly?: boolean;
};

type NavGroup = {
  section: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    section: "Overview & workflow",
    items: [
      { href: "/admin", label: "Dashboard" },
      { href: "/admin/ai-analytics", label: "Insights" },
      { href: "/admin/tickets", label: "Tickets" },
      { href: "/admin/rag-chat", label: "RAG test chat" },
    ],
  },
  {
    section: "Content & knowledge",
    items: [
      { href: "/admin/actions", label: "Actions" },
      { href: "/admin/labels", label: "Labels" },
      { href: "/admin/docs", label: "Documents" },
      { href: "/admin/playbooks", label: "Playbooks" },
      { href: "/admin/intent", label: "Intent manifest" },
    ],
  },
  {
    section: "Configuration",
    items: [
      { href: "/admin/diagnosis-mode", label: "Diagnosis mode" },
      { href: "/admin/escalation", label: "Escalation" },
      { href: "/admin/product-types", label: "Product types" },
      { href: "/admin/models", label: "Supported models" },
      { href: "/admin/nameplate", label: "Nameplate config" },
      { href: "/admin/clearance", label: "Clearance config" },
    ],
  },
  {
    section: "Users & system",
    items: [
      { href: "/admin/profile", label: "My profile" },
      { href: "/admin/users", label: "Users", adminOnly: true },
      { href: "/admin/telegram", label: "Telegram notifications" },
      { href: "/admin/maintenance", label: "Maintenance mode" },
      { href: "/admin/backups", label: "Backups", adminOnly: true },
    ],
  },
  {
    section: "Logs",
    items: [
      { href: "/admin/error-logs", label: "Error logs", adminOnly: true },
      { href: "/admin/audit-logs", label: "Audit logs", adminOnly: true },
    ],
  },
];

function NavLinks({
  role,
  onNavigate,
}: {
  role: AdminUiRole | null;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const canSeeAdminOnly = role === "admin";

  const linkClass = (href: string) => {
    const isActive =
      href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
    return isActive
      ? "bg-aqua/40 font-medium text-primary"
      : "text-muted hover:bg-aqua/20 hover:text-ink";
  };

  return (
    <ul className="flex flex-col gap-1 py-2">
      {navGroups.map((group) => {
        const visibleItems = group.items.filter(
          (item) => !item.adminOnly || canSeeAdminOnly
        );
        if (visibleItems.length === 0) return null;
        return (
          <li key={group.section}>
            <div className="px-4 pb-1 pt-4 first:pt-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                {group.section}
              </span>
            </div>
            <ul>
              {visibleItems.map(({ href, label }) => (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    className={`mx-2 block rounded-lg px-3 py-2.5 text-sm transition-colors duration-150 ${linkClass(href)}`}
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

export function AdminNav({
  role,
  collapsed = false,
  onToggle,
}: {
  role: AdminUiRole | null;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const roleLabel = role === "editor" ? "Editor" : "Admin";

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/admin";
    }
  };

  const sidebarContent = (
    <>
      <div className="flex items-center gap-2 border-b border-border px-3 py-4">
        <Image
          src="/kuhlberg-logo-icon-web.webp"
          alt="Kuhlberg logo"
          width={32}
          height={32}
          className="h-8 w-8 shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Kuhlberg Support</p>
          <p className="text-xs text-muted">{roleLabel}</p>
        </div>
        <ThemeToggle />
        <button
          type="button"
          onClick={onToggle}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-aqua/30 hover:text-ink"
          aria-label="Collapse sidebar"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto">
        <NavLinks role={role} onNavigate={() => setOpen(false)} />
      </nav>

      <div className="border-t border-border p-4 space-y-2">
        <Link
          href="/"
          className="flex min-h-[44px] items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-aqua/20 hover:text-ink"
        >
          Back to app
        </Link>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex min-h-[44px] w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-900/20 dark:hover:text-red-400"
        >
          {loggingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </>
  );

  const collapsedSidebar = (
    <div className="flex flex-col items-center py-3 gap-2">
      <Image
        src="/kuhlberg-logo-icon-web.webp"
        alt="Kuhlberg logo"
        width={32}
        height={32}
        className="h-8 w-8 rounded-lg"
      />
      <button
        type="button"
        onClick={onToggle}
        className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-aqua/30 hover:text-ink"
        aria-label="Expand sidebar"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M6 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );

  return (
    <>
      {/* Desktop persistent sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-surface transition-all duration-200 lg:flex ${collapsed ? "w-14" : "w-64"}`}
      >
        {collapsed ? collapsedSidebar : sidebarContent}
      </aside>

      {/* Mobile top bar */}
      <nav className="sticky top-0 z-20 border-b border-border bg-surface lg:hidden">
        <div className="flex items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-aqua/30 hover:text-ink"
            aria-label="Open menu"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Image
              src="/kuhlberg-logo-icon-web.webp"
              alt="Kuhlberg logo"
              width={18}
              height={18}
              className="h-[18px] w-[18px] rounded-sm"
            />
            <span>Support</span>
          </span>
          <span className="text-xs text-muted">({roleLabel})</span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <Link
              href="/"
              className="flex h-10 items-center rounded-lg px-2 text-sm text-muted transition-colors hover:text-ink"
            >
              Back to app
            </Link>
          </div>
        </div>
      </nav>

      {/* Mobile overlay */}
      {open && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm lg:hidden"
          aria-label="Close menu"
        />
      )}

      {/* Mobile slide-out drawer */}
      <div
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] transform flex-col border-r border-border bg-surface shadow-xl transition-transform duration-200 ease-out lg:hidden ${open ? "translate-x-0" : "-translate-x-full"
          }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-semibold text-ink">Menu</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-aqua/30 hover:text-ink"
            aria-label="Close menu"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto">
          <NavLinks role={role} onNavigate={() => setOpen(false)} />
        </nav>
        <div className="border-t border-border p-4">
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex min-h-[44px] w-full items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-60 dark:hover:bg-red-900/20 dark:hover:text-red-400"
          >
            {loggingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </div>
    </>
  );
}
