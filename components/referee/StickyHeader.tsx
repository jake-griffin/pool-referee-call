'use client';

interface StickyHeaderProps {
  unansweredCount: number;
  myQueueCount: number;
}

export default function StickyHeader({ unansweredCount, myQueueCount }: StickyHeaderProps) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
      <h1 className="text-lg font-semibold text-gray-900">Referee</h1>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-gray-600">New</span>
          <span
            className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800"
            aria-label={`${unansweredCount} unanswered calls`}
          >
            {unansweredCount}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-gray-600">Mine</span>
          <span
            className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800"
            aria-label={`${myQueueCount} calls in your queue`}
          >
            {myQueueCount}
          </span>
        </div>
      </div>
    </header>
  );
}
