import type { Metadata } from "next";
import "./globals.css";
import { BrandProvider } from "@/components/brand-provider";
import { SkinProvider } from "@/components/skin-provider";

export const metadata: Metadata = {
  title: "Insights",
  description: "Powered by the Meerkats Partner API",
};

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
