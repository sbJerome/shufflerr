// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import BlocklistBlock from '@app/components/BlocklistBlock';
import BlocklistModal from '@app/components/BlocklistModal';
import Alert from '@app/components/Common/Alert';
import Avatar from '@app/components/Common/Avatar';
import Button from '@app/components/Common/Button';
import ConfirmButton from '@app/components/Common/ConfirmButton';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import SlideOver from '@app/components/Common/SlideOver';
import ExternalLinkBlock from '@app/components/ExternalLinkBlock';
import IssueBlock from '@app/components/IssueBlock';
import StatusBadge from '@app/components/StatusBadge';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { isDownloading } from '@app/utils/status';
import { MediaRequestStatus, MediaStatus } from '@server/constants/media';
import type { IssueResultsResponse } from '@server/interfaces/api/issueInterfaces';
import type {
  AlbumDetails,
  ArtistDetails,
  ExternalLink,
  RequestSummary,
} from '@server/models/music';
import axios from 'axios';
import Link from 'next/link';
import { useState } from 'react';
import { FormattedDate, useIntl } from 'react-intl';
import useSWR, { mutate as globalMutate } from 'swr';

const messages = defineMessages('components.ManageSlideOver', {
  manage: 'Manage {title}',
  manageUntitled: 'Manage',
  subAlbum: 'Requests, issues and library data for this album.',
  subArtist: 'Requests, issues and library data for this artist.',
  loadError:
    'Shufflerr could not load this item. Close the panel and try again in a moment.',
  requests: 'Requests',
  noRequests: 'Nobody has requested this.',
  scopeTracks: 'Missing tracks',
  scopeAlbum: 'Whole album',
  scopeDiscography: 'Discography',
  requestedBy: '{scope}, requested by {name} on {date}',
  approve: 'Approve',
  decline: 'Decline',
  approveLabel: 'Approve the request from {name}',
  declineLabel: 'Decline the request from {name}',
  approved: 'Approved {title}. Sent to Lidarr.',
  declined: 'Declined {title}.',
  allRequests: 'All requests',
  issues: 'Open issues',
  noIssues: 'No open issues.',
  allIssues: 'All issues',
  library: 'Library data',
  libraryStatus: 'Shufflerr currently shows this as:',
  markAvailable: 'Mark as available',
  markAvailableSub:
    'Use this when the music is in the library but a scan has not picked it up.',
  markedAvailable: 'Marked {title} as available.',
  clearData: 'Clear data',
  clearDataConfirm: 'Are you sure?',
  removeLidarr: 'Remove from Lidarr',
  removeLidarrSub:
    'Lidarr stops tracking and downloading this. The files stay where they are.',
  removeLidarrFiles: 'Remove from Lidarr and delete files',
  removeLidarrFilesSub:
    'Lidarr also deletes the music files. The next library scan marks it as not in the library.',
  removedLidarr: 'Removed {title} from Lidarr.',
  removedLidarrFiles: 'Removed {title} from Lidarr and deleted its files.',
  clearDataSub:
    'Removes what Shufflerr knows about this item, including its requests and issues. Files and Lidarr are not touched; the next scan finds the music again.',
  cleared: 'Cleared the data for {title}.',
  notTracked:
    'Shufflerr has no library data for this yet. It appears after a request or a library scan.',
  blocklist: 'Blocklist',
  block: 'Block',
  blockSub: 'Stops anyone from requesting this.',
  links: 'Open in',
  failed: 'That did not work. {reason}',
  tryAgain: 'Try again in a moment.',
});

export interface ManageSlideOverProps {
  mediaType: 'artist' | 'release-group';
  mbid: string;
  show: boolean;
  onClose: () => void;
}

const linkTypes: ExternalLink['type'][] = [
  'plex',
  'jellyfin',
  'navidrome',
  'musicbrainz',
];

