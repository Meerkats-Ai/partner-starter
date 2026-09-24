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
    setWs((prev) => (prev?.id === w.id && prev?.name === w.name ? prev : w));
    try {
      const changed = localStorage.getItem("currentWorkspaceId") !== w.id;
      localStorage.setItem("currentWorkspaceId", w.id);
      if (w.name) localStorage.setItem("currentWorkspaceName", w.name);
      if (changed) {
        // Notify the ported stores that key on the workspace...
        window.dispatchEvent(new Event("workspaceChanged"));
        // ...and force every data view to re-pull for the new workspace. The metrics
        // hooks already listen for this; the CDP/report loaders listen for it too
        // (see below). Without this the server proxy switches the cookie but the
        // client keeps showing the previous workspace's data until a full reload.
        window.dispatchEvent(new Event("mk-metrics-refresh"));
      }
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
