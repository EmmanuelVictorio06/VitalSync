import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Bell,
  BellRing,
  ChartColumn,
  CheckCircle,
  CircleCheck,
  ClipboardList,
  Download,
  Eye,
  FileImage,
  Heart,
  Lock,
  Menu,
  MessageCircle,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  Thermometer,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

const navItems = [
  ['Início', '#inicio'],
  ['Como funciona', '#como-funciona'],
  ['Benefícios', '#beneficios'],
  ['Recursos', '#recursos'],
  ['Segurança', '#seguranca'],
  ['Contato', '#contato'],
] as const;

const flowSteps = [
  {
    icon: ClipboardList,
    title: 'Cadastro do paciente',
    text: 'A equipe médica cadastra o paciente, o procedimento cirúrgico, a data da alta e a equipe responsável.',
  },
  {
    icon: MessageCircle,
    title: 'Envio do link seguro',
    text: 'O paciente recebe um link individual pelo WhatsApp para registrar os sinais vitais durante o acompanhamento.',
  },
  {
    icon: Thermometer,
    title: 'Registro dos sinais vitais',
    text: 'Temperatura, saturação, pressão, frequência cardíaca, sintomas e foto da ferida ou dreno.',
  },
  {
    icon: ChartColumn,
    title: 'Monitoramento em tempo real',
    text: 'Médicos acompanham os dados em gráficos, cards e indicadores clínicos organizados por status.',
  },
  {
    icon: BellRing,
    title: 'Alertas automáticos',
    text: 'Quando houver alteração amarela ou vermelha, a equipe é notificada para verificar o paciente.',
  },
];

const benefits = [
  {
    title: 'Para pacientes',
    items: [
      'Registro simples pelo celular',
      'Acesso por link, sem login complicado',
      'Orientações claras a cada etapa',
      'Mais segurança e sensação de acompanhamento',
    ],
  },
  {
    title: 'Para médicos',
    items: [
      'Visualização rápida dos pacientes',
      'Alertas por status clínico',
      'Gráficos de evolução',
      'Histórico de medições',
      'Acompanhamento por equipe',
    ],
  },
  {
    title: 'Para administradores',
    items: [
      'Gestão de equipes',
      'Cadastro de hospitais e cirurgias',
      'Exportação de dados',
      'Controle de usuários e permissões',
      'Organização do pós-operatório',
    ],
  },
];

const features = [
  {
    icon: Activity,
    title: 'Dashboard de monitoramento',
    text: 'Visualize pacientes estáveis, em atenção, em alerta e registros recebidos no dia.',
  },
  {
    icon: Smartphone,
    title: 'Registro de sinais vitais',
    text: 'O paciente registra medições de manhã e à noite por uma tela mobile first.',
  },
  {
    icon: FileImage,
    title: 'Foto da ferida ou dreno',
    text: 'Permite anexar imagem para apoio visual da equipe médica.',
  },
  {
    icon: Bell,
    title: 'Alertas clínicos',
    text: 'Classificação por cores identifica rapidamente os casos que exigem atenção.',
  },
  {
    icon: Users,
    title: 'Equipes médicas',
    text: 'Cada médico acessa apenas os pacientes das equipes às quais está vinculado.',
  },
  {
    icon: Download,
    title: 'Exportação de dados',
    text: 'Administradores podem exportar informações para análise e acompanhamento.',
  },
];

const usability = [
  ['Visibilidade do estado do sistema', 'Status verde, amarelo e vermelho indicam rapidamente a situação clínica do paciente.'],
  ['Prevenção de erros', 'Campos com validação, máscaras e confirmações ajudam a evitar registros incorretos.'],
  ['Reconhecimento em vez de memorização', 'Menus, cards e botões claros reduzem a necessidade de lembrar caminhos.'],
  ['Design estético e minimalista', 'As telas priorizam informações importantes, evitando excesso visual.'],
  ['Ajuda e recuperação de erros', 'Mensagens simples orientam o usuário quando algo precisa ser corrigido.'],
] as const;