const ManageSlideOver = ({
  mediaType,
  mbid,
  show,
  onClose,
}: ManageSlideOverProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { hasPermission } = useUser();
  const isArtist = mediaType === 'artist';
  const itemKey = `/api/v1/${isArtist ? 'artist' : 'album'}/${mbid}`;
  const canManageRequests = hasPermission(Permission.MANAGE_REQUESTS);
  const canManageBlocklist = hasPermission(Permission.MANAGE_BLOCKLIST);
  const canSeeIssues = hasPermission(
    [Permission.MANAGE_ISSUES, Permission.VIEW_ISSUES],
    { type: 'or' }
  );

  const { data, error, mutate } = useSWR<AlbumDetails | ArtistDetails>(
    show ? itemKey : null
  );
  const mediaId = data?.mediaInfo?.id;
  const { data: issues, mutate: mutateIssues } = useSWR<IssueResultsResponse>(
    show && canSeeIssues && mediaId
      ? `/api/v1/issue?take=100&filter=open&mediaId=${mediaId}`
      : null
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [showBlock, setShowBlock] = useState(false);

  const title = data ? ('title' in data ? data.title : data.name) : undefined;
  const requests: RequestSummary[] = data
    ? 'requests' in data
      ? [
          ...data.requests,
          ...(data.discographyRequest ? [data.discographyRequest] : []),
        ]
      : data.discographyRequest
        ? [data.discographyRequest]
        : []
    : [];
  const itemIssues = (issues?.results ?? []).filter(
    (issue) => issue.media?.id === mediaId
  );
  const links: ExternalLink[] = data
    ? [
        ...data.links,
        ...(data.links.some((link) => link.type === 'musicbrainz')
          ? []
          : [
              {
                type: 'musicbrainz' as const,
                url: `https://musicbrainz.org/${
                  isArtist ? 'artist' : 'release-group'
                }/${mbid}`,
              },
            ]),
      ]
    : [];
  const status = data?.mediaInfo?.status ?? data?.status;
  const inLidarr = canManageRequests && !!data?.lidarr?.canRemove;
  const isBlocked = status === MediaStatus.BLOCKLISTED;

  const refresh = () => {
    mutate();
    mutateIssues();
    globalMutate('/api/v1/request/count');
  };

  const run = async (
    name: string,
    action: () => Promise<unknown>,
    done: string
  ) => {
    setBusy(name);
    try {
      await action();
      addToast(done, { appearance: 'success' });
      refresh();
    } catch (e) {
      addToast(
        intl.formatMessage(messages.failed, {
          reason:
            e?.response?.data?.message ?? intl.formatMessage(messages.tryAgain),
        }),
        { appearance: 'error' }
      );
    } finally {
      setBusy(null);
    }
  };

  const scopeLabel = (scope: RequestSummary['scope']) =>
    intl.formatMessage(
      scope === 'tracks'
        ? messages.scopeTracks
        : scope === 'discography'
          ? messages.scopeDiscography
          : messages.scopeAlbum
    );

  return (
    <>
      <SlideOver
        show={show}
        title={
          title
            ? intl.formatMessage(messages.manage, { title })
            : intl.formatMessage(messages.manageUntitled)
        }
        subText={intl.formatMessage(
          isArtist ? messages.subArtist : messages.subAlbum
        )}
        onClose={onClose}
      >
        {!data && !error && <LoadingSpinner />}
        {error && (
          <Alert type="error" title={intl.formatMessage(messages.loadError)} />
        )}
        {data && (
          <div className="sh-stack">
            <section>
              <div className="sh-sec-head">
                <h3 className="sh-h-section">
                  {intl.formatMessage(messages.requests)}
                </h3>
                <Link href="/requests" onClick={onClose}>
                  {intl.formatMessage(messages.allRequests)}
                </Link>
              </div>
              {requests.length === 0 ? (
                <p className="text-muted">
                  {intl.formatMessage(messages.noRequests)}
                </p>
              ) : (
                <div className="sh-box">
                  <ul className="sh-list">
                    {requests.map((request) => (
                      <li key={request.id} className="flex-wrap">
                        <Avatar
                          size="sm"
                          name={request.requestedBy.displayName}
                          src={request.requestedBy.avatar}
                        />
                        <div className="grow">
                          <StatusBadge
                            requestStatus={request.status}
                            downloading={isDownloading(request)}
                          />
                          <div className="text-muted">
                            {intl.formatMessage(messages.requestedBy, {
                              scope: scopeLabel(request.scope),
                              name: request.requestedBy.displayName,
                              date: (
                                <FormattedDate
                                  key="date"
                                  value={request.createdAt}
                                  year="numeric"
                                  month="short"
                                  day="numeric"
                                />
                              ),
                            })}
                          </div>
                        </div>
                        {canManageRequests &&
                          request.status === MediaRequestStatus.PENDING && (
                            <span className="flex gap-2">
                              <Button
                                buttonType="success"
                                buttonSize="sm"
                                disabled={busy !== null}
                                aria-label={intl.formatMessage(
                                  messages.approveLabel,
                                  { name: request.requestedBy.displayName }
                                )}
                                onClick={() =>
                                  run(
                                    `approve-${request.id}`,
                                    () =>
                                      axios.post(
                                        `/api/v1/request/${request.id}/approve`
                                      ),
                                    intl.formatMessage(messages.approved, {
                                      title,
                                    })
                                  )
                                }
                              >
                                {intl.formatMessage(messages.approve)}
                              </Button>
                              <Button
                                buttonSize="sm"
                                disabled={busy !== null}
                                aria-label={intl.formatMessage(
                                  messages.declineLabel,
                                  { name: request.requestedBy.displayName }
                                )}
                                onClick={() =>
                                  run(
                                    `decline-${request.id}`,
                                    () =>
                                      axios.post(
                                        `/api/v1/request/${request.id}/decline`
                                      ),
                                    intl.formatMessage(messages.declined, {
                                      title,
                                    })
                                  )
                                }
                              >
                                {intl.formatMessage(messages.decline)}
                              </Button>
                            </span>
                          )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {canSeeIssues && mediaId && (
              <section>
                <div className="sh-sec-head">
                  <h3 className="sh-h-section">
                    {intl.formatMessage(messages.issues)}
                  </h3>
                  <Link href="/issues" onClick={onClose}>
                    {intl.formatMessage(messages.allIssues)}
                  </Link>
                </div>
                {!issues ? (
                  <LoadingSpinner />
                ) : itemIssues.length === 0 ? (
                  <p className="text-muted">
                    {intl.formatMessage(messages.noIssues)}
                  </p>
                ) : (
                  <div className="sh-box">
                    <ul className="sh-list">
                      {itemIssues.map((issue) => (
                        <IssueBlock issue={issue} key={issue.id} />
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {canManageRequests && (
              <section>
                <h3 className="sh-h-section">
                  {intl.formatMessage(messages.library)}
                </h3>
                {!mediaId ? (
                  <p className="mt-2 text-muted">
                    {intl.formatMessage(messages.notTracked)}
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col gap-4">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-muted">
                        {intl.formatMessage(messages.libraryStatus)}
                      </span>
                      <StatusBadge status={status} />
                    </p>
                    {!isArtist &&
                      !isBlocked &&
                      status !== MediaStatus.AVAILABLE && (
                        <div>
                          <Button
                            buttonSize="sm"
                            disabled={busy !== null}
                            onClick={() =>
                              run(
                                'available',
                                () =>
                                  axios.post(
                                    `/api/v1/media/${mediaId}/available`
                                  ),
                                intl.formatMessage(messages.markedAvailable, {
                                  title,
                                })
                              )
                            }
                          >
                            {intl.formatMessage(messages.markAvailable)}
                          </Button>
                          <p className="sh-sub mt-1">
                            {intl.formatMessage(messages.markAvailableSub)}
                          </p>
                        </div>
                      )}
                    {inLidarr && (
                      <>
                        <div>
                          <ConfirmButton
                            className="min-w-[9rem]"
                            confirmText={intl.formatMessage(
                              messages.clearDataConfirm
                            )}
                            onClick={() =>
                              run(
                                'lidarr',
                                () =>
                                  axios.delete(
                                    `/api/v1/media/${mediaId}/lidarr`
                                  ),
                                intl.formatMessage(messages.removedLidarr, {
                                  title,
                                })
                              )
                            }
                          >
                            {intl.formatMessage(messages.removeLidarr)}
                          </ConfirmButton>
                          <p className="sh-sub mt-1">
                            {intl.formatMessage(messages.removeLidarrSub)}
                          </p>
                        </div>
                        <div>
                          <ConfirmButton
                            className="min-w-[9rem]"
                            confirmText={intl.formatMessage(
                              messages.clearDataConfirm
                            )}
                            onClick={() =>
                              run(
                                'lidarr-files',
                                () =>
                                  axios.delete(
                                    `/api/v1/media/${mediaId}/lidarr?deleteFiles=1`
                                  ),
                                intl.formatMessage(
                                  messages.removedLidarrFiles,
                                  { title }
                                )
                              )
                            }
                          >
                            {intl.formatMessage(messages.removeLidarrFiles)}
                          </ConfirmButton>
                          <p className="sh-sub mt-1">
                            {intl.formatMessage(messages.removeLidarrFilesSub)}
                          </p>
                        </div>
                      </>
                    )}
                    <div>
                      <ConfirmButton
                        className="min-w-[9rem]"
                        confirmText={intl.formatMessage(
                          messages.clearDataConfirm
                        )}
                        onClick={() =>
                          run(
                            'clear',
                            () => axios.delete(`/api/v1/media/${mediaId}`),
                            intl.formatMessage(messages.cleared, { title })
                          )
                        }
                      >
                        {intl.formatMessage(messages.clearData)}
                      </ConfirmButton>
                      <p className="sh-sub mt-1">
                        {intl.formatMessage(messages.clearDataSub)}
                      </p>
                    </div>
                  </div>
                )}
              </section>
            )}

            {canManageBlocklist && (
              <section>
                <h3 className="sh-h-section">
                  {intl.formatMessage(messages.blocklist)}
                </h3>
                <div className="mt-2">
                  {isBlocked ? (
                    <BlocklistBlock
                      mediaType={mediaType}
                      mbid={mbid}
                      title={title}
                      onUnblock={refresh}
                    />
                  ) : (
                    <>
                      <Button
                        buttonType="danger"
                        buttonSize="sm"
                        onClick={() => setShowBlock(true)}
                      >
                        {intl.formatMessage(messages.block)}
                      </Button>
                      <p className="sh-sub mt-1">
                        {intl.formatMessage(messages.blockSub)}
                      </p>
                    </>
                  )}
                </div>
              </section>
            )}

            <section>
              <h3 className="sh-h-section">
                {intl.formatMessage(messages.links)}
              </h3>
              <div className="mt-2">
                <ExternalLinkBlock links={links} only={linkTypes} />
              </div>
            </section>
          </div>
        )}
      </SlideOver>
      <BlocklistModal
        mediaType={mediaType}
        mbid={mbid}
        title={title}
        show={showBlock}
        onClose={() => setShowBlock(false)}
        onComplete={refresh}
      />
    </>
  );
};

export default ManageSlideOver;
