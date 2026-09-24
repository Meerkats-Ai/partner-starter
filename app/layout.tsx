import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { BrandProvider } from "@/components/brand-provider";
import { SkinProvider } from "@/components/skin-provider";
import { apiCall } from "@/lib/api";
import { appIdFromHost } from "@/lib/config";

// Server-side title + favicon from the agency branding (first-paint / SEO). The
// client BrandProvider re-applies both after hydration so they stay fresh and work
// in the live customizer preview. Best-effort: any failure falls back to defaults.
export async function generateMetadata(): Promise<Metadata> {
  const fallback: Metadata = { title: "Insights", description: "Powered by the Meerkats Partner API" };
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host") || undefined;
    // HOST mode when the host is an app subdomain — even if an ambient key is set
    // (the shared *.meerkats.ai deployment has one). Host identity wins per request.
    const appId = process.env.MEERKATS_APP_ID || appIdFromHost(host);
    const r = appId
      ? await apiCall(`/apps/${encodeURIComponent(appId)}/public-branding`, { appId })
      : await apiCall("/branding");
    const b: any = (r.data as any)?.data || r.data || {};
    return {
      title: b.app_name || fallback.title,
      description: b.tagline || fallback.description,
      ...(b.favicon_url ? { icons: { icon: b.favicon_url } } : {}),
    };
  } catch {
    return fallback;
  }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        {/* SkinProvider wraps BrandProvider: the skin sets the full token set,
            then the agency brand color layers on top of --primary. */}
        <SkinProvider>
          <BrandProvider>{children}</BrandProvider>
        </SkinProvider>
      </body>
    </html>
  );
}
