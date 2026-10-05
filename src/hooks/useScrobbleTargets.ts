import { useUser } from '@app/hooks/useUser';
import type { ScrobbleStatusResponse } from '@server/interfaces/api/playbackInterfaces';
import useSWR from 'swr';

const NAMES: Record<string, string> = {
  listenbrainz: 'ListenBrainz',
  lastfm: 'Last.fm',
};

/**
 * Names of the scrobble services the signed-in user has linked and that are
 * enabled server-side — shown in the player ("…, scrobbling to ListenBrainz").
 */
const useScrobbleTargets = (): string[] => {
  const { user } = useUser();
  const { data } = useSWR<ScrobbleStatusResponse>(
    user ? '/api/v1/scrobble/status' : null,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  if (!data?.enabled) {
    return [];
  }
  return data.targets.map((t) => NAMES[t] ?? t);
};

export default useScrobbleTargets;
