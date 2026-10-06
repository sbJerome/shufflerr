import AlbumCard from '@app/components/AlbumCard';
import { SERVER_LINKS, linkLabel } from '@app/components/AlbumDetails/links';
import Discography from '@app/components/ArtistDetails/Discography';
import Button from '@app/components/Common/Button';
import EmptyState from '@app/components/Common/EmptyState';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import Carousel from '@app/components/Discover/Carousel';
import ManageSlideOver from '@app/components/ManageSlideOver';
import RequestButton from '@app/components/RequestButton';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import {
  MediaRequestStatus,
  MediaStatus,
  RequestScope,
} from '@server/constants/media';
import type { ArtistDetails as ArtistDetailsType } from '@server/models/music';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.ArtistDetails', {
  topalbums: 'Top albums',
  artist: 'Artist',
  artists: 'Artists',
  activesince: 'Active since {year}',
  active: '{begin} to {end}',
  requestdiscography: 'Request discography',
  discographywaiting: 'Discography waiting for approval',
  discographyapproved: 'Discography approved',
  watch: 'Watch for new releases',
  watching: 'Watching for new releases',
  watchon: 'Watching {name} for new releases.',
  watchoff: 'Stopped watching {name} for new releases.',
  watchfailed:
    'The watch setting couldn’t be changed. Check that Lidarr is reachable and try again.',
  manage: 'Manage',
  openin: 'Open in {name}',
  factreleases: 'Releases',
  factinlibrary: 'In library',
  factdownloading: 'Requested',
  factalbums: 'Albums',
  about: 'About',
  nobio: 'No biography is available for this artist.',
  biosourcelastfm: 'Read more on Last.fm',
  biosourcemusicbrainz: 'Read more on MusicBrainz',
  mbid: 'MusicBrainz ID',
  lidarr: 'Lidarr',
  monitored: 'Monitored',
  notmonitored: 'Not monitored',
  notadded: 'Not added yet',
  quality: 'Quality',
  metadataprofile: 'Metadata profile',
  folder: 'Folder',
  similar: 'Similar artists',
  links: 'Links',
  notfound: 'That artist couldn’t be found.',
  notfoundhint:
    'The link may be wrong, or MusicBrainz is unreachable right now. Search for the artist to try again.',
  searchmusic: 'Search music',
});

