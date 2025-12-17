/**
 * server.js (entrypoint)
 * - Loads env
 * - Initializes DB
 * - Registers middleware
 * - Mounts route modules
 * - Starts HTTP server
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const { initDb, db } = require('./db');
const { attachCurrentUser } = require('./auth');
const { SESSION_SECRET, PORT } = require('./config/appConfig');

const localsMiddleware = require('./middleware/locals');
const siteResolverMiddleware = require('./middleware/siteResolver');

const publicRoutes = require('./routes/public');
const authRoutes = require('./routes/auth');
const adminUsersRoutes = require('./routes/adminUsers');
const adminSitesRoutes = require('./routes/adminSites');
const portalRoutes = require('./routes/portal');
const notFoundRoutes = require('./routes/notFound');

// ---- Create app ----
const app = express();

// ---- View engine ----
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- Parse bodies ----
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---- Static assets ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- Session ----
// app.use(
//   session({
//     secret: SESSION_SECRET,
//     resave: false,
//     saveUninitialized: false
//   })
// );

// If behind a proxy (e.g. Caddy), trust first proxy
app.set('trust proxy', 1);

// Reconfigure session to use SQLite store
app.use(
  session({
    store: new SQLiteStore({
      // you can keep this next to your app or in a subfolder
      db: 'sessions.sqlite',
      dir: __dirname
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    }
  })
);


// ---- Locals helpers (phone formatting, flash, etc.) ----
app.use(localsMiddleware);

// ---- Attach current user into res.locals ----
app.use(attachCurrentUser);

// ---- Load site by hostname into res.locals.site ----
app.use(siteResolverMiddleware);

// ---- Initialise DB (tables + seeds) ----
initDb();

// ---- Mount routes ----
app.use(publicRoutes);
app.use(authRoutes);
app.use(adminUsersRoutes);
app.use(adminSitesRoutes);
app.use(portalRoutes);

// ------------------------------------------------------------
// Caddy "ask" endpoint (for on-demand TLS)
// Caddy calls: /caddy-ask?domain=example.com
// Return 200 to allow cert issuance, 403 to deny.
// ------------------------------------------------------------
app.get('/caddy-ask', (req, res) => {
  const token = String(req.query.token || '').trim();
  const expected = process.env.CADDY_ASK_TOKEN || '';

  // Require token (prevents abuse)
  if (!expected || token !== expected) {
    return res.status(403).send('forbidden');
  }

  let domain = String(req.query.domain || '').trim().toLowerCase();
  if (!domain) return res.status(400).send('missing domain');

  // Strip :port if Caddy ever includes it
  domain = domain.split(':')[0];

  // Ignore www. so www.customer.com works
  if (domain.startsWith('www.')) domain = domain.slice(4);

  // Deny localhost
  if (domain === 'localhost') return res.status(403).send('denied');

  // Deny IPs (Let's Encrypt won't issue certs for IPs)
  const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(domain);
  if (isIPv4) return res.status(403).send('denied');

  // Basic sanity check
  if (!/^[a-z0-9.-]+$/.test(domain)) return res.status(403).send('denied');

  // Allow only domains that exist in the DB
  db.get('SELECT id FROM sites WHERE domain = ? LIMIT 1', [domain], (err, row) => {
    if (err) {
      console.error('caddy-ask DB error:', err);
      return res.status(500).send('error');
    }
    if (!row) return res.status(403).send('denied');
    return res.status(200).send('ok');
  });
});


// ---- Not found + error handlers ----
app.use(notFoundRoutes);

// ---- Start ----
console.log('DEBUG: process.env.PORT =', process.env.PORT);
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
