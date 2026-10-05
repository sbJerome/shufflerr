import StatusDot from '@app/components/Common/StatusDot';
import CoverArt from '@app/components/CoverArt';
import { hasActiveRequest } from '@app/components/RequestModal/subject';
import StatusBadge from '@app/components/StatusBadge';
import defineMessages from '@app/utils/defineMessages';
import { proxied } from '@app/utils/images';
import { MediaStatus } from '@server/constants/media';
import type { ImportMatch } from '@server/interfaces/api/importInterfaces';
import Link from 'next/link';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Import.MatchList', {
  nomatch: 'No match on MusicBrainz',
  matching: 'Finding it on MusicBrainz…',
  pick: 'Request {title} by {artist}',
  viewalbum: 'View album',
});

/** An album from an import link that can still be requested. */
export const isPickable = (match: ImportMatch): boolean =>
  !!match.album &&
  (match.album.status === MediaStatus.UNKNOWN ||
    match.album.status === MediaStatus.DELETED) &&
  !hasActiveRequest(match.album);

interface MatchListProps {
  matches: ImportMatch[];
  /** Release-group MBIDs currently checked. */
  picked: string[];
  onToggle: (mbid: string, checked: boolean) => void;
}

/** Albums found behind an import link, with a checkbox for each requestable one. */
const MatchList = ({ matches, picked, onToggle }: MatchListProps) => {
  const intl = useIntl();

  return (
    <div className="sh-box sh-import-res">
      {matches.map((match) => {
        const album = match.album;
        const pickable = isPickable(match);
        const title = album?.title ?? match.sourceTitle;
        const artist = album?.artistName ?? match.sourceArtist;
        const year = album?.year ?? album?.firstReleaseDate?.slice(0, 4);
        return (
          <label
            className={`sh-linked ${pickable ? 'cursor-pointer' : ''}`}
            key={match.sourceId}
          >
            <input
              type="checkbox"
              className="h-[18px] w-[18px] flex-none"
              style={{ accentColor: 'var(--accent)' }}
              checked={pickable && !!album && picked.includes(album.mbid)}
              disabled={!pickable}
              aria-label={intl.formatMessage(messages.pick, { title, artist })}
              onChange={(e) => album && onToggle(album.mbid, e.target.checked)}
            />
            <CoverArt
              thumb
              decorative
              src={album ? album.coverUrl : proxied(match.sourceCoverUrl)}
              mbid={album?.mbid ?? match.sourceId}
              title={title}
            />
            <span className="grow">
              <b>{title}</b>
              <span className="sh-feat">
                {[artist, year].filter(Boolean).join(', ')}
              </span>
            </span>
            {album ? (
              <>
                {hasActiveRequest(album) && album.request ? (
                  <StatusBadge requestStatus={album.request.status} />
                ) : (
                  <StatusBadge status={album.status} />
                )}
                <Link href={`/album/${album.mbid}`} className="text-[13px]">
                  {intl.formatMessage(messages.viewalbum)}
                </Link>
              </>
            ) : (
              <StatusDot tone={match.pending ? 'processing' : 'none'}>
                {intl.formatMessage(
                  match.pending ? messages.matching : messages.nomatch
                )}
              </StatusDot>
            )}
          </label>
        );
      })}
    </div>
  );
};

export default MatchList;
