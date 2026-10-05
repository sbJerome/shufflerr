import Button from '@app/components/Common/Button';
import FilterChips from '@app/components/Common/FilterChips';
import CoverArt from '@app/components/CoverArt';
import usePlayback from '@app/components/Playback';
import RequestButton from '@app/components/RequestButton';
import {
  hasActiveRequest,
  toModalAlbum,
} from '@app/components/RequestModal/subject';
import StatusBadge from '@app/components/StatusBadge';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { MediaRequestStatus} from '@server/constants/media';
import { MediaStatus } from '@server/constants/media';
import type { AlbumResult } from '@server/models/music';
import Link from 'next/link';
import { useMemo, useState } from 'react';
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
  empty: 'MusicBrainz lists no releases for this artist yet.',
  emptyfilter: 'No releases of this type. Try another filter.',
});

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
  const { hasPermission } = useUser();
  const { playAlbum } = usePlayback();
  const [filter, setFilter] = useState<TypeFilter>('all');

  const canRequestAlbums = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_ALBUM],
    { type: 'or' }
  );

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

  const rows = releases.filter(
    (release) => filter === 'all' || typeOf(release) === filter
  );

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
    <section aria-labelledby="artist-discography">
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
              const type = [release.primaryType, ...(release.secondaryTypes ?? [])]
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
                    {release.year ?? release.firstReleaseDate?.slice(0, 4) ?? ''}
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
                      />
                    ) : (
                      <StatusBadge status={release.status} />
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
    </section>
  );
};

export default Discography;
