import CoverArt from '@app/components/CoverArt';
import StatusBadge from '@app/components/StatusBadge';
import RequestTitle from '@app/components/UserProfile/RequestTitle';
import {
  requestHref,
  useProfileUser,
} from '@app/components/UserProfile/shared';
import usePlayer from '@app/hooks/usePlayer';
import defineMessages from '@app/utils/defineMessages';
import { isDownloading } from '@app/utils/status';
import type {
  QuotaResponse,
  QuotaStatus,
  UserRecentlyPlayedResponse,
  UserRequestsResponse,
} from '@server/interfaces/api/userInterfaces';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.UserProfile.Overview', {
  totalRequests: 'Total requests',
  albumsLeft: 'Albums left',
  albumsLeftDays: 'Albums left (past {days} days)',
  tracksLeft: 'Tracks left',
  tracksLeftDays: 'Tracks left (past {days} days)',
  remainingOf: '{remaining} of {limit}',
  unlimited: 'Unlimited',
  ringLabel: '{used} of {limit} used',
  recentRequests: 'Recent requests',
  allRequests: 'All requests',
  noRequests: 'No requests yet.',
  recentlyPlayed: 'Recently played',
  playedFrom: 'From {sources}',
  playedScrobbling: 'From {sources}. Scrobbling to {targets}',
  scrobblingOnly: 'Scrobbling to {targets}',
  nothingPlayed:
    'Nothing played yet. Plays from the player and connected apps show up here.',
  play: 'Play',
  playTrack: 'Play {title}',
  sourcePlex: 'Plex',
  sourceJellyfin: 'Jellyfin',
  sourceNavidrome: 'Navidrome',
  sourceApps: 'connected apps',
  sourceWeb: 'Shufflerr’s player',
});

const Ring = ({
  used,
  limit,
  label,
  children,
}: {
  used: number;
  limit?: number;
  label: string;
  children: React.ReactNode;
}) => {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <span
      className="sh-ring"
      style={{ '--p': pct } as CSSProperties}
      role="img"
      aria-label={label}
    >
      <span>{children}</span>
    </span>
  );
};

