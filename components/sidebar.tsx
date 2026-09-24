"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Gauge, Compass, FileSpreadsheet, Bot, Inbox, LogOut, ChevronsUpDown } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { authFetch, logout, setWorkspace } from "@/lib/client";
import { useWorkspace } from "@/lib/useWorkspace";
import { cn } from "@/lib/utils";

interface Workspace { id: string; name: string; is_default?: boolean }

const NAV = [
  { href: "/dashboard/cockpit", label: "Cockpit", icon: Gauge },
  { href: "/dashboard/explore", label: "Explore", icon: Compass },
  { href: "/dashboard/reports", label: "Reports", icon: FileSpreadsheet },
  { href: "/dashboard/agents", label: "Agents", icon: Bot },
  { href: "/dashboard/queue", label: "Inbox", icon: Inbox },
];

export function Sidebar({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [current, setCurrent] = useState<Workspace | null>(null);
  const [open, setOpen] = useState(false);
  const { setCurrentWorkspace } = useWorkspace();

  useEffect(() => {
    authFetch<{ data: Workspace[] }>("/workspaces").then(async (r) => {
      const ws = r.data?.data || [];
      setWorkspaces(ws);
      if (!ws.length || current) return;
      // Restore the last-used workspace if it's still granted, else the app's
      // DEFAULT workspace (is_default), else the first one.
      let saved: string | null = null;
      try { saved = localStorage.getItem("currentWorkspaceId"); } catch { /* no storage */ }
      const initial =
        ws.find((w) => w.id === saved) ||
        ws.find((w) => w.is_default) ||
        ws[0];
      setCurrent(initial);
      await setWorkspace(initial.id);                               // session cookie (server) — set BEFORE first data pull
      setCurrentWorkspace({ id: initial.id, name: initial.name }); // + localStorage / refresh signal
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (ws: Workspace) => {
    setCurrent(ws);
    setOpen(false);
    await setWorkspace(ws.id);
    setCurrentWorkspace({ id: ws.id, name: ws.name });
    router.refresh();
  };

  const doLogout = async () => {
    await logout();
    // Hard navigation (not router.push): the destroyed session cookie must be
    // re-read by the server. A soft client nav can keep the cached dashboard
    // (Router Cache) and the still-mounted authed tree, so logout looks like a
    // no-op. window.location forces a full reload past the auth guard.
    window.location.href = "/login";
  };

  return (
    <aside className="w-60 shrink-0 border-r bg-background flex flex-col h-full">
      <div className="h-14 flex items-center px-4 border-b">
        <BrandMark compact />
      </div>

      {/* workspace picker */}
      <div className="p-3 border-b relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          <span className="truncate">{current?.name || "Select workspace"}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
        </button>
        {open && workspaces.length > 0 && (
          <div className="absolute left-3 right-3 mt-1 z-10 rounded-md border bg-popover shadow-md py-1">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => pick(ws)}
                className={cn("w-full text-left px-3 py-2 text-sm hover:bg-accent", current?.id === ws.id && "bg-accent")}
              >
                {ws.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* nav */}
      <nav className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm",
                active ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" /> {item.label}
            </Link>
          );
        })}
      </nav>

      {/* footer */}
      <div className="p-3 border-t space-y-2">
        <div className="text-xs text-muted-foreground truncate">{email}</div>
        <button onClick={doLogout} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}
