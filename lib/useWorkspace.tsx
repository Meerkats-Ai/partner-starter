"use client";
/**
 * Minimal useWorkspace — replaces the frontend's heavy WorkspaceContext. The
 * Cockpit tree only reads `currentWorkspace.{id,name,category}`. We source the
 * current workspace from a tiny client context that the sidebar populates, and
 * ALSO mirror the id into localStorage['currentWorkspaceId'] so the ported
 * chartSpec / savedCharts.store / useCardFilter helpers (which read that key
 * directly) work unchanged.
 */
import { createContext, useContext, useState, useCallback, useEffect } from "react";

export interface CurrentWorkspace { id: string; name: string; category?: string }

interface Ctx {
  currentWorkspace: CurrentWorkspace | null;
  setCurrentWorkspace: (w: CurrentWorkspace) => void;
}

const WorkspaceCtx = createContext<Ctx>({ currentWorkspace: null, setCurrentWorkspace: () => {} });

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [currentWorkspace, setWs] = useState<CurrentWorkspace | null>(null);

  // Hydrate from localStorage on mount (survives navigation).
  useEffect(() => {
    try {
      const id = localStorage.getItem("currentWorkspaceId");
      const name = localStorage.getItem("currentWorkspaceName") || "";
      if (id) setWs({ id, name });
    } catch { /* SSR / no storage */ }
  }, []);

  const setCurrentWorkspace = useCallback((w: CurrentWorkspace) => {
    setWs(w);
    try {
      localStorage.setItem("currentWorkspaceId", w.id);
      if (w.name) localStorage.setItem("currentWorkspaceName", w.name);
      // Notify the ported stores that key on the workspace.
      window.dispatchEvent(new Event("workspaceChanged"));
    } catch { /* ignore */ }
  }, []);

  return (
    <WorkspaceCtx.Provider value={{ currentWorkspace, setCurrentWorkspace }}>
      {children}
    </WorkspaceCtx.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceCtx);
}
