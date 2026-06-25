export function AttendanceListSkeleton() {
  return (
    <ul className="space-y-3" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={i}
          className="bg-card border border-border rounded-xl p-4 shadow-sm border-l-4 border-l-border animate-pulse"
        >
          <div className="flex items-start gap-3">
            <span className="size-10 rounded-full bg-muted shrink-0" />
            <div className="flex-1 min-w-0 space-y-2.5">
              <div className="h-4 w-44 max-w-[60%] bg-muted rounded" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
                {Array.from({ length: 6 }).map((__, j) => (
                  <div key={j} className="h-3 bg-muted rounded" />
                ))}
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border flex gap-2">
            <div className="h-7 w-24 bg-muted rounded-md" />
            <div className="h-7 w-24 bg-muted rounded-md" />
          </div>
        </li>
      ))}
    </ul>
  );
}
