import AlbumCard from '@app/components/AlbumCard';
import FilterChips from '@app/components/Common/FilterChips';
import Pager from '@app/components/Library/Pager';
import RequestButton from '@app/components/RequestButton';
import {
  hasActiveRequest,
  toModalAlbum,
} from '@app/components/RequestModal/subject';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { MediaStatus, RequestScope } from '@server/constants/media';
import type { AlbumResult } from '@server/models/music';
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
  typealbum: 'Album',
  typesingle: 'Single',
  typeep: 'EP',
  typeother: 'Other',
  request: 'Request',
  fillgaps: 'Fill gaps',
  empty: 'MusicBrainz lists no releases for this artist yet.',
  emptyfilter: 'No releases of this type. Try another filter.',
});

const PAGE_SIZE = 24;

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
  const [filter, setFilter] = useState<TypeFilter>('all');
  const [page, setPage] = useState(1);
  const top = useRef<HTMLElement>(null);

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
  const typeLabels: Record<Exclude<TypeFilter, 'all'>, string> = {
    Album: intl.formatMessage(messages.typealbum),
    Single: intl.formatMessage(messages.typesingle),
    EP: intl.formatMessage(messages.typeep),
    Other: intl.formatMessage(messages.typeother),
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
      {rows.length ? (
        <div className="sh-grid">
          {rows.map((release) => {
            const partial =
              release.status === MediaStatus.PARTIALLY_AVAILABLE;
            // Hover reveals a request button for anything not fully in the
            // library (available tiles just link through to the album).
            const requestable =
              canRequestAlbums &&
              !hasActiveRequest(release) &&
              release.status !== MediaStatus.AVAILABLE;
            const year =
              release.year != null
                ? String(release.year)
                : release.firstReleaseDate?.slice(0, 4);
            const meta = [typeLabels[typeOf(release)], year]
              .filter(Boolean)
              .join(' · ');
            return (
              <AlbumCard
                key={release.mbid}
                mbid={release.mbid}
                title={release.title}
                status={release.status}
                imageSrc={release.coverUrl}
                meta={meta}
                overlay={
                  requestable ? (
                    <RequestButton
                      album={toModalAlbum(release)}
                      defaultScope={
                        partial ? RequestScope.TRACKS : RequestScope.ALBUM
                      }
                      buttonType="primary"
                      buttonSize="default"
                    >
                      {intl.formatMessage(
                        partial ? messages.fillgaps : messages.request
                      )}
                    </RequestButton>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-10 text-center text-muted">
          {intl.formatMessage(
            releases.length ? messages.emptyfilter : messages.empty
          )}
        </div>
      )}
      {pages > 1 && (
        <div className="mt-4">
          <Pager page={current} pages={pages} onPage={goTo} />
        </div>
      )}
    </section>
  );
};

export default Discography;
