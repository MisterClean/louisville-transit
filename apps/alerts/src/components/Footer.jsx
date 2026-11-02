export default function Footer() {
  return (
    <footer className="border-t border-slate-200 dark:border-gh-border mt-8">
      <div className="max-w-5xl mx-auto px-4 py-6 text-xs text-slate-500 dark:text-slate-400 space-y-3">
        <p>
          Transit data:{' '}
          <a className="text-blue-500 hover:underline" href="https://www.ridetarc.org/developers/">
            Transit Authority of River City (TARC)
          </a>
          . Unofficial and independent.
        </p>
        <nav className="flex gap-5">
          <a href="/about">About</a>
          <a href="/subscribe">Subscribe</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </div>
    </footer>
  );
}
