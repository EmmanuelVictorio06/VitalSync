/**
 * PatientReviewModal — conferência somente-leitura antes de efetivar o cadastro
 * do paciente (ver pages/PatientRegisterPage.tsx).
 *
 * Mostra tudo que foi digitado com os MESMOS rótulos e a MESMA formatação do
 * "Prontuário do paciente" do Detalhes do Alerta — o de-para vem de
 * `lib/patientReview.ts`, que por sua vez delega a `lib/patientInfo.ts` e
 * `lib/studyVariables.ts`. Aqui só há renderização.
 *
 * Diferença proposital em relação ao `DGrid` do detalhe: lá "—" é só ausência
 * de dado; aqui ele é o ponto da tela. Campo vazio é destacado (âmbar quando
 * opcional, vermelho quando obrigatório) e o obrigatório bloqueia o envio,
 * com um atalho que devolve o foco ao campo no formulário.
 *
 * Mesmo padrão visual de ConfirmModal/PatientRecordSummaryModal (ui.tsx):
 * backdrop bg-foreground/50 + backdrop-blur-sm, z-50, painel bg-card.
 */
import { AlertTriangle, ClipboardList, FlaskConical, Pencil, UserPlus } from 'lucide-react';
import { richTextToPlainText, sanitizeRichText } from '../lib/richText';
import type { RegistrationField, RegistrationProblem, ReviewRow, ReviewSection } from '../lib/patientReview';
import { Button, ModalOverlay, cn } from './ui';

export interface PatientReviewModalProps {
  sections: ReviewSection[];
  problems: RegistrationProblem[];
  /** Comorbidades já normalizadas (texto puro), como serão gravadas. */
  comorbidities: string[];
  /** HTML do resumo de prontuário, exatamente como será persistido. */
  medicalRecordSummary: string;
  isTest: boolean;
  busy?: boolean;
  /** Fecha a conferência e devolve ao formulário com os dados preservados. */
  onEdit: () => void;
  /** Volta ao formulário e foca o campo indicado. */
  onFixField: (field: RegistrationField) => void;
  /** Dispara o mesmo submit de sempre. */
  onConfirm: () => void;
}

export function PatientReviewModal({
  sections,
  problems,
  comorbidities,
  medicalRecordSummary,
  isTest,
  busy,
  onEdit,
  onFixField,
  onConfirm,
}: PatientReviewModalProps) {
  const bloqueado = problems.length > 0;
  const vazios = sections.flatMap((s) => s.rows).filter((r) => r.missing && !r.blocking).length;
  const summaryHtml = richTextToPlainText(medicalRecordSummary).trim()
    ? sanitizeRichText(medicalRecordSummary)
    : null;

  return (
    <ModalOverlay
      onClose={onEdit}
      // Sem fechar no clique do fundo: o usuário está a um clique de cadastrar,
      // um toque fora não pode parecer "cancelado" nem "enviado".
      closeOnBackdrop={false}
      className="z-50 bg-foreground/50 backdrop-blur-sm items-center justify-center p-4 overflow-y-auto"
      ariaLabelledBy="conferencia-cadastro-titulo"
    >
      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-3xl my-auto max-h-[90vh] flex flex-col animate-entry">
        <header className="px-5 py-4 border-b border-border">
          <h2 id="conferencia-cadastro-titulo" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <ClipboardList className="size-5 text-primary" /> Confira antes de cadastrar
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Estes são os dados como aparecerão no prontuário do paciente. Revise e confirme.
          </p>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {bloqueado && (
            <div className="rounded-lg border border-alert/30 bg-alert/10 p-3">
              <p className="flex items-center gap-2 text-sm font-bold text-alert">
                <AlertTriangle className="size-4" />
                {problems.length === 1
                  ? '1 campo obrigatório impede o cadastro'
                  : `${problems.length} campos obrigatórios impedem o cadastro`}
              </p>
              <ul className="mt-2 space-y-1">
                {problems.map((p) => (
                  <li key={`${p.field}-${p.message}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="font-semibold">{p.label}:</span>
                    <span className="text-muted-foreground">{p.message}</span>
                    <button
                      type="button"
                      onClick={() => onFixField(p.field)}
                      className="inline-flex items-center gap-1 font-semibold text-alert underline underline-offset-2"
                    >
                      <Pencil className="size-3" /> Corrigir
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!bloqueado && vazios > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
              <p className="flex items-center gap-2 text-sm font-bold text-warning">
                <AlertTriangle className="size-4" />
                {vazios === 1 ? '1 campo opcional em branco' : `${vazios} campos opcionais em branco`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Dá para cadastrar assim, mas as variáveis do estudo em branco ficam sem registro no prontuário.
              </p>
            </div>
          )}

          {isTest && (
            <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs font-semibold text-warning">
              <FlaskConical className="size-4" /> Paciente de teste (homologação) — marcado como fictício.
            </div>
          )}

          {sections.map((section) => (
            <section key={section.key} className="rounded-xl border border-border p-4">
              <h3 className="text-sm font-bold mb-3">{section.title}</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {section.rows.map((row) => (
                  <ReviewField key={row.key} row={row} onFix={onFixField} />
                ))}
              </dl>
            </section>
          ))}

          <section className="rounded-xl border border-border p-4">
            <h3 className="text-sm font-bold mb-3">Comorbidades e resumo</h3>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Comorbidades</p>
            <p className={cn('text-sm mt-0.5', !comorbidities.length && 'text-muted-foreground')}>
              {comorbidities.length ? comorbidities.join(', ') : 'Nenhuma comorbidade registrada.'}
            </p>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-3">
              Resumo do prontuário
            </p>
            {summaryHtml ? (
              <div
                className="text-sm mt-0.5 whitespace-pre-line break-words [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5"
                dangerouslySetInnerHTML={{ __html: summaryHtml }}
              />
            ) : (
              <p className="text-sm mt-0.5 text-muted-foreground">Nenhum resumo de prontuário registrado.</p>
            )}
          </section>
        </div>

        <footer className="px-5 py-3 border-t border-border flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={onEdit} disabled={busy}>
            <Pencil className="size-4" /> Voltar e editar
          </Button>
          <Button onClick={onConfirm} disabled={bloqueado} loading={busy} data-autofocus>
            <UserPlus className="size-4" /> Confirmar cadastro
          </Button>
        </footer>
      </div>
    </ModalOverlay>
  );
}

/** Uma linha do grid: valor, ou o destaque de "faltando". */
function ReviewField({ row, onFix }: { row: ReviewRow; onFix: (field: RegistrationField) => void }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{row.label}</dt>
      <dd className="mt-0.5 break-words">
        {row.missing ? (
          <button
            type="button"
            onClick={() => onFix(row.field)}
            className={cn(
              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-bold border',
              row.blocking
                ? 'bg-alert/10 text-alert border-alert/30'
                : 'bg-warning/10 text-warning border-warning/30',
            )}
          >
            <AlertTriangle className="size-3" />
            {row.blocking ? 'Obrigatório — preencher' : 'Em branco'}
          </button>
        ) : (
          <span className="font-semibold">{row.value}</span>
        )}
      </dd>
    </div>
  );
}
