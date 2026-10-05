// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Avatar from '@app/components/Common/Avatar';
import StatusDot from '@app/components/Common/StatusDot';
import CoverArt from '@app/components/CoverArt';
import { issueOption } from '@app/components/IssueModal/constants';
import defineMessages from '@app/utils/defineMessages';
import { coverUrl } from '@app/utils/images';
import { IssueStatus } from '@server/constants/issue';
import type Issue from '@server/entity/Issue';
import Link from 'next/link';
import { FormattedRelativeTime, useIntl } from 'react-intl';

const messages = defineMessages('components.IssueList.IssueItem', {
  open: 'Open',
  resolved: 'Resolved',
  tracks: '{count, plural, one {# track} other {# tracks}}',
  view: 'View report',
  viewLabel: 'View the report on {title}',
  untitled: 'Untitled',
});

export const ISSUE_COLUMNS = '48px 2fr 1.1fr 1.4fr 1fr 130px';

interface IssueItemProps {
  issue: Issue;
}

const IssueItem = ({ issue }: IssueItemProps) => {
  const intl = useIntl();
  const media = issue.media;
  const isAlbum = media?.mediaType === 'release-group';
  const title = media?.title || intl.formatMessage(messages.untitled);
  const trackCount = issue.problemTracks?.length ?? 0;

  return (
    <div
      className="sh-tr"
      role="row"
      style={{ gridTemplateColumns: ISSUE_COLUMNS }}
    >
      <div role="cell">
        <CoverArt
          thumb
          decorative
          round={!isAlbum}
          src={isAlbum && media ? coverUrl(media.mbid, 250) : undefined}
          mbid={media?.mbid}
          title={title}
          showInitials={!isAlbum}
        />
      </div>
      <div role="cell">
        <Link className="sh-title" href={`/issues/${issue.id}`}>
          {title}
        </Link>
        {media?.artistName && isAlbum && (
          <div className="dim">{media.artistName}</div>
        )}
      </div>
      <div role="cell">
        {intl.formatMessage(issueOption(issue.issueType).name)}
        {trackCount > 0 && (
          <div className="dim">
            {intl.formatMessage(messages.tracks, { count: trackCount })}
          </div>
        )}
      </div>
      <div role="cell" className="flex items-center gap-2">
        <Avatar
          size="sm"
          name={issue.createdBy?.displayName}
          src={issue.createdBy?.avatar}
        />
        <span>
          {issue.createdBy?.displayName}
          <div className="dim">
            <FormattedRelativeTime
              value={Math.floor(
                (new Date(issue.createdAt).getTime() - Date.now()) / 1000
              )}
              updateIntervalInSeconds={60}
              numeric="auto"
            />
          </div>
        </span>
      </div>
      <div role="cell">
        <StatusDot
          tone={issue.status === IssueStatus.OPEN ? 'pending' : 'available'}
        >
          {intl.formatMessage(
            issue.status === IssueStatus.OPEN
              ? messages.open
              : messages.resolved
          )}
        </StatusDot>
      </div>
      <div role="cell" className="actions">
        <Link
          className="sh-btn small"
          href={`/issues/${issue.id}`}
          aria-label={intl.formatMessage(messages.viewLabel, { title })}
        >
          {intl.formatMessage(messages.view)}
        </Link>
      </div>
    </div>
  );
};

export default IssueItem;
