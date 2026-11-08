// Palpitezzada · site oficial (fechado com login) · rodada ao vivo do GitHub
// Node puro, sem dependências. Porta 80 (exigência da ShardCloud) ou PORT.
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = 80; // ShardCloud exige porta 80 em 0.0.0.0
process.on('uncaughtException', e => console.error('Erro (servidor segue no ar):', e && e.stack || e));
process.on('unhandledRejection', e => console.error('Promessa rejeitada (servidor segue no ar):', e && e.message || e));
const REPO = 'Alekzzada/palpitezzada-rodadas';
const DIR = __dirname;
const USERS_FILE = path.join(DIR, 'usuarios.json');
const SECRET_FILE = path.join(DIR, '.segredo');
const ATUALIZA_MS = 15000; // reserva: checa o GitHub a cada 15s (resposta 304 não gasta limite)

// ---------- segredo da sessão ----------
let SECRET;
try { SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim(); } catch (e) {}
if (!SECRET) { SECRET = crypto.randomBytes(32).toString('hex'); try { fs.writeFileSync(SECRET_FILE, SECRET); } catch (e) {} }

// ---------- usuários (senha em texto vira hash no primeiro boot) ----------
function hash(senha, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(senha, salt, 32).toString('hex');
}
function confere(senha, guardado) {
  const [salt, h] = String(guardado).split(':');
  if (!salt || !h) return false;
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(senha, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
let USERS = {};
function carregarUsuarios() {
  let lista = [];
  try { lista = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { console.error('ATENÇÃO: usuarios.json inválido ou ausente — ninguém consegue entrar até corrigir.'); }
  let mudou = false;
  for (const u of lista) if (u.senha) { u.hash = hash(String(u.senha)); delete u.senha; mudou = true; }
  if (mudou) { try { fs.writeFileSync(USERS_FILE, JSON.stringify(lista, null, 2)); } catch (e) {} }
  USERS = {};
  for (const u of lista) if (u.usuario && u.hash) USERS[String(u.usuario).toLowerCase()] = u.hash;
  console.log('Node', process.version, '· usuários carregados:', Object.keys(USERS).length);
}
carregarUsuarios();

// ---------- sessão em cookie assinado (30 dias) ----------
function assinar(v) { return crypto.createHmac('sha256', SECRET).update(v).digest('hex'); }
function criarSessao(user) {
  const v = Buffer.from(JSON.stringify({ u: user, e: Date.now() + 30 * 864e5 })).toString('hex');
  return v + '.' + assinar(v);
}
function lerSessao(req) {
  const m = /(?:^|;\s*)pz=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [v, s] = m[1].split('.');
  if (!v || !s || s.length !== 64) return null;
  const esperado = assinar(v);
  if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(esperado))) return null;
  try { const d = JSON.parse(Buffer.from(v, 'hex').toString()); return d.e > Date.now() && USERS[d.u] ? d.u : null; } catch (e) { return null; }
}

// ---------- trava contra força bruta no login ----------
const tentativas = new Map();
function bloqueado(ip) { const t = tentativas.get(ip); return t && t.n >= 8 && Date.now() - t.t < 15 * 60e3; }
function falhou(ip) { const t = tentativas.get(ip) || { n: 0, t: Date.now() }; t.n++; t.t = Date.now(); tentativas.set(ip, t); }

// ---------- GitHub ao vivo ----------
const TOKEN = process.env.GITHUB_TOKEN || (() => { try { return fs.readFileSync(path.join(DIR, '.github-token'), 'utf8').trim(); } catch (e) { return ''; } })();
const limite = { restante: null, reseta: null };
function req(url, accept, etag) {
  return new Promise((ok, erro) => {
    const h = { 'User-Agent': 'palpitezzada-site', Accept: accept || 'application/json' };
    if (etag) h['If-None-Match'] = etag;
    if (TOKEN && url.startsWith('https://api.github.com')) h.Authorization = 'Bearer ' + TOKEN;
    https.get(url, { headers: h }, r => {
      if (r.headers['x-ratelimit-remaining']) { limite.restante = +r.headers['x-ratelimit-remaining']; limite.reseta = new Date(r.headers['x-ratelimit-reset'] * 1000).toISOString(); }
      let b = ''; r.on('data', c => b += c);
      r.on('end', () => (r.statusCode === 200 || r.statusCode === 304) ? ok({ status: r.statusCode, body: b, etag: r.headers.etag }) : erro(new Error(url.split('?')[0] + ' ' + r.statusCode)));
    }).on('error', erro).setTimeout(10000, function () { this.destroy(new Error('timeout')); });
  });
}
const get = (url, accept) => req(url, accept).then(r => r.body);
const estado = { sha: null, rodada: null, historico: [], atualizado: null, erro: null, carregadoEm: null };
let etagCommit = null, rodando = null;
function atualizar() { if (!rodando) rodando = atualizarAgora().finally(() => { rodando = null; }); return rodando; }
async function atualizarAgora() {
  try {
    const r = await req(`https://api.github.com/repos/${REPO}/commits/main`, 'application/vnd.github.sha', estado.sha && !String(estado.sha).startsWith('main-') ? etagCommit : null);
    if (r.status === 304) { estado.atualizado = new Date().toISOString(); estado.erro = null; return; }
    etagCommit = r.etag;
    const sha = r.body.trim();
    if (sha !== estado.sha) {
      const base = `https://raw.githubusercontent.com/${REPO}/${sha}/`;
      const rodada = JSON.parse(await get(base + 'rodada.json'));
      if (!rodada || !Array.isArray(rodada.entradas)) throw new Error('rodada.json sem entradas');
      let hist = [];
      try {
        const arquivos = JSON.parse(await get(`https://api.github.com/repos/${REPO}/contents/historico?ref=${sha}`))
          .filter(f => /^rodada-\d{4}-\d{2}-\d{2}\.json$/.test(f.name)).map(f => f.name).sort().slice(-31);
        hist = (await Promise.all(arquivos.map(n => get(base + 'historico/' + n).then(JSON.parse).catch(() => null))))
          .filter(Boolean).map(resumoDia);
      } catch (e) { hist = estado.historico; }
      Object.assign(estado, { sha, rodada, historico: hist, carregadoEm: new Date().toISOString() });
      console.log('Rodada nova carregada', sha.slice(0, 7), rodada.gerado);
    }
    estado.atualizado = new Date().toISOString(); estado.erro = null;
  } catch (e) {
    estado.erro = e.message; console.error('GitHub:', e.message);
    // reserva: arquivo da branch main direto (pode atrasar até 5 min pelo cache do GitHub)
    try {
      const rodada = JSON.parse(await get(`https://raw.githubusercontent.com/${REPO}/main/rodada.json?t=${Date.now()}`));
      if (!estado.rodada || rodada.gerado !== estado.rodada.gerado) { estado.rodada = rodada; estado.sha = 'main-' + (rodada.gerado || Date.now()); }
      estado.atualizado = new Date().toISOString();
    } catch (e2) { console.error('Reserva:', e2.message); }
  }
}
function resumoDia(d) {
  const es = d.entradas || [];
  const data = (es[0] && es[0].data) || (d.analise && d.analise.data) || '';
  let lucro = 0, investido = 0, verdes = 0, vermelhos = 0, pend = 0;
  for (const e of es) {
    investido += Number(e.stake) || 0;
    if (e.status === 'green') { verdes++; lucro += Number(e.lucro) || 0; }
    else if (e.status === 'red') { vermelhos++; lucro += Number(e.lucro) || -(Number(e.stake) || 0); }
    else pend++;
  }
  return { data, lucro, investido, verdes, vermelhos, pend };
}
atualizar(); setInterval(atualizar, ATUALIZA_MS);

// ---------- servidor ----------
const PUB = path.join(DIR, 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SEG = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store' };
function enviar(res, cod, corpo, tipo, extra) { res.writeHead(cod, Object.assign({ 'Content-Type': tipo || 'text/plain; charset=utf-8' }, SEG, extra || {})); res.end(corpo); }
// aceita os arquivos da página dentro de public/ ou soltos na raiz
function arquivo(res, nome) {
  const tipo = TIPOS[path.extname(nome)] || 'application/octet-stream';
  fs.readFile(path.join(PUB, nome), (e, b) => {
    if (!e) return enviar(res, 200, b, tipo);
    fs.readFile(path.join(DIR, nome), (e2, b2) => e2 ? enviar(res, 404, 'Não encontrado') : enviar(res, 200, b2, tipo));
  });
}
function corpo(req) { return new Promise(ok => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e4) req.destroy(); }); req.on('end', () => ok(b)); }); }

