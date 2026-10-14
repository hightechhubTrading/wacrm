import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** A shared page identity; actions remain owned by each screen. */
export function PageIdentity({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className="crm-page-identity">
      <span className="crm-page-mark" aria-hidden="true">
        <Icon size={22} strokeWidth={1.7} />
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
