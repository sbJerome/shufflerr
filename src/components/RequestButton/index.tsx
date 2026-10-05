// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Button from '@app/components/Common/Button';
import type {
  RequestModalAlbum,
  RequestModalArtist,
} from '@app/components/RequestModal';
import RequestModal from '@app/components/RequestModal';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { RequestScope } from '@server/constants/media';
import type { RequestResult } from '@server/interfaces/api/requestInterfaces';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RequestButton', {
  request: 'Request',
  requestnamed: 'Request {title}',
});

interface RequestButtonProps {
  album?: RequestModalAlbum;
  artist?: RequestModalArtist;
  defaultScope?: RequestScope;
  /** Button text; defaults to "Request". */
  children?: React.ReactNode;
  buttonType?: 'accent' | 'primary' | 'default';
  buttonSize?: 'default' | 'sm';
  onComplete?: (request: RequestResult) => void;
}

/**
 * "Request" button that opens the request modal. Renders nothing when the
 * viewer holds no request permission at all.
 */
const RequestButton = ({
  album,
  artist,
  defaultScope,
  children,
  buttonType = 'accent',
  buttonSize = 'sm',
  onComplete,
}: RequestButtonProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const [open, setOpen] = useState(false);

  const allowed = hasPermission(
    [
      Permission.REQUEST,
      Permission.REQUEST_ALBUM,
      Permission.REQUEST_TRACK,
      Permission.REQUEST_DISCOGRAPHY,
    ],
    { type: 'or' }
  );

  if (!allowed || (!album && !artist)) {
    return null;
  }

  const title = album?.title ?? artist?.name ?? '';

  return (
    <>
      <Button
        type="button"
        buttonType={buttonType}
        buttonSize={buttonSize}
        aria-label={
          children
            ? undefined
            : intl.formatMessage(messages.requestnamed, { title })
        }
        onClick={() => setOpen(true)}
      >
        {children ?? intl.formatMessage(messages.request)}
      </Button>
      {open && (
        <RequestModal
          album={album}
          artist={artist}
          defaultScope={defaultScope}
          onCancel={() => setOpen(false)}
          onComplete={onComplete}
        />
      )}
    </>
  );
};

export default RequestButton;
