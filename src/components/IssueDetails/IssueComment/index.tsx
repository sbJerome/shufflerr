// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Avatar from '@app/components/Common/Avatar';
import Button from '@app/components/Common/Button';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type IssueCommentEntity from '@server/entity/IssueComment';
import axios from 'axios';
import { useState } from 'react';
import { FormattedRelativeTime, useIntl } from 'react-intl';

const messages = defineMessages('components.IssueDetails.IssueComment', {
  edit: 'Edit',
  delete: 'Delete',
  confirmDelete: 'Delete this comment?',
  save: 'Save comment',
  saving: 'Saving…',
  cancel: 'Cancel',
  edited: 'edited',
  editLabel: 'Edit your comment',
  empty: 'Write something before saving.',
  failed: 'The comment was not changed. Try again in a moment.',
});

interface IssueCommentProps {
  comment: IssueCommentEntity;
  /** The first comment is the report itself and can't be deleted on its own. */
  isDescription?: boolean;
  onUpdate: () => void;
}

const IssueComment = ({
  comment,
  isDescription = false,
  onUpdate,
}: IssueCommentProps) => {
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(comment.message);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwn = comment.user?.id === user?.id;
  const canDelete =
    !isDescription && (isOwn || hasPermission(Permission.MANAGE_ISSUES));
  const wasEdited =
    new Date(comment.updatedAt).getTime() -
      new Date(comment.createdAt).getTime() >
    1000;

  const save = async () => {
    if (!draft.trim()) {
      setError(intl.formatMessage(messages.empty));
      return;
    }
    setBusy(true);
    try {
      await axios.put(`/api/v1/issueComment/${comment.id}`, {
        message: draft.trim(),
      });
      setEditing(false);
      setError(null);
      onUpdate();
    } catch {
      setError(intl.formatMessage(messages.failed));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await axios.delete(`/api/v1/issueComment/${comment.id}`);
      onUpdate();
    } catch {
      setError(intl.formatMessage(messages.failed));
      setBusy(false);
    }
  };

  return (
    <li className="!items-start">
      <Avatar
        size="sm"
        name={comment.user?.displayName}
        src={comment.user?.avatar}
      />
      <div className="grow">
        <div>
          <b>{comment.user?.displayName}</b>{' '}
          <span className="text-faint">
            <FormattedRelativeTime
              value={Math.floor(
                (new Date(comment.createdAt).getTime() - Date.now()) / 1000
              )}
              updateIntervalInSeconds={60}
              numeric="auto"
            />
            {wasEdited && ` · ${intl.formatMessage(messages.edited)}`}
          </span>
        </div>
        {editing ? (
          <form
            className="mt-2 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <textarea
              rows={3}
              value={draft}
              aria-label={intl.formatMessage(messages.editLabel)}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                buttonType="primary"
                buttonSize="sm"
                type="submit"
                disabled={busy}
              >
                {intl.formatMessage(busy ? messages.saving : messages.save)}
              </Button>
              <Button
                buttonSize="sm"
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft(comment.message);
                  setError(null);
                }}
              >
                {intl.formatMessage(messages.cancel)}
              </Button>
            </div>
          </form>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-words">
            {comment.message}
          </p>
        )}
        {error && (
          <p className="text-st-declined" role="alert">
            {error}
          </p>
        )}
        {!editing && (isOwn || canDelete) && (
          <div className="mt-2 flex gap-2">
            {isOwn && (
              <Button buttonSize="sm" onClick={() => setEditing(true)}>
                {intl.formatMessage(messages.edit)}
              </Button>
            )}
            {canDelete &&
              (confirming ? (
                <>
                  <Button
                    buttonType="danger"
                    buttonSize="sm"
                    disabled={busy}
                    onClick={remove}
                  >
                    {intl.formatMessage(messages.confirmDelete)}
                  </Button>
                  <Button buttonSize="sm" onClick={() => setConfirming(false)}>
                    {intl.formatMessage(messages.cancel)}
                  </Button>
                </>
              ) : (
                <Button buttonSize="sm" onClick={() => setConfirming(true)}>
                  {intl.formatMessage(messages.delete)}
                </Button>
              ))}
          </div>
        )}
      </div>
    </li>
  );
};

export default IssueComment;
