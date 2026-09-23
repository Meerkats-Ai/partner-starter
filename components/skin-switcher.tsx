"use client";
/**
 * SkinSwitcher — a small control to preview skins + light/dark at runtime.
 * Drops into the sidebar footer. This is the dev/preview affordance; in production
 * the default skin comes from the agency config, but leaving a switcher is fine
 * (it only writes localStorage, scoped to the current browser).
 */
import { useState } from "react";
import { Moon, Sun, Palette, Check } from "lucide-react";
import { useSkin } from "@/components/skin-provider";
import { cn } from "@/lib/utils";

export function SkinSwitcher() {
  const { skins, skinId, setSkinId, mode, toggleMode } = useSkin();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex items-center gap-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        title="Change skin"
      >
        <Palette className="h-4 w-4" /> Skin
      </button>

      <button
        onClick={toggleMode}
        className="ml-auto rounded-md border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        title={mode === "dark" ? "Switch to light" : "Switch to dark"}
        aria-label="Toggle dark mode"
      >
        {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 z-20 w-52 rounded-md border bg-popover shadow-md py-1">
          {skins.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSkinId(s.id);
                setOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent",
                skinId === s.id && "text-primary"
              )}
            >
              <span
                className="h-3.5 w-3.5 rounded-full border shrink-0"
                style={{
                  background: `hsl(${(mode === "dark" ? s.dark : s.light).primary})`,
                }}
              />
              <span className="flex-1 text-left">{s.label}</span>
              {skinId === s.id && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
