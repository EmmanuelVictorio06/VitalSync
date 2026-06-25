import { ClipboardList } from 'lucide-react';

export function AttendanceEmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground animate-entry">
      <ClipboardList className="size-8 mx-auto mb-3 opacity-40" />
      <p className="font-semibold text-foreground">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
