// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import StatusDot from '@app/components/Common/StatusDot';
import { issueOption } from '@app/components/IssueModal/constants';
import defineMessages from '@app/utils/defineMessages';
import { IssueStatus } from '@server/constants/issue';
import type Issue from '@server/entity/Issue';
import Link from 'next/link';
import { FormattedDate, useIntl } from 'react-intl';

const messages = defineMessages('components.IssueBlock', {
  open: 'Open',
  resolved: 'Resolved',
  reportedBy: 'Reported by {name}',
  view: 'View',
  viewLabel: 'View report {id}',
});

interface IssueBlockProps {
  issue: Issue;
}

/** One issue as a list row (`<li>` inside a `sh-list`). */
const IssueBlock = ({ issue }: IssueBlockProps) => {
  const intl = useIntl();

  return (
    <li>
      <div className="grow">
        <b>{intl.formatMessage(issueOption(issue.issueType).name)}</b>
        <div className="text-muted">
          {intl.formatMessage(messages.reportedBy, {
            name: issue.createdBy?.displayName,
          })}
          {' · '}
          <FormattedDate
            value={issue.createdAt}
            year="numeric"
            month="short"
            day="numeric"
          />
        </div>
      </div>
      <StatusDot
        tone={issue.status === IssueStatus.OPEN ? 'pending' : 'available'}
      >
        {intl.formatMessage(
          issue.status === IssueStatus.OPEN ? messages.open : messages.resolved
        )}
      </StatusDot>
      <Link
        className="sh-btn small"
        href={`/issues/${issue.id}`}
        aria-label={intl.formatMessage(messages.viewLabel, { id: issue.id })}
      >
        {intl.formatMessage(messages.view)}
      </Link>
    </li>
  );
};

export default IssueBlock;
