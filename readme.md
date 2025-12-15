# SMS Sites Portal (Multi-Tenant Domain Websites + Admin/Customer Portal)

This repository contains a Node.js + Express + SQLite application that lets a reseller (admin) create and manage customer “sites” by domain, and allows each customer to manage their own SMS-compliance landing pages and basic company branding/content from a portal.

It supports:

* **Public websites per domain** (home, contact form, privacy policy, SMS terms)
* **Contact form storage + email notifications**
* **Admin portal** to manage sites + users
* **Customer portal** to manage their own site settings, upload logo/favicon, view form submissions
* **On-demand SSL readiness** (works well behind a reverse proxy like Caddy with an “ask” endpoint)

---

## Features

### Public site (per domain)

* Home page (company info + branding pulled from DB by hostname)
* Contact page (saves submission to DB and optionally emails it)
* Privacy Policy + SMS Terms pages
* Thank-you page

### Admin portal (reseller users)

* Login + session-based auth
* Create / edit / delete sites
* Upload logo + favicon per site
* Validate domain (DNS CNAME check + HTTPS /health check)
* View contact form submissions (filter by domain)
* Manage users:

  * Reseller users (admin)
  * Account users (account_user / account_admin)

### Customer portal (account users)

* Portal home (`/portal`) shows site info + domain status
* Edit site settings (`/portal/site`) (account_admin can edit)
* Upload logo/favicon for their own site
* Validate domain (their own site)
* View their own contact form submissions

### Optional AI helper

If `OPENAI_API_KEY` is configured, admin and portal can generate “Company Details” HTML snippets.

---

## Tech Stack

* Node.js + Express
* SQLite (single file DB)
* EJS templates
* Sessions via `express-session`
* Password hashing via `bcryptjs`
* File uploads via `multer`
* Email via `nodemailer` (Gmail SMTP supported)
* Optional OpenAI client for text generation

---

## Project Structure

Typical structure (core files may live in the repo root):

```
.
├─ server.js           # Main Express app
├─ db.js               # SQLite schema + init/seed helpers
├─ auth.js             # Session auth middleware
├─ mailer.js           # SMTP + email templates (invite/reset/contact)
├─ data.sqlite         # SQLite DB file (created at runtime)
├─ public/
│  ├─ assets/          # default logo/favicon
│  ├─ uploads/         # uploaded logos/favicons (created automatically)
│  ├─ style.css
│  └─ ...
└─ views/
   ├─ *.ejs
   └─ partials/
```

> You can keep `auth.js`, `db.js`, and `mailer.js` next to `server.js`. They are already modular and clean. If you later want, you can move them into `/lib` or `/src`, but **don’t move them unless you update the `require('./db')` paths in server.js**.

---

## Requirements

* Node.js 18+ recommended (works on modern Node versions)
* npm
* A server with ports open:

  * 80/443 if using a reverse proxy for SSL
  * your internal app port (example: 3000) for local proxying

---

## Installation

### 1) Clone and install

```bash
git clone <your-repo-url>
cd <your-repo-folder>
npm install
```

### 2) Create `.env`

Create a `.env` file in the project root.

Minimal example:

```env
PORT=3000
SESSION_SECRET=change-this-to-a-long-random-string

# Domain validation
CNAME_URL=your-caddy-hostname-or-target.example.com

# Base URL used in emails (reset links)
APP_BASE_URL=https://your-admin-domain.example.com

# SMTP (Gmail example)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your_app_password
FROM_EMAIL="Teklink Sites <you@gmail.com>"

# Create first admin user automatically IF db is empty
INIT_ADMIN_EMAIL=admin@yourcompany.com
INIT_ADMIN_PASSWORD=ChangeMeNow123!

# Optional AI
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

**Important: Gmail requires an App Password** (not your normal password) if you have 2FA enabled.

---

## Running Locally

### Start

```bash
node server.js
```

Open:

* Public site: `http://localhost:3000/`
* Login: `http://localhost:3000/login`
* Admin sites list: `http://localhost:3000/admin/sites`
* Portal: `http://localhost:3000/portal`

