import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const WEB = 'http://localhost:5173';
const API = 'http://localhost:3333/api';
const OUT = 'D:/VitalSync/.preview';
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log('•', ...a);

async function apiLogin() {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@vitalsync.local', password: 'Admin@123' }),
  });
  return (await r.json()).token;
}

async function getPatientLink(token) {
  const list = await (await fetch(`${API}/patients?pageSize=20`, { headers: { Authorization: `Bearer ${token}` } })).json();
  const carlos = list.items.find((p) => p.name.includes('Carlos')) ?? list.items[0];
  const link = await (await fetch(`${API}/patients/${carlos.id}/link`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).json();
  return { id: carlos.id, raw: link.link };
}

const browser = await chromium.launch();
const errors = [];

// ---------- Desktop panels ----------
const desk = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
const page = await desk.newPage();
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

log('login screen');
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/01-login.png` });

log('login as ADM');
await page.fill('input[type="email"]', 'admin@vitalsync.local');
await page.fill('input[type="password"]', 'Admin@123');
await page.click('button:has-text("Entrar")');
await page.waitForSelector('text=Pacientes em monitoramento', { timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/02-board.png`, fullPage: true });

log('open Carlos Lima dashboard');
await page.click('.card-title:has-text("Carlos Lima")');
await page.waitForSelector('text=Painel de acompanhamento', { timeout: 15000 });
await page.waitForTimeout(1500); // deixa os gráficos animarem
await page.screenshot({ path: `${OUT}/03-dashboard.png`, fullPage: true });

log('patient registration screen');
await page.goto(`${WEB}/patients/new`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=Cadastro de Pacientes');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/04-register.png`, fullPage: true });

log('teams screen');
await page.goto(`${WEB}/teams`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=Cadastro de Equipes Médicas');
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/05-teams.png`, fullPage: true });

// ---------- Mobile patient screen ----------
const token = await apiLogin();
const { raw } = await getPatientLink(token);
const tokenPath = raw.replace(`${WEB}`, '');
log('patient mobile screen:', tokenPath);

const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
const mpage = await mob.newPage();
mpage.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await mpage.goto(`${WEB}${tokenPath}`, { waitUntil: 'networkidle' });
await mpage.waitForSelector('text=Registro de sinais vitais', { timeout: 15000 });
await mpage.waitForTimeout(600);
await mpage.screenshot({ path: `${OUT}/06-patient-choose.png`, fullPage: true });

log('patient morning form');
await mpage.click('button:has-text("Manhã")');
await mpage.waitForSelector('text=Temperatura');
await mpage.waitForTimeout(500);
await mpage.screenshot({ path: `${OUT}/07-patient-form.png`, fullPage: true });

await browser.close();
console.log('\nConsole errors:', errors.length ? errors : 'none');
console.log('Screenshots em', OUT);
