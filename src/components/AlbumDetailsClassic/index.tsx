import Tracklist from '@app/components/AlbumDetails/Tracklist';
import { linkLabel } from '@app/components/AlbumDetails/links';
import Button from '@app/components/Common/Button';
import EmptyState from '@app/components/Common/EmptyState';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ProgressBar from '@app/components/Common/ProgressBar';
import CoverArt from '@app/components/CoverArt';
import IssueModal from '@app/components/IssueModal';
import ManageSlideOver from '@app/components/ManageSlideOver';
import usePlayback, { playableTracks } from '@app/components/Playback';
import RequestButton from '@app/components/RequestButton';
import { toModalAlbum } from '@app/components/RequestModal/subject';
import StatusBadge from '@app/components/StatusBadge';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { formatDuration } from '@app/utils/format';
import {
  MediaRequestStatus,
  MediaStatus,
  RequestScope,
} from '@server/constants/media';
import type { AlbumDetails as AlbumDetailsType } from '@server/models/music';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.AlbumDetailsClassic', {
  album: 'Album',
  artists: 'Artists',
  metareleased: '{type}, released {date}',
  metareleasedlabel: '{type}, released {date} on {label}',
  metatype: '{type}',
  trackcount: '{count, plural, one {# track} other {# tracks}}',
  inlibrary: '{have} of {total} in library',
  progresslabel: '{have} of {total} tracks in library',
  requestmissing: 'Request missing tracks',
  requestalbum: 'Request album',
  playalbum: 'Play album',
  report: 'Report a problem',
  manage: 'Manage',
  tracklist: 'Tracklist',
  notracklist:
    'MusicBrainz has no tracklist for this release yet. You can still request the album.',
  pendingown: 'Your request for {what} is waiting for an admin to approve it.',
  pendingother:
    '{name}’s request for {what} is waiting for an admin to approve it.',
  review: 'Review it',
  approvedauto:
    '{what} approved automatically. Lidarr is downloading ({percent}%).',
  approved: '{what} approved. Lidarr is downloading ({percent}%).',
  whatmissing:
    '{count, plural, one {the missing track} other {the # missing tracks}}',
  whatalbum: 'this album',
  whatdiscography: 'this artist’s discography',
  whatmissingcap:
    '{count, plural, one {The missing track was} other {The # missing tracks were}}',
  whatalbumcap: 'This album was',
  whatdiscographycap: 'This artist’s discography was',
  notfound: 'That album couldn’t be found.',
  notfoundhint:
    'The link may be wrong, or MusicBrainz is unreachable right now. Search for the album to try again.',
  searchmusic: 'Search music',
  links: 'Links',
  openin: 'Open in {name}',
});

