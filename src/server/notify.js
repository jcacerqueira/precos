import nodemailer from 'nodemailer';
import dns from 'dns/promises';
import net from 'net';
import tls from 'tls';
import { latestBestByProduct, latestPromotions, alreadySentPromoToday, logNotification } from './db.js';

function money(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${Number(value).toFixed(2).replace('.', ',')} €`;
}


function smtpConfig() {
  const host = process.env.SMTP_HOST || '';
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false') === 'true' || port === 465;
  return {
    host,
    port,
    secure,
    user: process.env.SMTP_USER || '',
    hasPassword: Boolean(process.env.SMTP_PASS),
    from: process.env.ALERT_FROM || process.env.SMTP_USER || '',
    to: process.env.ALERT_TO || '',
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 15000),
    requireTLS: String(process.env.SMTP_REQUIRE_TLS || 'false') === 'true'
  };
}

function redact(value = '') {
  const str = String(value || '');
  if (!str) return '';
  if (str.includes('@')) {
    const [name, domain] = str.split('@');
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return `${str.slice(0, 3)}***`;
}

function publicSmtpConfig() {
  const cfg = smtpConfig();
  return {
    ...cfg,
    user: redact(cfg.user),
    from: cfg.from.replace(/<([^>]+)>/, (_, email) => `<${redact(email)}>`),
    to: redact(cfg.to)
  };
}

function emailProvider() {
  if (process.env.RESEND_API_KEY) return 'resend';
  return 'smtp';
}

function resendConfig() {
  return {
    enabled: Boolean(process.env.RESEND_API_KEY),
    from: process.env.RESEND_FROM || process.env.ALERT_FROM || '',
    to: process.env.ALERT_TO || ''
  };
}

function publicResendConfig() {
  const cfg = resendConfig();
  return {
    enabled: cfg.enabled,
    from: cfg.from.replace(/<([^>]+)>/, (_, email) => `<${redact(email)}>`),
    to: redact(cfg.to),
    hasApiKey: Boolean(process.env.RESEND_API_KEY)
  };
}

async function sendWithResend({ from, to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY não configurada' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || from,
      to: [to],
      subject,
      html,
      text
    })
  });

  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }

  if (!response.ok) {
    const msg = data?.message || data?.error || raw || `HTTP ${response.status}`;
    return { sent: false, reason: `Resend falhou: ${msg}`, provider: 'resend', status: response.status, details: data };
  }

  return { sent: true, reason: null, provider: 'resend', messageId: data?.id || null, response: data };
}

function tcpProbe({ host, port, secure, timeoutMs = 12000 }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: false })
      : net.createConnection({ host, port });

    let done = false;
    function finish(result) {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch {}
      resolve({ ...result, durationMs: Date.now() - startedAt });
    }

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, stage: 'tcp-connect' }));
    socket.once('secureConnect', () => finish({ ok: true, stage: 'tls-secure-connect', authorized: socket.authorized, authorizationError: socket.authorizationError || null }));
    socket.once('timeout', () => finish({ ok: false, stage: 'connect-timeout', code: 'TIMEOUT', message: `Timeout a ligar a ${host}:${port}` }));
    socket.once('error', (error) => finish({ ok: false, stage: 'connect-error', code: error.code, errno: error.errno, syscall: error.syscall, address: error.address, port: error.port, message: error.message }));
  });
}

function getTransport() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const { host, port, secure, connectionTimeout, greetingTimeout, socketTimeout, requireTLS } = smtpConfig();

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    connectionTimeout,
    greetingTimeout,
    socketTimeout,
    requireTLS,
    tls: {
      servername: host
    }
  });
}

function describeEmailError(error) {
  const msg = error?.message || String(error);
  if (/timeout|timed out|ETIMEDOUT/i.test(msg)) {
    return `${msg}. Timeout de ligação ao SMTP: confirma SMTP_HOST, SMTP_PORT e SMTP_SECURE; se os dados estiverem certos, o servidor pode estar a bloquear ligações vindas do Railway.`;
  }
  if (/auth|invalid login|EAUTH|Username and Password/i.test(msg)) {
    return `${msg}. Confirma SMTP_USER e SMTP_PASS; usa a password da conta SMTP ou app password, conforme o fornecedor.`;
  }
  return msg;
}

async function sendEmail({ subject, html, text }) {
  const to = process.env.ALERT_TO;
  const from = process.env.ALERT_FROM || process.env.SMTP_USER || process.env.RESEND_FROM;
  if (!to) {
    return { sent: false, reason: 'ALERT_TO não configurado' };
  }

  if (process.env.RESEND_API_KEY) {
    try {
      console.log('[resend] sending email', { subject, config: publicResendConfig() });
      const result = await sendWithResend({ from, to, subject, text, html });
      if (result.sent) console.log('[resend] sent ok', { messageId: result.messageId });
      else console.error('[resend] send failed', result);
      return result;
    } catch (error) {
      console.error('[resend] send failed', { message: error?.message, code: error?.code });
      return { sent: false, reason: `Resend erro: ${error?.message || String(error)}`, provider: 'resend', code: error?.code };
    }
  }

  const transport = getTransport();
  if (!transport) {
    console.log('[email disabled]', subject, text || html);
    return { sent: false, reason: 'SMTP não configurado. Configura SMTP_* ou usa RESEND_API_KEY.' };
  }
  try {
    console.log('[smtp] sending email', { subject, config: publicSmtpConfig() });
    await transport.verify();
    console.log('[smtp] verify ok');
    const info = await transport.sendMail({ from, to, subject, text, html });
    console.log('[smtp] sent ok', { messageId: info.messageId, response: info.response });
    return { sent: true, reason: null, provider: 'smtp', messageId: info.messageId, response: info.response };
  } catch (error) {
    console.error('[smtp] send failed', { config: publicSmtpConfig(), code: error?.code, command: error?.command, responseCode: error?.responseCode, response: error?.response, message: error?.message });
    return { sent: false, reason: describeEmailError(error), provider: 'smtp', code: error?.code, command: error?.command, responseCode: error?.responseCode };
  }
}

export async function smtpDiagnostics() {
  const cfg = smtpConfig();
  const startedAt = new Date().toISOString();
  console.log('[smtp-diagnostics] start', { startedAt, provider: emailProvider(), smtp: publicSmtpConfig(), resend: publicResendConfig() });

  if (process.env.RESEND_API_KEY) return { ok: true, step: 'provider', reason: 'RESEND_API_KEY configurada; envio será feito por HTTP/Resend, não por SMTP.', config: { provider: 'resend', resend: publicResendConfig() } };
  if (!cfg.host) return { ok: false, step: 'config', reason: 'SMTP_HOST não configurado', config: { provider: 'smtp', smtp: publicSmtpConfig() } };

  const result = {
    ok: false,
    startedAt,
    config: { provider: emailProvider(), smtp: publicSmtpConfig(), resend: publicResendConfig() },
    dns: null,
    tcp: null,
    verify: null,
    advice: []
  };

  try {
    const addresses = await dns.lookup(cfg.host, { all: true });
    result.dns = { ok: true, addresses };
    console.log('[smtp-diagnostics] dns ok', addresses);
  } catch (error) {
    result.dns = { ok: false, code: error.code, message: error.message };
    result.advice.push('DNS falhou: confirma se SMTP_HOST está correto.');
    console.error('[smtp-diagnostics] dns failed', result.dns);
    return result;
  }

  result.tcp = await tcpProbe({ host: cfg.host, port: cfg.port, secure: cfg.secure, timeoutMs: cfg.connectionTimeout + 3000 });
  console.log('[smtp-diagnostics] tcp result', result.tcp);

  if (!result.tcp.ok) {
    if (result.tcp.code === 'TIMEOUT') {
      result.advice.push(`O Railway não conseguiu abrir ligação a ${cfg.host}:${cfg.port}. Isto aponta para porta bloqueada/firewall/SMTP não acessível externamente.`);
      result.advice.push('Testa 587 com SMTP_SECURE=false, ou usa SMTP transacional como Brevo/SendGrid/Resend.');
    } else if (result.tcp.code === 'ECONNREFUSED') {
      result.advice.push('Ligação recusada: porta errada ou serviço SMTP não está a escutar nessa porta.');
    } else {
      result.advice.push('Falha TCP antes da autenticação. Não é problema de password.');
    }
    return result;
  }

  const transport = getTransport();
  try {
    await transport.verify();
    result.verify = { ok: true };
    result.ok = true;
    result.advice.push('SMTP OK: ligação e autenticação funcionaram.');
    console.log('[smtp-diagnostics] verify ok');
  } catch (error) {
    result.verify = { ok: false, code: error?.code, command: error?.command, responseCode: error?.responseCode, response: error?.response, message: error?.message, reason: describeEmailError(error) };
    console.error('[smtp-diagnostics] verify failed', result.verify);
    if (/auth|EAUTH|Invalid login|Username and Password/i.test(error?.message || '')) {
      result.advice.push('A ligação funcionou, mas a autenticação falhou: confirma SMTP_USER e SMTP_PASS.');
    } else {
      result.advice.push('A ligação TCP funcionou, mas o verify SMTP falhou. Vê code/command/responseCode.');
    }
  }

  return result;
}

function renderSummaryRows(rows) {
  return rows.map(r => {
    const hasResult = r.store && r.price;
    return `<tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(r.name)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${hasResult ? escapeHtml(r.store) : 'Sem resultado'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right"><strong>${hasResult ? money(r.price) : '-'}</strong></td>
      <td style="padding:8px;border-bottom:1px solid #eee">${r.is_promo ? 'Promoção' : ''}</td>
    </tr>`;
  }).join('');
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function sendDailySummaryEmail({ test = false } = {}) {
  const rows = await latestBestByProduct();
  const subject = `${test ? '[TESTE] ' : ''}Resumo diário de preços`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#111">
      <h2>Resumo diário de preços</h2>
      <p>Produtos onde estão mais baratos hoje.</p>
      <table style="border-collapse:collapse;width:100%;max-width:760px">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #ddd">Produto</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #ddd">Loja</th>
            <th style="text-align:right;padding:8px;border-bottom:2px solid #ddd">Preço</th>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #ddd">Estado</th>
          </tr>
        </thead>
        <tbody>${renderSummaryRows(rows)}</tbody>
      </table>
    </div>`;
  const text = rows.map(r => `${r.name} - ${r.store || 'Sem resultado'} - ${r.price ? money(r.price) : '-'}`).join('\n');
  const result = await sendEmail({ subject, html, text });
  await logNotification({ type: test ? 'summary-test' : 'summary', subject, body: text || 'Sem produtos', sent: result.sent, reason: result.reason });
  return { ...result, count: rows.length, subject };
}

export async function sendPromotionAlerts({ test = false } = {}) {
  const promos = await latestPromotions();
  const sent = [];
  const skipped = [];

  for (const promo of promos) {
    const alreadySent = !test && await alreadySentPromoToday(promo.product_id, promo.store, promo.price);
    if (alreadySent) {
      skipped.push({ product: promo.name, store: promo.store, reason: 'já enviado hoje' });
      continue;
    }

    const subject = `${test ? '[TESTE] ' : ''}Promoção: ${promo.name} a ${money(promo.price)} no ${promo.store}`;
    const text = [
      `Produto: ${promo.name}`,
      `Loja: ${promo.store}`,
      `Preço: ${money(promo.price)}`,
      promo.old_price ? `Preço anterior: ${money(promo.old_price)}` : null,
      promo.promo_text ? `Promoção: ${promo.promo_text}` : null,
      promo.url ? `Link: ${promo.url}` : null
    ].filter(Boolean).join('\n');
    const html = `<div style="font-family:Arial,sans-serif;color:#111">
      <h2>Promoção detetada</h2>
      <p><strong>${escapeHtml(promo.name)}</strong></p>
      <p>Loja: <strong>${escapeHtml(promo.store)}</strong></p>
      <p>Preço: <strong>${money(promo.price)}</strong></p>
      ${promo.old_price ? `<p>Preço anterior: ${money(promo.old_price)}</p>` : ''}
      ${promo.promo_text ? `<p>${escapeHtml(promo.promo_text)}</p>` : ''}
      ${promo.url ? `<p><a href="${escapeHtml(promo.url)}">Ver produto</a></p>` : ''}
    </div>`;

    const result = await sendEmail({ subject, html, text });
    await logNotification({
      type: test ? 'promotion-test' : 'promotion',
      productId: promo.product_id,
      store: promo.store,
      price: promo.price,
      subject,
      body: text,
      sent: result.sent,
      reason: result.reason
    });
    sent.push({ product: promo.name, store: promo.store, price: promo.price, sent: result.sent, reason: result.reason });
  }

  if (!promos.length) {
    const subject = `${test ? '[TESTE] ' : ''}Sem promoções detetadas`;
    const body = test
      ? 'Teste de alerta de promoção: o envio de email está configurado, mas neste momento não há promoções reais detetadas.'
      : 'Não há promoções neste momento.';
    const result = test ? await sendEmail({ subject, text: body, html: `<p>${escapeHtml(body)}</p>` }) : { sent: false, reason: 'sem promoções' };
    await logNotification({ type: test ? 'promotion-test' : 'promotion', subject, body, sent: result.sent, reason: result.reason });
    if (test) sent.push({ product: 'Teste', store: '-', price: null, sent: result.sent, reason: result.reason });
  }

  return { promotionCount: promos.length, sent, skipped };
}
