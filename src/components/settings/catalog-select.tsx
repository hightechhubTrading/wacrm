import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function CatalogSelect({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'border-input bg-background text-foreground focus-visible:ring-ring h-9 w-full min-w-0 rounded-lg border px-3 text-sm outline-none focus-visible:ring-2 disabled:opacity-50',
        className
      )}
    />
  );
}
