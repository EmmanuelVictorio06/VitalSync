import { Construction } from 'lucide-react';

/** Página genérica para áreas previstas no produto e ainda não conectadas ao backend. */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto w-full space-y-6">
      <div className="animate-entry">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{description}</p>
      </div>
      <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground animate-entry [animation-delay:100ms]">
        <span className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
          <Construction className="size-6" />
        </span>
        <p className="font-semibold text-foreground">Em preparação</p>
        <p className="text-sm mt-1">Esta área será conectada ao backend em uma próxima etapa.</p>
      </div>
    </div>
  );
}
