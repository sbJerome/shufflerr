// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import useRequestText from '@app/components/RequestList/requestText';
import StatusBadge from '@app/components/StatusBadge';
import type { RequestResult } from '@server/interfaces/api/requestInterfaces';

interface RequestBlockProps {
  request: Pick<
    RequestResult,
    | 'id'
    | 'status'
    | 'scope'
    | 'media'
    | 'trackCount'
    | 'releaseCount'
    | 'requestedBy'
    | 'createdAt'
  > &
    Partial<Pick<RequestResult, 'lastChange' | 'profileName'>>;
}

/** Compact request line for panels (Manage slide-over, album sidebars). */
const RequestBlock = ({ request }: RequestBlockProps) => {
  const text = useRequestText();

  return (
    <div className="sh-linked">
      <span className="grow">
        <b>{text.title(request)}</b>
        <span className="sh-feat">
          {[
            text.typeLabel(request.scope),
            request.requestedBy?.displayName,
            text.ago(request.createdAt),
            request.profileName,
          ]
            .filter(Boolean)
            .join(', ')}
        </span>
        {request.lastChange && (
          <span className="sh-feat">{request.lastChange}</span>
        )}
      </span>
      <StatusBadge requestStatus={request.status} />
    </div>
  );
};

export default RequestBlock;