### Default seed data

If your DB is empty, the app seeds:

* A default `localhost` site (so the public pages always have something to render)
* A default admin user **only if**:

  * there are **no users** in the DB, and
  * `INIT_ADMIN_EMAIL` + `INIT_ADMIN_PASSWORD` are set

This is intentional so a fresh deploy always has a way in.

---

## Users & Roles

The `users` table stores:

* `admin` → reseller/admin portal
* `account_admin` → customer portal with edit access
* `account_user` → customer portal read-only access (cannot save site settings)

Login redirects:

* `admin` → `/admin/sites`
* non-admin → `/portal`

---

## Sites / Domains

Sites are loaded by hostname:

* The app checks `req.hostname` and looks up a matching `sites.domain`
* If not found, it falls back to the `localhost` site record

This allows multi-tenant hosting on one server.

---

## Logo & Favicon Uploads (Important)

Uploads are handled by separate endpoints:

* Admin:

  * `POST /admin/sites/:id/upload-logo`
  * `POST /admin/sites/:id/upload-favicon`
* Portal:

  * `POST /portal/sites/:id/upload-logo`
  * `POST /portal/sites/:id/upload-favicon`

**The main “Save Site” form does not upload images.**
So, to avoid wiping the DB values:

* The admin site form includes hidden fields:

  * `<input type="hidden" name="logo_url" ...>`
  * `<input type="hidden" name="favicon_url" ...>`
* Portal save route preserves existing values from the DB before updating.

If you change those forms/routes, ensure you do not accidentally overwrite `logo_url` / `favicon_url` with empty values.

---

## Domain Validation

There are two validation checks:

1. **DNS CNAME**: verifies the customer’s domain points to the expected CNAME target (`CNAME_URL`)
2. **HTTPS health check**: verifies `https://domain/health` returns `200`

Admin trigger:

* `POST /admin/sites/:id/validate-domain`

Portal trigger (customer):

* `POST /portal/sites/:id/validate-domain`

The `sites` table tracks:

* `domain_status`
* `domain_last_checked_at`

---

## Reverse Proxy + SSL (Production)

This app is commonly deployed behind a reverse proxy (recommended), e.g. **Caddy** or **Nginx**.

### If using Caddy “on-demand TLS”

Caddy can issue SSL for domains automatically **only if** your app allows it.

To do that, your Express app should expose a route like:

* `GET /caddy-ask?domain=example.com`

Return:

* `200` → allow Caddy to issue cert
* `403` → deny

**Important:** this is separate from your DNS validation feature.
DNS validation is for your UI/status; the “ask” route is for certificate issuance security.

---

## Production Process Manager (PM2)

### Install PM2

```bash
npm install -g pm2
```

### Start the app

From the project folder:

```bash
pm2 start server.js --name sms-sites
```

### Save the process list

```bash
pm2 save
```

### Enable startup on boot

```bash
pm2 startup
```

PM2 will output a command to run (copy/paste it).

### Check status/logs

```bash
pm2 status
pm2 logs sms-sites
```

---

## Backups

SQLite is a single file database:

* `data.sqlite`

Back up:

* `data.sqlite`
* `public/uploads/` (logos/favicons)

---

## Common Troubleshooting

### “I can’t login after creating a user”

* If the user was created without a password, they start inactive (`is_active=0`)
* They must set a password via invite/reset link

### Emails not sending

* If SMTP user/pass are missing, the app logs the email to console and skips sending.
* For Gmail, use an App Password.

### Domain validation fails

* Ensure customer domain has a CNAME pointing to `CNAME_URL`
* Ensure your reverse proxy routes `https://domain/health` to the app and returns `200`

---

## Security Notes (Recommended Improvements)

* Set a strong `SESSION_SECRET`
* In production, configure session cookies with `secure: true` when behind HTTPS
* Restrict the Caddy “ask” endpoint to only allow domains existing in DB (already recommended)
* Consider rate-limiting public form submission endpoints if needed

---

## License

Add your preferred license here (MIT, proprietary, etc.).
