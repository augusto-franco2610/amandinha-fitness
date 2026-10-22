/* =====================================================================
   Amandinha Fitness — servidor (Cloudflare Worker, plano gratuito)

   Faz duas coisas que um site sozinho não consegue:
   1. Strava: troca o código de login por tokens usando a chave secreta
      (que fica só aqui) e repassa as consultas de atividades.
   2. Notificações: guarda a inscrição do iPhone e dispara os lembretes
      nos horários agendados (Cron Triggers), mesmo com o app fechado.

   Configuração (veja o README):
   - KV namespace ligado com o nome  SUBS
   - Variáveis:  APP_URL            ex.: https://seu-usuario.github.io/amandinha-fitness/
                 STRAVA_CLIENT_ID   (número do app no Strava)
   - Secret:     STRAVA_CLIENT_SECRET
   - Cron Triggers (horário UTC; Brasília = UTC-3):
       0 10 * * *   -> 07:00 todo dia (peso)
       0 1 * * SAT  -> sexta 22:00 (Mounjaro)
   ===================================================================== */

const MENSAGENS = {
  peso: { title: 'Bom dia! ⚖️', body: 'Hora de registrar o peso de hoje.', url: './#diario', tag: 'peso' },
  mounjaro: { title: 'Dia de Mounjaro 💉', body: 'Lembrete da aplicação semanal. Registre a dose no app.', url: './#mounjaro', tag: 'mounjaro' },
  teste: { title: 'Amandinha Fitness', body: 'Notificações funcionando! ✅', url: './', tag: 'teste' }
};

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Vary': 'Origin'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    const url = new URL(req.url);
    try {
      // ---------- notificações ----------
      if (url.pathname === '/push/key') {
        const k = await chavesVapid(env);
        return json({ key: k.publica });
      }
      if (url.pathname === '/push/subscribe' && req.method === 'POST') {
        const { subscription, prefs } = await req.json();
        if (!subscription || !subscription.endpoint || !subscription.keys) return json({ erro: 'inscrição inválida' }, 400);
        let subs = await lerSubs(env);
        subs = subs.filter(s => s.subscription.endpoint !== subscription.endpoint);
        subs.unshift({ subscription, prefs: { peso: true, mounjaro: true, ...(prefs || {}) }, criado: Date.now() });
        await env.SUBS.put('subs', JSON.stringify(subs.slice(0, 10)));
        return json({ ok: true });
      }
      if (url.pathname === '/push/unsubscribe' && req.method === 'POST') {
        const { endpoint } = await req.json();
        const subs = (await lerSubs(env)).filter(s => s.subscription.endpoint !== endpoint);
        await env.SUBS.put('subs', JSON.stringify(subs));
        return json({ ok: true });
      }
      if (url.pathname === '/push/test' && req.method === 'POST') {
        const { endpoint } = await req.json();
        const s = (await lerSubs(env)).find(x => x.subscription.endpoint === endpoint);
        if (!s) return json({ erro: 'inscrição não encontrada' }, 404);
        const r = await enviarPush(env, s.subscription, MENSAGENS.teste);
        return json({ ok: r.ok, status: r.status });
      }

      // ---------- Strava ----------
      if (url.pathname === '/strava/token' && req.method === 'POST') {
        const body = await req.json();
        const params = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET });
        if (body.code) { params.set('code', body.code); params.set('grant_type', 'authorization_code'); }
        else if (body.refresh_token) { params.set('refresh_token', body.refresh_token); params.set('grant_type', 'refresh_token'); }
        else return json({ erro: 'faltou code ou refresh_token' }, 400);
        const r = await fetch('https://www.strava.com/oauth/token', { method: 'POST', body: params });
        const d = await r.json();
        if (!r.ok) return json({ erro: d.message || 'erro no Strava' }, r.status);
        return json({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: d.expires_at, athlete: d.athlete ? { firstname: d.athlete.firstname, lastname: d.athlete.lastname } : null });
      }
      if (url.pathname === '/strava/api') {
        const path = url.searchParams.get('path') || '';
        if (!/^\/(athlete\/activities|activities\/\d+)(\?|$)/.test(path)) return json({ erro: 'caminho não permitido' }, 400);
        const r = await fetch('https://www.strava.com/api/v3' + path, { headers: { Authorization: req.headers.get('Authorization') || '' } });
        return new Response(await r.text(), { status: r.status, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      return json({ ok: true, app: 'Amandinha Fitness' });
    } catch (e) {
      return json({ erro: String(e && e.message || e) }, 500);
    }
  },

  // disparado pelos Cron Triggers
  async scheduled(evento, env, ctx) {
    const tipo = evento.cron.trim() === '0 10 * * *' ? 'peso' : 'mounjaro';
    ctx.waitUntil(enviarParaTodos(env, tipo));
  }
};

