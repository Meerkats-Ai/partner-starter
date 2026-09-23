"use client";
/**
 * /preview — an UNAUTHENTICATED, self-contained render of the app shell + a
 * representative dashboard, used as the live-preview target inside the Meerkats
 * branding customizer's iframe. It mirrors the real dashboard's layout (sidebar +
 * KPI cards + a bar chart + a table) but calls no APIs, so it works with no
 * end-user session and no workspace. The PreviewListener applies skin/accent/mode
 * pushed from the customizer via postMessage.
 *
 * It renders inside the root SkinProvider + BrandProvider (app/layout.tsx), so the
 * exact same token machinery as production drives it.
 */
import { useEffect, useState } from "react";
import { Gauge, Compass, Bot, Inbox, LogOut } from "lucide-react";
import {
  PreviewListener,
  PREVIEW_BRANDING_EVENT,
  type PreviewBranding,
} from "@/components/preview-listener";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const NAV = [
  { label: "Cockpit", icon: Gauge, active: true },
  { label: "Explore", icon: Compass },
  { label: "Agents", icon: Bot },
  { label: "Inbox", icon: Inbox },
];

const BARS = [42, 58, 51, 72, 39, 88, 64];
const ROWS = [
  ["Search — Brand", "12,480", "3.4×", "up"],
  ["Meta — Retargeting", "8,210", "2.1×", "up"],
  ["PMax — Catalog", "5,940", "0.8×", "down"],
  ["Shopping — Core", "4,102", "1.9×", "up"],
];

export default function PreviewPage() {
  // Branding pushed live from the customizer (app name / logo / tagline).
  const [branding, setBranding] = useState<PreviewBranding>({});
  useEffect(() => {
    function onBranding(e: Event) {
      setBranding((e as CustomEvent).detail || {});
    }
    window.addEventListener(PREVIEW_BRANDING_EVENT, onBranding);
    return () => window.removeEventListener(PREVIEW_BRANDING_EVENT, onBranding);
  }, []);

  const appName = branding.app_name || "Your App";

  return (
    <>
      <PreviewListener />
      <div className="min-h-screen flex bg-muted/20 text-foreground">
        {/* sidebar (visual mirror of the real one; no API calls) */}
        <aside className="w-60 shrink-0 border-r bg-background flex flex-col">
          <div className="h-14 flex items-center px-4 border-b">
            {branding.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logo_url} alt={appName} className="h-7 object-contain" />
            ) : (
              <div className="text-base font-bold text-primary">{appName}</div>
            )}
          </div>
          <div className="p-3 border-b">
            <div className="w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="truncate">{appName} Workspace</span>
            </div>
          </div>
          <nav className="flex-1 p-2 space-y-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm ${
                    item.active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {item.label}
                </div>
              );
            })}
          </nav>
          <div className="p-3 border-t">
            <div className="text-xs text-muted-foreground truncate mb-2">
              founder@acme.com
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LogOut className="h-4 w-4" /> Sign out
            </div>
          </div>
        </aside>

        {/* main */}
        <main className="flex-1 min-w-0 p-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Cockpit</h1>
              <p className="text-sm text-muted-foreground">
                {branding.tagline || "Last 30 days · live preview"}
              </p>
            </div>
            <Button>New report</Button>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              ["Revenue", "₹1,28,400", "+12%"],
              ["Ad spend", "₹41,900", "-4%"],
              ["Blended ROAS", "3.06×", "+8%"],
            ].map(([label, value, delta]) => (
              <Card key={label} className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <Badge>{delta}</Badge>
                </div>
                <div className="text-2xl font-bold text-primary mt-2">{value}</div>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
            {/* bar chart */}
            <Card className="p-5">
              <div className="text-sm font-medium mb-4">Revenue by day</div>
              <div className="flex items-end gap-3" style={{ height: 160 }}>
                {BARS.map((h, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end gap-2 h-full">
                    <div
                      className="w-full rounded-t bg-primary"
                      style={{ height: `${Math.round((h / 100) * 130)}px` }}
                    />
                    <span className="text-[10px] text-muted-foreground">D{i + 1}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4">
                <Button variant="outline" size="sm">View full report</Button>
              </div>
            </Card>

            {/* table */}
            <Card className="p-5">
              <div className="text-sm font-medium mb-3">Top campaigns</div>
              <div className="space-y-1 text-sm">
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-xs text-muted-foreground pb-2 border-b">
                  <span>Campaign</span><span>Rev</span><span>ROAS</span>
                </div>
                {ROWS.map(([name, rev, roas, dir]) => (
                  <div key={name} className="grid grid-cols-[1fr_auto_auto] gap-3 py-1.5 items-center">
                    <span className="truncate">{name}</span>
                    <span className="tabular-nums text-muted-foreground">{rev}</span>
                    <span className={dir === "up" ? "text-primary font-medium" : "text-destructive font-medium"}>{roas}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </main>
      </div>
    </>
  );
}
