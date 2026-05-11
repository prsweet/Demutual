import React from "react";
import { SlidersHorizontal, Wallet, LogOut } from "lucide-react";
import { shortenAddress } from "../lib/wallet";
import type { LayoutUser } from "./Layout";

export function Topbar({
  title = "Trending buckets",
  onConnectWallet,
  onDisconnect,
  user
}: {
  title?: string;
  onConnectWallet: () => void;
  onDisconnect?: () => void;
  user?: LayoutUser;
}) {
  const connected = Boolean(user?.walletAddress);

  return (
    <header className="h-[72px] flex items-center justify-between px-8 shrink-0 tracking-tight">
      <div className="flex items-center gap-6">
        <h1 className="text-[20px] font-semibold text-[#1a1c1e]">{title}</h1>

        <div className="relative group">
          <button
            type="button"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/5 hover:bg-black/10 text-[13px] font-semibold text-[#374151] transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filter
          </button>

          <div className="absolute top-full left-0 mt-2 w-40 bg-[#f8f9f7] rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_-4px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.06)]">
            <div className="py-1 px-1">
              <p className="px-3 py-2 text-[12px] text-[#9ca3af] font-medium">Coming soon</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {connected && user?.walletAddress && (
          <span className="text-[13px] font-medium text-[#6b7280] tabular-nums hidden sm:inline">
            {shortenAddress(user.walletAddress, 5)}
          </span>
        )}
        {connected && onDisconnect ? (
          <button
            type="button"
            onClick={() => void onDisconnect()}
            className="flex items-center gap-2 px-4 py-2 bg-[#8b5cf6] text-white rounded-[10px] text-[14px] font-semibold transition-all active:scale-[0.98] shadow-[inset_0_2px_1px_rgba(255,255,255,0.3),inset_0_0_0_0.5px_rgba(255,255,255,0.2),0_0_0_1px_#6d28d9,0_12px_24px_-4px_rgba(0,0,0,0.05),0_4px_8px_-2px_rgba(0,0,0,0.01)] hover:bg-[#9661f0]"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnectWallet}
            className="flex items-center gap-2 px-4 py-2 bg-[#8b5cf6] text-white rounded-[10px] text-[14px] font-semibold transition-all active:scale-[0.98] shadow-[inset_0_2px_1px_rgba(255,255,255,0.3),inset_0_0_0_0.5px_rgba(255,255,255,0.2),0_0_0_1px_#6d28d9,0_12px_24px_-4px_rgba(0,0,0,0.01),0_4px_8px_-2px_rgba(0,0,0,0.01)] hover:bg-[#8743fc]"
          >
            <Wallet className="w-4 h-4" />
            Connect wallet
          </button>
        )}
      </div>
    </header>
  );
}