const ArtistDetails = () => {
  const intl = useIntl();
  const router = useRouter();
  const { addToast } = useToasts();
  const { hasPermission } = useUser();
  const [showManage, setShowManage] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);

  const mbid = router.query.mbid as string | undefined;
  const {
    data: artist,
    error,
    mutate,
  } = useSWR<ArtistDetailsType>(mbid ? `/api/v1/artist/${mbid}` : null);

  if (error) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.artist)} />
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

  if (!artist) {
    return <LoadingSpinner />;
  }

  const canRequestDiscography = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_DISCOGRAPHY],
    { type: 'or' }
  );
  const canManage = hasPermission(Permission.MANAGE_REQUESTS);
  const discoRequest =
    artist.discographyRequest &&
    (artist.discographyRequest.status === MediaRequestStatus.PENDING ||
      artist.discographyRequest.status === MediaRequestStatus.APPROVED)
      ? artist.discographyRequest
      : undefined;

  const beginYear = artist.lifeSpan?.begin?.slice(0, 4);
  const endYear = artist.lifeSpan?.end?.slice(0, 4);
  const metaLine = [
    artist.disambiguation,
    [artist.type, artist.area || artist.country].filter(Boolean).join(', '),
    beginYear
      ? endYear
        ? intl.formatMessage(messages.active, {
            begin: beginYear,
            end: endYear,
          })
        : intl.formatMessage(messages.activesince, { year: beginYear })
      : '',
  ]
    .filter(Boolean)
    .join('. ');

  const toggleWatch = async () => {
    if (!artist.lidarr) {
      return;
    }
    const enabled = !artist.lidarr.monitorNewItems;
    setWatchBusy(true);
    try {
      await axios.post(`/api/v1/artist/${artist.mbid}/watch`, { enabled });
      addToast(
        intl.formatMessage(enabled ? messages.watchon : messages.watchoff, {
          name: artist.name,
        }),
        { appearance: 'success' }
      );
      mutate();
    } catch (e) {
      const message =
        axios.isAxiosError(e) && e.response?.status !== 501
          ? e.response?.data?.message
          : undefined;
      addToast(message ?? intl.formatMessage(messages.watchfailed), {
        appearance: 'error',
      });
    } finally {
      setWatchBusy(false);
    }
  };

  const serverLinks = artist.links.filter(
    (l) => SERVER_LINKS.includes(l.type) && l.type !== 'lidarr'
  );
  const otherLinks = artist.links.filter(
    (l) => !SERVER_LINKS.includes(l.type) || l.type === 'lidarr'
  );
  const openIn = (name: string) =>
    intl.formatMessage(messages.openin, { name });

  const heroImage = artist.backgroundUrl ?? artist.imageUrl;
  const inLibrary = (status: MediaStatus) =>
    status === MediaStatus.AVAILABLE ||
    status === MediaStatus.PARTIALLY_AVAILABLE;
  // What is already in the library first, then studio albums, newest first
  // (the discography arrives newest first).
  const rank = (album: (typeof artist.discography)[number]) =>
    (inLibrary(album.status) ? 0 : 2) +
    (album.primaryType === 'Album' && !album.secondaryTypes?.length ? 0 : 1);
  const topAlbums = [...artist.discography]
    .sort((x, y) => rank(x) - rank(y))
    .slice(0, 12);

  return (
    <>
      <PageTitle title={artist.name} />
      <section className="sh-rx-hero" aria-labelledby="artist-name">
        {heroImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="art" src={heroImage} alt="" aria-hidden="true" />
        )}
        <div className="veil" aria-hidden="true" />
        <p className="sh-crumb">
          <Link href="/artists">{intl.formatMessage(messages.artists)}</Link> /{' '}
          {artist.name}
        </p>
        <div className="copy">
          <h1 id="artist-name">{artist.name}</h1>
          {metaLine && <p className="sub">{metaLine}</p>}
          <div className="cta">
            {discoRequest ? (
              <Button type="button" disabled>
                {intl.formatMessage(
                  discoRequest.status === MediaRequestStatus.PENDING
                    ? messages.discographywaiting
                    : messages.discographyapproved
                )}
              </Button>
            ) : (
              canRequestDiscography && (
                <RequestButton
                  artist={{
                    mbid: artist.mbid,
                    name: artist.name,
                    imageUrl: artist.imageUrl,
                  }}
                  defaultScope={RequestScope.DISCOGRAPHY}
                  buttonType="primary"
                  buttonSize="default"
                  onComplete={() => mutate()}
                >
                  {intl.formatMessage(messages.requestdiscography)}
                </RequestButton>
              )
            )}
            {artist.lidarr && canManage && (
              <Button
                type="button"
                aria-pressed={artist.lidarr.monitorNewItems}
                disabled={watchBusy}
                onClick={toggleWatch}
              >
                {intl.formatMessage(
                  artist.lidarr.monitorNewItems
                    ? messages.watching
                    : messages.watch
                )}
              </Button>
            )}
            {serverLinks.map((link) => (
              <a
                key={`${link.type}-${link.url}`}
                className="sh-btn"
                href={link.url}
                target="_blank"
                rel="noreferrer"
              >
                {linkLabel(link, openIn)}
              </a>
            ))}
            {canManage && (
              <Button type="button" onClick={() => setShowManage(true)}>
                {intl.formatMessage(messages.manage)}
              </Button>
            )}
          </div>
          {!!artist.tags?.length && (
            <div className="tags">
              {artist.tags.slice(0, 6).map((tag) => (
                <Link
                  className="sh-tag"
                  key={tag}
                  href={`/genre/${encodeURIComponent(tag)}`}
                >
                  {tag}
                </Link>
              ))}
            </div>
          )}
        </div>
        {topAlbums.length > 0 && (
          <Carousel
            className="tiles"
            title={intl.formatMessage(messages.topalbums)}
          >
            {topAlbums.map((album) => (
              <AlbumCard
                key={album.mbid}
                mbid={album.mbid}
                title={album.title}
                year={album.firstReleaseDate}
                status={album.status}
                imageSrc={album.coverUrl}
                meta={[album.primaryType, album.firstReleaseDate?.slice(0, 4)]
                  .filter(Boolean)
                  .join(', ')}
              />
            ))}
          </Carousel>
        )}
      </section>

      <dl className="sh-facts sh-rx-facts">
        <div>
          <dt>{intl.formatMessage(messages.factreleases)}</dt>
          <dd>{intl.formatNumber(artist.facts.releases)}</dd>
        </div>
        <div>
          <dt>{intl.formatMessage(messages.factinlibrary)}</dt>
          <dd className="text-st-available">
            {intl.formatNumber(artist.facts.inLibrary)}
          </dd>
        </div>
        <div>
          <dt>{intl.formatMessage(messages.factdownloading)}</dt>
          <dd className="text-st-processing">
            {intl.formatNumber(artist.facts.downloading)}
          </dd>
        </div>
        <div>
          <dt>{intl.formatMessage(messages.factalbums)}</dt>
          <dd>{intl.formatNumber(artist.facts.albums)}</dd>
        </div>
      </dl>

      <section className="sh-two" aria-labelledby="artist-about">
        <div className="wide" style={{ flex: '2 1 480px' }}>
          <h2 className="sh-h-section mb-3" id="artist-about">
            {intl.formatMessage(messages.about)}
          </h2>
          {artist.bio ? (
            <p className="m-0 max-w-[66ch] leading-[1.65] text-muted">
              {artist.bio.text}{' '}
              <a href={artist.bio.url} target="_blank" rel="noreferrer">
                {intl.formatMessage(
                  artist.bio.source === 'lastfm'
                    ? messages.biosourcelastfm
                    : messages.biosourcemusicbrainz
                )}
              </a>
            </p>
          ) : (
            <p className="m-0 text-muted">
              {intl.formatMessage(messages.nobio)}
            </p>
          )}
        </div>
        <dl className="sh-box sh-kv" style={{ flex: '1 1 280px' }}>
          <div>
            <dt>{intl.formatMessage(messages.mbid)}</dt>
            <dd className="break-all font-mono text-[13px]">{artist.mbid}</dd>
          </div>
          <div>
            <dt>{intl.formatMessage(messages.lidarr)}</dt>
            <dd
              className={
                artist.lidarr?.monitored ? 'text-st-available' : 'text-muted'
              }
            >
              {intl.formatMessage(
                artist.lidarr
                  ? artist.lidarr.monitored
                    ? messages.monitored
                    : messages.notmonitored
                  : messages.notadded
              )}
            </dd>
          </div>
          {artist.lidarr?.qualityProfileName && (
            <div>
              <dt>{intl.formatMessage(messages.quality)}</dt>
              <dd>{artist.lidarr.qualityProfileName}</dd>
            </div>
          )}
          {artist.lidarr?.metadataProfileName && (
            <div>
              <dt>{intl.formatMessage(messages.metadataprofile)}</dt>
              <dd>{artist.lidarr.metadataProfileName}</dd>
            </div>
          )}
          {artist.lidarr?.rootFolder && (
            <div>
              <dt>{intl.formatMessage(messages.folder)}</dt>
              <dd className="break-all">{artist.lidarr.rootFolder}</dd>
            </div>
          )}
        </dl>
      </section>

      <Discography releases={artist.discography} />

      {artist.similar.length > 0 && (
        <section aria-labelledby="artist-similar">
          <h2 className="sh-h-section mb-3.5" id="artist-similar">
            {intl.formatMessage(messages.similar)}
          </h2>
          <div className="sh-chips">
            {artist.similar.map((similar) => (
              <Link
                key={similar.mbid}
                href={`/artist/${similar.mbid}`}
                className="sh-chip inline-flex items-center text-ink"
              >
                {similar.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {otherLinks.length > 0 && (
        <section aria-labelledby="artist-links">
          <h2 className="sh-h-section mb-3.5" id="artist-links">
            {intl.formatMessage(messages.links)}
          </h2>
          <div className="sh-chips">
            {otherLinks.map((link) => (
              <a
                key={`${link.type}-${link.url}`}
                className="sh-chip inline-flex items-center text-ink"
                href={link.url}
                target="_blank"
                rel="noreferrer"
              >
                {linkLabel(link, openIn)}
              </a>
            ))}
          </div>
        </section>
      )}

      <ManageSlideOver
        mediaType="artist"
        mbid={artist.mbid}
        show={showManage}
        onClose={() => setShowManage(false)}
      />
    </>
  );
};

export default ArtistDetails;
