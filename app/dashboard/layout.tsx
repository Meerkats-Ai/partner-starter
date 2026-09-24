import { redirect } from "next/navigation";
import { Toaster } from "sonner";
import { getSession } from "@/lib/session";
import { Sidebar } from "@/components/sidebar";
import { WorkspaceProvider } from "@/lib/useWorkspace";

/** Dashboard shell — auth-guarded; renders the branded sidebar + content. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session.token) redirect("/login");

  return (
    <WorkspaceProvider>
      {/* h-screen (not min-h-screen) pins the shell to the viewport so the sidebar
          stays fixed and ONLY <main> scrolls. overflow-hidden on the row stops the
          whole page from growing with content and dragging the sidebar off-screen. */}
      <div className="h-screen flex overflow-hidden">
        <Sidebar email={session.email || ""} />
        <main className="flex-1 min-w-0 h-screen overflow-y-auto flex flex-col bg-muted/20">{children}</main>
      </div>
      <Toaster position="bottom-right" />
    </WorkspaceProvider>
  );
}
