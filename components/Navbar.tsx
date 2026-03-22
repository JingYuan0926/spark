import Link from "next/link";

interface NavbarProps {
  onSignOut?: () => void;
  children?: React.ReactNode;
}

export function Navbar({ onSignOut, children }: NavbarProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-[#483519]/10 bg-[#f5f0e8]">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center">
          <img src="/logo.png" alt="SPARK" className="h-8" />
        </Link>

        <nav className="flex items-center gap-1">
          {children}
          {onSignOut && (
            <button
              onClick={onSignOut}
              className="px-4 py-1 text-sm font-semibold text-[#483519]/40 transition hover:text-red-600"
            >
              Sign Out
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
