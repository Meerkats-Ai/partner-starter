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
      <div className="min-h-screen flex">
        <Sidebar email={session.email || ""} />
        {/* min-h-screen + flex so children using min-h-full / sticky headers resolve correctly */}
        <main className="flex-1 min-w-0 min-h-screen flex flex-col bg-muted/20">{children}</main>
      </div>
      <Toaster position="bottom-right" />
    </WorkspaceProvider>
  );
}