const securityItems = [
  ['Controle de acesso por perfil', 'Cada perfil enxerga apenas o que é necessário para o seu papel.'],
  ['Visão por equipe', 'Médicos associados visualizam apenas pacientes das suas equipes.'],
  ['Link seguro para o paciente', 'Acesso individual sem necessidade de criar conta.'],
  ['Fotos com proteção', 'Imagens armazenadas com regras de acesso restritas à equipe.'],
  ['Boas práticas de privacidade', 'Preparado para regras de privacidade e auditoria do setor de saúde.'],
  ['Tokens em ambiente seguro', 'Integrações e segredos protegidos fora do código cliente.'],
] as const;

const panelChecks = [
  'Cards de status com contagem em tempo real',
  'Gráficos de evolução por paciente',
  'Lista crítica com atalhos rápidos',
  'Filtros por equipe, hospital e período',
];

const mobileChecks = [
  'Formulário em etapas',
  'Botões grandes',
  'Exemplos nos campos',
  'Envio opcional de foto',
  'Tela de sucesso após envio',
  'Experiência leve para quem está em recuperação',
];

function LoginLink({ children, className }: { children: React.ReactNode; className: string }) {
  return (
    <Link to="/login" className={className}>
      {children}
    </Link>
  );
}

function BrandMark() {
  return (
    <a href="#inicio" className="flex items-center gap-2 min-w-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Heart className="h-5 w-5" fill="currentColor" />
      </span>
      <span className="flex flex-col leading-tight min-w-0">
        <span className="truncate text-base font-extrabold tracking-tight">VitalSync</span>
        <span className="truncate text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Post-Op Care</span>
      </span>
    </a>
  );
}

function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <BrandMark />

        <nav className="hidden items-center gap-7 lg:flex">
          {navItems.map(([label, href]) => (
            <a key={href} href={href} className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              {label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <a href="#contato" className="rounded-lg px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary">
            Solicitar demonstração
          </a>
          <LoginLink className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90">
            Acessar sistema
            <ArrowRight className="h-4 w-4" />
          </LoginLink>
        </div>

        <button
          type="button"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setOpen((v) => !v)}
          className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-surface lg:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-background px-4 py-4 shadow-sm lg:hidden">
          <nav className="mx-auto grid max-w-7xl gap-1">
            {navItems.map(([label, href]) => (
              <a
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                {label}
              </a>
            ))}
            <LoginLink className="mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
              Acessar sistema
              <ArrowRight className="h-4 w-4" />
            </LoginLink>
          </nav>
        </div>
      )}
    </header>
  );
}

function StatusSummaryCard({
  tone,
  icon: Icon,
  value,
  label,
}: {
  tone: 'success' | 'warning' | 'destructive';
  icon: typeof CircleCheck;
  value: string;
  label: string;
}) {
  const toneClass = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/15 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
  }[tone];

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className={`grid h-8 w-8 place-items-center rounded-lg ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-2xl font-extrabold leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function PatientRow({ name, meta, label, tone }: { name: string; meta: string; label: string; tone: 'alert' | 'warning' | 'success' }) {
  const toneClass = {
    alert: 'bg-destructive/10 text-destructive',
    warning: 'bg-warning/15 text-warning',
    success: 'bg-success/10 text-success',
  }[tone];

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{meta}</p>
      </div>
      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${toneClass}`}>{label}</span>
    </div>
  );
}