function https_(req) { return req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').includes('https'); }
let ultimoPing = 0;
function handler(req, res) { rota(req, res).catch(e => { console.error('Rota:', e && e.message); try { enviar(res, 500, 'Erro interno'); } catch (x) {} }); }
function ouvir(porta) {
  const srv = http.createServer(handler);
  srv.on('error', e => console.error('Não consegui abrir a porta ' + porta + ':', e.code || e.message));
  srv.listen(porta, '0.0.0.0', () => console.log('Palpitezzada no ar em 0.0.0.0:' + porta));
}
ouvir(PORT);
if (process.env.PORT && +process.env.PORT !== PORT) ouvir(+process.env.PORT);

async function rota(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const user = lerSessao(req);

  if (p === '/saude') return enviar(res, 200, JSON.stringify({ ok: !!estado.rodada, sha: estado.sha, rodada: estado.rodada && estado.rodada.gerado, titulo: estado.rodada && estado.rodada.analise && estado.rodada.analise.titulo, entradas: estado.rodada ? estado.rodada.entradas.length : 0, dias_historico: estado.historico.length, carregada_em: estado.carregadoEm, conferido_em: estado.atualizado, github_limite_restante: limite.restante, usuarios: Object.keys(USERS).length, erro: estado.erro }), 'application/json');
  if (p === '/atualizar') {
    // chamado pelo GitHub a cada envio: busca a rodada na hora (no máx. 1 vez a cada 3s)
    if (Date.now() - ultimoPing > 3000) { ultimoPing = Date.now(); etagCommit = null; await atualizar().catch(() => {}); }
    return enviar(res, 200, JSON.stringify({ ok: true, sha: estado.sha, rodada: estado.rodada && estado.rodada.gerado }), 'application/json');
  }

  if (p === '/entrar' && req.method === 'POST') {
    if (bloqueado(ip)) return enviar(res, 429, JSON.stringify({ erro: 'Muitas tentativas. Espere 15 minutos.' }), 'application/json');
    let d = {}; try { d = JSON.parse(await corpo(req)); } catch (e) {}
    const u = String(d.usuario || '').toLowerCase().trim();
    if (USERS[u] && confere(String(d.senha || ''), USERS[u])) {
      tentativas.delete(ip);
      return enviar(res, 200, '{"ok":true}', 'application/json', { 'Set-Cookie': `pz=${criarSessao(u)}; Path=/; HttpOnly;${https_(req) ? ' Secure;' : ''} SameSite=Lax; Max-Age=${30 * 86400}` });
    }
    falhou(ip);
    return enviar(res, 401, JSON.stringify({ erro: 'Usuário ou senha incorretos.' }), 'application/json');
  }
  if (p === '/sair') return enviar(res, 302, '', null, { Location: '/', 'Set-Cookie': 'pz=; Path=/; Max-Age=0' });

  if (!user) {
    if (p.startsWith('/api/')) return enviar(res, 401, '{"erro":"login"}', 'application/json');
    if (p === '/login.css') return arquivo(res, 'app.css');
    return arquivo(res, 'login.html');
  }

  if (p === '/api/rodada') {
    if (url.searchParams.get('sha') && url.searchParams.get('sha') === estado.sha) return enviar(res, 204, '');
    return enviar(res, 200, JSON.stringify({ sha: estado.sha, atualizado: estado.atualizado, usuario: user, rodada: estado.rodada, historico: estado.historico }), 'application/json');
  }
  if (p === '/' || p === '/index.html') return arquivo(res, 'index.html');
  if (/^\/[\w.-]+\.(css|js|svg|png|ico)$/.test(p)) return arquivo(res, p.slice(1));
  enviar(res, 404, 'Não encontrado');
}
