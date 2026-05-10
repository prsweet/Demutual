import React from "react";
import { Plus, TrendingUp, BookOpen, Coins, Heart, Dog, User2, PieChart, FolderKanban } from "lucide-react";
import { NavLink, useNavigate } from "react-router";
import { shortenAddress } from "../lib/wallet";
import type { LayoutUser } from "./Layout";

const navBtn =
  "flex items-center gap-3 px-3 py-2 rounded-[8px] text-[14px] font-semibold text-left transition-colors w-full";
const navInactive = "text-[#6b7280] hover:bg-black/5 hover:text-[#374151]";
const navActive = "bg-black/5 text-[#1a1c1e]";

export function Sidebar({ user }: { user?: LayoutUser }) {
  const navigate = useNavigate();

  return (
    <aside className="w-[280px] h-screen flex-shrink-0 flex flex-col border-r border-black/5 bg-[#eaebe9] p-4 text-[#1a1c1e] tracking-tight">
      <div className="flex items-center gap-3 mb-5 px-2">
        <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center shadow-[inset_0_1px_1px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.05)] border border-black/5">
          <User2 className="w-5 h-5 text-gray-500" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[#1a1c1e] leading-tight truncate">
            {user?.name ?? "New user"}
          </h3>
          <p className="text-[13px] text-[#6b7280] leading-tight truncate">
            {user?.walletAddress ? shortenAddress(user.walletAddress, 4) : "Not connected"}
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate("/create-bucket")}
        className="flex items-center justify-center gap-2 w-full py-2 px-4 bg-[#f8f9f7] rounded-[10px] text-[14px] font-semibold text-[#374151]
        shadow-[inset_0_2px_1px_rgba(255,255,255,0.8),inset_0_0_0_1px_rgba(255,255,255,0.5),0_0_0_1px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.04)]
        hover:bg-white active:scale-[0.98] transition-all mb-4"
      >
        <Plus className="w-4 h-4 text-[#6b7280]" />
        New bucket
      </button>

      <div className="h-px w-full bg-black/5 shadow-[0_1px_0_white] mb-4" />

      <div className="flex flex-col gap-1 mb-4">
        <p className="px-2 text-[12px] font-semibold text-[#9ca3af] mb-1 uppercase tracking-wider">Main menu</p>

        <NavLink to="/" end className={({ isActive }) => `${navBtn} ${isActive ? navActive : navInactive}`}>
          <TrendingUp className="w-4 h-4 text-[#6b7280]" />
          Trending buckets
        </NavLink>

        <NavLink to="/portfolio" className={({ isActive }) => `${navBtn} ${isActive ? navActive : navInactive}`}>
          <PieChart className="w-4 h-4 text-[#6b7280]" />
          Portfolio
        </NavLink>

        <NavLink to="/my-buckets" className={({ isActive }) => `${navBtn} ${isActive ? navActive : navInactive}`}>
          <FolderKanban className="w-4 h-4 text-[#6b7280]" />
          My buckets
        </NavLink>

        <button
          type="button"
          disabled
          className={`${navBtn} text-[#9ca3af] cursor-not-allowed opacity-70`}
        >
          <BookOpen className="w-4 h-4 text-[#9ca3af]" />
          Research papers
        </button>
      </div>

      <div className="h-px w-full bg-black/5 shadow-[0_1px_0_white] mb-4" />

      <div className="flex flex-col gap-1 flex-1">
        <p className="px-2 text-[12px] font-semibold text-[#9ca3af] mb-1 uppercase tracking-wider">Buckets</p>

        <button type="button" disabled className={`${navBtn} text-[#9ca3af] cursor-not-allowed opacity-70`}>
          <Coins className="w-4 h-4 text-[#9ca3af]" />
          Solana
        </button>

        <button type="button" disabled className={`${navBtn} text-[#9ca3af] cursor-not-allowed opacity-70`}>
          <Heart className="w-4 h-4 text-[#9ca3af]" />
          Health
        </button>

        <button type="button" disabled className={`${navBtn} text-[#9ca3af] cursor-not-allowed opacity-70`}>
          <Dog className="w-4 h-4 text-[#9ca3af]" />
          Memecoin
        </button>
      </div>
    </aside>
  );
}
