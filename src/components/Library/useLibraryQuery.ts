import useDebouncedState from '@app/hooks/useDebouncedState';
import { useRouter } from 'next/router';
import { useEffect } from 'react';

/**
 * Keeps a library page's `page`, `sort`, `filter` and `q` in the URL so the
 * view survives reloads and the back button.
 */
const useLibraryQuery = <S extends string, F extends string = never>(
  pathname: string,
  sorts: readonly S[],
  filters: readonly F[] = []
) => {
  const router = useRouter();

  const rawSort = String(router.query.sort ?? '') as S;
  const sort = sorts.includes(rawSort) ? rawSort : sorts[0];
  const rawFilter = String(router.query.filter ?? '') as F;
  const filter = filters.includes(rawFilter) ? rawFilter : filters[0];
  const page = Math.max(1, Number(router.query.page) || 1);
  const q = String(router.query.q ?? '');

  const update = (next: {
    sort?: S;
    filter?: F;
    page?: number;
    q?: string;
  }) => {
    const merged = { sort, filter, page, q, ...next };
    const query: Record<string, string> = {};
    if (merged.sort && merged.sort !== sorts[0]) {
      query.sort = merged.sort;
    }
    if (merged.filter && merged.filter !== filters[0]) {
      query.filter = merged.filter;
    }
    if (merged.page > 1) {
      query.page = String(merged.page);
    }
    if (merged.q) {
      query.q = merged.q;
    }
    router.replace({ pathname, query }, undefined, { shallow: true });
  };

  // Text filter: type freely, push to the URL after a short pause.
  const [text, debouncedText, setText] = useDebouncedState(q, 350);
  useEffect(() => {
    // Follow the URL when it changes underneath us (first load, back button).
    setText(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    if (router.isReady && debouncedText !== q) {
      update({ q: debouncedText, page: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedText]);

  return { sort, filter, page, q, text, setText, update };
};

export default useLibraryQuery;
