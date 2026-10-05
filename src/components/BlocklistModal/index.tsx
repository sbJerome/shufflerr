// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Modal from '@app/components/Common/Modal';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import { mutate } from 'swr';

const messages = defineMessages('components.BlocklistModal', {
  titleNamed: 'Block {title}?',
  title: 'Block this?',
  bodyArtist:
    'Nobody will be able to request this artist or their albums until it is unblocked. Music already in the library stays.',
  bodyAlbum:
    'Nobody will be able to request this album until it is unblocked. Music already in the library stays.',
  block: 'Block',
  blocking: 'Blocking…',
  cancel: 'Cancel',
  blocked: 'Blocked {title}.',
  blockedUnnamed: 'Blocked.',
  already: 'That is already blocked.',
  failed: 'It was not blocked. Try again in a moment.',
});

interface BlocklistModalProps {
  mediaType: 'artist' | 'release-group';
  mbid: string;
  /** Name shown in the dialog and stored with the block. */
  title?: string;
  show: boolean;
  onClose: () => void;
  /** Called after the item was blocked. */
  onComplete?: () => void;
}

const BlocklistModal = ({
  mediaType,
  mbid,
  title,
  show,
  onClose,
  onComplete,
}: BlocklistModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const { hasPermission } = useUser();
  const [busy, setBusy] = useState(false);

  if (!show || !hasPermission(Permission.MANAGE_BLOCKLIST)) {
    return null;
  }

  const block = async () => {
    setBusy(true);
    try {
      await axios.post('/api/v1/blocklist', { mbid, mediaType, title });
      addToast(
        title
          ? intl.formatMessage(messages.blocked, { title })
          : intl.formatMessage(messages.blockedUnnamed),
        { appearance: 'success' }
      );
      mutate(`/api/v1/${mediaType === 'artist' ? 'artist' : 'album'}/${mbid}`);
      onComplete?.();
      onClose();
    } catch (e) {
      addToast(
        intl.formatMessage(
          e?.response?.status === 412 ? messages.already : messages.failed
        ),
        { appearance: 'error' }
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={
        title
          ? intl.formatMessage(messages.titleNamed, { title })
          : intl.formatMessage(messages.title)
      }
      okText={intl.formatMessage(busy ? messages.blocking : messages.block)}
      okButtonType="danger"
      okDisabled={busy}
      cancelText={intl.formatMessage(messages.cancel)}
      onOk={block}
      onCancel={onClose}
    >
      <p>
        {intl.formatMessage(
          mediaType === 'artist' ? messages.bodyArtist : messages.bodyAlbum
        )}
      </p>
    </Modal>
  );
};

export default BlocklistModal;
