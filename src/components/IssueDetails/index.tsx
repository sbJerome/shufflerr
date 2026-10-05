// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import PageTitle from '@app/components/Common/PageTitle';
import CoverArt from '@app/components/CoverArt';
import IssueComment from '@app/components/IssueDetails/IssueComment';
import IssueDescription from '@app/components/IssueDetails/IssueDescription';
import { issueOption } from '@app/components/IssueModal/constants';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { coverUrl } from '@app/utils/images';
import { IssueStatus } from '@server/constants/issue';
import type Issue from '@server/entity/Issue';
import type { AlbumDetails } from '@server/models/music';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate as globalMutate } from 'swr';

const messages = defineMessages('components.IssueDetails', {
  issues: 'Issues',
  pageTitle: 'Issue {id}',
  heading: '{type}: {title}',
  untitled: 'Untitled',
  viewAlbum: 'View album',
  viewArtist: 'View artist',
  details: 'Details',
  comments: 'Comments',
  commentLabel: 'Add a comment',
  commentPlaceholder: 'Add what you found or what was fixed.',
  comment: 'Comment',
  commenting: 'Commenting…',
  resolve: 'Resolve issue',
  resolveWithComment: 'Comment and resolve',
  reopen: 'Reopen issue',
  reopenWithComment: 'Comment and reopen',
  delete: 'Delete issue',
  deleteTitle: 'Delete this issue?',
  deleteBody:
    'This removes the report and its comments. The music itself is not changed.',
  cancel: 'Cancel',
  resolved: 'Resolved the issue with {title}.',
  reopened: 'Reopened the issue with {title}.',
  deleted: 'Deleted the issue with {title}.',
  failed: 'That did not work. {reason}',
  tryAgain: 'Try again in a moment.',
  notFound: 'This issue does not exist, or you are not allowed to see it.',
  backToIssues: 'Back to issues',
});

