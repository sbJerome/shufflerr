// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import UserProfile from '@app/components/UserProfile';
import Overview from '@app/components/UserProfile/Overview';
import type { NextPage } from 'next';

const UserProfilePage: NextPage = () => {
  return (
    <UserProfile tab="overview">
      <Overview />
    </UserProfile>
  );
};

export default UserProfilePage;
