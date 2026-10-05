// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
export enum IssueType {
  WRONG_RELEASE = 1,
  BAD_TAGS = 2,
  MISSING_TRACKS = 3,
  LOW_QUALITY = 4,
  OTHER = 5,
}

export enum IssueStatus {
  OPEN = 1,
  RESOLVED = 2,
}

export const IssueTypeKey: Record<IssueType, string> = {
  [IssueType.WRONG_RELEASE]: 'wrong-release',
  [IssueType.BAD_TAGS]: 'bad-tags',
  [IssueType.MISSING_TRACKS]: 'missing-tracks',
  [IssueType.LOW_QUALITY]: 'low-quality',
  [IssueType.OTHER]: 'other',
};

export const IssueTypeName: Record<IssueType, string> = {
  [IssueType.WRONG_RELEASE]: 'Wrong release',
  [IssueType.BAD_TAGS]: 'Bad tags',
  [IssueType.MISSING_TRACKS]: 'Missing tracks',
  [IssueType.LOW_QUALITY]: 'Low quality',
  [IssueType.OTHER]: 'Other',
};
