const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Where applications land. Comma separated for more than one recipient.
const NOTIFY_TO = (process.env.NOTIFY_TO || 'emilian@expand.health')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Must be an address on a domain verified in the Resend account.
const FROM_EMAIL = process.env.FROM_EMAIL || 'The Forum <noreply@expand.health>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname), { extensions: ['html'] }));

// Crude per IP throttle. A public form on the open internet gets hit.
const hits = new Map();
function throttled(ip) {
  const now = Date.now();
  const window = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < window);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 5;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

app.post('/api/register', async (req, res) => {
  const body = req.body || {};

  // Honeypot. Real people never fill this, bots fill everything.
  if (body.website) return res.json({ ok: true });

  const name = String(body.name || '').trim().slice(0, 120);
  const email = String(body.email || '').trim().slice(0, 160);
  const firm = String(body.firm || '').trim().slice(0, 160);
  const role = String(body.role || '').trim().slice(0, 120);

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Please add your name and a valid email address.' });
  }
  if (throttled(req.ip)) {
    return res.status(429).json({ ok: false, error: 'Too many submissions. Try again shortly.' });
  }

  console.log(JSON.stringify({ event: 'registration', name, email, firm, role, at: new Date().toISOString() }));

  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set, registration logged but no email sent');
    return res.json({ ok: true, emailed: false });
  }

  const html = [
    '<p>New application for The Forum.</p>',
    '<p><strong>Name</strong><br>' + escapeHtml(name) + '</p>',
    '<p><strong>Email</strong><br>' + escapeHtml(email) + '</p>',
    '<p><strong>Firm</strong><br>' + escapeHtml(firm || '-') + '</p>',
    '<p><strong>You are</strong><br>' + escapeHtml(role || '-') + '</p>'
  ].join('');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: NOTIFY_TO,
        reply_to: email,
        subject: 'The Forum, application from ' + name,
        html
      })
    });
    const payload = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('resend failed', r.status, JSON.stringify(payload));
      return res.status(502).json({ ok: false, error: 'Could not send. Please email us directly.' });
    }
    console.log('resend accepted', payload.id);
    return res.json({ ok: true, emailed: true });
  } catch (err) {
    console.error('resend error', err.message);
    return res.status(502).json({ ok: false, error: 'Could not send. Please email us directly.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, resendConfigured: Boolean(RESEND_API_KEY), notifyTo: NOTIFY_TO.length });
});

app.listen(PORT, () => console.log('The Forum listening on ' + PORT));
