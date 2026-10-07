import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import FilterChips from '@app/components/Common/FilterChips';
import CoverArt from '@app/components/CoverArt';
import Pager from '@app/components/Library/Pager';
import usePlayback from '@app/components/Playback';
import RequestButton from '@app/components/RequestButton';
import { revalidateMusic } from '@app/components/RequestModal';
import {
  hasActiveRequest,
  toModalAlbum,
} from '@app/components/RequestModal/subject';
import StatusBadge from '@app/components/StatusBadge';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { canCancelRequest } from '@app/utils/requests';
import { isDownloading } from '@app/utils/status';
import type { MediaRequestStatus } from '@server/constants/media';
import { MediaStatus } from '@server/constants/media';
import type { AlbumResult } from '@server/models/music';
import axios from 'axios';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ArtistDetails.Discography', {
  discography: 'Discography',
  releasetype: 'Release type',
  all: 'All',
  albums: 'Albums',
  singles: 'Singles',
  eps: 'EPs',
  other: 'Other',
  colcover: 'Cover',
  colrelease: 'Release',
  coltype: 'Type',
  colyear: 'Year',
  coltracks: 'Tracks',
  colstatus: 'Status',
  colactions: 'Actions',
  fillgaps: 'Fill gaps',
  fillgapsnamed: 'Fill the gaps in {title}',
  play: 'Play',
  playnamed: 'Play {title}',
  cancelrequest: 'Cancel request',
  removerequest: 'Remove request',
  cancelnamed: 'Cancel the request for {title}',
  removenamed: 'Remove the request for {title}',
  confirmcancel: 'Cancel it?',
  confirmremove: 'Remove it?',
  cancelled: 'Cancelled the request for {title}.',
  removed: 'Removed the request for {title}.',
  cancelfailed: 'That didn’t go through. Refresh the page and try again.',
  empty: 'MusicBrainz lists no releases for this artist yet.',
  emptyfilter: 'No releases of this type. Try another filter.',
});

const PAGE_SIZE = 10;

const COLUMNS =
  '56px minmax(220px,2fr) 100px 64px 64px 170px minmax(150px,auto)';

type TypeFilter = 'all' | 'Album' | 'Single' | 'EP' | 'Other';

const typeOf = (album: AlbumResult): Exclude<TypeFilter, 'all'> =>
  album.primaryType === 'Album' ||
  album.primaryType === 'Single' ||
  album.primaryType === 'EP'
    ? album.primaryType
    : 'Other';

interface DiscographyProps {
  releases: AlbumResult[];
}

