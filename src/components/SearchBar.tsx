import { useState, useRef, useEffect, useMemo, useDeferredValue, type ReactNode } from 'react';
import { Search, X, Loader2, BookOpen, FileText, History, Trash2, AlertTriangle, Lightbulb } from 'lucide-react';
import type { SurahMeta, Language } from '@/types/quran';
import {
  searchSurahNames,
  searchAyahs,
  loadSearchIndex,
  getHighlightedSegments,
  type SearchIndex,
  type SearchResult,
  type AyahSearchResult,
  type SurahSearchResult,
} from '@/lib/quranData';
import { parseReference, suggestQuery, type ReferenceWarning } from '@/lib/searchHelp';
import { useHistory, removeHistory, clearHistory } from '@/lib/history';

interface SearchBarProps {
  surahs: SurahMeta[];
  /** the surah that is open: a bare number such as "205" means this surah's ayah 205 */
  currentSurah: number;
  language: Language;
  /** `record` = false when an ayah is reopened from the history (it is not a new search) */
  onNavigateSurah: (surahNumber: number, ayahNumber?: number, query?: string, record?: boolean) => void;
}

/** With more results than this the query is probably what the user meant: no "did you mean" */
const MAX_RESULTS_FOR_SUGGESTION = 3;

/** Message for a reference that does not exist (e.g. "340"). */
function warningText(w: ReferenceWarning, surahs: SurahMeta[], fa: boolean): string {
  if (w.kind === 'surah') {
    return fa
      ? `سوره‌ای با شمارهٔ ${w.value} وجود ندارد؛ شمارهٔ سوره‌ها از ۱ تا ${surahs.length} است.`
      : `لا توجد سورة برقم ${w.value}؛ أرقام السور من ١ إلى ${surahs.length}.`;
  }
  const name = surahs[w.surah - 1]?.name ?? '';
  if (w.kind === 'ayah') {
    return fa
      ? `${name} فقط ${w.max} آیه دارد؛ آیهٔ ${w.value} وجود ندارد.`
      : `${name} فيها ${w.max} آية فقط؛ لا توجد الآية ${w.value}.`;
  }
  return fa
    ? `«${w.value}» نامعتبر است: ${name} ${w.max} آیه دارد و شمارهٔ سوره‌ها از ۱ تا ${surahs.length} است.`
    : `«${w.value}» غير صالح: ${name} فيها ${w.max} آية وأرقام السور من ١ إلى ${surahs.length}.`;
}

