"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { AdminNav } from "./AdminNav";
import type { AdminUiRole } from "@/lib/auth";

const AdminRoleContext = createContext<AdminUiRole | null>(null);

export function useAdminRole(): AdminUiRole | null {
  return useContext(AdminRoleContext);
}

export function AdminSidebarProvider({
  role,
  children,
}: {
  role: AdminUiRole | null;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("admin-sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("admin-sidebar-collapsed", String(next));
      return next;
    });
  };

  return (
    <AdminRoleContext.Provider value={role}>
      <AdminNav role={role} collapsed={collapsed} onToggle={toggle} />
      <main
        id="main-content"
        className={`transition-[padding] duration-200 ${collapsed ? "lg:pl-14" : "lg:pl-64"}`}
      >
        <div className="px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </div>
      </main>
    </AdminRoleContext.Provider>
  );
}
