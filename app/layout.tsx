import type { Metadata } from "next";
import "./globals.css";
import { BrandProvider } from "@/components/brand-provider";

export const metadata: Metadata = {
  title: "Insights",
  description: "Powered by the Meerkats Partner API",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <BrandProvider>{children}</BrandProvider>
      </body>
    </html>
  );
}
