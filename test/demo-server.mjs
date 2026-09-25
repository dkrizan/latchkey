/**
 * Two tiny React login apps for manual and automated testing.
 *
 *   http://localhost:4100  "Acme Console"  (user: demo@acme.test / pass: secret)
 *   http://localhost:4200  "Other App"     (same form markup, different title)
 *
 * The form mimics common real-world setups: controlled React inputs, a submit
 * button that stays disabled until both fields are filled, and a full-page
 * redirect back to /login?error=1 after wrong credentials. E-mails starting with
 * "bounce" instead get an error page that sends them back to the login after 0.5 s,
 * like apps that show an in-between page after a failed login.
 *
 * Usage: node test/demo-server.mjs
 */
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// React 19 ships no UMD build, so bundle a tiny global React/ReactDOM on startup.
const { outputFiles } = await build({
  stdin: {
    contents: "import React from 'react'; import * as ReactDOM from 'react-dom/client'; window.React = React; window.ReactDOM = ReactDOM;",
    resolveDir: root,
  },
  bundle: true,
  minify: true,
  format: 'iife',
  write: false,
  define: { 'process.env.NODE_ENV': '"production"' },
});
const reactBundle = outputFiles[0].contents;

export const USERS = { 'demo@acme.test': 'secret' };
export const stats = { submits: { 4100: 0, 4200: 0 } };

function page(title, port) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f1f5f9;
         font: 14px/1.5 system-ui, sans-serif; color: #0f172a; }
  .card { width: 340px; background: #fff; border-radius: 14px; padding: 28px; box-shadow: 0 10px 30px rgba(15,23,42,.08); }
  h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 18px; color: #64748b; }
  label { display: block; font-size: 12.5px; font-weight: 600; margin: 12px 0 4px; }
  input { width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
  button { margin-top: 18px; width: 100%; padding: 10px; border: 0; border-radius: 8px; background: #0f766e; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { background: #94a3b8; cursor: default; }
  .err { background: #fee2e2; color: #b91c1c; padding: 8px 10px; border-radius: 8px; font-size: 13px; margin-bottom: 8px; }
  .logo { width: 36px; height: 36px; border-radius: 10px; background: #0f766e; margin-bottom: 14px; }
</style></head>
<body><div id="root"></div>
<script src="/react.js"></script>
<script>
  const h = React.createElement;
  function Login() {
    const [email, setEmail] = React.useState('');
    const [password, setPassword] = React.useState('');
    const error = new URLSearchParams(location.search).has('error');
    return h('form', { className: 'card', method: 'post', action: '/login',
        onSubmit: (e) => { if (!email || !password) e.preventDefault(); } },
      h('div', { className: 'logo' }),
      h('h1', null, ${JSON.stringify(title)}),
      h('p', null, 'Sign in to continue'),
      error ? h('div', { className: 'err', 'data-testid': 'error' }, 'Invalid e-mail or password') : null,
      h('label', { htmlFor: 'email' }, 'E-mail'),
      h('input', { id: 'email', name: 'email', type: 'email', value: email, onChange: (e) => setEmail(e.target.value) }),
      h('label', { htmlFor: 'password' }, 'Password'),
      h('input', { id: 'password', name: 'password', type: 'password', value: password, onChange: (e) => setPassword(e.target.value) }),
      h('button', { type: 'submit', 'data-testid': 'submit', disabled: !email || !password }, 'Sign in'));
  }
  // Render late, like a real SPA fetching config first.
  setTimeout(() => ReactDOM.createRoot(document.getElementById('root')).render(h(Login)), 300);
</script></body></html>`;
}

function dashboard(title, email) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}: Dashboard</title></head>
<body style="font:16px system-ui;padding:40px"><h1 data-testid="welcome">Welcome, ${email}</h1><a href="/logout">Log out</a></body></html>`;
}

function app(title, port) {
  return createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/react.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(reactBundle);
    if (url.pathname === '/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        stats.submits[port]++;
        const form = new URLSearchParams(body);
        const email = form.get('email');
        if (USERS[email] && USERS[email] === form.get('password')) {
          res.writeHead(302, { location: '/dashboard?u=' + encodeURIComponent(email) }).end();
        } else {
          res.writeHead(302, { location: email && email.startsWith('bounce') ? '/oops' : '/login?error=1' }).end();
        }
      });
      return;
    }
    if (url.pathname === '/oops') {
      const back = `<script>setTimeout(() => location.replace('/login?error=1'), 500)</script>`;
      return res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><title>Oops</title><p>Login failed, taking you back…</p>${back}`);
    }
    if (url.pathname === '/dashboard') {
      return res.writeHead(200, { 'content-type': 'text/html' }).end(dashboard(title, url.searchParams.get('u')));
    }
    if (url.pathname === '/login') return res.writeHead(200, { 'content-type': 'text/html' }).end(page(title, port));
    res.writeHead(302, { location: '/login' }).end();
  });
}

export function start() {
  const servers = [app('Acme Console', 4100).listen(4100), app('Other App', 4200).listen(4200)];
  return () => servers.forEach((s) => s.close());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start();
  console.log('Acme Console: http://localhost:4100/login  (demo@acme.test / secret)');
  console.log('Other App:    http://localhost:4200/login');
}
