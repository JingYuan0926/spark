import { useState, useEffect, useRef } from "react";
import { spinners } from "unicode-animations";

const SPINNER_NAMES = Object.keys(spinners) as (keyof typeof spinners)[];

function SpinnerPreview({ name }: { name: keyof typeof spinners }) {
  const spinner = spinners[name];
  const [frame, setFrame] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setFrame((f) => (f + 1) % spinner.frames.length);
    }, spinner.interval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [spinner]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-[#141414] p-6 transition hover:border-[#fc4501]/50 hover:bg-[#1a1a1a]">
      <div className="flex h-16 items-center justify-center font-mono text-3xl text-white whitespace-pre">
        {spinner.frames[frame]}
      </div>
      <p className="text-sm font-semibold text-white">{name}</p>
      <p className="text-xs text-[#757575]">
        {spinner.frames.length} frames / {spinner.interval}ms
      </p>
    </div>
  );
}

export default function IconsPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold text-white">Unicode Animations</h1>
        <p className="mt-2 text-sm text-[#757575]">
          Pick one for the SPARK dashboard. All {SPINNER_NAMES.length} spinners from{" "}
          <code className="text-[#fc4501]">unicode-animations</code>
        </p>

        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {SPINNER_NAMES.map((name) => (
            <SpinnerPreview key={name} name={name} />
          ))}
        </div>
      </div>
    </div>
  );
}
