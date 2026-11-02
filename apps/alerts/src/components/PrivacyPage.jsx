import { useDarkMode } from '../hooks/useDarkMode.js';
import Footer from './Footer.jsx';
import Header from './Header.jsx';

export default function PrivacyPage() {
  const [dark, toggleDark] = useDarkMode();
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <Header
        dark={dark}
        onToggleDark={toggleDark}
        onResetFilters={() => {
          window.location.href = '/';
        }}
      />
      <main id="main" className="max-w-3xl mx-auto px-4 py-6 w-full flex-1">
        <h1 className="text-xl font-bold">Privacy</h1>
        <div className="mt-4 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-6 space-y-3 text-sm">
          <p>
            This site stores display preferences and filters in your browser. You can clear them
            through your browser settings.
          </p>
          <p>
            Requests to the site may be processed by its hosting infrastructure to deliver the
            service.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
