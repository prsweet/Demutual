import React from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export type LayoutUser = {
  name: string;
  walletAddress?: string;
};

export function Layout({
  children,
  title,
  onConnectWallet,
  onDisconnect,
  user,
  sidebarCollapsed = false
}: {
  children: React.ReactNode;
  /** Shown in the main header (default: Trending buckets) */
  title?: string;
  onConnectWallet: () => void;
  onDisconnect?: () => void;
  user?: LayoutUser;
  sidebarCollapsed?: boolean;
}) {
  return (
    <div className="flex h-screen w-full bg-[#f4f4f4] overflow-hidden tracking-tighter text-[#1a1c1e]">
      <Sidebar user={user} collapsed={sidebarCollapsed} />
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        <div className="absolute inset-y-0 left-0 w-px bg-white/50 shadow-[1px_0_2px_rgba(0,0,0,0.02)] z-10" />

        <Topbar title={title} onConnectWallet={onConnectWallet} onDisconnect={onDisconnect} user={user} />

        <div className="flex-1 overflow-y-auto bg-[#f4f4f4]">{children}</div>
      </main>
    </div>
  );
}
