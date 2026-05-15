import { ImageDithering } from '@paper-design/shaders-react';
import { useNavigate } from 'react-router';
import "../index.css";

import InvestBucketUi from "../assets/invest_bucket_ui.png";
import CreateBucketUi from "../assets/create_bucket_ui.png";
import HumanCentricUi from "../assets/human_centric_ui.png";
import DemutualLogo from "../assets/demutual.png";

export function Landing() {
  const navigate = useNavigate();
  const goDashboard = () => navigate("/dashboard");

  return (
    <div className="p-0 md:p-2 w-screen min-h-screen bg-transparent font-sans">
      <div className="w-full relative overflow-hidden">
        {/* Background layer */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          <svg
            viewBox="0 0 871 720"
            preserveAspectRatio="xMidYMax slice"
            className="w-full h-full block"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <clipPath id="hero-shape">
                <path d="M399.177 708.572L9.04795 539.918C3.55591 537.544 0.000121188 532.133 0.000119825 526.149L3.41611e-06 15C0 6.71573 6.71573 0 15 0H855.928C864.213 0 870.928 6.71574 870.928 15L870.928 525.948C870.928 532.029 867.256 537.509 861.631 539.821L449.928 709.031C433.641 715.725 415.341 715.56 399.177 708.572Z" />
              </clipPath>
            </defs>

            <foreignObject x="0" y="0" width="871" height="720" clipPath="url(#hero-shape)">
              <div style={{ width: '100%', height: '100%' }}>
                <ImageDithering
                  width={871}
                  height={720}
            image="https://pbs.twimg.com/media/G4CN9vdWUAAfiVD.jpg"
            colorBack="#000c38"
            colorFront="#94ffaf"
            colorHighlight="#eaff94"
            originalColors={false}
            inverted={false}
            type="4x4"
            size={1}
            colorSteps={4}
            fit="cover"
          />
              </div>
            </foreignObject>
          </svg>
        </div>
        {/* Foreground UI overlay */}
        <div className="relative z-10 flex flex-col text-white min-h-[95vh] md:min-h-[850px] md:aspect-[871/720] pb-[25vw] md:pb-[18vw]">
          {/* Navigation */}
          <nav className="w-full flex justify-between items-center px-4 md:px-[3%] py-4 md:py-[2.5%] pointer-events-auto">
            {/* Logo */}
            <div className="flex items-center ">
              <img
                src={DemutualLogo}
                alt="Demutual"
                className="w-12 h-12 md:w-16 md:h-16 object-contain "
              />
              <span className="font-semibold text-lg md:text-[22px] tracking-tight text-white ">Demutual</span>
            </div>

            {/* Links */}
            <div className="hidden md:flex items-center space-x-7 text-[15px] font-medium tracking-tight text-white">
              <button type="button" className="flex items-center hover:text-white/80 transition-colors">
                What do we do
              </button>
              <button type="button" className="flex items-center hover:text-white/80 transition-colors">
                Why us
              </button>
              <button type="button" className="flex items-center hover:text-white/80 transition-colors">
                Contact us
              </button>
            </div>

            {/* Actions */}
            <button
              type="button"
              onClick={goDashboard}
              className="bg-white text-[#242424] px-4 py-2 md:px-5 md:py-2.5 rounded-lg text-sm md:text-[14px] font-semibold tracking-tight hover:bg-white/90 transition-all"
            >
              Get started
            </button>
          </nav>

          {/* Hero Content */}
          <main className="flex flex-col items-center text-center px-4 md:px-[2%] mt-[8vh] md:mt-[11vh] pointer-events-auto">
            <h1 className="text-5xl md:text-[5vw] xl:text-[70px] font-sans font-normal tracking-tighter text-white/ mb-4 md:mb-[2%] max-w-[900px] leading-[1.05]">
              Create or Invest in <span className="font-serif italic text-[#94ffaf] [text-shadow:2px_2px_20px_rgba(0,0,0,0.2)]">Decentralized</span><br className="hidden md:block" /> Mutual Funds on <span className="font-serif italic text-[#94ffaf] [text-shadow:2px_2px_20px_rgba(0,0,0,0.2)] ">Solana</span>
            </h1>
            <p className="text-base md:text-[1.2vw] xl:text-[20px] font-normal tracking-tight  text-white/90 max-w-[700px] mb-8 md:mb-[3%] leading-[1.4] md:leading-[1.2]">
              Not sure what coins to buy? Start with buckets.
              Invest in curated portfolios, or create one yourself for others.
              Diversified, simple, and fully transparent.
            </p>
            <button
              type="button"
              onClick={goDashboard}
              className="bg-[#94ffaf] text-[#242424] px-6 py-3 md:px-7 md:py-2 rounded-md text-base md:text-[15px] font-semibold tracking-tight hover:bg-[#94ffaf]/90 transition-all shadow-md"
            >
              Get started
            </button>
          </main>

        </div>
      </div>

      {/* Screen Bottom Logos */}
      <div className="absolute top-[calc(100vh-10rem)] left-0 right-0 z-50 flex flex-col items-center pointer-events-none">
        <p className="text-white/70 text-[15px] md:text-[18px] font-medium tracking-wide mb-4 md:mb-0">Built with help of</p>
        <div className="flex flex-wrap justify-center items-center gap-8 md:gap-16 px-4 pointer-events-auto">
          <img src="https://res.cloudinary.com/dbvotc5ja/image/upload/v1778536243/vecteezy_solana-logo-on-transparent-background_-removebg-preview_iisbto.png" alt="Solana" className="h-10 md:h-16 object-contain brightness-0 invert opacity-80 hover:opacity-100 transition-opacity cursor-pointer" />
          <img src="https://res.cloudinary.com/dbvotc5ja/image/upload/v1778536238/c3ad730ba88957fe84a12cc5319652c6f995bdb2_2_690x345-removebg-preview_mwpnem.png" alt="Partner Logo" className="h-10 md:h-16 object-contain brightness-0 invert opacity-80 hover:opacity-100 transition-opacity cursor-pointer" />
          <img src="https://assets.bitdegree.org/images/phantom-wallet-review-square-logo-v1.png?tr=w-250" alt="Phantom Wallet" className="h-10 md:h-16 object-contain brightness-0 invert opacity-80 hover:opacity-100 transition-opacity cursor-pointer" />
          <img src="https://images.ctfassets.net/23fkqdsgbpuj/1t0njrGaxERm0tVkwo3sNF/cee88331e9ec6f9c2351cdec444ba7e1/1666227862821.png" alt="Sponsor" className="h-10 md:h-16 object-contain brightness-0 invert opacity-80 hover:opacity-100 transition-opacity cursor-pointer" />
          <img src="https://files.readme.io/44295bd-Birdeye_Logo_Black_full_logo_400x400.png" alt="Birdeye" className="h-16 md:h-24 object-contain brightness-0 invert opacity-80 hover:opacity-100 transition-opacity cursor-pointer" />
        </div>
      </div>

      {/* How it Works Section */}
      <section className="w-full max-w-7xl mx-auto mt-16 md:mt-24 px-6 md:px-12 py-16 md:py-32 rounded-[40px] text-black ">

        {/* Row 1: Invest */}
        <div className="flex flex-col md:flex-row items-center gap-12 md:gap-24 mb-32">
          <div className="flex-1 order-2 md:order-1">
            <h2 className="font-sans font-medium text-black text-[40px] md:text-[56px] leading-[1.1] mb-6 tracking-tighter">
              Invest in <span className="font-serif italic font-normal">Buckets</span>
            </h2>
            <p className="font-sans font-normal text-black/80 text-[18px] leading-[1.5] mb-8 max-w-xl">
              Not sure what coins to buy? Don't stress. Put your money into diversified baskets created by experts or the community.
              <br /><br />
              It's safe, transparent, and built for people who want simple exposure without the trading noise.
            </p>
            <button
              type="button"
              onClick={goDashboard}
              className="border-b border-black text-black pb-1 font-semibold hover:opacity-70 transition-opacity"
            >
              Explore portfolios &rarr;
            </button>
          </div>
          <div className="flex-1 order-1 md:order-2 w-full max-w-md md:max-w-none">
            <div className="relative rounded-[32px] overflow-hidden bg-white p-4 md:p-4 shadow-2xs  border border-black/5">
              <img src={InvestBucketUi} alt="Invest in Portfolios" className="w-full rounded-[20px] " />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/5 to-transparent pointer-events-none rounded-[32px]" />
            </div>
          </div>
        </div>

        {/* Row 2: Create */}
        <div className="flex flex-col md:flex-row items-center gap-12 md:gap-24 mb-32">
          <div className="flex-1 w-full max-w-md md:max-w-none">
            <div className="relative rounded-[32px] overflow-hidden bg-white p-4 md:p-4 shadow-2xs border border-black/5">
              <img src={CreateBucketUi} alt="Create Portfolios" className="w-full rounded-[20px] " />
              <div className="absolute inset-0 bg-gradient-to-bl from-black/5 to-transparent pointer-events-none rounded-[32px]" />
            </div>
          </div>
          <div className="flex-1">
            <h2 className="font-sans font-medium text-black text-[40px] md:text-[56px] leading-[1.1] mb-6 tracking-tighter">
              Create a <span className="font-serif italic font-normal">Bucket</span>
            </h2>
            <p className="font-sans font-normal text-black/80 text-[18px] leading-[1.5] mb-8 max-w-xl">
              Got a thesis? Create your own mutual-fund-style portfolio in seconds.
              Share your strategy with the world, track your allocation history entirely on-chain, and earn a flat 0.4% creator fee.
            </p>
            <button
              type="button"
              onClick={goDashboard}
              className="border-b border-black text-black pb-1 font-semibold hover:opacity-70 transition-opacity"
            >
              Start building &rarr;
            </button>
          </div>
        </div>

        {/* Row 3: Human Centric */}
        <div className="flex flex-col md:flex-row items-center gap-12 md:gap-24">
          <div className="flex-1 order-2 md:order-1">
            <h2 className="font-sans font-medium text-black text-[40px] md:text-[56px] leading-[1.1] mb-6 tracking-tighter">
              Built for Humans,<br />Not <span className="font-serif italic font-normal">Developers</span>
            </h2>
            <p className="font-sans font-normal text-black/80 text-[18px] leading-[1.5] mb-8 max-w-xl">
              We abstract away the messy crypto plumbing—no RPCs, no SPL standards, and no complex DeFi composability to worry about.
              <br /><br />
              You just get a clean, beautiful financial interface that finally answers, <em>"where do I put my money?"</em>
            </p>
            <button
              type="button"
              onClick={goDashboard}
              className="border-b border-black text-black pb-1 font-semibold hover:opacity-70 transition-opacity"
            >
              Learn more &rarr;
            </button>
          </div>
          <div className="flex-1 order-1 md:order-2 w-full max-w-md md:max-w-none">
            <div className="relative rounded-[32px] overflow-hidden bg-white p-4 md:p-4 shadow-2xs border border-black/5">
              <img src={HumanCentricUi} alt="Human Centric Interface" className="w-full rounded-[20px] " />
              <div className="absolute inset-0 bg-gradient-to-tr from-black/5 to-transparent pointer-events-none rounded-[32px]" />
            </div>
          </div>
        </div>

      </section>

      {/* Footer CTA — pastel green slab, text-only */}
      <footer className="bg-[#edf6e3] m-4 rounded-lg overflow-hidden">
        <div className="flex flex-col px-8 md:px-14 py-10 md:py-14">
          <h2 className="font-sans font-medium text-black text-[28px] md:text-[44px] leading-[1.1] tracking-tighter mb-6">
            Stop wasting time and<br />
            trade your first <span className="font-serif italic font-normal">bucket</span> full of crypto
          </h2>
          <button
            type="button"
            onClick={goDashboard}
            className="self-start bg-black text-white px-6 py-2.5 rounded-md text-[14px] font-semibold tracking-tight hover:bg-black/90 transition-all shadow-md"
          >
            Get started &rarr;
          </button>
        </div>
      </footer>

    </div>
  );
}

export default Landing;
