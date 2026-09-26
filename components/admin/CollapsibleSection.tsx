'use client';

import { useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: string;
  /** Whether the section starts expanded. Defaults to true. */
  defaultOpen?: boolean;
  children: ReactNode;
}

/**
 * A section wrapper with a clickable header that shows/hides its content, so
 * the admin dashboard can collapse sections that aren't currently needed.
 */
export default function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <span className="text-gray-500" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="border-t border-gray-100 p-4">{children}</div>}
    </div>
  );
}