async function lerSubs(env) {
  try { return JSON.parse((await env.SUBS.get('subs')) || '[]'); } catch (e) { return []; }
}
async function enviarParaTodos(env, tipo) {
  const subs = await lerSubs(env);
  const vivos = [];
  for (const s of subs) {
    if (s.prefs && s.prefs[tipo] === false) { vivos.push(s); continue; }
    const r = await enviarPush(env, s.subscription, MENSAGENS[tipo]);
    if (r.status !== 404 && r.status !== 410) vivos.push(s);   // 404/410 = inscrição expirada
  }
  await env.SUBS.put('subs', JSON.stringify(vivos));
}

/* ---------------- Web Push (RFC 8291 + VAPID RFC 8292) ---------------- */
const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const junta = (...arrs) => { const n = arrs.reduce((a, b) => a + b.length, 0); const o = new Uint8Array(n); let i = 0; for (const a of arrs) { o.set(a, i); i += a.length; } return o; };

async function chavesVapid(env) {
  const salvo = await env.SUBS.get('vapid');
  if (salvo) return JSON.parse(salvo);
  const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const k = { privada: await crypto.subtle.exportKey('jwk', par.privateKey), publica: b64u(await crypto.subtle.exportKey('raw', par.publicKey)) };
  await env.SUBS.put('vapid', JSON.stringify(k));
  return k;
}

async function jwtVapid(env, endpoint) {
  const k = await chavesVapid(env);
  const aud = new URL(endpoint).origin;
  const sub = env.APP_URL && /^https:/.test(env.APP_URL) ? new URL(env.APP_URL).origin : 'mailto:amandinha.fitness@example.org';
  const cab = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub })));
  const chave = await crypto.subtle.importKey('jwk', k.privada, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const ass = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, enc.encode(cab + '.' + corpo));
  return { jwt: cab + '.' + corpo + '.' + b64u(ass), publica: k.publica };
}

async function hkdf(salt, ikm, info, bits) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bits));
}

export async function cifrar(subscription, payload) {
  const uaPub = deB64u(subscription.keys.p256dh);
  const auth = deB64u(subscription.keys.auth);
  const efemera = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', efemera.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const segredo = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, efemera.privateKey, 256));
  const ikm = await hkdf(auth, segredo, junta(enc.encode('WebPush: info\0'), uaPub, asPub), 256);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 96);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const texto = junta(enc.encode(payload), new Uint8Array([2]));
  const cifra = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, texto));
  const rs = new Uint8Array([0, 0, 16, 0]); // 4096
  return junta(salt, rs, new Uint8Array([asPub.length]), asPub, cifra);
}

async function enviarPush(env, subscription, msg) {
  const corpo = await cifrar(subscription, JSON.stringify(msg));
  const { jwt, publica } = await jwtVapid(env, subscription.endpoint);
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '43200',
      'Urgency': 'high',
      'Topic': msg.tag,
      'Authorization': `vapid t=${jwt}, k=${publica}`
    },
    body: corpo
  });
}
