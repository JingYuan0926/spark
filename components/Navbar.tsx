import Link from "next/link";

interface NavbarProps {
  onSignOut?: () => void;
  children?: React.ReactNode;
}

export function Navbar({ onSignOut, children }: NavbarProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-[#483519]/10 bg-[#f5f0e8]">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center">
            <img src="/logo.png" alt="SPARK" className="h-8" />
          </Link>
          {children}
        </div>

        <nav className="flex items-center">
          {onSignOut && (
            <button
              onClick={onSignOut}
              className="rounded-lg border border-[#e5e5e5] bg-white px-4 py-1.5 text-sm font-medium text-[#333333] transition-colors duration-200 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
            >
              Sign Out
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
