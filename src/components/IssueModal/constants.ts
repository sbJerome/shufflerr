// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import defineMessages from '@app/utils/defineMessages';
import { IssueType } from '@server/constants/issue';
import type { MessageDescriptor } from 'react-intl';

const messages = defineMessages('components.IssueModal.constants', {
  wrongRelease: 'Wrong release',
  wrongReleaseSub: 'A different edition or album than the one requested.',
  badTags: 'Bad tags',
  badTagsSub: 'Wrong titles, artists, track numbers or cover art.',
  missingTracks: 'Missing tracks',
  missingTracksSub: 'Some tracks never arrived or do not play.',
  lowQuality: 'Low quality',
  lowQualitySub: 'The files sound bad or are in the wrong format.',
  other: 'Something else',
  otherSub: 'Anything that does not fit the choices above.',
});

interface IssueOption {
  issueType: IssueType;
  name: MessageDescriptor;
  description: MessageDescriptor;
  /** People can point at the affected tracks. */
  perTrack: boolean;
  /** Offered for artists too (not only albums). */
  artist: boolean;
}

export const issueOptions: IssueOption[] = [
  {
    issueType: IssueType.WRONG_RELEASE,
    name: messages.wrongRelease,
    description: messages.wrongReleaseSub,
    perTrack: false,
    artist: false,
  },
  {
    issueType: IssueType.BAD_TAGS,
    name: messages.badTags,
    description: messages.badTagsSub,
    perTrack: true,
    artist: true,
  },
  {
    issueType: IssueType.MISSING_TRACKS,
    name: messages.missingTracks,
    description: messages.missingTracksSub,
    perTrack: true,
    artist: false,
  },
  {
    issueType: IssueType.LOW_QUALITY,
    name: messages.lowQuality,
    description: messages.lowQualitySub,
    perTrack: true,
    artist: true,
  },
  {
    issueType: IssueType.OTHER,
    name: messages.other,
    description: messages.otherSub,
    perTrack: false,
    artist: true,
  },
];

export const issueOption = (issueType: IssueType): IssueOption =>
  issueOptions.find((option) => option.issueType === issueType) ??
  issueOptions[issueOptions.length - 1];
