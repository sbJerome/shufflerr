// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { defineMessages } from '@server/i18n';

const globalMessages = defineMessages('notifications.common', {
  requestedBy: 'Requested by',
  requestStatus: 'Request status',
  pendingApproval: 'Waiting for approval',
  processing: 'Approved, downloading',
  available: 'Available',
  declined: 'Declined',
  failed: 'Failed',
  commentFrom: 'Comment from {userName}',
  reportedBy: 'Reported by',
  issueType: 'Issue type',
  issueStatus: 'Issue status',
  open: 'Open',
  resolved: 'Resolved',
  viewIssue: 'View issue in {applicationTitle}',
  viewMedia: 'Open in {applicationTitle}',
  openIn: 'Open in {applicationTitle}',
  album: 'album',
  tracks: 'tracks',
  discography: 'discography',
  artist: 'artist',
  issue: 'issue',
  issueTypeName: '{type} issue',
});

export default globalMessages;
