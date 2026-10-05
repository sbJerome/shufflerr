// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { useUser } from '@app/hooks/useUser';
import type { Permission } from '@server/lib/permissions';
import { hasPermission } from '@server/lib/permissions';
import Link from 'next/link';
import { useRouter } from 'next/router';

export interface SettingsRoute {
  text: string;
  content?: React.ReactNode;
  route: string;
  regex: RegExp;
  requiredPermission?: Permission | Permission[];
  permissionType?: { type: 'and' | 'or' };
  hidden?: boolean;
}

type SettingsLinkProps = {
  tabType: 'default' | 'button';
  currentPath: string;
  route: string;
  regex: RegExp;
  hidden?: boolean;
  isMobile?: boolean;
  children: React.ReactNode;
};

const SettingsLink = ({
  children,
  currentPath,
  route,
  regex,
  hidden = false,
  isMobile = false,
}: SettingsLinkProps) => {
  if (hidden) {
    return null;
  }

  if (isMobile) {
    return <option value={route}>{children}</option>;
  }

  const active = !!currentPath.match(regex);

  return (
    <Link href={route} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  );
};

const SettingsTabs = ({
  tabType = 'default',
  settingsRoutes,
}: {
  tabType?: 'default' | 'button';
  settingsRoutes: SettingsRoute[];
}) => {
  const router = useRouter();
  const { user: currentUser } = useUser();

  return (
    <>
      <div className="sm:hidden">
        <label htmlFor="tabs" className="sr-only">
          Select a Tab
        </label>
        <select
          id="tabs"
          className="sh-select-plain w-full"
          onChange={(e) => {
            router.push(e.target.value);
          }}
          onBlur={(e) => {
            router.push(e.target.value);
          }}
          defaultValue={
            settingsRoutes.find((route) => !!router.pathname.match(route.regex))
              ?.route
          }
          aria-label="Selected Tab"
        >
          {settingsRoutes
            .filter(
              (route) =>
                !route.hidden &&
                (route.requiredPermission
                  ? hasPermission(
                      route.requiredPermission,
                      currentUser?.permissions ?? 0,
                      route.permissionType
                    )
                  : true)
            )
            .map((route, index) => (
              <SettingsLink
                tabType={tabType}
                currentPath={router.pathname}
                route={route.route}
                regex={route.regex}
                hidden={route.hidden ?? false}
                isMobile
                key={`mobile-settings-link-${index}`}
              >
                {route.text}
              </SettingsLink>
            ))}
        </select>
      </div>
      {tabType === 'button' ? (
        <div className="hidden sm:block">
          <nav className="sh-subnav-pills" aria-label="Tabs">
            {settingsRoutes.map((route, index) => (
              <SettingsLink
                tabType={tabType}
                currentPath={router.pathname}
                route={route.route}
                regex={route.regex}
                hidden={route.hidden ?? false}
                key={`button-settings-link-${index}`}
              >
                {route.content ?? route.text}
              </SettingsLink>
            ))}
          </nav>
        </div>
      ) : (
        <div className="hidden sm:block">
          <nav className="sh-tabs-h" data-testid="settings-nav-desktop">
            {settingsRoutes
              .filter(
                (route) =>
                  !route.hidden &&
                  (route.requiredPermission
                    ? hasPermission(
                        route.requiredPermission,
                        currentUser?.permissions ?? 0,
                        route.permissionType
                      )
                    : true)
              )
              .map((route, index) => (
                <SettingsLink
                  tabType={tabType}
                  currentPath={router.pathname}
                  route={route.route}
                  regex={route.regex}
                  key={`standard-settings-link-${index}`}
                >
                  {route.text}
                </SettingsLink>
              ))}
          </nav>
        </div>
      )}
    </>
  );
};

export default SettingsTabs;
