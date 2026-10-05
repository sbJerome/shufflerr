// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import UserProfile from '@app/components/UserProfile';
import Requests from '@app/components/UserProfile/Requests';
import type { NextPage } from 'next';

const UserRequestsPage: NextPage = () => {
  return (
    <UserProfile tab="requests">
      <Requests />
    </UserProfile>
  );
};

export default UserRequestsPage;