const Discography = ({ releases }: DiscographyProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const { playAlbum } = usePlayback();
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [page, setPage] = useState(1);
  const [cancelId, setCancelId] = useState<number | null>(null);
  const top = useRef<HTMLElement>(null);

  const canRequestAlbums = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_ALBUM],
    { type: 'or' }
  );
  const canManage = hasPermission(Permission.MANAGE_REQUESTS);

  const cancelRequest = async (
    requestId: number,
    title: string,
    isOwn: boolean
  ) => {
    setCancelId(requestId);
    try {
      await axios.delete(`/api/v1/request/${requestId}`);
      addToast(
        intl.formatMessage(isOwn ? messages.cancelled : messages.removed, {
          title,
        }),
        { appearance: 'success' }
      );
      revalidateMusic();
    } catch (e) {
      const message = axios.isAxiosError(e)
        ? e.response?.data?.message
        : undefined;
      addToast(message ?? intl.formatMessage(messages.cancelfailed), {
        appearance: 'error',
      });
    } finally {
      setCancelId(null);
    }
  };

  const counts = useMemo(() => {
    const result: Record<TypeFilter, number> = {
      all: releases.length,
      Album: 0,
      Single: 0,
      EP: 0,
      Other: 0,
    };
    releases.forEach((release) => {
      result[typeOf(release)] += 1;
    });
    return result;
  }, [releases]);

  const filtered = releases.filter(
    (release) => filter === 'all' || typeOf(release) === filter
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const goTo = (next: number) => {
    setPage(next);
    top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  // a new filter starts again from the first page
  useEffect(() => {
    setPage(1);
  }, [filter]);

  const labels: Record<TypeFilter, string> = {
    all: intl.formatMessage(messages.all),
    Album: intl.formatMessage(messages.albums),
    Single: intl.formatMessage(messages.singles),
    EP: intl.formatMessage(messages.eps),
    Other: intl.formatMessage(messages.other),
  };
  const chips = (['all', 'Album', 'Single', 'EP', 'Other'] as TypeFilter[])
    .filter((value) => value === 'all' || counts[value] > 0)
    .map((value) => ({ value, label: labels[value], count: counts[value] }));

  return (
    <section aria-labelledby="artist-discography" ref={top}>
      <div className="sh-sec-head">
        <h2 className="sh-h-section" id="artist-discography">
          {intl.formatMessage(messages.discography)}
        </h2>
        <FilterChips
          aria-label={intl.formatMessage(messages.releasetype)}
          value={filter}
          onChange={setFilter}
          chips={chips}
        />
      </div>
      <div className="sh-box sh-scroll-x">
        <div className="sh-table" role="table">
          <div
            className="sh-tr head"
            role="row"
            style={{ gridTemplateColumns: COLUMNS }}
          >
            <span role="columnheader">
              <span className="sr-only">
                {intl.formatMessage(messages.colcover)}
              </span>
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.colrelease)}
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.coltype)}
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.colyear)}
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.coltracks)}
            </span>
            <span role="columnheader">
              {intl.formatMessage(messages.colstatus)}
            </span>
            <span role="columnheader">
              <span className="sr-only">
                {intl.formatMessage(messages.colactions)}
              </span>
            </span>
          </div>
          {rows.length ? (
            rows.map((release) => {
              const active = hasActiveRequest(release);
              const type = [
                release.primaryType,
                ...(release.secondaryTypes ?? []),
              ]
                .filter(Boolean)
                .join(', ');
              let action: React.ReactNode = null;
              if (release.status === MediaStatus.AVAILABLE) {
                action = (
                  <Button
                    buttonSize="sm"
                    aria-label={intl.formatMessage(messages.playnamed, {
                      title: release.title,
                    })}
                    onClick={() => playAlbum(release.mbid)}
                  >
                    {intl.formatMessage(messages.play)}
                  </Button>
                );
              } else if (
                release.status === MediaStatus.PARTIALLY_AVAILABLE &&
                !active
              ) {
                action = (
                  <Link
                    href={`/album/${release.mbid}`}
                    className="sh-btn small"
                    aria-label={intl.formatMessage(messages.fillgapsnamed, {
                      title: release.title,
                    })}
                  >
                    {intl.formatMessage(messages.fillgaps)}
                  </Link>
                );
              } else if (
                !active &&
                canRequestAlbums &&
                (release.status === MediaStatus.UNKNOWN ||
                  release.status === MediaStatus.DELETED)
              ) {
                action = <RequestButton album={toModalAlbum(release)} />;
              } else if (
                active &&
                release.request &&
                canCancelRequest(release.request, user?.id, canManage)
              ) {
                const isOwn = release.request.requestedBy?.id === user?.id;
                const requestId = release.request.id;
                action = (
                  <ConfirmButton
                    buttonSize="sm"
                    disabled={cancelId === requestId}
                    confirmText={intl.formatMessage(
                      isOwn ? messages.confirmcancel : messages.confirmremove
                    )}
                    aria-label={intl.formatMessage(
                      isOwn ? messages.cancelnamed : messages.removenamed,
                      { title: release.title }
                    )}
                    onClick={() =>
                      cancelRequest(requestId, release.title, isOwn)
                    }
                  >
                    {intl.formatMessage(
                      isOwn ? messages.cancelrequest : messages.removerequest
                    )}
                  </ConfirmButton>
                );
              }
              return (
                <div
                  className="sh-tr"
                  role="row"
                  key={release.mbid}
                  style={{ gridTemplateColumns: COLUMNS }}
                >
                  <span role="cell">
                    <CoverArt
                      thumb
                      decorative
                      src={release.coverUrl}
                      mbid={release.mbid}
                      title={release.title}
                    />
                  </span>
                  <span role="cell" className="min-w-0">
                    <Link
                      href={`/album/${release.mbid}`}
                      className="sh-title text-ink"
                    >
                      {release.title}
                    </Link>
                  </span>
                  <span role="cell" className="dim">
                    {type}
                  </span>
                  <span role="cell" className="num">
                    {release.year ??
                      release.firstReleaseDate?.slice(0, 4) ??
                      ''}
                  </span>
                  <span role="cell" className="num">
                    {release.trackCount ?? release.mediaInfo?.trackCount ?? '–'}
                  </span>
                  <span role="cell">
                    {active && release.request ? (
                      <StatusBadge
                        requestStatus={
                          release.request.status as MediaRequestStatus
                        }
                        downloading={isDownloading(release.request)}
                      />
                    ) : (
                      <StatusBadge
                        status={release.status}
                        downloading={isDownloading(release.request)}
                      />
                    )}
                  </span>
                  <span role="cell" className="actions">
                    {action}
                  </span>
                </div>
              );
            })
          ) : (
            <div className="px-4 py-10 text-center text-muted">
              {intl.formatMessage(
                releases.length ? messages.emptyfilter : messages.empty
              )}
            </div>
          )}
        </div>
      </div>
      {pages > 1 && (
        <div className="mt-4">
          <Pager page={current} pages={pages} onPage={goTo} />
        </div>
      )}
    </section>
  );
};

export default Discography;
