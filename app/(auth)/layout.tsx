import { AuthBrandHeader } from "@/components/auth-brand-header";

/** Centered card layout for the auth screens, branded from /branding. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid place-items-center bg-muted/30 px-4">
      <div className="w-full max-w-sm">
        <AuthBrandHeader />
        {children}
      </div>
    </div>
  );
}
