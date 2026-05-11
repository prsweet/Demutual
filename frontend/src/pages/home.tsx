import { CodeXml, Tag, Users, Pencil } from "lucide-react";
import "./index.css";

export function Home() {
  return (
    <div className="min-h-screen tracking-tighter flex items-center justify-center p-8 relative z-10">
      
      {/* Card Container */}
      <div 
        className="w-[320px] rounded-[1.25rem] p-5 text-left bg-[#f8f9f7] 
        shadow-[inset_0_0px_1px_rgba(255,255,255,1),inset_0_0_0_1.5px_rgba(255,255,255,0.8),0_0_0_1px_rgba(0,0,0,0.1),0_12px_24px_-4px_rgba(0,0,0,0.05),0_4px_8px_-2px_rgba(0,0,0,0.04)]"

      >
        
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="bg-[#4ade80] p-1.5 rounded-lg shadow-[inset_0_1px_1px_rgba(255,255,255,0.4),0_2px_4px_rgba(74,222,128,0.3)]">
            <CodeXml className="w-4 h-4 text-white stroke-[2.5]" />
          </div>
          <h2 className="text-[17px] font-semibold text-[#1a1c1e] tracking-tight">Software engineer</h2>
        </div>
        
        <p className="text-[15px] text-[#6b7280] font-medium tracking-tight mb-4">
          Looking for a senior software engin...
        </p>

        {/* Divider */}
        {/* <div className="h-px bg-gradient-to-r from-transparent via-[#0000000a] to-transparent bg-[#00000008] w-[calc(100%+40px)] -ml-5 my-4"></div> */}
        <div className="h-px w-[calc(100%+40px)] -ml-5 my-4 bg-black/5 shadow-[0_1.5px_0_white]"></div>

        {/* Details List */}
        <div className="flex flex-col gap-3.5 mt-5">
          <div className="flex items-center text-[15px]">
            <Tag className="w-[18px] h-[18px] text-[#9ca3af] fill-current" />
            <span className="font-semibold text-[#374151] ml-3">Status:</span>
            <span className="ml-auto text-[#6b7280] font-medium">Active</span>
          </div>

          <div className="flex items-center text-[15px]">
            <Users className="w-[18px] h-[18px] text-[#9ca3af] fill-current" />
            <span className="font-semibold text-[#374151] ml-3">Candidates:</span>
            <span className="ml-auto text-[#6b7280] font-medium">24 shortlisted</span>
          </div>

          <div className="flex items-center text-[15px]">
            <Pencil className="w-[18px] h-[18px] text-[#9ca3af] fill-current" />
            <span className="font-semibold text-[#374151] ml-3">Created by:</span>
            <span className="ml-auto text-[#6b7280] font-medium">Beane Anthony</span>
          </div>
        </div>

      </div>

    </div>
  );
}

export default Home;