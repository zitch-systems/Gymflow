import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type CommonProps = {
  variant?: Variant;
  size?: Size;
  full?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children?: ReactNode;
  className?: string;
};

function classes({ variant = 'primary', size = 'md', full, className }: CommonProps) {
  const v = variant === 'primary' ? 'gf-btn-primary'
    : variant === 'secondary' ? 'gf-btn-secondary'
    : variant === 'outline' ? 'gf-btn-outline'
    : variant === 'ghost' ? 'gf-btn-ghost'
    : 'gf-btn-danger';
  const s = size === 'sm' ? 'gf-btn-sm' : size === 'lg' ? 'gf-btn-lg' : '';
  return ['gf-btn', v, s, full ? 'gf-btn-full' : '', className ?? ''].filter(Boolean).join(' ');
}

function Content({ leadingIcon, trailingIcon, children, loading }: CommonProps) {
  return (
    <>
      {loading ? <span className="gf-spinner gf-spinner-sm" aria-hidden /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </>
  );
}

export function Button({
  variant, size, full, loading, leadingIcon, trailingIcon, children, className,
  type = 'button',
  ...rest
}: CommonProps & Omit<ComponentProps<'button'>, 'className' | 'children'>) {
  return (
    <button
      type={type}
      className={classes({ variant, size, full, className })}
      disabled={loading || rest.disabled}
      {...rest}
    >
      <Content leadingIcon={leadingIcon} trailingIcon={trailingIcon} loading={loading}>{children}</Content>
    </button>
  );
}

export function ButtonLink({
  variant, size, full, leadingIcon, trailingIcon, children, className,
  href,
  ...rest
}: CommonProps & Omit<ComponentProps<typeof Link>, 'className' | 'children'>) {
  return (
    <Link href={href} className={classes({ variant, size, full, className })} {...rest}>
      <Content leadingIcon={leadingIcon} trailingIcon={trailingIcon}>{children}</Content>
    </Link>
  );
}
