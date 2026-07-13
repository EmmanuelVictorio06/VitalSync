/**
 * "Convidar Profissional" — ADMIN e SUPORTE geram um link de auto-cadastro
 * para médico/cirurgião e enviam por WhatsApp. A criação da conta acontece
 * quando o profissional abre o link e define a própria senha (Edge Function).
 *
 * O convite só define o PAPEL do profissional (e contatos opcionais). A
 * associação com equipe fica para a gestão de equipes, onde o cirurgião
 * principal é definido na criação da equipe e os médicos associados são
 * vinculados depois.
 */
import { useMemo, useState } from 'react';
import { Copy, MessageCircle, Send, UserPlus } from 'lucide-react';
import { whatsappLink } from '@vitalsync/shared';
import { useToast } from '../components/Toast';
import { Button, CustomSelect, PageContainer, PageHeader, PhoneInput, TextInput } from '../components/ui';
import { professionalInviteService, type InviteRole } from '../services/professionalInviteService';

type RoleState = InviteRole | '';

export function InvitesPage() {
  const toast = useToast();
  const [role, setRole] = useState<RoleState>('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [roleError, setRoleError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ link: string } | null>(null);

  const message = useMemo(
    () =>
      result
        ? `Olá! Você foi convidado(a) para integrar a equipe no VitalSync. Conclua seu cadastro neste link seguro: ${result.link}`
        : '',
    [result],
  );

  async function generate() {
    if (!role) {
      setRoleError('Selecione o papel do profissional.');
      return;
    }
    setRoleError(undefined);
    setBusy(true);
    try {
      const { link } = await professionalInviteService.generate({
        role,
        phone: phone || undefined,
        email: email || undefined,
      });
      setResult({ link });
      toast.success('Convite gerado! Envie o link ao profissional.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao gerar o convite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title="Convidar Profissional"
        subtitle="Gere um link de cadastro para um médico ou cirurgião. A associação com equipe pode ser feita depois na gestão de equipes."
      />

      <form
        className="space-y-6 animate-entry [animation-delay:100ms]"
        onSubmit={(e) => {
          e.preventDefault();
          void generate();
        }}
      >
        <section className="bg-card rounded-xl border border-border shadow-sm p-6 space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <CustomSelect
              label="Papel"
              value={role}
              onChange={(e) => {
                setRole(e.target.value as RoleState);
                setRoleError(undefined);
              }}
              options={[
                { value: 'ASSOCIATED_DOCTOR', label: 'Médico Associado' },
                { value: 'MAIN_SURGEON', label: 'Médico Cirurgião' },
              ]}
              error={roleError}
              required
            />
            <PhoneInput label="Telefone (WhatsApp) — opcional" value={phone} onChange={setPhone} />
          </div>

          <TextInput
            label="E-mail (opcional)"
            type="email"
            placeholder="profissional@exemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              <UserPlus className="size-4" /> Gerar convite
            </Button>
          </div>
        </section>
      </form>

      {result && (
        <section className="bg-card border border-stable/30 rounded-xl p-6 animate-entry mt-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="size-8 rounded-full bg-stable/10 text-stable flex items-center justify-center">
              <Send className="size-4" />
            </span>
            <h3 className="font-bold">Link de convite gerado</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Envie este link ao profissional. Ele expira em 7 dias e só pode ser usado uma vez.
          </p>
          <div className="bg-muted rounded-lg px-4 py-3 text-xs font-mono break-all border border-border">
            {result.link}
          </div>
          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <Button
              variant="ghost"
              onClick={async () => {
                await navigator.clipboard.writeText(result.link);
                toast.info('Link copiado.');
              }}
            >
              <Copy className="size-4" /> Copiar link
            </Button>
            {phone && (
              <Button variant="whatsapp" onClick={() => window.open(whatsappLink(phone, message), '_blank')}>
                <MessageCircle className="size-4" /> Enviar pelo WhatsApp
              </Button>
            )}
            <span className="flex-1" />
            <Button variant="ghost" onClick={() => setResult(null)}>
              Gerar outro
            </Button>
          </div>
        </section>
      )}
    </PageContainer>
  );
}
