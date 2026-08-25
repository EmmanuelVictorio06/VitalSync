import { useRef } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../theme/ThemeContext';
import { cn } from './ui';

/** Toque e segure (mouse/toque/teclado) por esse tanto ativa "seguir o
 *  sistema" em vez de simplesmente alternar claro/escuro. */
const LONG_PRESS_MS = 550;

/** Botão único de alternância de tema, usado em toda a aplicação (painel,
 *  landing page, login, tela pública do paciente). Clique simples alterna
 *  claro ↔ escuro — o caso comum, um toque só. Segurar (mouse, toque ou
 *  Enter/Espaço) volta a seguir o tema do sistema operacional; é a forma
 *  secundária exigida pela tarefa, para não transformar o clique simples num
 *  ciclo de três estados que deixaria o usuário perdido. */
export function ThemeToggle({
  tone = 'default',
  className,
}: {
  /** 'onPrimary': para uso sobre fundo azul sólido (ex.: faixa da marca no login). */
  tone?: 'default' | 'onPrimary';
  className?: string;
}) {
  const { temaEfetivo, alternarTema, seguirSistema } = useTheme();
  const escuro = temaEfetivo === 'escuro';

  const pressStart = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const keyDown = useRef(false);

  function iniciarPressao() {
    pressStart.current = Date.now();
    longPressFired.current = false;
  }

  function finalizarPressao() {
    if (pressStart.current != null && Date.now() - pressStart.current >= LONG_PRESS_MS) {
      longPressFired.current = true;
      seguirSistema();
    }
    pressStart.current = null;
  }

  const onPrimary = tone === 'onPrimary';

  return (
    <button
      type="button"
      onPointerDown={iniciarPressao}
      onPointerUp={finalizarPressao}
      onPointerLeave={() => {
        pressStart.current = null;
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Repetição nativa do keydown ao segurar — só marca o início uma vez.
        if (!keyDown.current) {
          keyDown.current = true;
          iniciarPressao();
        }
      }}
      onKeyUp={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        keyDown.current = false;
        finalizarPressao();
      }}
      onClick={() => {
        // Clique (ou Enter/Espaço "curto") só alterna se a pressão longa não
        // já tiver disparado "seguir o sistema" — evita fazer as duas coisas.
        if (longPressFired.current) {
          longPressFired.current = false;
          return;
        }
        alternarTema();
      }}
      aria-label={escuro ? 'Ativar modo claro' : 'Ativar modo escuro'}
      title={escuro ? 'Ativar modo claro (segure para seguir o sistema)' : 'Ativar modo escuro (segure para seguir o sistema)'}
      className={cn(
        // SEM `relative` aqui de propósito: o contexto de posicionamento dos
        // ícones Sol/Lua vem do <span> logo abaixo, não do <button>. Um
        // `relative` no próprio botão colidia com `absolute` passado via
        // `className` pelas telas que posicionam o botão num canto (ex.:
        // LoginPage) — como `cn()` não faz merge de utilitários conflitantes,
        // as duas classes ficavam juntas e "relative" vencia a cascata do
        // Tailwind, prendendo o botão no fluxo normal do documento em vez de
        // no canto pedido.
        'flex size-11 sm:size-9 shrink-0 items-center justify-center rounded-full border transition-colors focus:outline-none focus:ring-2',
        onPrimary
          ? 'border-white/20 text-primary-foreground hover:bg-white/10 focus:ring-white/50'
          : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground focus:ring-primary/30',
        className,
      )}
    >
      <span className="relative block size-5 sm:size-4">
        <Sun
          className={cn(
            'absolute inset-0 size-5 sm:size-4 transition-[opacity,transform] duration-200 ease-out',
            escuro ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-45 scale-75',
          )}
        />
        <Moon
          className={cn(
            'absolute inset-0 size-5 sm:size-4 transition-[opacity,transform] duration-200 ease-out',
            escuro ? 'opacity-0 rotate-45 scale-75' : 'opacity-100 rotate-0 scale-100',
          )}
        />
      </span>
    </button>
  );
}
