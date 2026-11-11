import type { AnchorHTMLAttributes, ReactNode } from 'react';
/** Standalone build: hash-based routing instead of the Next.js router. */
export default function Link({ href, children, ...rest }: { href: string; children?: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={`#${href}`} {...rest}>{children}</a>;
}
