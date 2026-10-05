// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import CreateIssueModal from '@app/components/IssueModal/CreateIssueModal';
import { Permission, useUser } from '@app/hooks/useUser';

export interface IssueModalProps {
  mediaType: 'artist' | 'release-group';
  mbid: string;
  show: boolean;
  onClose: () => void;
}

/** "Report a problem" dialog for an album or artist. */
const IssueModal = ({ mediaType, mbid, show, onClose }: IssueModalProps) => {
  const { hasPermission } = useUser();

  if (
    !show ||
    !hasPermission([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
      type: 'or',
    })
  ) {
    return null;
  }

  return (
    <CreateIssueModal mediaType={mediaType} mbid={mbid} onCancel={onClose} />
  );
};

export default IssueModal;
