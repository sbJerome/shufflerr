// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Button from '@app/components/Common/Button';
import Field from '@app/components/Common/Field';
import Modal from '@app/components/Common/Modal';
import ProgressBar from '@app/components/Common/ProgressBar';
import CoverArt from '@app/components/CoverArt';
import usePlayback from '@app/components/Playback';
import useRequestText from '@app/components/RequestList/requestText';
import { revalidateMusic } from '@app/components/RequestModal';
import StatusBadge from '@app/components/StatusBadge';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { isDownloading } from '@app/utils/status';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import type { RequestResult } from '@server/interfaces/api/requestInterfaces';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.RequestList.RequestItem', {
  approve: 'Approve',
  decline: 'Decline',
  cancelrequest: 'Cancel request',
  retry: 'Retry',
  play: 'Play',
  downloaded: '{percent}% downloaded',
  downloadprogress: '{title}: {percent}% downloaded',
  approved: 'Approved {title}. Sent to Lidarr.',
  declined: 'Declined {title}.',
  retrying: 'Retrying {title}. Sent to Lidarr.',
  cancelled: 'Cancelled your request for {title}.',
  removed: 'Removed the request for {title}.',
  actionfailed: 'That didn’t go through. Refresh the page and try again.',
  declinetitle: 'Decline {title}?',
  declinereason: 'Reason (optional)',
  declinereasonhint: 'The requester sees this note.',
  declineconfirm: 'Decline request',
  keep: 'Keep request',
  approvenamed: 'Approve {title}',
  declinenamed: 'Decline {title}',
  cancelnamed: 'Cancel your request for {title}',
  retrynamed: 'Retry {title}',
  playnamed: 'Play {title}',
});

export const REQUEST_COLUMNS =
  '52px minmax(220px,2fr) 110px minmax(120px,1fr) minmax(170px,1.2fr) 180px 210px';

interface RequestItemProps {
  request: RequestResult;
  onChange: () => void;
}

