import Link from "next/link";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <img src="/logo.png" alt="SPARK" className="h-8" />
          <span className="text-lg font-bold tracking-tight text-white">
            SPARK
          </span>
        </Link>

        <nav className="flex items-center gap-8">
          <Link
            href="/dashboard"
            className="text-sm font-medium text-[#757575] transition-colors duration-200 hover:text-[#fc4501]"
          >
            Dashboard
          </Link>
          <Link
            href="/register"
            className="text-sm font-medium text-[#757575] transition-colors duration-200 hover:text-[#fc4501]"
          >
            Register
          </Link>
        </nav>
      </div>
    </header>
  );
}
