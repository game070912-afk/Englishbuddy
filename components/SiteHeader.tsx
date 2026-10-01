import Link from "next/link";

/**
 * 全站顶部导航。
 */
export default function SiteHeader() {
  return (
    <header className="h-16 border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-full max-w-3xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-semibold text-indigo-500">
          EnglishBuddy
        </Link>
        <nav className="flex items-center gap-4 text-sm text-slate-600">
          <Link href="/chat" className="transition hover:text-indigo-500">
            对话练习
          </Link>
          <Link href="/correct" className="transition hover:text-indigo-500">
            语法纠错
          </Link>
        </nav>
      </div>
    </header>
  );
}
