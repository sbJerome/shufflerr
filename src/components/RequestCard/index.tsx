// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import CoverArt from '@app/components/CoverArt';
import useRequestText from '@app/components/RequestList/requestText';
import StatusBadge from '@app/components/StatusBadge';
import { isDownloading } from '@app/utils/status';
import { MediaType } from '@server/constants/media';
import type { RequestResult } from '@server/interfaces/api/requestInterfaces';
import Link from 'next/link';

interface RequestCardProps {
  request: RequestResult;
  /** Show who asked and when (lists that mix several people's requests). */
  showRequester?: boolean;
}

/**
 * One request as a card for horizontal rows: art, title, artist and status.
 * Put it inside `HorizontalRow` / `sh-row`.
 */
const RequestCard = ({ request, showRequester = false }: RequestCardProps) => {
  const text = useRequestText();
  const title = text.title(request);
  const href = text.href(request);
  const artistLine = text.artistLine(request);

  return (
    <div className="sh-card">
      <Link href={href} aria-label={title}>
        <CoverArt
          decorative
          round={request.media?.mediaType === MediaType.ARTIST}
          src={request.coverUrl}
          mbid={request.media?.mbid}
          title={request.media?.title}
        />
      </Link>
      <div className="min-w-0">
        <Link href={href} className="t block" title={title}>
          {title}
        </Link>
        <div className="m truncate">
          {[
            artistLine,
            showRequester ? request.requestedBy?.displayName : '',
            text.ago(request.createdAt),
          ]
            .filter(Boolean)
            .join(', ')}
        </div>
      </div>
      <StatusBadge
        requestStatus={request.status}
        downloading={isDownloading(request)}
      />
    </div>
  );
};

export default RequestCard;
