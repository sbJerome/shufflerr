// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import EmptyState from '@app/components/Common/EmptyState';
import PageTitle from '@app/components/Common/PageTitle';
import defineMessages from '@app/utils/defineMessages';
import Link from 'next/link';
import { useIntl } from 'react-intl';

const messages = defineMessages('pages.404', {
  pagenotfound: 'Page not found',
  code: '404',
  explain:
    'This page doesn’t exist. The link may be old, or the address has a typo.',
  gotodiscover: 'Go to Discover',
  searchmusic: 'Search music',
});

const Custom404 = () => {
  const intl = useIntl();

  return (
    <>
      <PageTitle title={intl.formatMessage(messages.pagenotfound)} />
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-16">
        <p className="m-0 font-mono text-[13px] text-faint">
          {intl.formatMessage(messages.code)}
        </p>
        <h1 className="text-[32px] font-bold tracking-[-0.02em]">
          {intl.formatMessage(messages.pagenotfound)}
        </h1>
        <EmptyState
          title={intl.formatMessage(messages.explain)}
          action={
            <span className="flex flex-wrap justify-center gap-3">
              <Link href="/discover" className="sh-btn small primary">
                {intl.formatMessage(messages.gotodiscover)}
              </Link>
              <Link href="/search" className="sh-btn small">
                {intl.formatMessage(messages.searchmusic)}
              </Link>
            </span>
          }
        />
      </div>
    </>
  );
};

export default Custom404;
