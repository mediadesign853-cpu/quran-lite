import { useEffect, useState } from 'react';

export interface CopyStatus {
  message: string;
  success: boolean;
}

export function useCopyStatus() {
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);

  useEffect(() => {
    let timeout: number | undefined;

    const handleCopyStatus = (event: Event) => {
      const detail = (event as CustomEvent<CopyStatus>).detail;
      if (!detail?.message) return;

      setCopyStatus(detail);
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setCopyStatus(null), detail.success ? 3500 : 10000);
    };

    window.addEventListener('quran:copy-status', handleCopyStatus);
    return () => {
      window.removeEventListener('quran:copy-status', handleCopyStatus);
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, []);

  return copyStatus;
}