export default function SearchBar({ surahs, currentSurah, language, onNavigateSurah }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [indexError, setIndexError] = useState(false);
  const [indexAttempt, setIndexAttempt] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'surahs' | 'ayahs'>('all');
  const history = useHistory();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);

  // The index is one small file: load it right away so the first search is instant too.
  useEffect(() => {
    let active = true;
    loadSearchIndex()
      .then((loaded) => { if (active) setIndex(loaded); })
      .catch(() => { if (active) setIndexError(true); });
    return () => { active = false; };
  }, [indexAttempt]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Typing stays responsive: the results list is rendered from a deferred copy of the text.
  const { results, capped, warning, suggestion } = useMemo(() => {
    const none = { results: [] as SearchResult[], capped: false, warning: undefined, suggestion: null };
    if (!deferredQuery.trim()) return none;

    // "2:250", "205", "بقره 255": go straight to the surah / ayah (or say that it does not exist)
    const reference = parseReference(deferredQuery, surahs, currentSurah);
    if (reference) {
      const hits: SearchResult[] = [];
      const surah = reference.surah ? surahs[reference.surah - 1] : undefined;
      if (surah) hits.push({ type: 'surah', surahNumber: surah.number, surahName: surah.name, englishName: surah.englishName });
      if (reference.ayah && index) {
        const { surah: s, ayah } = reference.ayah;
        hits.push({
          type: 'ayah',
          surahNumber: s,
          surahName: surahs[s - 1].name,
          ayahNumberInSurah: ayah,
          textSnippet: index.texts[s - 1][ayah - 1],
        });
      }
      return { ...none, results: hits, warning: reference.warning };
    }

    const surahHits = searchSurahNames(surahs, deferredQuery);
    if (!index) return { ...none, results: surahHits as SearchResult[] };
    const ayahHits = searchAyahs(index, surahs, deferredQuery);
    // the phrase itself is not in the Quran and little else was found: maybe a typo or a wrong space ("احذ", "أ فحسب")
    const suggestion = ayahHits.exact === 0 && ayahHits.results.length <= MAX_RESULTS_FOR_SUGGESTION ? suggestQuery(index, surahs, deferredQuery) : null;
    return { ...none, results: [...surahHits, ...ayahHits.results] as SearchResult[], capped: ayahHits.capped, suggestion };
  }, [surahs, currentSurah, index, deferredQuery]);
  const loadingIndex = !index && !indexError && query.trim() !== '';
  const retryIndex = () => {
    setIndex(null);
    setIndexError(false);
    setIndexAttempt((attempt) => attempt + 1);
  };

  const handleChange = (value: string) => {
    setQuery(value);
    setShowResults(true);
  };

  const handleClear = () => {
    setQuery('');
    setShowResults(false);
    inputRef.current?.focus();
  };

  const handleResultClick = (result: SearchResult) => {
    onNavigateSurah(result.surahNumber, result.type === 'ayah' ? result.ayahNumberInSurah : undefined, query);
    setShowResults(false);
    setQuery('');
  };

  const handleHistoryClick = (surah: number, ayah: number, historyQuery: string) => {
    onNavigateSurah(surah, ayah, historyQuery, false);
    setShowResults(false);
  };

  const surahResults = results.filter((r): r is SurahSearchResult => r.type === 'surah');
  const ayahResults = results.filter((r): r is AyahSearchResult => r.type === 'ayah');

  const filteredResults =
    activeTab === 'surahs' ? surahResults :
    activeTab === 'ayahs' ? ayahResults :
    results;

  const t = language === 'fa';
  const placeholder = t ? 'جستجو ...' : 'البحث ...';

  function renderHighlighted(text: string) {
    const segments = getHighlightedSegments(text, deferredQuery);
    return segments.map((seg, i) =>
      seg.highlight
        ? <mark key={i} className="search-highlight">{seg.text}</mark>
        : <span key={i}>{seg.text}</span>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-xl mx-auto">
      <div className="relative w-full min-w-0 mx-auto">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (query.trim() || history.length > 0) setShowResults(true); }}
          placeholder={placeholder}
          aria-label={placeholder}
          autoComplete="off"
          className="w-full pr-9 pl-9 py-2 text-sm bg-[var(--bg-card)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)] transition-smooth"
        />
        {query && !loadingIndex && (
          <button
            onClick={handleClear}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[var(--border-light)] transition-smooth"
          >
            <X className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        )}
        {loadingIndex && (
          <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--accent)] animate-spin" />
        )}
      </div>

      {showResults && !query.trim() && history.length > 0 && (
        <div className="absolute top-full mt-2 w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl z-50 max-h-[60vh] flex flex-col animate-scale-in overflow-hidden">
          {/* Search history: ayahs opened from the search results */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-light)]">
            <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
              <History className="w-3.5 h-3.5" />
              {t ? 'تاریخچهٔ جستجو' : 'سجل البحث'}
            </span>
            <button
              onClick={clearHistory}
              className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-red-600 transition-smooth"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t ? 'حذف همه' : 'حذف الكل'}
            </button>
          </div>
          <div className="overflow-y-auto flex-1">
            {history.map((entry) => (
              <div key={`${entry.surah}:${entry.ayah}`} className="flex items-stretch border-b border-[var(--border-light)] hover:bg-[var(--bg-secondary)] transition-smooth">
                <button
                  onClick={() => handleHistoryClick(entry.surah, entry.ayah, entry.query)}
                  className="flex-1 min-w-0 px-4 py-2.5 text-right"
                >
                  <div className="text-xs text-[var(--text-secondary)] mb-0.5">
                    {surahs[entry.surah - 1]?.name} · {entry.surah}:{entry.ayah}
                  </div>
                  <p className="font-quran text-sm text-[var(--text-primary)] truncate" dir="rtl">
                    {index?.texts[entry.surah - 1]?.[entry.ayah - 1] ?? entry.query}
                  </p>
                </button>
                <button
                  onClick={() => removeHistory(entry.surah, entry.ayah)}
                  aria-label={t ? 'حذف از تاریخچه' : 'حذف من السجل'}
                  className="px-3 text-[var(--text-secondary)] hover:text-red-600 transition-smooth"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showResults && deferredQuery.trim() && (
        <div className="absolute top-full mt-2 w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-2xl z-50 max-h-[60vh] flex flex-col animate-scale-in overflow-hidden">
          {indexError && (
            <div className="flex items-center justify-between gap-3 border-b border-[var(--border-light)] px-4 py-3 text-sm text-red-700" role="alert">
              <span>{t ? 'فهرست جستجوی آیات بارگذاری نشد.' : 'تعذّر تحميل فهرس البحث عن الآيات.'}</span>
              <button onClick={retryIndex} className="shrink-0 underline">
                {t ? 'تلاش دوباره' : 'إعادة المحاولة'}
              </button>
            </div>
          )}

          {/* Warning for a number / reference that does not exist */}
          {warning && (
            <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 text-amber-800 text-sm border-b border-amber-200">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{warningText(warning, surahs, t)}</span>
            </div>
          )}

          {/* "Did you mean ...?" */}
          {suggestion && (
            <button
              onClick={() => handleChange(suggestion)}
              className="flex items-center gap-2 px-4 py-3 text-sm text-right border-b border-[var(--border-light)] hover:bg-[var(--bg-secondary)] transition-smooth"
            >
              <Lightbulb className="w-4 h-4 text-[var(--accent)]  flex-shrink-0" />
              <span className='font-arabic font-bold'>
                {t ? 'آیا منظور شما' : 'هل تقصد: '}
                <span className="font-quran font-black text-base text-[var(--accent)]">«{suggestion}»</span>
                {t ? ' بود؟' : '؟'}
              </span>
            </button>
          )}

          {/* Tabs */}
          <div className="flex items-center justify-center gap-6 border-b border-[var(--border-light)] px-2 pt-2">
            <TabButton active={activeTab === 'all'} onClick={() => setActiveTab('all')}>
              {t ? 'همه' : 'الكل'} ({results.length}{capped ? '+' : ''})
            </TabButton>
            <TabButton active={activeTab === 'surahs'} onClick={() => setActiveTab('surahs')}>
              {t ? 'سوره‌ها' : 'السور'} ({surahResults.length})
            </TabButton>
            <TabButton active={activeTab === 'ayahs'} onClick={() => setActiveTab('ayahs')}>
              {t ? 'آیات' : 'الآيات'} ({ayahResults.length}{capped ? '+' : ''})
            </TabButton>
          </div>

          {/* Results list */}
          <div className="overflow-y-auto flex-1">
            {filteredResults.length === 0 && !loadingIndex && !warning && !suggestion && (
            <div className="text-center py-8 px-4">
              <p className="text-sm text-[var(--text-secondary)]">
                {t ? 'نتیجه‌ای یافت نشد' : 'لا توجد نتائج'}
              </p>
            </div>
            )}

            {filteredResults.length === 0 && loadingIndex && (
            <div className="text-center py-8 px-4">
              <Loader2 className="w-5 h-5 text-[var(--accent)] animate-spin mx-auto mb-2" />
            </div>
            )}

            {filteredResults.map((result) => {
            if (result.type === 'surah') {
              return (
                <button
                  key={`s-${result.surahNumber}`}
                  onClick={() => handleResultClick(result)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-secondary)] transition-smooth text-right border-b border-[var(--border-light)]"
                >
                  <div className="w-9 h-9 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="w-4 h-4 text-[var(--accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-quran text-base text-[var(--text-primary)] truncate">
                        {renderHighlighted(result.surahName)}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)] flex-shrink-0 ml-2">{result.surahNumber}</span>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] truncate">
                      {t ? 'سوره' : 'سورة'} · {renderHighlighted(result.englishName)}
                    </div>
                  </div>
                </button>
              );
            } else {
              return (
                <button
                  key={`a-${result.surahNumber}:${result.ayahNumberInSurah}`}
                  onClick={() => handleResultClick(result)}
                  className="w-full flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-secondary)] transition-smooth text-right border-b border-[var(--border-light)]"
                >
                  <div className="w-9 h-9 rounded-lg bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <FileText className="w-4 h-4 text-[var(--accent)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-[var(--text-secondary)]">
                        {result.surahName} · {result.surahNumber}:{result.ayahNumberInSurah}{result.lastAyah ? `–${result.lastAyah}` : ''}
                      </span>
                    </div>
                    <p className="font-quran text-sm text-[var(--text-primary)] leading-relaxed line-clamp-2" dir="rtl">
                      {renderHighlighted(result.textSnippet)}
                    </p>
                  </div>
                </button>
              );
            }
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition-smooth ${
        active
          ? 'text-[var(--accent)] border-b-2 border-[var(--accent)]'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}