const IssueDetails = () => {
  const intl = useIntl();
  const router = useRouter();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();
  const issueId = router.query.issueId;
  const key = issueId ? `/api/v1/issue/${issueId}` : null;
  const { data: issue, error, mutate } = useSWR<Issue>(key);
  const isAlbum = issue?.media?.mediaType === 'release-group';
  const { data: album } = useSWR<AlbumDetails>(
    issue && isAlbum && (issue.problemTracks?.length ?? 0) > 0
      ? `/api/v1/album/${issue.media.mbid}`
      : null
  );
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  if (!issue && !error) {
    return <LoadingSpinner />;
  }

  if (!issue) {
    return (
      <>
        <PageTitle title={intl.formatMessage(messages.issues)} />
        <Alert type="error" title={intl.formatMessage(messages.notFound)} />
        <div>
          <Link className="sh-btn" href="/issues">
            {intl.formatMessage(messages.backToIssues)}
          </Link>
        </div>
      </>
    );
  }

  const title = issue.media?.title || intl.formatMessage(messages.untitled);
  const isOwn = issue.createdBy?.id === user?.id;
  const isManager = hasPermission(Permission.MANAGE_ISSUES);
  const canChangeStatus = isManager || isOwn;
  const canComment =
    (isManager || isOwn) &&
    hasPermission([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
      type: 'or',
    });
  const canDelete = isManager || (isOwn && issue.comments.length <= 1);
  const isOpen = issue.status === IssueStatus.OPEN;
  const mediaHref = `/${isAlbum ? 'album' : 'artist'}/${issue.media?.mbid}`;

  const fail = (e: { response?: { data?: { message?: string } } }) =>
    addToast(
      intl.formatMessage(messages.failed, {
        reason:
          e?.response?.data?.message ?? intl.formatMessage(messages.tryAgain),
      }),
      { appearance: 'error' }
    );

  const postComment = async () => {
    if (!comment.trim()) {
      return;
    }
    await axios.post(`/api/v1/issue/${issue.id}/comment`, {
      message: comment.trim(),
    });
    setComment('');
  };

  const submitComment = async () => {
    setBusy(true);
    try {
      await postComment();
      mutate();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: 'open' | 'resolved') => {
    setBusy(true);
    try {
      await postComment();
      await axios.post(`/api/v1/issue/${issue.id}/${status}`);
      addToast(
        intl.formatMessage(
          status === 'resolved' ? messages.resolved : messages.reopened,
          { title }
        ),
        { appearance: 'success' }
      );
      mutate();
      globalMutate('/api/v1/issue/count');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await axios.delete(`/api/v1/issue/${issue.id}`);
      addToast(intl.formatMessage(messages.deleted, { title }), {
        appearance: 'success',
      });
      globalMutate('/api/v1/issue/count');
      router.push('/issues');
    } catch (e) {
      fail(e);
      setBusy(false);
      setShowDelete(false);
    }
  };

  return (
    <>
      <PageTitle
        title={[
          intl.formatMessage(messages.pageTitle, { id: issue.id }),
          title,
        ]}
      />
      <div>
        <nav className="sh-crumb" aria-label="Breadcrumb">
          <Link href="/issues">{intl.formatMessage(messages.issues)}</Link>
          {' / '}
          <span className="font-mono">#{issue.id}</span>
        </nav>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <div className="w-24 shrink-0">
            <CoverArt
              decorative
              round={!isAlbum}
              showInitials={!isAlbum}
              src={isAlbum ? coverUrl(issue.media.mbid, 250) : undefined}
              mbid={issue.media?.mbid}
              title={title}
            />
          </div>
          <div className="min-w-0 grow">
            <h1 className="sh-h-section">
              {intl.formatMessage(messages.heading, {
                type: intl.formatMessage(issueOption(issue.issueType).name),
                title,
              })}
            </h1>
            {isAlbum && issue.media?.artistName && (
              <p className="text-muted">{issue.media.artistName}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="sh-btn small" href={mediaHref}>
              {intl.formatMessage(
                isAlbum ? messages.viewAlbum : messages.viewArtist
              )}
            </Link>
            {canDelete && (
              <Button
                buttonType="danger"
                buttonSize="sm"
                onClick={() => setShowDelete(true)}
              >
                {intl.formatMessage(messages.delete)}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="sh-two">
        <section className="wide">
          <h2 className="sh-h-section">
            {intl.formatMessage(messages.comments)}
          </h2>
          <div className="sh-box mt-4">
            <ul className="sh-list">
              {issue.comments.map((entry, index) => (
                <IssueComment
                  key={entry.id}
                  comment={entry}
                  isDescription={index === 0}
                  onUpdate={() => mutate()}
                />
              ))}
            </ul>
          </div>
          {canComment && (
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                submitComment();
              }}
            >
              <label htmlFor="issue-comment">
                {intl.formatMessage(messages.commentLabel)}
              </label>
              <textarea
                id="issue-comment"
                rows={3}
                value={comment}
                placeholder={intl.formatMessage(messages.commentPlaceholder)}
                onChange={(e) => setComment(e.target.value)}
              />
              <div className="flex flex-wrap justify-end gap-2">
                {canChangeStatus && (
                  <Button
                    type="button"
                    buttonType={isOpen ? 'success' : 'default'}
                    disabled={busy}
                    onClick={() => setStatus(isOpen ? 'resolved' : 'open')}
                  >
                    {intl.formatMessage(
                      isOpen
                        ? comment.trim()
                          ? messages.resolveWithComment
                          : messages.resolve
                        : comment.trim()
                          ? messages.reopenWithComment
                          : messages.reopen
                    )}
                  </Button>
                )}
                <Button
                  type="submit"
                  buttonType="primary"
                  disabled={busy || !comment.trim()}
                >
                  {intl.formatMessage(
                    busy ? messages.commenting : messages.comment
                  )}
                </Button>
              </div>
            </form>
          )}
        </section>
        <aside className="narrow">
          <h2 className="sh-h-section">
            {intl.formatMessage(messages.details)}
          </h2>
          <div className="mt-4">
            <IssueDescription issue={issue} tracks={album?.tracks} />
          </div>
        </aside>
      </div>

      {showDelete && (
        <Modal
          title={intl.formatMessage(messages.deleteTitle)}
          okText={intl.formatMessage(messages.delete)}
          okButtonType="danger"
          okDisabled={busy}
          cancelText={intl.formatMessage(messages.cancel)}
          onOk={remove}
          onCancel={() => setShowDelete(false)}
        >
          <p>{intl.formatMessage(messages.deleteBody)}</p>
        </Modal>
      )}
    </>
  );
};

export default IssueDetails;
