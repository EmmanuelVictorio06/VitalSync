import { Search, SlidersHorizontal } from 'lucide-react';

export function AttendanceSearchBar({
  search,
  onSearch,
  onOpenFilters,
  activeFilterCount,
}: {
  search: string;
  onSearch: (v: string) => void;
  onOpenFilters: () => void;
  activeFilterCount: number;
}) {
  return (
    <div className="flex items-stretch gap-2 animate-entry">
      <div className="relative flex-1 min-w-0">
        <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          className="input pl-9 w-full"
          placeholder="Buscar por paciente..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          aria-label="Buscar por paciente"
        />
      </div>
      <button
        type="button"
        onClick={onOpenFilters}
        className="inline-flex items-center gap-2 px-3 sm:px-4 rounded-lg border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors shrink-0"
        aria-label="Abrir filtros avançados"
      >
        <SlidersHorizontal className="size-4" />
        <span className="hidden sm:inline">Filtros</span>
        {activeFilterCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-[11px] font-bold">
            {activeFilterCount}
          </span>
        )}
      </button>
    </div>
  );
}
