// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import StatusDot from '@app/components/Common/StatusDot';
import { issueOption } from '@app/components/IssueModal/constants';
import defineMessages from '@app/utils/defineMessages';
import { IssueStatus } from '@server/constants/issue';
import type Issue from '@server/entity/Issue';
import type { AlbumTrack } from '@server/models/music';
import { FormattedDate, useIntl } from 'react-intl';

const messages = defineMessages('components.IssueDetails.IssueDescription', {
  problem: 'Problem',
  status: 'Status',
  open: 'Open',
  resolved: 'Resolved',
  reportedBy: 'Reported by',
  reported: 'Reported',
  lastChange: 'Last change',
  changedBy: '{date} by {name}',
  tracks: 'Tracks',
  wholeAlbum: 'The whole album',
  wholeArtist: 'Everything by this artist',
  unknownTracks: '{count, plural, one {# track} other {# tracks}}',
});

interface IssueDescriptionProps {
  issue: Issue;
  /** The album's tracklist, when it could be loaded, to name the affected tracks. */
  tracks?: AlbumTrack[];
}

/** The facts of a report: what kind, who, when, which tracks. */
const IssueDescription = ({ issue, tracks }: IssueDescriptionProps) => {
  const intl = useIntl();
  const problemIds = issue.problemTracks ?? [];
  const named = (tracks ?? []).filter(
    (track) => track.id !== undefined && problemIds.includes(track.id)
  );
  const isAlbum = issue.media?.mediaType === 'release-group';
  const date = (value: Date) => (
    <FormattedDate value={value} year="numeric" month="long" day="numeric" />
  );

  return (
    <dl className="sh-kv">
      <div>
        <dt>{intl.formatMessage(messages.problem)}</dt>
        <dd>{intl.formatMessage(issueOption(issue.issueType).name)}</dd>
      </div>
      <div>
        <dt>{intl.formatMessage(messages.status)}</dt>
        <dd>
          <StatusDot
            tone={issue.status === IssueStatus.OPEN ? 'pending' : 'available'}
          >
            {intl.formatMessage(
              issue.status === IssueStatus.OPEN
                ? messages.open
                : messages.resolved
            )}
          </StatusDot>
        </dd>
      </div>
      <div>
        <dt>{intl.formatMessage(messages.reportedBy)}</dt>
        <dd>{issue.createdBy?.displayName}</dd>
      </div>
      <div>
        <dt>{intl.formatMessage(messages.reported)}</dt>
        <dd>{date(issue.createdAt)}</dd>
      </div>
      {issue.modifiedBy && (
        <div>
          <dt>{intl.formatMessage(messages.lastChange)}</dt>
          <dd>
            {intl.formatMessage(messages.changedBy, {
              date: date(issue.updatedAt),
              name: issue.modifiedBy.displayName,
            })}
          </dd>
        </div>
      )}
      <div>
        <dt>{intl.formatMessage(messages.tracks)}</dt>
        <dd>
          {problemIds.length === 0 ? (
            intl.formatMessage(
              isAlbum ? messages.wholeAlbum : messages.wholeArtist
            )
          ) : named.length > 0 ? (
            <ul>
              {named.map((track) => (
                <li key={track.id}>
                  <span className="font-mono text-faint">{track.position}</span>{' '}
                  {track.title}
                </li>
              ))}
            </ul>
          ) : (
            intl.formatMessage(messages.unknownTracks, {
              count: problemIds.length,
            })
          )}
        </dd>
      </div>
    </dl>
  );
};

export default IssueDescription;
