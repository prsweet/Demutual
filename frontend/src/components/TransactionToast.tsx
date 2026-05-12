import { useEffect, useState } from "react";
import { Check } from "lucide-react";

/**
 * Floating success pill — CSS-driven so it can't fail silently the way a
 * motion/AnimatePresence chain can. Three-phase state machine:
 *   hidden    → not in DOM
 *   entering  → mounted, pre-enter styles applied (below, transparent)
 *   shown     → final styles (centered, opaque) — transition runs ease-out
 *   exiting   → exit styles (above, transparent) — transition runs ease-in
 *
 * Visual matches the green bucket-name icon: pastel surround, dark green chip,
 * inset white sheen + soft outer glow.
 */

type Phase = "hidden" | "entering" | "shown" | "exiting";

export function TransactionToast({ show }: { show: boolean }) {
  const message = "Transaction completed";
  const [phase, setPhase] = useState<Phase>("hidden");

  useEffect(() => {
    if (show) {
      if (phase === "hidden" || phase === "exiting") {
        // Mount in pre-enter state first, then on the *next* frame flip to
        // "shown" so the browser sees a transition between two states.
        setPhase("entering");
        const r1 = requestAnimationFrame(() => {
          const r2 = requestAnimationFrame(() => setPhase("shown"));
          return () => cancelAnimationFrame(r2);
        });
        return () => cancelAnimationFrame(r1);
      }
    } else {
      if (phase === "shown" || phase === "entering") {
        setPhase("exiting");
        const t = window.setTimeout(() => setPhase("hidden"), 320);
        return () => window.clearTimeout(t);
      }
    }
  }, [show, phase]);

  if (phase === "hidden") return null;

  const phaseClass =
    phase === "shown"
      ? "opacity-100 translate-y-0 duration-[340ms] ease-out"
      : phase === "entering"
        ? "opacity-0 translate-y-9 duration-0"
        : "opacity-0 -translate-y-1 duration-[280ms] ease-in";

  const chipClass =
    phase === "shown"
      ? "scale-100 rotate-0 duration-300 ease-out"
      : "scale-50 rotate-[-15deg] duration-0";

  return (
    <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[100] pointer-events-none">
      <div
        className={[
          "flex items-center gap-3 px-5 py-3 rounded-[14px]",
          "bg-[#dcfce7] text-emerald-900",
          // inset white sheen + soft green outer glow + 1px green ring
          "shadow-[inset_0_1px_1px_rgba(255,255,255,0.6),0_10px_24px_-6px_rgba(74,222,128,0.35),0_0_0_1px_rgba(74,222,128,0.22)]",
          "transition-[opacity,transform] will-change-[opacity,transform]",
          phaseClass
        ].join(" ")}
      >
        <div
          className={[
            "bg-[#4ade80] p-1.5 rounded-xl shrink-0",
            "shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(74,222,128,0.45)]",
            "transition-transform",
            chipClass
          ].join(" ")}
        >
          <Check className="w-4 h-4 text-white stroke-3" />
        </div>
        <span className="text-[14px] font-semibold tracking-tight">{message}</span>
      </div>
    </div>
  );
}
