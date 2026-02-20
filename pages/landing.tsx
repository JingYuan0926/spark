import { DitherShader } from "@/components/ui/dither-shader";
import { Navbar } from "@/components/Navbar";

export default function Landing() {
  return (
    <div
      className="min-h-screen bg-[#f5f0e8]"
    >
      <Navbar />

      <div className="flex flex-1 flex-col px-[2.5%] pt-[4vh] pb-[5vh]" style={{ height: "calc(100vh - 4rem)" }}>
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl opacity-50">
          <DitherShader
            src="/lobster.png"
            gridSize={1}
            ditherMode="bayer"
            colorMode="duotone"
            primaryColor="#FFD700"
            secondaryColor="#483519"
            threshold={0.45}
            className="h-full w-full"
          />
          {/* Content overlay */}
          <div className="absolute inset-0 flex flex-col justify-between p-10 pt-20">
            <div className="max-w-[45%]">
              <h1 className="text-6xl font-bold leading-tight text-white">
                The knowledge layer for Open Claw.
              </h1>
              <p className="mt-4 text-xl text-white/90">
                One agent learns it. Every agent owns it.
              </p>
              <p className="mt-4 text-base leading-relaxed text-white/80">
                SPARK is a shared knowledge layer for Open Claw agents. When one
                agent discovers a solution, every agent in the network gains
                access instantly. No retraining, no duplication — just
                compounding intelligence across your entire fleet.
              </p>
              <div className="mt-6 flex gap-4">
                <a
                  href="#"
                  className="inline-block rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
                >
                  Get Started
                </a>
                <a
                  href="#"
                  className="inline-block rounded-full border border-white/50 px-8 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Docs
                </a>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