function MedicalPanel() {
  return (
    <div className="relative">
      <div className="rounded-2xl border border-border bg-surface p-5 shadow-xl shadow-primary/5 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-warning/80" />
            <span className="h-2.5 w-2.5 rounded-full bg-success/80" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">Painel médico</span>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <StatusSummaryCard tone="success" icon={CircleCheck} value="24" label="Estável" />
          <StatusSummaryCard tone="warning" icon={Eye} value="6" label="Atenção" />
          <StatusSummaryCard tone="destructive" icon={TriangleAlert} value="2" label="Alerta" />
        </div>

        <div className="mt-5 rounded-xl border border-border bg-background p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Evolução · últimos 7 dias</span>
            <ChartColumn className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-4 flex h-24 items-end gap-2">
            {[38, 55, 42, 70, 60, 82, 75].map((height) => (
              <div key={height} className="flex-1 rounded-t-md bg-primary/80" style={{ height: `${height}%` }} />
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <PatientRow name="Maria S." meta="Colecistectomia · D+3" label="Alerta" tone="alert" />
          <PatientRow name="João P." meta="Hérnia inguinal · D+5" label="Atenção" tone="warning" />
          <PatientRow name="Ana L." meta="Apendicectomia · D+2" label="Estável" tone="success" />
        </div>
      </div>

      <div className="absolute -bottom-6 -left-6 hidden rounded-2xl border border-border bg-surface p-4 shadow-lg sm:block">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-destructive/10 text-destructive">
            <Heart className="h-5 w-5" fill="currentColor" />
          </span>
          <div>
            <p className="text-xs font-semibold text-muted-foreground">FC atual</p>
            <p className="text-lg font-extrabold">98 bpm</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroSection() {
  return (
    <section id="inicio" className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-success/10 blur-3xl" />
      </div>
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-24">
        <div className="flex flex-col justify-center">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Monitoramento pós-operatório <span className="text-primary">inteligente, simples e seguro.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
            Acompanhe pacientes em recuperação domiciliar, registre sinais vitais pelo celular e receba alertas clínicos para agir no momento certo.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <LoginLink className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90">
              Acessar sistema
              <ArrowRight className="h-4 w-4" />
            </LoginLink>
            <a href="#recursos" className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary">
              Conhecer recursos
            </a>
          </div>
          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-success" />
              Acesso por perfil
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Bell className="h-4 w-4 text-warning" />
              Alertas clínicos
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Smartphone className="h-4 w-4 text-primary" />
              Mobile first
            </span>
          </div>
        </div>

        <MedicalPanel />
      </div>
    </section>
  );
}

function FlowSection() {
  return (
    <section id="como-funciona" className="py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Fluxo</span>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Como o VitalSync funciona</h2>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            Cinco passos simples conectam o paciente em casa à equipe médica responsável.
          </p>
        </div>

        <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {flowSteps.map(({ icon: Icon, title, text }, index) => (
            <li key={title}>
              <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm transition-shadow hover:shadow-md h-full">
                <div className="flex items-start gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-primary">PASSO {index + 1}</span>
                    <h3 className="mt-1 text-lg font-bold">{title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{text}</p>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function BenefitsSection() {
  return (
    <section id="beneficios" className="bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Benefícios</span>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Para toda a jornada de cuidado</h2>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            Valor específico para cada perfil que usa a plataforma.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {benefits.map((benefit) => (
            <article key={benefit.title} className="rounded-2xl border border-border bg-background p-6 shadow-sm">
              <h3 className="text-lg font-bold">{benefit.title}</h3>
              <ul className="mt-5 space-y-3">
                {benefit.items.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section id="recursos" className="py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Recursos</span>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Recursos principais</h2>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            Ferramentas pensadas para o dia a dia clínico e a recuperação domiciliar.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <article key={title} className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-lg font-bold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function UsabilitySection() {
  return (
    <section className="bg-surface py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Usabilidade</span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Uma experiência simples, clara e eficiente</h2>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              O VitalSync foi projetado com foco em usabilidade, reduzindo esforço, prevenindo erros e tornando informações clínicas fáceis de interpretar.
            </p>
          </div>

          <div className="grid gap-4">
            {usability.map(([title, text]) => (
              <article key={title} className="rounded-2xl border border-border bg-background p-5">
                <span className="text-xs font-bold uppercase tracking-wider text-primary">Heurística</span>
                <h3 className="mt-1 text-base font-bold">{title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{text}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SecuritySection() {
  return (
    <section id="seguranca" className="py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-bold uppercase tracking-wider text-primary">Segurança</span>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Segurança para dados sensíveis de saúde</h2>
          <p className="mt-3 text-base text-muted-foreground sm:text-lg">
            Proteção das informações dos pacientes, controle de acessos por perfil e restrição por equipe médica responsável.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {securityItems.map(([title, text]) => (
            <article key={title} className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Lock className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-bold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{text}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function PanelSection() {
  return (
    <section className="bg-surface py-20 sm:py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
        <div>
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Painel</span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Tudo que a equipe precisa em um só lugar</h2>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              Acompanhe pacientes críticos, registros recebidos, alertas recentes e indicadores de evolução clínica.
            </p>
          </div>
          <ul className="mt-8 space-y-3 text-sm">
            {panelChecks.map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3">
            <LoginLink className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Acompanhar pacientes
            </LoginLink>
            <a href="#contato" className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold hover:bg-secondary">
              Ver alertas
            </a>
          </div>
        </div>

        <MedicalPanel />
      </div>
    </section>
  );
}

function MobileSection() {
  return (
    <section className="py-20 sm:py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
        <div className="order-2 lg:order-1 flex justify-center">
          <div className="relative w-[280px] rounded-[2.5rem] border border-border bg-surface p-3 shadow-2xl shadow-primary/10">
            <div className="rounded-[2rem] bg-background p-4">
              <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground">
                <span>09:24</span>
                <span>● ● ●</span>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                  <Heart className="h-4 w-4" fill="currentColor" />
                </span>
                <div>
                  <p className="text-[11px] font-bold">VitalSync</p>
                  <p className="text-[10px] text-muted-foreground">Registro do dia</p>
                </div>
              </div>
              <p className="mt-5 text-sm font-bold">Como você está hoje?</p>
              <p className="text-[11px] text-muted-foreground">Etapa 2 de 4</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-1/2 rounded-full bg-primary" />
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-border bg-surface p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Temperatura</p>
                  <p className="mt-1 text-lg font-extrabold">36,8 °C</p>
                </div>
                <div className="rounded-xl border border-border bg-surface p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Saturação</p>
                  <p className="mt-1 text-lg font-extrabold text-success">97%</p>
                </div>
                <div className="rounded-xl border border-border bg-surface p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Frequência cardíaca</p>
                  <p className="mt-1 text-lg font-extrabold">78 bpm</p>
                </div>
              </div>
              <button className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground">Continuar</button>
            </div>
          </div>
        </div>

        <div className="order-1 lg:order-2">
          <div className="max-w-2xl">
            <span className="text-xs font-bold uppercase tracking-wider text-primary">Mobile first</span>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">Registro simples pelo celular</h2>
            <p className="mt-3 text-base text-muted-foreground sm:text-lg">
              O paciente acessa um link enviado pelo WhatsApp e registra as informações de forma rápida, com campos grandes, instruções claras e tela adaptada para dispositivos móveis.
            </p>
          </div>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {mobileChecks.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ContactSection() {
  return (
    <section id="contato" className="px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-primary p-8 text-primary-foreground shadow-xl sm:p-14">
        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Transforme o acompanhamento pós-operatório em uma experiência mais segura e organizada.
            </h2>
            <p className="mt-4 text-base opacity-90 sm:text-lg">
              Centralize equipes, pacientes, sinais vitais e alertas em uma plataforma moderna, responsiva e preparada para evoluir.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <LoginLink className="inline-flex items-center justify-center gap-2 rounded-lg bg-surface px-6 py-3 text-sm font-bold text-primary shadow-sm hover:opacity-95">
              Acessar sistema
              <ArrowRight className="h-4 w-4" />
            </LoginLink>
            <a
              href="mailto:contato@vitalsync.health"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary-foreground/30 px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary-foreground/10"
            >
              Solicitar demonstração
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr] lg:px-8">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Heart className="h-5 w-5" fill="currentColor" />
            </span>
            <div>
              <p className="text-base font-extrabold">VitalSync · CURAPATH</p>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Post-Op Care</p>
            </div>
          </div>
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">
            Plataforma de apoio ao monitoramento pós-operatório domiciliar.
          </p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-foreground">Navegação</p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li><a href="#inicio" className="hover:text-foreground">Início</a></li>
            <li><a href="#recursos" className="hover:text-foreground">Recursos</a></li>
            <li><a href="#seguranca" className="hover:text-foreground">Segurança</a></li>
            <li><a href="#contato" className="hover:text-foreground">Contato</a></li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-foreground">Acesso</p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li><Link to="/login" className="hover:text-foreground">Entrar no sistema</Link></li>
            <li><a href="mailto:contato@vitalsync.health" className="hover:text-foreground">Falar com a equipe</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <p>© 2026 VitalSync. Todos os direitos reservados.</p>
          <p>Feito com cuidado para equipes de saúde.</p>
        </div>
      </div>
    </footer>
  );
}

export function HomePage() {
  const { user } = useAuth();

  if (user) return <Navigate to="/monitoring" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <SiteHeader />
      <main>
        <HeroSection />
        <FlowSection />
        <BenefitsSection />
        <FeaturesSection />
        <UsabilitySection />
        <SecuritySection />
        <PanelSection />
        <MobileSection />
        <ContactSection />
      </main>
      <SiteFooter />
    </div>
  );
}
