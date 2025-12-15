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

const { initDb } = require('./db');
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
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false
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
  const domain = String(req.query.domain || '').trim().toLowerCase();

  if (!domain) return res.status(400).send('missing domain');

  // Safety: never issue certs for localhost, and basic sanity check
  if (domain === 'localhost') return res.status(403).send('denied');
  if (!/^[a-z0-9.-]+$/.test(domain)) return res.status(403).send('denied');

  // Allow only domains that exist in the DB (you can tighten to only 'active' later if you want)
  db.get('SELECT id FROM sites WHERE domain = ?', [domain], (err, row) => {
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
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
