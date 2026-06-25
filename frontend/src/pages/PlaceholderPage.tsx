import { Construction } from 'lucide-react';
import { PageContainer, PageHeader } from '../components/ui';

/** Página genérica para áreas previstas no produto e ainda não conectadas ao backend. */
export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <PageContainer>
      <PageHeader title={title} subtitle={description} />
      <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground animate-entry [animation-delay:100ms]">
        <span className="size-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
          <Construction className="size-6" />
        </span>
        <p className="font-semibold text-foreground">Em preparação</p>
        <p className="text-sm mt-1">Esta área será conectada ao backend em uma próxima etapa.</p>
      </div>
    </PageContainer>
  );
}