const RequestItem = ({ request, onChange }: RequestItemProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const text = useRequestText();
  const { playAlbum } = usePlayback();
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');

  const title = text.title(request);
  const shortTitle = text.shortTitle(request);
  const isOwn = request.requestedBy?.id === user?.id;
  const canSeeUsers = hasPermission(Permission.MANAGE_USERS);
  const note = request.failureReason || request.declineReason;
  const percent = Math.max(0, Math.min(100, request.downloadProgress ?? 0));

  const act = async (
    run: () => Promise<unknown>,
    success: string
  ): Promise<boolean> => {
    setBusy(true);
    try {
      await run();
      addToast(success, { appearance: 'success' });
      revalidateMusic();
      onChange();
      return true;
    } catch (e) {
      const message = axios.isAxiosError(e)
        ? e.response?.data?.message
        : undefined;
      addToast(message ?? intl.formatMessage(messages.actionfailed), {
        appearance: 'error',
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const approve = () =>
    act(
      () => axios.post(`/api/v1/request/${request.id}/approve`),
      intl.formatMessage(messages.approved, { title: shortTitle })
    );
  const decline = async () => {
    const ok = await act(
      () =>
        axios.post(`/api/v1/request/${request.id}/decline`, {
          declineReason: reason.trim() || undefined,
        }),
      intl.formatMessage(messages.declined, { title: shortTitle })
    );
    if (ok) {
      setDeclining(false);
    }
  };
  const retry = () =>
    act(
      () => axios.post(`/api/v1/request/${request.id}/retry`),
      intl.formatMessage(messages.retrying, { title: shortTitle })
    );
  const remove = () =>
    act(
      () => axios.delete(`/api/v1/request/${request.id}`),
      intl.formatMessage(isOwn ? messages.cancelled : messages.removed, {
        title: shortTitle,
      })
    );

  let actions: React.ReactNode = null;
  if (request.status === MediaRequestStatus.PENDING && request.canManage) {
    actions = (
      <>
        <Button
          buttonType="success"
          buttonSize="sm"
          disabled={busy}
          onClick={approve}
          aria-label={intl.formatMessage(messages.approvenamed, { title })}
        >
          {intl.formatMessage(messages.approve)}
        </Button>
        <button
          type="button"
          className="sh-btn small no"
          disabled={busy}
          onClick={() => setDeclining(true)}
          aria-label={intl.formatMessage(messages.declinenamed, { title })}
        >
          {intl.formatMessage(messages.decline)}
        </button>
      </>
    );
  } else if (
    request.status === MediaRequestStatus.PENDING &&
    request.canRemove
  ) {
    actions = (
      <Button
        buttonSize="sm"
        disabled={busy}
        onClick={remove}
        aria-label={intl.formatMessage(messages.cancelnamed, { title })}
      >
        {intl.formatMessage(messages.cancelrequest)}
      </Button>
    );
  } else if (request.status === MediaRequestStatus.APPROVED) {
    actions = (
      <span className="flex w-[180px] flex-col gap-1.5">
        <span className="sh-feat">
          {intl.formatMessage(messages.downloaded, { percent })}
        </span>
        <ProgressBar
          value={percent}
          tone="processing"
          className="!h-1"
          label={intl.formatMessage(messages.downloadprogress, {
            title,
            percent,
          })}
        />
      </span>
    );
  } else if (
    request.status === MediaRequestStatus.FAILED &&
    request.canManage
  ) {
    actions = (
      <Button
        buttonSize="sm"
        disabled={busy}
        onClick={retry}
        aria-label={intl.formatMessage(messages.retrynamed, { title })}
      >
        {intl.formatMessage(messages.retry)}
      </Button>
    );
  } else if (
    request.status === MediaRequestStatus.COMPLETED &&
    request.playable &&
    request.media?.mediaType === MediaType.RELEASE_GROUP
  ) {
    actions = (
      <Button
        buttonSize="sm"
        onClick={() => playAlbum(request.media.mbid)}
        aria-label={intl.formatMessage(messages.playnamed, { title })}
      >
        {intl.formatMessage(messages.play)}
      </Button>
    );
  }

  const requester = request.requestedBy;
  const artistLine = text.artistLine(request);

  return (
    <div
      className="sh-tr"
      role="row"
      style={{ gridTemplateColumns: REQUEST_COLUMNS }}
    >
      <span role="cell">
        <CoverArt
          thumb
          decorative
          round={request.media?.mediaType === MediaType.ARTIST}
          src={request.coverUrl}
          mbid={request.media?.mbid}
          title={request.media?.title}
        />
      </span>
      <span role="cell" className="min-w-0">
        <Link href={text.href(request)} className="sh-title text-ink">
          {title}
        </Link>
        {artistLine && (
          <>
            <br />
            <span className="sh-feat">{artistLine}</span>
          </>
        )}
        {note && (
          <>
            <br />
            <span className="text-xs text-st-declined">{note}</span>
          </>
        )}
      </span>
      <span role="cell" className="dim">
        {text.typeLabel(request.scope)}
      </span>
      <span role="cell" className="min-w-0">
        {requester &&
          (canSeeUsers ? (
            <Link href={`/users/${requester.id}`} className="font-medium">
              {requester.displayName}
            </Link>
          ) : (
            <b className="font-medium">{requester.displayName}</b>
          ))}
        <br />
        <span className="sh-feat">{text.ago(request.createdAt)}</span>
      </span>
      <span role="cell" className="dim">
        {request.lastChange}
      </span>
      <span role="cell">
        <StatusBadge
          requestStatus={request.status}
          downloading={isDownloading(request)}
        />
      </span>
      <span role="cell" className="actions">
        {actions}
      </span>

      {declining && (
        <Modal
          title={intl.formatMessage(messages.declinetitle, {
            title: shortTitle,
          })}
          onCancel={() => setDeclining(false)}
          cancelText={intl.formatMessage(messages.keep)}
          onOk={decline}
          okText={intl.formatMessage(messages.declineconfirm)}
          okButtonType="danger"
          okDisabled={busy}
        >
          <Field
            full
            label={intl.formatMessage(messages.declinereason)}
            hint={intl.formatMessage(messages.declinereasonhint)}
          >
            {(p) => (
              <textarea
                {...p}
                value={reason}
                maxLength={250}
                rows={3}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </Modal>
      )}
    </div>
  );
};

export default RequestItem;
