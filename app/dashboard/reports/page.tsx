"use client";
/**
 * Reports — the cross-platform Reporting Pack (Daily Log / Weekly / Monthly /
 * Placement tabs + Excel export), wired to the public API's /cdp/daily-log bundle.
 */
import ReportingPack from "@/components/charts/ReportingPack";

export default function Page() {
  return <ReportingPack />;
}
