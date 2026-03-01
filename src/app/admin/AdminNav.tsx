"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { AdminUiRole } from "@/lib/auth";

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
      { href: "/admin/tickets", label: "Tickets" },
    ],
  },
  {
    section: "Content & knowledge",
    items: [
      { href: "/admin/labels", label: "Labels" },
      { href: "/admin/images", label: "Reference images" },
      { href: "/admin/docs", label: "Documents" },
      { href: "/admin/playbooks", label: "Playbooks" },
      { href: "/admin/intent", label: "Intent manifest" },
    ],
  },
  {
    section: "Configuration",
    items: [
      { href: "/admin/product-types", label: "Product types" },
      { href: "/admin/models", label: "Supported models" },
      { href: "/admin/nameplate", label: "Nameplate config" },
      { href: "/admin/clearance", label: "Clearance config" },
    ],
  },
  {
    section: "Users & system",
    items: [
      { href: "/admin/users", label: "Users", adminOnly: true },
      { href: "/admin/maintenance", label: "Maintenance mode" },
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

export function AdminNav({ role }: { role: AdminUiRole | null }) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const pathname = usePathname();
  const canSeeAdminOnly = role === "admin";
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

  const linkClass = (href: string) => {
    const isActive =
      href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
    return isActive
      ? "font-medium text-gray-900 dark:text-white"
      : "text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white";
  };

  return (
    <>
      <nav className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex shrink-0 items-center justify-center rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
            aria-label="Open menu"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {roleLabel}
          </span>
          <Link
            href="/"
            className="ml-auto shrink-0 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            Back to app
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="shrink-0 text-sm text-gray-600 hover:text-gray-900 disabled:opacity-60 dark:text-gray-400 dark:hover:text-white"
          >
            {loggingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>
      </nav>

      {/* Overlay */}
      {open && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          aria-label="Close menu"
        />
      )}

      {/* Slide-out panel */}
      <div
        className={`fixed left-0 top-0 z-50 h-full w-72 max-w-[85vw] transform border-r border-gray-200 bg-white shadow-xl transition-transform duration-200 ease-out dark:border-gray-700 dark:bg-gray-800 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <span className="font-semibold text-gray-900 dark:text-white">
            Menu
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-2 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
            aria-label="Close menu"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <ul className="flex flex-col py-2">
          {navGroups.map((group) => {
            const visibleItems = group.items.filter(
              (item) => !item.adminOnly || canSeeAdminOnly
            );
            if (visibleItems.length === 0) return null;
            return (
              <li key={group.section} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
                <div className="px-4 pt-3 pb-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {group.section}
                  </span>
                </div>
                <ul className="pb-2">
                  {visibleItems.map(({ href, label }) => (
                    <li key={href}>
                      <Link
                        href={href}
                        onClick={() => setOpen(false)}
                        className={`block px-4 py-2.5 text-sm ${linkClass(href)}`}
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
      </div>
    </>
  );
}
