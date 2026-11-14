import { useState, useEffect, useCallback, useRef } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import Reader from '@/components/Reader';
import SettingsPanel from '@/components/SettingsPanel';
import BookmarksPanel from '@/components/BookmarksPanel';
import PageViewer from '@/components/PageViewer';
import type { PageTarget } from '@/lib/pageImages';
import type { SurahMeta, SurahEdition, AppSettings } from '@/types/quran';
import {
  fetchSurahList,
  fetchSurah,
  loadSettings,
  saveSettings,
} from '@/lib/quranData';
import { recordAyahSearch, purgeLegacyStorage } from '@/lib/viewStats';
import { addHistory } from '@/lib/history';
import { getLastReadPosition, saveLastReadPosition } from '@/lib/lastRead';
import { useCopyStatus } from '@/app/hooks/useCopyStatus';
import { useServiceWorkerUpdate } from '@/app/hooks/useServiceWorkerUpdate';

export default function App() {
  const [surahs, setSurahs] = useState<SurahMeta[]>([]);
  const [currentSurah, setCurrentSurah] = useState<number | null>(null);
  const [surahData, setSurahData] = useState<SurahEdition[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [listRetry, setListRetry] = useState(0);
  const [surahRetry, setSurahRetry] = useState(0);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [targetAyah, setTargetAyah] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewPage, setViewPage] = useState<PageTarget | null>(null);
  const copyStatus = useCopyStatus();
  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate();
  const pendingTargetRef = useRef<number | null>(null);

  useEffect(() => {
    purgeLegacyStorage();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.lang = settings.language;
    document.documentElement.dir = 'rtl';
  }, [settings.theme, settings.language]);

  // Load the surah catalogue independently so a failure can be retried without a page refresh.
  useEffect(() => {
    let active = true;
    fetchSurahList()
      .then((list) => {
        if (!active) return;
        setSurahs(list);
        setCurrentSurah((current) => {
          if (current !== null) return current;
          const lastRead = getLastReadPosition();
          const lastReadSurah = lastRead ? list.find((item) => item.number === lastRead.surah) : undefined;
          if (lastRead && lastReadSurah && lastRead.ayah <= lastReadSurah.numberOfAyahs) {
            pendingTargetRef.current = lastRead.ayah;
            return lastRead.surah;
          }
          pendingTargetRef.current = null;
          return 1;
        });
      })
      .catch(() => {
        if (!active) return;
        setListError(true);
      })
      .finally(() => {
        if (active) setListLoading(false);
      });
    return () => {
      active = false;
    };
  }, [listRetry]);

  // Ignore stale requests: fast navigation must never let an older response replace the selected surah.
  useEffect(() => {
    if (currentSurah === null) return;
    let active = true;
    fetchSurah(currentSurah)
      .then((data) => {
        if (!active) return;
        setSurahData(data);
        setLoading(false);
        if (pendingTargetRef.current !== null) {
          const ayah = pendingTargetRef.current;
          setTargetAyah(ayah);
          saveLastReadPosition(currentSurah, ayah);
          pendingTargetRef.current = null;
        } else {
          saveLastReadPosition(currentSurah, 1);
        }
      })
      .catch(() => {
        if (!active) return;
        setError('load-surah-failed');
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentSurah, surahRetry]);

  const handleSelectSurah = useCallback((n: number) => {
    pendingTargetRef.current = null;
    if (n !== currentSurah) {
      setLoading(true);
      setError(null);
      setSurahData(null);
      setTargetAyah(null);
      setCurrentSurah(n);
    }
    setSidebarOpen(false);
    setSearchQuery('');
  }, [currentSurah]);

  const handleNavigateSurah = useCallback((surahNumber: number, ayahNumber?: number, query?: string, record = true) => {
    if (query) setSearchQuery(query);
    if (record && query && ayahNumber !== undefined) {
      recordAyahSearch(surahNumber, ayahNumber);
      addHistory(surahNumber, ayahNumber, query);
    }
    if (surahNumber !== currentSurah) {
      setLoading(true);
      setError(null);
      setSurahData(null);
      setTargetAyah(null);
      pendingTargetRef.current = ayahNumber ?? null;
      setCurrentSurah(surahNumber);
    } else if (ayahNumber !== undefined) {
      setTargetAyah(null);
      window.setTimeout(() => setTargetAyah(ayahNumber), 50);
    }
  }, [currentSurah]);

  const handleRetrySurah = useCallback(() => {
    setLoading(true);
    setError(null);
    setSurahData(null);
    setSurahRetry((value) => value + 1);
  }, []);

  const handleToggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  const handleOpenBookmarks = useCallback(() => {
    setSidebarOpen(false);
    setBookmarksOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        setBookmarksOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSettingsChange = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const handleToggleTheme = useCallback(() => {
    const theme: 'light' | 'dark' = settings.theme === 'light' ? 'dark' : 'light';
    const next = { ...settings, theme };
    setSettings(next);
    saveSettings(next);
  }, [settings]);

  const handlePrev = useCallback(() => {
    pendingTargetRef.current = null;
    if (currentSurah && currentSurah > 1) {
      setLoading(true);
      setError(null);
      setSurahData(null);
      setTargetAyah(null);
      setCurrentSurah(currentSurah - 1);
    }
    setSearchQuery('');
  }, [currentSurah]);

  const handleNext = useCallback(() => {
    pendingTargetRef.current = null;
    if (currentSurah && currentSurah < 114) {
      setLoading(true);
      setError(null);
      setSurahData(null);
      setTargetAyah(null);
      setCurrentSurah(currentSurah + 1);
    }
    setSearchQuery('');
  }, [currentSurah]);

  const surahMeta = currentSurah ? surahs.find((surah) => surah.number === currentSurah) ?? null : null;

  if (listLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center">
            <BookOpen className="w-8 h-8 text-[var(--accent)]" />
          </div>
          <div className="flex items-center gap-2" aria-label="Loading">
            <span className="loading-dot" />
            <span className="loading-dot" />
            <span className="loading-dot" />
          </div>
        </div>
      </div>
    );
  }

  if (listError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-6" role="alert">
        <div className="max-w-md text-center space-y-3">
          <BookOpen className="w-10 h-10 text-[var(--accent)] mx-auto" />
          <p className="text-[var(--text-primary)]">
            {settings.language === 'fa' ? 'فهرست سوره‌ها بارگذاری نشد.' : 'تعذّر تحميل قائمة السور.'}
          </p>
          <button onClick={() => {
            setListLoading(true);
            setListError(false);
            setListRetry((value) => value + 1);
          }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-white">
            <RefreshCw className="w-4 h-4" />
            {settings.language === 'fa' ? 'تلاش دوباره' : 'إعادة المحاولة'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[var(--bg-primary)]">
      <Sidebar
        surahs={surahs}
        currentSurah={currentSurah}
        onSelectSurah={handleSelectSurah}
        language={settings.language}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <Reader
        surahMeta={surahMeta}
        surahData={surahData}
        loading={loading}
        error={error}
        onRetry={handleRetrySurah}
        settings={settings}
        surahs={surahs}
        targetAyah={targetAyah}
        searchQuery={searchQuery}
        onPrev={handlePrev}
        onNext={handleNext}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleSidebar={handleToggleSidebar}
        onOpenBookmarks={handleOpenBookmarks}
        onShowPage={setViewPage}
        onToggleTheme={handleToggleTheme}
        onNavigateSurah={handleNavigateSurah}
        hasPrev={currentSurah !== null && currentSurah > 1}
        hasNext={currentSurah !== null && currentSurah < 114}
      />

      <SettingsPanel settings={settings} onChange={handleSettingsChange} isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <PageViewer
        target={viewPage}
        surahs={surahs}
        language={settings.language}
        onClose={() => setViewPage(null)}
        onChangePage={(page) => setViewPage((value) => (value ? { ...value, page } : value))}
      />
      <BookmarksPanel
        isOpen={bookmarksOpen}
        onClose={() => setBookmarksOpen(false)}
        language={settings.language}
        onNavigate={handleNavigateSurah}
      />

      {copyStatus && (
        <div
          className={`fixed  bottom-[86px] right-6 z-[110] w-fit max-w-[calc(100vw-2rem)] max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border bg-[var(--bg-card)] px-4 py-3 text-sm leading-6 shadow-xl
            ${copyStatus.success ? 'border-[var(--accent)]' : 'border-amber-400'}`}
          dir="auto"
          role={copyStatus.success ? 'status' : 'alert'}
          aria-live={copyStatus.success ? 'polite' : 'assertive'}
        >
          {copyStatus.message}
        </div>
      )}

      {updateAvailable && (
        <div className="fixed bottom-4 left-4 z-[100] flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 shadow-xl" role="status">
          <span className="text-sm text-[var(--text-primary)]">
            {settings.language === 'fa' ? 'نسخهٔ تازه آماده است.' : 'يتوفر تحديث جديد.'}
          </span>
          <button onClick={() => void applyUpdate()} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-sm text-white">
            {settings.language === 'fa' ? 'به‌روزرسانی' : 'تحديث'}
          </button>
        </div>
      )}
    </div>
  );
}