// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { IssueType, IssueTypeName } from '@server/constants/issue';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { defineMessages, getIntl } from '@server/i18n';
import globalMessages from '@server/i18n/globalMessages';
import PreparedEmail from '@server/lib/email';
import type { NotificationAgentEmail } from '@server/lib/settings';
import { NotificationAgentKey, getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import type { AvailableLocale } from '@server/types/languages';
import type { EmailOptions } from 'email-templates';
import path from 'path';
import validator from 'validator';
import { Notification, shouldSendAdminNotification } from '..';
import type { NotificationAgent, NotificationPayload } from './agent';
import { BaseAgent, mediaPath } from './agent';

const messages = defineMessages('notifications.agents.email', {
  issueType: '{type} issue',
  issue: 'issue',
  requestPending: 'A new request is waiting for approval:',
  requestAutoRequested: 'A new request was made automatically:',
  requestApproved: 'Your request was approved and sent to Lidarr:',
  requestAutoApproved: 'A new request was approved automatically:',
  requestAvailable: 'Your music is available:',
  requestDeclined: 'Your request was declined:',
  requestFailed: 'A request failed to download:',
  issueReported:
    '{userName} reported a new {issueType} for the {mediaType} {subject}:',
  issueCommented:
    '{userName} commented on the {issueType} for the {mediaType} {subject}:',
  issueMarkedResolved:
    '{userName} marked the {issueType} for the {mediaType} {subject} as resolved.',
  issueWasReopened:
    '{userName} reopened the {issueType} for the {mediaType} {subject}.',
});

class EmailAgent
  extends BaseAgent<NotificationAgentEmail>
  implements NotificationAgent
{
  protected getSettings(): NotificationAgentEmail {
    if (this.settings) {
      return this.settings;
    }

    const settings = getSettings();

    return settings.notifications.agents.email;
  }

  public shouldSend(): boolean {
    const settings = this.getSettings();

    if (
      settings.enabled &&
      settings.options.emailFrom &&
      settings.options.smtpHost &&
      settings.options.smtpPort
    ) {
      return true;
    }

    return false;
  }

  private buildMessage(
    type: Notification,
    payload: NotificationPayload,
    recipientEmail: string,
    recipientName?: string,
    locale?: AvailableLocale
  ): EmailOptions | undefined {
    const intl = getIntl(locale);
    const settings = getSettings();
    const { applicationUrl, applicationTitle } = settings.main;
    const { embedPoster } = settings.notifications.agents.email;
    // Shufflerr has no publicly hosted logo: emails only carry one when the
    // application URL is set (served from this instance).
    const logoUrl = applicationUrl ? `${applicationUrl}/logo.png` : undefined;

    if (type === Notification.TEST_NOTIFICATION) {
      return {
        template: path.join(__dirname, '../../../templates/email/test-email'),
        message: {
          to: recipientEmail,
        },
        locals: {
          body: payload.message,
          applicationUrl,
          applicationTitle,
          logoUrl,
          recipientName,
          recipientEmail,
        },
      };
    }

    const mediaType = payload.media
      ? payload.media.mediaType === MediaType.RELEASE_GROUP
        ? intl.formatMessage(globalMessages.album)
        : intl.formatMessage(globalMessages.artist)
      : undefined;

    if (payload.request) {
      const bodies: Partial<
        Record<Notification, { id: string; defaultMessage: string }>
      > = {
        [Notification.MEDIA_PENDING]: messages.requestPending,
        [Notification.MEDIA_AUTO_REQUESTED]: messages.requestAutoRequested,
        [Notification.MEDIA_APPROVED]: messages.requestApproved,
        [Notification.MEDIA_AUTO_APPROVED]: messages.requestAutoApproved,
        [Notification.MEDIA_AVAILABLE]: messages.requestAvailable,
        [Notification.MEDIA_DECLINED]: messages.requestDeclined,
        [Notification.MEDIA_FAILED]: messages.requestFailed,
      };
      const descriptor = bodies[type];
      const body = descriptor ? intl.formatMessage(descriptor) : '';

      return {
        template: path.join(
          __dirname,
          '../../../templates/email/media-request'
        ),
        message: {
          to: recipientEmail,
        },
        locals: {
          event: payload.event,
          body,
          mediaName: payload.subject,
          message: payload.message,
          actionLabel: intl.formatMessage(globalMessages.viewMedia, {
            applicationTitle,
          }),
          requestedByLabel: intl.formatMessage(globalMessages.requestedBy),
          mediaExtra: payload.extra ?? [],
          imageUrl: embedPoster ? payload.image : undefined,
          timestamp: new Date().toTimeString(),
          requestedBy: payload.request.requestedBy.displayName,
          actionUrl: applicationUrl
            ? `${applicationUrl}/${mediaPath(payload.media)}`
            : undefined,
          applicationUrl,
          applicationTitle,
          logoUrl,
          recipientName,
          recipientEmail,
        },
      };
    } else if (payload.issue) {
      const issueType =
        payload.issue && payload.issue.issueType !== IssueType.OTHER
          ? intl.formatMessage(messages.issueType, {
              type: IssueTypeName[payload.issue.issueType].toLowerCase(),
            })
          : intl.formatMessage(messages.issue);

      let body = '';

      switch (type) {
        case Notification.ISSUE_CREATED:
          body = intl.formatMessage(messages.issueReported, {
            issueType,
            userName: payload.issue.createdBy.displayName,
            mediaType,
            subject: payload.subject,
          });
          break;
        case Notification.ISSUE_COMMENT:
          body = intl.formatMessage(messages.issueCommented, {
            userName: payload.comment?.user.displayName,
            issueType,
            mediaType,
            subject: payload.subject,
          });
          break;
        case Notification.ISSUE_RESOLVED:
          body = intl.formatMessage(messages.issueMarkedResolved, {
            issueType,
            userName: payload.issue.modifiedBy?.displayName,
            mediaType,
            subject: payload.subject,
          });
          break;
        case Notification.ISSUE_REOPENED:
          body = intl.formatMessage(messages.issueWasReopened, {
            issueType,
            userName: payload.issue.modifiedBy?.displayName,
            mediaType,
            subject: payload.subject,
          });
          break;
      }

      return {
        template: path.join(__dirname, '../../../templates/email/media-issue'),
        message: {
          to: recipientEmail,
        },
        locals: {
          event: payload.event,
          body,
          issueDescription: payload.message,
          issueComment: payload.comment?.message,
          mediaName: payload.subject,
          extra: payload.extra ?? [],
          imageUrl: embedPoster ? payload.image : undefined,
          timestamp: new Date().toTimeString(),
          actionUrl: applicationUrl
            ? `${applicationUrl}/issues/${payload.issue.id}`
            : undefined,
          applicationUrl,
          applicationTitle,
          logoUrl,
          recipientName,
          recipientEmail,
        },
      };
    }

    return undefined;
  }

  public async send(
    type: Notification,
    payload: NotificationPayload
  ): Promise<boolean> {
    if (payload.notifyUser) {
      if (
        !payload.notifyUser.settings ||
        (payload.notifyUser.settings.hasNotificationType(
          NotificationAgentKey.EMAIL,
          type
        ) ??
          true)
      ) {
        logger.debug('Sending email notification', {
          label: 'Notifications',
          recipient: payload.notifyUser.displayName,
          type: Notification[type],
          subject: payload.subject,
        });

        try {
          const email = new PreparedEmail(
            this.getSettings(),
            payload.notifyUser.settings?.pgpKey
          );
          if (
            validator.isEmail(payload.notifyUser.email, { require_tld: false })
          ) {
            await email.send(
              this.buildMessage(
                type,
                payload,
                payload.notifyUser.email,
                payload.notifyUser.displayName,
                payload.notifyUser.settings?.locale as AvailableLocale
              )
            );
          } else {
            logger.warn('Invalid email address provided for user', {
              label: 'Notifications',
              recipient: payload.notifyUser.displayName,
              type: Notification[type],
              subject: payload.subject,
            });
          }
        } catch (e) {
          logger.error('Error sending email notification', {
            label: 'Notifications',
            recipient: payload.notifyUser.displayName,
            type: Notification[type],
            subject: payload.subject,
            errorMessage: e.message,
          });

          return false;
        }
      }
    }

    if (payload.notifyAdmin) {
      const userRepository = getRepository(User);
      const users = await userRepository.find();

      await Promise.all(
        users
          .filter(
            (user) =>
              (!user.settings ||
                (user.settings.hasNotificationType(
                  NotificationAgentKey.EMAIL,
                  type
                ) ??
                  true)) &&
              shouldSendAdminNotification(type, user, payload)
          )
          .map(async (user) => {
            logger.debug('Sending email notification', {
              label: 'Notifications',
              recipient: user.displayName,
              type: Notification[type],
              subject: payload.subject,
            });

            try {
              const email = new PreparedEmail(
                this.getSettings(),
                user.settings?.pgpKey
              );
              if (validator.isEmail(user.email, { require_tld: false })) {
                await email.send(
                  this.buildMessage(
                    type,
                    payload,
                    user.email,
                    user.displayName,
                    user.settings?.locale as AvailableLocale
                  )
                );
              } else {
                logger.warn('Invalid email address provided for user', {
                  label: 'Notifications',
                  recipient: user.displayName,
                  type: Notification[type],
                  subject: payload.subject,
                });
              }
            } catch (e) {
              logger.error('Error sending email notification', {
                label: 'Notifications',
                recipient: user.displayName,
                type: Notification[type],
                subject: payload.subject,
                errorMessage: e.message,
              });

              return false;
            }
          })
      );
    }

    return true;
  }
}

export default EmailAgent;
