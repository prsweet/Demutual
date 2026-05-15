import { Link } from "react-router";
import DemutualLogo from "../assets/demutual.png";

export function MobileUnsupportedScreen() {
  return (
    <div className="min-h-screen w-full bg-white flex flex-col items-center justify-center px-6 py-12 tracking-tight">
      <div className="flex flex-col items-center text-center max-w-[340px]">
        <div className="flex items-center gap-0 mb-10">
          <img
            src={DemutualLogo}
            alt=""
            className="w-14 h-14 object-contain"
            aria-hidden
          />
          <span className="text-[22px] font-medium text-[#8b5cf6]">Demutual</span>
        </div>

        <h1 className="text-[20px] font-medium text-[#1a1c1e] leading-snug mb-4">
          Demutual is not supported <br /> on small screens yet
        </h1>

        <p className="text-[14px] text-black/40 font-normal tracking-normal mb-10">
          A mobile-friendly experience is in progress and will roll out in a future update. For
          now, please use a <br/> tablet or desktop browser.
        </p>

        <Link
          to="/"
          className="text-[15px] font-medium text-[#374151] underline underline-offset-4 decoration-[#9ca3af] hover:text-[#1a1c1e] transition-colors"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
