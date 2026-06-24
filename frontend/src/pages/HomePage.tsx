import { useCallback, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Bell,
  ChartColumn,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  Heart,
  ImageIcon,
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
  type LucideIcon,
} from 'lucide-react';
import { ScrollReveal } from '../components/ScrollReveal';
import { cn } from '../components/ui';

const navItems = [
  { href: '#inicio', label: 'Início' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#beneficios', label: 'Benefícios' },
  { href: '#recursos', label: 'Recursos' },
  { href: '#seguranca', label: 'Segurança' },
  { href: '#contato', label: 'Contato' },
];

const PAGE_TRANSITION_MS = 180;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isPlainLeftClick(event: MouseEvent) {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey
  );
}

type StatusTone = 'success' | 'warning' | 'danger';
type CardTone = 'primary' | 'success' | 'warning' | 'danger';

const toneClasses: Record<CardTone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/10 text-destructive',
};

export function HomePage() {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);

  const scrollToSection = useCallback((sectionId: string) => {
    const section = document.getElementById(sectionId);
    if (!section) return;

    const headerHeight = document.querySelector('header')?.getBoundingClientRect().height ?? 72;
    const top =
      sectionId === 'inicio'
        ? 0
        : Math.max(section.getBoundingClientRect().top + window.scrollY - headerHeight - 16, 0);

    window.scrollTo({
      top,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    window.history.replaceState(null, '', `#${sectionId}`);
  }, []);

  const navigateToLogin = useCallback(() => {
    if (leaving) return;

    if (prefersReducedMotion()) {
      navigate('/login');
      return;
    }

    setLeaving(true);
    window.setTimeout(() => navigate('/login'), PAGE_TRANSITION_MS);
  }, [leaving, navigate]);

  const handleHomeClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!isPlainLeftClick(event)) return;

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || !event.currentTarget.contains(anchor)) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      if (href.startsWith('#')) {
        event.preventDefault();
        scrollToSection(href.slice(1));
        return;
      }

      const url = new URL(anchor.href);
      if (url.origin === window.location.origin && (url.pathname === '/auth' || url.pathname === '/login')) {
        event.preventDefault();
        navigateToLogin();
      }
    },
    [navigateToLogin, scrollToSection],
  );

  return (
    <div
      onClick={handleHomeClick}
      className={cn(
        'vitalsync-home min-h-screen text-foreground font-sans antialiased transition-all duration-200 ease-out',
        leaving ? 'opacity-0 -translate-y-1' : 'opacity-100 translate-y-0',
      )}
    >
      <Header />
      <main>
        <HeroSection />
        <HowItWorksSection />
        <BenefitsSection />
        <FeaturesSection />
        <SecuritySection />
        <PanelSection />
        <MobileSection />
        <ContactSection />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <BrandMark href="#inicio" />

        <nav className="hidden items-center gap-7 lg:flex">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <a href="#contato" className="rounded-lg px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary">
            Solicitar demonstração
          </a>
          <a
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90"
          >
            Acessar sistema
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <button
          type="button"
          aria-label="Abrir menu"
          onClick={() => setOpen((value) => !value)}
          className="grid h-10 w-10 place-items-center rounded-lg border border-border bg-surface lg:hidden"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-border bg-surface lg:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 sm:px-6">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-secondary"
              >
                {item.label}
              </a>
            ))}
            <div className="mt-2 grid gap-2">
              <a
                href="#contato"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border px-3 py-2.5 text-center text-sm font-semibold"
              >
                Solicitar demonstração
              </a>
              <a href="/login" className="rounded-lg bg-primary px-3 py-2.5 text-center text-sm font-semibold text-primary-foreground">
                Acessar sistema
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function BrandMark({ href }: { href: string }) {
  return (
    <a href={href} className="flex items-center gap-2 min-w-0">
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

function HeroSection() {
  return (
    <section id="inicio" className="home-section home-section-hero relative overflow-hidden">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-24">
        <div className="flex flex-col justify-center">
          <ScrollReveal delay={60}>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
              Monitoramento pós-operatório <span className="text-primary">inteligente, simples e seguro.</span>
            </h1>
          </ScrollReveal>
          <ScrollReveal delay={150}>
            <p className="mt-5 max-w-xl text-base text-muted-foreground sm:text-lg">
              Acompanhe pacientes em recuperação domiciliar, registre sinais vitais pelo celular e receba alertas clínicos para agir no
              momento certo.
            </p>
          </ScrollReveal>

          <ScrollReveal delay={240}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="/login"
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90"
              >
                Acessar sistema <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="#recursos"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-6 py-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary"
              >
                Conhecer recursos
              </a>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={330}>
            <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-success" /> Acesso por perfil
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Bell className="h-4 w-4 text-warning" /> Alertas clínicos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Smartphone className="h-4 w-4 text-primary" /> Mobile first
              </span>
            </div>
          </ScrollReveal>
        </div>

        <ScrollReveal direction="right" delay={180}>
          <DashboardPreview />
        </ScrollReveal>
      </div>
    </section>
  );
}

function DashboardPreview() {
  const patients: Array<{ name: string; info: string; tone: StatusTone }> = [
    { name: 'Maria S.', info: 'Colecistectomia · D+3', tone: 'danger' },
    { name: 'João P.', info: 'Hérnia inguinal · D+5', tone: 'warning' },
    { name: 'Ana L.', info: 'Apendicectomia · D+2', tone: 'success' },
  ];

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
          <StatusMetric tone="success" label="Estável" value="24" Icon={CheckCircle2} />
          <StatusMetric tone="warning" label="Atenção" value="6" Icon={Eye} />
          <StatusMetric tone="danger" label="Alerta" value="2" Icon={TriangleAlert} />
        </div>

        <div className="mt-5 rounded-xl border border-border bg-background p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Evolução · últimos 7 dias</span>
            <ChartColumn className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-4 flex h-24 items-end gap-2">
            {[38, 55, 42, 70, 60, 82, 75].map((height, index) => (
              <div key={index} className="flex-1 rounded-t-md bg-primary/80" style={{ height: `${height}%` }} />
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {patients.map((patient) => (
            <div key={patient.name} className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{patient.name}</p>
                <p className="truncate text-xs text-muted-foreground">{patient.info}</p>
              </div>
              <StatusPill tone={patient.tone} />
            </div>
          ))}
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

function StatusMetric({ tone, label, value, Icon }: { tone: CardTone; label: string; value: string; Icon: LucideIcon }) {
  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className={`grid h-8 w-8 place-items-center rounded-lg ${toneClasses[tone]}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-2 text-2xl font-extrabold leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}

function StatusPill({ tone }: { tone: StatusTone }) {
  const meta: Record<StatusTone, { className: string; label: string }> = {
    success: { className: 'bg-success/10 text-success', label: 'Estável' },
    warning: { className: 'bg-warning/15 text-warning', label: 'Atenção' },
    danger: { className: 'bg-destructive/10 text-destructive', label: 'Alerta' },
  };

  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta[tone].className}`}>{meta[tone].label}</span>;
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
}) {
  return (
    <ScrollReveal>
      <div className={align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
        {eyebrow && <span className="text-xs font-bold uppercase tracking-wider text-primary">{eyebrow}</span>}
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h2>
        {description && <p className="mt-3 text-base text-muted-foreground sm:text-lg">{description}</p>}
      </div>
    </ScrollReveal>
  );
}

function HomeCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col rounded-2xl border border-border bg-surface p-6 shadow-sm transition-shadow hover:shadow-md h-full ${className}`}>{children}</div>;
}

function IconBadge({ children, tone = 'primary' }: { children: ReactNode; tone?: CardTone }) {
  return <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${toneClasses[tone]}`}>{children}</span>;
}

function HowItWorksSection() {
  const steps = [
    {
      icon: <ClipboardList className="h-5 w-5" />,
      title: 'Cadastro do paciente',
      text: 'A equipe médica cadastra o paciente, o procedimento cirúrgico, a data da alta e a equipe responsável.',
    },
    {
      icon: <MessageCircle className="h-5 w-5" />,
      title: 'Envio do link seguro',
      text: 'O paciente recebe um link individual pelo WhatsApp para registrar os sinais vitais durante o acompanhamento.',
    },
    {
      icon: <Thermometer className="h-5 w-5" />,
      title: 'Registro dos sinais vitais',
      text: 'Temperatura, saturação, pressão, frequência cardíaca, sintomas e foto da ferida ou dreno.',
    },
    {
      icon: <Activity className="h-5 w-5" />,
      title: 'Monitoramento em tempo real',
      text: 'Médicos acompanham os dados em gráficos, cards e indicadores clínicos organizados por status.',
    },
    {
      icon: <Bell className="h-5 w-5" />,
      title: 'Alertas automáticos',
      text: 'Quando houver alteração amarela ou vermelha, a equipe é notificada para verificar o paciente.',
    },
  ];

  return (
    <section id="como-funciona" className="home-section home-section-soft py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Fluxo"
          title="Como o VitalSync funciona"
          description="Cinco passos simples conectam o paciente em casa à equipe médica responsável."
        />
        <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title}>
              <ScrollReveal delay={index * 90}>
                <HomeCard className="h-full">
                  <div className="flex items-start gap-4">
                    <IconBadge>{step.icon}</IconBadge>
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-primary">PASSO {index + 1}</span>
                      <h3 className="mt-1 text-lg font-bold">{step.title}</h3>
                      <p className="mt-2 text-sm text-muted-foreground">{step.text}</p>
                    </div>
                  </div>
                </HomeCard>
              </ScrollReveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function BenefitsSection() {
  const groups: Array<{ icon: ReactNode; tone: CardTone; title: string; items: string[] }> = [
    {
      icon: <Heart className="h-5 w-5" />,
      tone: 'danger',
      title: 'Para pacientes',
      items: ['Registro simples pelo celular', 'Acesso por link, sem login complicado', 'Orientações claras a cada etapa', 'Mais segurança e sensação de acompanhamento'],
    },
    {
      icon: <Stethoscope className="h-5 w-5" />,
      tone: 'primary',
      title: 'Para médicos',
      items: ['Visualização rápida dos pacientes', 'Alertas por status clínico', 'Gráficos de evolução', 'Histórico de medições', 'Acompanhamento por equipe'],
    },
    {
      icon: <Users className="h-5 w-5" />,
      tone: 'success',
      title: 'Para administradores',
      items: ['Gestão de equipes', 'Cadastro de hospitais e cirurgias', 'Exportação de dados', 'Controle de usuários e permissões', 'Organização do pós-operatório'],
    },
  ];

  return (
    <section id="beneficios" className="home-section home-section-clear py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Benefícios"
          title="Para toda a jornada de cuidado"
          description="Valor específico para cada perfil que usa a plataforma."
        />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {groups.map((group, index) => (
            <ScrollReveal key={group.title} delay={index * 110}>
              <HomeCard>
                <div className="flex items-center gap-3">
                  <IconBadge tone={group.tone}>{group.icon}</IconBadge>
                  <h3 className="text-lg font-bold">{group.title}</h3>
                </div>
                <ul className="mt-5 space-y-3">
                  {group.items.map((item) => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-foreground/80">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </HomeCard>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const features = [
    {
      icon: <ChartColumn className="h-5 w-5" />,
      title: 'Dashboard de monitoramento',
      text: 'Visualize pacientes estáveis, em atenção, em alerta e registros recebidos no dia.',
    },
    {
      icon: <Activity className="h-5 w-5" />,
      title: 'Registro de sinais vitais',
      text: 'O paciente registra medições de manhã e à noite por uma tela mobile first.',
    },
    {
      icon: <ImageIcon className="h-5 w-5" />,
      title: 'Foto da ferida ou dreno',
      text: 'Permite anexar imagem para apoio visual da equipe médica.',
    },
    {
      icon: <Bell className="h-5 w-5" />,
      title: 'Alertas clínicos',
      text: 'Classificação por cores identifica rapidamente os casos que exigem atenção.',
    },
    {
      icon: <Users className="h-5 w-5" />,
      title: 'Equipes médicas',
      text: 'Cada médico acessa apenas os pacientes das equipes às quais está vinculado.',
    },
    {
      icon: <Download className="h-5 w-5" />,
      title: 'Exportação de dados',
      text: 'Administradores podem exportar informações para análise e acompanhamento.',
    },
  ];

  return (
    <section id="recursos" className="home-section home-section-soft py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Recursos"
          title="Recursos principais"
          description="Ferramentas pensadas para o dia a dia clínico e a recuperação domiciliar."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, index) => (
            <ScrollReveal key={feature.title} delay={(index % 3) * 90}>
              <HomeCard>
                <IconBadge>{feature.icon}</IconBadge>
                <h3 className="mt-4 text-lg font-bold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{feature.text}</p>
              </HomeCard>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function SecuritySection() {
  const items = [
    {
      icon: <Lock className="h-5 w-5" />,
      title: 'Controle de acesso por perfil',
      text: 'Cada perfil enxerga apenas o que é necessário para o seu papel.',
    },
    {
      icon: <Users className="h-5 w-5" />,
      title: 'Visão por equipe',
      text: 'Médicos associados visualizam apenas pacientes das suas equipes.',
    },
    {
      icon: <MessageCircle className="h-5 w-5" />,
      title: 'Link seguro para o paciente',
      text: 'Acesso individual sem necessidade de criar conta.',
    },
    {
      icon: <ImageIcon className="h-5 w-5" />,
      title: 'Fotos com proteção',
      text: 'Imagens armazenadas com regras de acesso restritas à equipe.',
    },
    {
      icon: <ShieldCheck className="h-5 w-5" />,
      title: 'Boas práticas de privacidade',
      text: 'Preparado para regras de privacidade e auditoria do setor de saúde.',
    },
    {
      icon: <Lock className="h-5 w-5" />,
      title: 'Tokens em ambiente seguro',
      text: 'Integrações e segredos protegidos fora do código cliente.',
    },
  ];

  return (
    <section id="seguranca" className="home-section home-section-clear py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          eyebrow="Segurança"
          title="Segurança para dados sensíveis de saúde"
          description="Proteção das informações dos pacientes, controle de acessos por perfil e restrição por equipe médica responsável."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => (
            <ScrollReveal key={item.title} delay={(index % 3) * 90}>
              <HomeCard>
                <IconBadge tone="primary">{item.icon}</IconBadge>
                <h3 className="mt-4 text-lg font-bold">{item.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{item.text}</p>
              </HomeCard>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function PanelSection() {
  return (
    <section className="home-section home-section-soft py-20 sm:py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
        <div>
          <SectionHeading
            align="left"
            eyebrow="Painel"
            title="Tudo que a equipe precisa em um só lugar"
            description="Acompanhe pacientes críticos, registros recebidos, alertas recentes e indicadores de evolução clínica."
          />
          <ScrollReveal delay={120}>
            <ul className="mt-8 space-y-3 text-sm">
            {['Cards de status com contagem em tempo real', 'Gráficos de evolução por paciente', 'Lista crítica com atalhos rápidos', 'Filtros por equipe, hospital e período'].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>{item}</span>
              </li>
            ))}
            </ul>
          </ScrollReveal>
          <ScrollReveal delay={210}>
            <div className="mt-8 flex flex-wrap gap-3">
            <a href="/login" className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">
              Acompanhar pacientes
            </a>
            <a href="#contato" className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-5 py-2.5 text-sm font-semibold hover:bg-secondary">
              Ver alertas
            </a>
            </div>
          </ScrollReveal>
        </div>

        <ScrollReveal direction="left" delay={120}>
          <DashboardPreview />
        </ScrollReveal>
      </div>
    </section>
  );
}

function MobileSection() {
  return (
    <section className="home-section home-section-clear py-20 sm:py-24">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8">
        <ScrollReveal direction="right" delay={120} className="order-2 lg:order-1 flex justify-center">
          <PhonePreview />
        </ScrollReveal>

        <div className="order-1 lg:order-2">
          <SectionHeading
            align="left"
            eyebrow="Mobile first"
            title="Registro simples pelo celular"
            description="O paciente acessa um link enviado pelo WhatsApp e registra as informações de forma rápida, com campos grandes, instruções claras e tela adaptada para dispositivos móveis."
          />
          <ScrollReveal delay={140}>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {['Formulário em etapas', 'Botões grandes', 'Exemplos nos campos', 'Envio opcional de foto', 'Tela de sucesso após envio', 'Experiência leve para quem está em recuperação'].map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>{item}</span>
              </li>
            ))}
            </ul>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}

function PhonePreview() {
  return (
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
          <PhoneValue label="Temperatura" value="36,8 °C" />
          <PhoneValue label="Saturação" value="97%" success />
          <PhoneValue label="Frequência cardíaca" value="78 bpm" />
        </div>

        <button type="button" className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground">
          Continuar
        </button>
      </div>
    </div>
  );
}

function PhoneValue({ label, value, success }: { label: string; value: string; success?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-extrabold ${success ? 'text-success' : ''}`}>{value}</p>
    </div>
  );
}

function ContactSection() {
  return (
    <section id="contato" className="home-section home-section-final px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
      <ScrollReveal>
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
            <a
              href="/login"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-surface px-6 py-3 text-sm font-bold text-primary shadow-sm hover:opacity-95"
            >
              Acessar sistema <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="mailto:contato@vitalsync.health"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary-foreground/30 px-6 py-3 text-sm font-bold text-primary-foreground hover:bg-primary-foreground/10"
            >
              Solicitar demonstração
            </a>
          </div>
        </div>
        </div>
      </ScrollReveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="home-footer border-t border-border">
      <ScrollReveal direction="none">
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
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">Plataforma de apoio ao monitoramento pós-operatório domiciliar.</p>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-foreground">Navegação</p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>
              <a href="#inicio" className="hover:text-foreground">
                Início
              </a>
            </li>
            <li>
              <a href="#recursos" className="hover:text-foreground">
                Recursos
              </a>
            </li>
            <li>
              <a href="#seguranca" className="hover:text-foreground">
                Segurança
              </a>
            </li>
            <li>
              <a href="#contato" className="hover:text-foreground">
                Contato
              </a>
            </li>
          </ul>
        </div>

        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-foreground">Acesso</p>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>
              <a href="/login" className="hover:text-foreground">
                Entrar no sistema
              </a>
            </li>
            <li>
              <a href="mailto:contato@vitalsync.health" className="hover:text-foreground">
                Falar com a equipe
              </a>
            </li>
          </ul>
        </div>
        </div>
      </ScrollReveal>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:px-6 lg:px-8">
          <p>© 2026 VitalSync. Todos os direitos reservados.</p>
          <p>Feito com cuidado para equipes de saúde.</p>
        </div>
      </div>
    </footer>
  );
}