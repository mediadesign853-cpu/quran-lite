import { useEffect, useRef, useState } from 'react';
import { Bookmark, X, Trash2, BookOpen } from 'lucide-react';
import type { Language, SurahMeta } from '@/types/quran';
import { getBookmarks, removeBookmark, useBookmarksVersion, type BookmarkEntry } from '@/lib/bookmarks';
import { fetchSurah, fetchSurahList } from '@/lib/quranData';
import { trapFocus } from '@/lib/focusTrap';

interface BookmarksPanelProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onNavigate: (surahNumber: number, ayahNumber: number) => void;
}

interface SurahDisplayData {
  meta: SurahMeta;
  ayahs: string[];
}

export default function BookmarksPanel({ isOpen, onClose, language, onNavigate }
  : BookmarksPanelProps) {
  useBookmarksVersion();

  const bookmarks = getBookmarks().sort(
    (a, b) => b.createdAt - a.createdAt
  );
  
  const surahNumbersKey = [
    ...new Set(bookmarks.map((item) => item.surahNumber)),
  ]
    .sort((a, b) => a - b)
    .join(','); 
  const [loadState, setLoadState] = useState<
    | { key: string; status: 'loaded'; data: Record<number, SurahDisplayData> }
    | { key: string; status: 'error' }
    | null
  >(null);
  const loading = Boolean(isOpen && surahNumbersKey && loadState?.key !== surahNumbersKey);
  const loadError = Boolean(surahNumbersKey && loadState?.key === surahNumbersKey && loadState.status === 'error');
  const displaySurahData = loadState?.key === surahNumbersKey && loadState.status === 'loaded'
    ? loadState.data
    : {};
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    (dialog as HTMLElement & { inert: boolean }).inert = !isOpen;
    if (!isOpen) return;

    const releaseFocus = trapFocus(dialog, closeButtonRef.current);
    return () => {
      (dialog as HTMLElement & { inert: boolean }).inert = true;
      releaseFocus();
    };
  }, [isOpen]);

  // Load display labels and ayah text from the canonical Quran files; the bookmark store itself
  // contains only surah/ayah IDs so it never becomes stale after a text or metadata correction.
  useEffect(() => {
    if (!isOpen || !surahNumbersKey) return;
  
    let active = true;
  
    const numbers = surahNumbersKey.split(',').map(Number);
  
  
    Promise.all([
      fetchSurahList(),
      ...numbers.map(async (number) => ({
        number,
        data: await fetchSurah(number),
      })),
    ])
      .then((results) => {
        if (!active) return;
  
        const list = results[0] as SurahMeta[];
  
        const entries = results.slice(1) as Array<{
          number: number;
          data: Awaited<ReturnType<typeof fetchSurah>>;
        }>;
  
        const next: Record<number, SurahDisplayData> = {};
  
        for (const entry of entries) {
          const meta = list[entry.number - 1];
          const edition = entry.data[0];
  
          if (meta && edition) {
            next[entry.number] = {
              meta,
              ayahs: edition.ayahs.map((ayah) => ayah.text),
            };
          }
        }
  
        setLoadState({ key: surahNumbersKey, status: 'loaded', data: next });
      })
      .catch(() => {
        if (active) setLoadState({ key: surahNumbersKey, status: 'error' });
      });
  
    return () => {
      active = false;
    };
  }, [isOpen, surahNumbersKey]);
  
  const handleRemove = (surahNumber: number, ayahNumber: number) => {
    removeBookmark(surahNumber, ayahNumber);
  };

  const handleNavigate = (surahNumber: number, ayahNumber: number) => {
    onNavigate(surahNumber, ayahNumber);
    onClose();
  };

  const t = language === 'fa';

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'var(--overlay)' }}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal={isOpen}
        aria-label={t ? 'آیه‌های نشان‌شده' : 'الآيات المعلّمة'}
        aria-hidden={!isOpen}
        className={`fixed top-0 right-0 h-full w-80 bg-[var(--bg-card)] shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-out overflow-hidden ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="sticky top-0 bg-[var(--bg-card)] border-b border-[var(--border)] px-4 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Bookmark className="w-5 h-5 text-[var(--accent)]" />
            <h2 className="text-sm font-semibold">
              {t ? 'آیه‌های نشان‌شده' : 'الآيات المعلّمة'}
            </h2>
          </div>
          <button ref={closeButtonRef} onClick={onClose} aria-label={t ? 'بستن پنل نشان‌ها' : 'إغلاق العلامات'} className="p-1.5 rounded-lg hover:bg-[var(--border-light)] transition-smooth focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
            <X className="w-5 h-5 text-[var(--text-secondary)]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {bookmarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-8 text-center">
              <Bookmark className="w-12 h-12 text-[var(--border)] mb-3" />
              <p className="text-sm text-[var(--text-secondary)]">
                {t ? 'هنوز آیه‌ای نشان نشده است' : 'لا توجد آيات معلّمة بعد'}
              </p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                {t ? 'با انتخاب نشان کنار آیه، آن را ذخیره کنید' : 'اضغط على علامة الآية لحفظها'}
              </p>
            </div>
          ) : (
            <div className="p-2">
              {loading && <p className="px-3 py-2 text-xs text-[var(--text-secondary)]" role="status">{t ? 'در حال بارگذاری آیه‌ها…' : 'جارٍ تحميل الآيات…'}</p>}
              {loadError && <p className="px-3 py-2 text-xs text-amber-700" role="alert">{t ? 'بارگذاری متن برخی آیه‌ها ناموفق بود؛ می‌توانید با شماره به آن‌ها بروید.' : 'تعذّر تحميل بعض الآيات؛ يمكنك الانتقال إليها بأرقامها.'}</p>}
              {bookmarks.map((bm: BookmarkEntry) => {
                const detail = displaySurahData[bm.surahNumber];
                const name = detail?.meta.name ?? (t ? `سورهٔ ${bm.surahNumber}` : `سورة ${bm.surahNumber}`);
                const englishName = detail?.meta.englishName ?? '';
                const text = detail?.ayahs[bm.ayahNumber - 1] ?? '';
                return (
                  <div
                    key={bm.key}
                    className="group flex items-start gap-3 px-3 py-3 rounded-lg mb-1 hover:bg-[var(--bg-secondary)] transition-smooth"
                  >
                    <div className="w-9 h-9 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <BookOpen className="w-4 h-4 text-[var(--accent)]" />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleNavigate(bm.surahNumber, bm.ayahNumber)}
                      className="flex-1 min-w-0 text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                      aria-label={t ? `رفتن به ${name}، آیهٔ ${bm.ayahNumber}` : `الانتقال إلى ${name}، الآية ${bm.ayahNumber}`}
                    >
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <span className="text-xs font-medium text-[var(--accent)]">
                          {name} · {bm.surahNumber}:{bm.ayahNumber}
                        </span>
                        <span className="text-xs text-[var(--text-secondary)]">
                          {englishName}
                        </span>
                      </div>
                      <p className="font-quran text-sm text-[var(--text-primary)] leading-relaxed line-clamp-2" dir="rtl">
                        {text || (loading ? '…' : '')}
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(bm.surahNumber, bm.ayahNumber)}
                      className="flex-shrink-0 p-1.5 rounded-lg hover:bg-red-500/10 transition-smooth opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                      aria-label={t ? `حذف نشان آیهٔ ${bm.ayahNumber}` : `حذف علامة الآية ${bm.ayahNumber}`}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
