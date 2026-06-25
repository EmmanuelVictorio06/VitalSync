import { AlertCircle } from 'lucide-react';
import { Button } from '../ui';

export function AttendanceErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="bg-card border border-alert/30 rounded-xl p-12 text-center animate-entry">
      <AlertCircle className="size-8 mx-auto mb-3 text-alert" />
      <p className="font-semibold">Não foi possível carregar seus atendimentos. Tente novamente.</p>
      <div className="mt-4 flex justify-center">
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}
