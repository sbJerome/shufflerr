// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Button from '@app/components/Common/Button';
import StatusDot from '@app/components/Common/StatusDot';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type { BlocklistItem } from '@server/interfaces/api/blocklistInterfaces';
import axios from 'axios';
import { useState } from 'react';
import { FormattedDate, useIntl } from 'react-intl';
import useSWR, { mutate as globalMutate } from 'swr';

const messages = defineMessages('components.BlocklistBlock', {
  blocked: 'Blocked',
  blockedBy: 'Blocked by {name} on {date}',
  blockedOn: 'Blocked on {date}',
  unblock: 'Unblock',
  unblocking: 'Unblocking…',
  unblocked: 'Unblocked {title}.',
  unblockedUnnamed: 'Unblocked.',
  failed: 'It was not unblocked. Try again in a moment.',
});

interface BlocklistBlockProps {
  mediaType: 'artist' | 'release-group';
  mbid: string;
  title?: string;
  /** Called after the block was removed. */
  onUnblock?: () => void;
}

/** Who blocked an item and when, with Unblock. Needs MANAGE_BLOCKLIST. */
const BlocklistBlock = ({
  mediaType,
  mbid,
  title,
  onUnblock,
}: BlocklistBlockProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { hasPermission } = useUser();
  const canManage = hasPermission(Permission.MANAGE_BLOCKLIST);
  const { data } = useSWR<BlocklistItem>(
    canManage ? `/api/v1/blocklist/${mbid}?mediaType=${mediaType}` : null
  );
  const [busy, setBusy] = useState(false);

  const unblock = async () => {
    setBusy(true);
    try {
      await axios.delete(`/api/v1/blocklist/${mbid}?mediaType=${mediaType}`);
      addToast(
        title
          ? intl.formatMessage(messages.unblocked, { title })
          : intl.formatMessage(messages.unblockedUnnamed),
        { appearance: 'success' }
      );
      globalMutate(
        `/api/v1/${mediaType === 'artist' ? 'artist' : 'album'}/${mbid}`
      );
      onUnblock?.();
    } catch {
      addToast(intl.formatMessage(messages.failed), { appearance: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const date = data?.createdAt ? (
    <FormattedDate
      value={data.createdAt}
      year="numeric"
      month="long"
      day="numeric"
    />
  ) : null;

  return (
    <div className="sh-box">
      <ul className="sh-list">
        <li>
          <div className="grow">
            <StatusDot tone="declined">
              {intl.formatMessage(messages.blocked)}
            </StatusDot>
            {date && (
              <div className="text-muted">
                {data?.user
                  ? intl.formatMessage(messages.blockedBy, {
                      name: data.user.displayName,
                      date,
                    })
                  : intl.formatMessage(messages.blockedOn, { date })}
              </div>
            )}
          </div>
          {canManage && (
            <Button buttonSize="sm" disabled={busy} onClick={unblock}>
              {intl.formatMessage(
                busy ? messages.unblocking : messages.unblock
              )}
            </Button>
          )}
        </li>
      </ul>
    </div>
  );
};

export default BlocklistBlock;
