// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { withProperties } from '@app/utils/typeHelpers';
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  Transition,
} from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/24/solid';
import {
  Fragment,
  useRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
} from 'react';

interface DropdownItemProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  buttonType?: 'primary' | 'ghost';
}

const DropdownItem = ({
  children,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  buttonType: _buttonType,
  ...props
}: DropdownItemProps) => {
  return (
    <MenuItem>
      <a
        className={[
          'button-md flex min-h-[42px] cursor-pointer items-center rounded-ctl px-3 text-sm leading-5 !text-ink !no-underline focus:outline-none',
          'bg-transparent hover:bg-hover data-[focus]:bg-hover',
        ].join(' ')}
        {...props}
      >
        {children}
      </a>
    </MenuItem>
  );
};

type DropdownItemsProps = HTMLAttributes<HTMLDivElement> & {
  dropdownType: 'primary' | 'ghost';
};

const DropdownItems = ({
  children,
  className,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  dropdownType: _dropdownType,
  ...props
}: DropdownItemsProps) => {
  return (
    <Transition
      as={Fragment}
      enter="transition ease-out duration-100"
      enterFrom="opacity-0 scale-95"
      enterTo="opacity-100 scale-100"
      leave="transition ease-in duration-75"
      leaveFrom="opacity-100 scale-100"
      leaveTo="opacity-0 scale-95"
    >
      <MenuItems
        className={[
          'absolute right-0 z-40 mt-2 w-56 origin-top-right rounded-pill border border-line-2 bg-raised p-1 shadow-lg',
          className,
        ].join(' ')}
        {...props}
      >
        <div className="py-1">{children}</div>
      </MenuItems>
    </Transition>
  );
};

interface DropdownProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  text: React.ReactNode;
  dropdownIcon?: React.ReactNode;
  buttonType?: 'primary' | 'ghost';
}

const Dropdown = ({
  text,
  children,
  dropdownIcon,
  className,
  buttonType = 'primary',
  ...props
}: DropdownProps) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <Menu as="div" className="relative z-10">
      <MenuButton
        type="button"
        className={[
          'sh-btn button-md space-x-2',
          buttonType === 'ghost' ? '' : 'primary',
          className,
        ].join(' ')}
        ref={buttonRef}
        disabled={!children}
        {...props}
      >
        <span>{text}</span>
        {children && (dropdownIcon ? dropdownIcon : <ChevronDownIcon />)}
      </MenuButton>
      {children && (
        <DropdownItems dropdownType={buttonType}>{children}</DropdownItems>
      )}
    </Menu>
  );
};
export default withProperties(Dropdown, {
  Item: DropdownItem,
  Items: DropdownItems,
});
