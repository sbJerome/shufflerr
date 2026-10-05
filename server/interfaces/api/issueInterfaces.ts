// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { IssueType } from '@server/constants/issue';
import type Issue from '@server/entity/Issue';
import type { PaginatedResponse } from './common';

export interface IssueResultsResponse extends PaginatedResponse {
  results: Issue[];
}

export type IssueRequestBody = {
  message: string;
  mediaId: number;
  issueType: IssueType;
  /** Track row ids the problem applies to. */
  problemTracks?: number[];
  userId?: number;
};
