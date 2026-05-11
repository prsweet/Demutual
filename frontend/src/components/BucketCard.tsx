import React from "react";
import { useNavigate } from "react-router";
import { CodeXml, Coins } from "lucide-react";

export interface BucketCardProps {
  id: string;
  title: string;
  description: string;
  apy: string | number;
  creatorName?: string;
  assetsCount?: number;
  icon?: React.ReactNode;
}

export function BucketCard({
  id,
  title,
  description,
  apy,
  creatorName,
  assetsCount = 0,
  icon
}: BucketCardProps) {
  const navigate = useNavigate();
  const open = () => navigate(`/buckets/${encodeURIComponent(id)}`);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="w-full h-full flex flex-col rounded-[1.25rem] p-5 text-left bg-[#f8f9f7]
      shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.05)]
      hover:shadow-[inset_0_3px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.12)]
      transition-all cursor-pointer group outline-none focus-visible:ring-2 focus-visible:ring-[#1a1c1e]/20 focus-visible:ring-offset-2"
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="bg-[#4ade80] p-2 rounded-lg shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(74,222,128,0.3)] shrink-0">
          {icon || <CodeXml className="w-6 h-6 text-white stroke-[2.5]" />}
        </div>
        <div className="flex flex-col min-w-0 justify-center">
          <h2 className="text-[17px] font-semibold text-[#1a1c1e] tracking-tight truncate  ">{title}</h2>
          <p className="text-[14px] text-[#6b7280] font-normal truncate tracking-normal leading-tight">by {creatorName || "Unknown Creator"}</p>
        </div>
      </div>

      {/* Main Stats */}
      <div className="flex flex-col mb-4 tracking-tight">
        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="text-[32px] font-medium text-[#1a1c1e] leading-none">0.01 SOL</span>
          <span className="text-[14px] text-[#9ca3af] font-normal">(min)</span>
        </div>
        <div className="text-[14px] font-medium text-[#47cb77] flex items-center gap-1">
          ▲ +{apy}
        </div>
      </div>

      {/* Description & Assets Badge */}
      <div className="flex items-center justify-between mt-auto mb-4 gap-4">
        <div className="w-1/2">
          <div className="text-[12px] text-[#6b7280] tracking-normal line-clamp-2 leading-snug">
            {description}
          </div>
        </div>
        <div className="w-1/2 flex justify-end">
          <div className="flex items-center gap-1.5 px-1 py-1 rounded-sm bg-[#4ade80]/15   ">
            <Coins className="w-3.5 h-3.5 text-[#22c55e]" />
            <span className="text-[12px] font-medium text-[#16a34a] tracking-tight">{assetsCount} {assetsCount === 1 ? 'Asset' : 'Assets'}</span>
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="pt-2 mt-auto">
        <div className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#f8f9f7] text-[#374151] rounded-[10px] text-[14px] font-medium transition-all shadow-[inset_0_3px_2px_rgba(255,255,255,1),inset_0_0_0_1px_rgba(255,255,255,0.5),0_0_0_1px_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.04)] hover:-translate-y-[1px]
hover:bg-[#f8fbf6]
">
          <span>Know more</span>
          <span className="text-[16px] font-medium leading-none transition-transform duration-300 group-hover:translate-x-1.5">→</span>
        </div>
      </div>
    </div>
  );
}
