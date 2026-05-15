import type { ReactNode } from "react";
import { MobileUnsupportedScreen } from "./MobileUnsupportedScreen";

/** Below Tailwind `md` (768px): show mobile blocker; at md+ render app routes. */
export function DesktopOnly({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="md:hidden min-h-screen w-full">
        <MobileUnsupportedScreen />
      </div>
      <div className="max-md:hidden min-h-screen w-full">{children}</div>
    </>
  );
}
