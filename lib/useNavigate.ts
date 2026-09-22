"use client";
/**
 * useNavigate — a react-router-dom compat shim over Next's router, so ported
 * components that call `const navigate = useNavigate(); navigate(path, {replace})`
 * work unchanged. Supports the string form (the only form the ported code uses).
 */
import { useRouter } from "next/navigation";
import { useCallback } from "react";

export function useNavigate() {
  const router = useRouter();
  return useCallback((path: string, opts?: { replace?: boolean }) => {
    if (typeof path !== "string") return;
    if (opts?.replace) router.replace(path);
    else router.push(path);
  }, [router]);
}
export default useNavigate;
