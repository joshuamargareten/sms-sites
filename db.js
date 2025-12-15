// db.js
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'data.sqlite');
const db = new sqlite3.Database(dbPath);

function initDb() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS sites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT UNIQUE NOT NULL,

        company_name TEXT NOT NULL,
        company_details TEXT NOT NULL,
        contact_phone TEXT NOT NULL,
        contact_email TEXT NOT NULL,

        address_line1 TEXT,
        address_line2 TEXT,
        city TEXT,
        state TEXT,
        zip TEXT,
        country TEXT,

        business_hours TEXT,

        logo_url TEXT,
        favicon_url TEXT,
        primary_color TEXT,
        secondary_color TEXT,
        dark_color TEXT,
        light_color TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS form_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_domain TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        message TEXT NOT NULL,
        sms_consent INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        site_id INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        reset_token TEXT,
        reset_token_expires_at TEXT
      )
    `);

    db.run(`ALTER TABLE sites ADD COLUMN domain_status TEXT`, (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error('Error adding domain_status to sites:', err);
      }
    });

    db.run(`ALTER TABLE sites ADD COLUMN domain_last_checked_at TEXT`, (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error('Error adding domain_last_checked_at to sites:', err);
      }
    });

    // Try to add site_id for older DBs where it doesn't exist yet
    db.run(`ALTER TABLE users ADD COLUMN site_id INTEGER`, (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error('Error adding site_id to users:', err);
      }
    });

    // Try to add new auth-related columns for older DBs
    db.run(`ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`, (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error('Error adding is_active to users:', err);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN reset_token TEXT`, (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error('Error adding reset_token to users:', err);
      }
    });

    db.run(`ALTER TABLE users ADD COLUMN reset_token_expires_at TEXT`, (err) => {
      if (err && !String(err.message).includes('duplicate column name')) {
        console.error('Error adding reset_token_expires_at to users:', err);
      }
    });

    // Auto-seed an admin user if none exists and INIT_ADMIN_* are set
    db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'", (err, row) => {
      if (err) {
        console.error('Error checking users count:', err);
        return;
      }

      if (row.count === 0) {
        const adminEmail = process.env.INIT_ADMIN_EMAIL;
        const adminPassword = process.env.INIT_ADMIN_PASSWORD;

        if (!adminEmail || !adminPassword) {
          console.warn(
            'No users in DB and INIT_ADMIN_EMAIL / INIT_ADMIN_PASSWORD not set. ' +
            'Set them in .env to auto-create the first admin user.'
          );
          return;
        }

        const passwordHash = bcrypt.hashSync(adminPassword, 10);
        const now = new Date().toISOString();

        db.run(
          `
            INSERT INTO users (email, password_hash, name, role, created_at)
            VALUES (?, ?, ?, ?, ?)
          `,
          [adminEmail.toLowerCase(), passwordHash, 'Admin', 'admin', now],
          (err2) => {
            if (err2) {
              console.error('Error inserting initial admin user:', err2);
            } else {
              console.log('Initial admin user created:', adminEmail);
            }
          }
        );
      }
    });

    // Seed a default site for localhost if table is empty
    db.get('SELECT COUNT(*) AS count FROM sites', (err, row) => {
      if (err) {
        console.error('Error checking sites count:', err);
        return;
      }

      if (row.count === 0) {
        console.log('Seeding default localhost site...');
        db.run(
          `
          INSERT INTO sites (
            domain,
            company_name,
            company_details,
            contact_phone,
            contact_email,
            address_line1,
            address_line2,
            city,
            state,
            zip,
            country,
            business_hours,
            logo_url,
            favicon_url,
            primary_color,
            secondary_color,
            dark_color,
            light_color, 
            domain_status, 
            domain_last_checked_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL)
        `,
          [
            'localhost',
            'Demo Company',
            'We provide high-quality demo services for testing SMS 10DLC compliance pages.',
            '+1 (555) 123-4567',
            'info@example.com',
            '123 Main St',
            '',
            'Sample City',
            'NY',
            '10001',
            'USA',
            'Mon–Thu 9:00–17:30, Fri 9:00–12:00',
            '/assets/logo.png',
            '/assets/favicon.png',
            '#1b1464',
            '#007dc5',
            '#282829',
            '#f1f2f2'
          ],
          (err2) => {
            if (err2) {
              console.error('Error seeding default site:', err2);
            } else {
              console.log('Default localhost site seeded.');
            }
          }
        );
      }
    });
  });
}

function mapRowToSite(row) {
  return {
    companyName: row.company_name,
    companyDetails: row.company_details,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.city,
      state: row.state,
      zip: row.zip,
      country: row.country
    },
    businessHours: row.business_hours,
    branding: {
      logoUrl: row.logo_url,
      faviconUrl: row.favicon_url,
      primaryColor: row.primary_color || '#1b1464',
      secondaryColor: row.secondary_color || '#007dc5',
      darkColor: row.dark_color || '#282829',
      lightColor: row.light_color || '#f1f2f2'
    }
  };
}

module.exports = {
  db,
  initDb,
  mapRowToSite
};