const AlbumDetailsClassic = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const { playTracks } = usePlayback();
  const [showIssue, setShowIssue] = useState(false);
  const [showManage, setShowManage] = useState(false);

  const mbid = router.query.mbid as string | undefined;
  const { data: album, error } = useSWR<AlbumDetailsType>(
    mbid ? `/api/v1/album/${mbid}` : null,
    {
      // Follow a running download until the files land.
      refreshInterval: (latest) =>
        latest?.requests?.some((r) => r.status === MediaRequestStatus.APPROVED)
          ? 15000
          : 0,
    }
  );

  if (error) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.album)} />
        <EmptyState
          title={intl.formatMessage(messages.notfound)}
          action={
            <Link href="/search" className="sh-btn small">
              {intl.formatMessage(messages.searchmusic)}
            </Link>
          }
        >
          {intl.formatMessage(messages.notfoundhint)}
        </EmptyState>
      </>
    );
  }

  if (!album) {
    return <LoadingSpinner />;
  }

  const total = album.tracks.length || album.trackCount || 0;
  const have = album.tracks.length
    ? album.tracks.filter((t) => t.status === MediaStatus.AVAILABLE).length
    : (album.tracksAvailable ?? 0);
  const complete = total > 0 && have >= total;
  const libraryStatus = complete
    ? MediaStatus.AVAILABLE
    : have > 0
      ? MediaStatus.PARTIALLY_AVAILABLE
      : album.status;

  const active =
    album.requests.find(
      (r) =>
        r.status === MediaRequestStatus.PENDING ||
        r.status === MediaRequestStatus.APPROVED
    ) ??
    (album.discographyRequest &&
    (album.discographyRequest.status === MediaRequestStatus.PENDING ||
      album.discographyRequest.status === MediaRequestStatus.APPROVED)
      ? album.discographyRequest
      : undefined);

  const queue = playableTracks(album);
  const type = album.primaryType || intl.formatMessage(messages.album);
  const released = album.firstReleaseDate
    ? album.firstReleaseDate.length >= 10
      ? intl.formatDate(album.firstReleaseDate, {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: 'UTC',
        })
      : album.firstReleaseDate
    : undefined;
  const metaLine = released
    ? album.label
      ? intl.formatMessage(messages.metareleasedlabel, {
          type,
          date: released,
          label: album.label,
        })
      : intl.formatMessage(messages.metareleased, { type, date: released })
    : intl.formatMessage(messages.metatype, { type });

  let banner: React.ReactNode = null;
  if (active) {
    const missingCount = active.trackIds?.length ?? Math.max(0, total - have);
    if (active.status === MediaRequestStatus.PENDING) {
      const what =
        active.scope === RequestScope.TRACKS
          ? intl.formatMessage(messages.whatmissing, { count: missingCount })
          : active.scope === RequestScope.DISCOGRAPHY
            ? intl.formatMessage(messages.whatdiscography)
            : intl.formatMessage(messages.whatalbum);
      banner = (
        <div className="sh-outcome wait" role="status">
          {active.requestedBy.id === user?.id
            ? intl.formatMessage(messages.pendingown, { what })
            : intl.formatMessage(messages.pendingother, {
                name: active.requestedBy.displayName,
                what,
              })}
          {hasPermission(Permission.MANAGE_REQUESTS) && (
            <>
              {' '}
              <Link href="/requests?filter=pending">
                {intl.formatMessage(messages.review)}
              </Link>
            </>
          )}
        </div>
      );
    } else {
      const what =
        active.scope === RequestScope.TRACKS
          ? intl.formatMessage(messages.whatmissingcap, { count: missingCount })
          : active.scope === RequestScope.DISCOGRAPHY
            ? intl.formatMessage(messages.whatdiscographycap)
            : intl.formatMessage(messages.whatalbumcap);
      banner = (
        <div className="sh-outcome auto" role="status">
          {intl.formatMessage(
            active.isAutoApproved ? messages.approvedauto : messages.approved,
            { what, percent: Math.round(active.downloadProgress ?? 0) }
          )}
        </div>
      );
    }
  }

  const canReport = hasPermission(
    [Permission.CREATE_ISSUES, Permission.MANAGE_ISSUES],
    { type: 'or' }
  );
  const canManage = hasPermission(Permission.MANAGE_REQUESTS);
  const externalLinks = album.links.filter((l) => !!l.url);

  return (
    <>
      <PageTitle title={[album.title, album.artistName]} />
      <p className="sh-crumb">
        <Link href={`/artist/${album.artistMbid}`}>{album.artistName}</Link> /{' '}
        {album.title}
      </p>

      {banner}

      <section className="sh-detail" aria-labelledby="album-title">
        <div className="art">
          <CoverArt
            src={album.coverUrl}
            mbid={album.mbid}
            title={album.title}
            loading="eager"
          />
        </div>
        <div className="info">
          <span className="sh-feat">{metaLine}</span>
          <h1 id="album-title">{album.title}</h1>
          <Link
            href={`/artist/${album.artistMbid}`}
            className="text-lg font-semibold text-ink"
          >
            {album.artistName}
          </Link>
          <div className="sh-meta">
            {total > 0 && (
              <span>
                {intl.formatMessage(messages.trackcount, { count: total })}
              </span>
            )}
            {!!album.totalLengthMs && (
              <span>{formatDuration(album.totalLengthMs)}</span>
            )}
            <StatusBadge status={libraryStatus} />
            {total > 0 && (
              <span>
                {intl.formatMessage(messages.inlibrary, { have, total })}
              </span>
            )}
          </div>
          {total > 0 && (
            <ProgressBar
              value={(have / total) * 100}
              tone={complete ? 'available' : 'partial'}
              label={intl.formatMessage(messages.progresslabel, {
                have,
                total,
              })}
            />
          )}
          <div className="mt-1.5 flex flex-wrap gap-2.5">
            {!complete && !active && (
              <RequestButton
                album={toModalAlbum(album)}
                defaultScope={
                  have > 0 ? RequestScope.TRACKS : RequestScope.ALBUM
                }
                buttonType="primary"
                buttonSize="default"
              >
                {intl.formatMessage(
                  have > 0 ? messages.requestmissing : messages.requestalbum
                )}
              </RequestButton>
            )}
            {queue.length > 0 && (
              <Button type="button" onClick={() => playTracks(queue, 0)}>
                {intl.formatMessage(messages.playalbum)}
              </Button>
            )}
            {canReport && (
              <Button type="button" onClick={() => setShowIssue(true)}>
                {intl.formatMessage(messages.report)}
              </Button>
            )}
            {canManage && (
              <Button type="button" onClick={() => setShowManage(true)}>
                {intl.formatMessage(messages.manage)}
              </Button>
            )}
          </div>
          {!!album.genres?.length && (
            <div className="sh-tags">
              {album.genres.slice(0, 6).map((genre) => (
                <span className="sh-tag" key={genre}>
                  {genre}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="album-tracklist">
        <h2 className="sh-h-section mb-[18px]" id="album-tracklist">
          {intl.formatMessage(messages.tracklist)}
        </h2>
        {album.tracks.length ? (
          <Tracklist album={album} />
        ) : (
          <div className="sh-box p-7 text-center text-muted">
            {intl.formatMessage(messages.notracklist)}
          </div>
        )}
      </section>

      {externalLinks.length > 0 && (
        <section aria-labelledby="album-links">
          <h2 className="sh-h-section mb-3.5" id="album-links">
            {intl.formatMessage(messages.links)}
          </h2>
          <div className="sh-chips">
            {externalLinks.map((link) => (
              <a
                key={`${link.type}-${link.url}`}
                className="sh-chip inline-flex items-center text-ink"
                href={link.url}
                target="_blank"
                rel="noreferrer"
              >
                {linkLabel(link, (name) =>
                  intl.formatMessage(messages.openin, { name })
                )}
              </a>
            ))}
          </div>
        </section>
      )}

      <IssueModal
        mediaType="release-group"
        mbid={album.mbid}
        show={showIssue}
        onClose={() => setShowIssue(false)}
      />
      <ManageSlideOver
        mediaType="release-group"
        mbid={album.mbid}
        show={showManage}
        onClose={() => setShowManage(false)}
      />
    </>
  );
};

export default AlbumDetailsClassic;
