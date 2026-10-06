import { useUser } from '@app/hooks/useUser';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { mutate } from 'swr';

// Pages shown before sign-in never open the stream.
const AUTH_PAGE = /^\/(login|logout|setup|resetpassword(?:\/|$))/;

/** Revalidate every SWR key that starts with one of these prefixes. */
const revalidate = (...prefixes: string[]): void => {
  mutate(
    (key) =>
      typeof key === 'string' &&
      prefixes.some((prefix) => key.startsWith(prefix)),
    undefined,
    { revalidate: true }
  );
};

/**
 * Opens one Server-Sent Events connection for a signed-in viewer and, as
 * request/media/scan events arrive, revalidates the SWR caches they affect —
 * so status, download progress and availability update live instead of on a
 * poll. Call once, from the authenticated app shell. Does nothing pre-auth.
 */
export const useRealtime = (): void => {
  const { user } = useUser();
  const router = useRouter();
  const signedIn = !!user && !AUTH_PAGE.test(router.pathname);

  useEffect(() => {
    if (
      !signedIn ||
      typeof window === 'undefined' ||
      !('EventSource' in window)
    ) {
      return;
    }

    const source = new EventSource('/api/v1/realtime');

    // A request changed: refresh request lists/counts and anything that shows
    // the request's or its media's state.
    source.addEventListener('request', () => {
      revalidate(
        '/api/v1/request',
        '/api/v1/user',
        '/api/v1/album',
        '/api/v1/artist',
        '/api/v1/discover',
        '/api/v1/library'
      );
    });

    // A media row's library status changed (a scan made it available, etc.).
    source.addEventListener('media', () => {
      revalidate(
        '/api/v1/album',
        '/api/v1/artist',
        '/api/v1/discover',
        '/api/v1/library',
        '/api/v1/request'
      );
    });

    source.addEventListener('scan', () => {
      revalidate('/api/v1/discover', '/api/v1/library');
    });

    // EventSource reconnects on its own (the server sends `retry`); nothing to
    // do here but close on sign-out/unmount.
    return () => {
      source.close();
    };
  }, [signedIn]);
};