const Overview = () => {
  const intl = useIntl();
  const { user, base } = useProfileUser();
  const { playTracks } = usePlayer();
  const { data: quota } = useSWR<QuotaResponse>(
    user ? `/api/v1/user/${user.id}/quota` : null
  );
  const { data: requests } = useSWR<UserRequestsResponse>(
    user ? `/api/v1/user/${user.id}/requests?take=6&skip=0` : null
  );
  const { data: played } = useSWR<UserRecentlyPlayedResponse>(
    user ? `/api/v1/user/${user.id}/recently-played?take=12` : null
  );

  if (!user) {
    return null;
  }

  const total = requests?.pageInfo.results ?? user.requestCount ?? 0;
  const list = new Intl.ListFormat(intl.locale, {
    style: 'long',
    type: 'conjunction',
  });

  const quotaCard = (
    status: QuotaStatus | undefined,
    plain: string,
    withDays: (days: number) => string
  ) => {
    const limit = status?.limit ?? 0;
    const used = status?.used ?? 0;
    const remaining = status?.remaining ?? Math.max(0, limit - used);
    return (
      <div className="sh-stat">
        <Ring
          used={used}
          limit={limit}
          label={
            limit
              ? intl.formatMessage(messages.ringLabel, { used, limit })
              : intl.formatMessage(messages.unlimited)
          }
        >
          {!status ? '–' : limit ? remaining : '∞'}
        </Ring>
        <div>
          <b>
            {!status
              ? '–'
              : limit
                ? intl.formatMessage(messages.remainingOf, { remaining, limit })
                : intl.formatMessage(messages.unlimited)}
          </b>
          <small>{limit && status?.days ? withDays(status.days) : plain}</small>
        </div>
      </div>
    );
  };

  const sourceNames = (played?.sources ?? []).map((s) =>
    intl.formatMessage(
      {
        plex: messages.sourcePlex,
        jellyfin: messages.sourceJellyfin,
        navidrome: messages.sourceNavidrome,
        apps: messages.sourceApps,
        web: messages.sourceWeb,
      }[s]
    )
  );
  const targetNames = (played?.scrobblingTo ?? []).map((t) =>
    t === 'listenbrainz' ? 'ListenBrainz' : 'Last.fm'
  );
  let playedSub: string | undefined;
  if (sourceNames.length && targetNames.length) {
    playedSub = intl.formatMessage(messages.playedScrobbling, {
      sources: list.format(sourceNames),
      targets: list.format(targetNames),
    });
  } else if (sourceNames.length) {
    playedSub = intl.formatMessage(messages.playedFrom, {
      sources: list.format(sourceNames),
    });
  } else if (targetNames.length) {
    playedSub = intl.formatMessage(messages.scrobblingOnly, {
      targets: list.format(targetNames),
    });
  }

  const plays = played?.results ?? [];
  const playable = plays.filter((p) => p.playable && p.trackId);

  return (
    <>
      <div className="sh-stats3">
        <div className="sh-stat">
          <Ring
            used={total ? 1 : 0}
            limit={1}
            label={`${total} ${intl.formatMessage(messages.totalRequests)}`}
          >
            {total}
          </Ring>
          <div>
            <b>{total}</b>
            <small>{intl.formatMessage(messages.totalRequests)}</small>
          </div>
        </div>
        {quotaCard(
          quota?.album,
          intl.formatMessage(messages.albumsLeft),
          (days) => intl.formatMessage(messages.albumsLeftDays, { days })
        )}
        {quotaCard(
          quota?.track,
          intl.formatMessage(messages.tracksLeft),
          (days) => intl.formatMessage(messages.tracksLeftDays, { days })
        )}
      </div>

      <section>
        <div className="sh-sec-head">
          <h2 className="sh-h-section">
            {intl.formatMessage(messages.recentRequests)}
          </h2>
          <Link href={`${base}/requests`}>
            {intl.formatMessage(messages.allRequests)}
          </Link>
        </div>
        {requests && requests.results.length > 0 ? (
          <div className="sh-row">
            {requests.results.map((r) => (
              <div className="sh-card" key={r.id}>
                <Link href={requestHref(r)} aria-label={r.media?.title}>
                  <CoverArt
                    src={r.coverUrl}
                    mbid={r.media?.mbid}
                    title={r.media?.title}
                    decorative
                  />
                </Link>
                <div>
                  <b className="t block">
                    <RequestTitle request={r} />
                  </b>
                  <StatusBadge
                    requestStatus={r.status}
                    downloading={isDownloading(r)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="sh-box p-6 text-muted">
            {requests ? intl.formatMessage(messages.noRequests) : '…'}
          </div>
        )}
      </section>

      {played?.enabled !== false && (
        <section>
          <div className="sh-sec-head">
            <div>
              <h2 className="sh-h-section">
                {intl.formatMessage(messages.recentlyPlayed)}
              </h2>
              {playedSub && <p className="sh-sub">{playedSub}</p>}
            </div>
          </div>
          {plays.length > 0 ? (
            <div className="sh-row">
              {plays.map((p) => {
                const cover = (
                  <CoverArt
                    src={p.coverUrl}
                    mbid={p.albumMbid ?? p.title}
                    title={p.albumTitle ?? p.title}
                    decorative
                  />
                );
                return (
                  <div className="sh-card" key={p.id}>
                    {p.albumMbid ? (
                      <Link
                        href={`/album/${p.albumMbid}`}
                        aria-label={p.albumTitle ?? p.title}
                      >
                        {cover}
                      </Link>
                    ) : (
                      cover
                    )}
                    <div>
                      <b className="t block">{p.title}</b>
                      <span className="m">{p.artistName}</span>
                    </div>
                    {p.playable && p.trackId && (
                      <button
                        type="button"
                        className="sh-btn small"
                        aria-label={intl.formatMessage(messages.playTrack, {
                          title: p.title,
                        })}
                        onClick={() =>
                          playTracks(
                            playable.map((x) => ({
                              id: x.trackId as number,
                              title: x.title,
                              artist: x.artistName,
                              album: x.albumTitle ?? undefined,
                              albumMbid: x.albumMbid ?? undefined,
                            })),
                            Math.max(
                              0,
                              playable.findIndex((x) => x.id === p.id)
                            )
                          )
                        }
                      >
                        {intl.formatMessage(messages.play)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="sh-box p-6 text-muted">
              {played ? intl.formatMessage(messages.nothingPlayed) : '…'}
            </div>
          )}
        </section>
      )}
    </>
  );
};

export default Overview;
