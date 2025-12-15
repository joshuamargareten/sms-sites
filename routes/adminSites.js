/**
 * routes/adminSites.js
 * Admin-only routes for:
 * - Sites CRUD
 * - Form submissions list
 * - Domain validation (DNS + HTTPS /health)
 * - Upload logo/favicon
 * - AI generate company_details (HTML fragment)
 */

const express = require('express');
const router = express.Router();

const { db } = require('../db');
const { requireAdminSession } = require('../auth');
const { upload } = require('../services/upload');
const { checkDnsCname, checkHttpsHealth, EXPECTED_CNAME_TARGET } = require('../services/domainValidation');
const { generateCompanyDetailsHTML } = require('../services/ai');
const { CNAME_URL } = require('../config/appConfig');

// ------------------------------
// Admin: list form submissions
// ------------------------------
router.get('/admin/forms', requireAdminSession, (req, res) => {
    const domainFilter = req.query.domain;

    let sql = `
    SELECT id, site_domain, name, email, phone, message, sms_consent, created_at
    FROM form_submissions
  `;
    const params = [];

    if (domainFilter) {
        sql += ' WHERE site_domain = ?';
        params.push(domainFilter.toLowerCase());
    }

    sql += ' ORDER BY datetime(created_at) DESC LIMIT 100';

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Error fetching form submissions:', err);
            return res.status(500).send('Error loading submissions.');
        }

        res.render('admin-forms', {
            pageTitle: 'Form Submissions',
            activePage: 'admin-forms',
            submissions: rows,
            domainFilter: domainFilter || '',
            query: req.query
        });
    });
});

// ------------------------------
// Admin: list sites
// ------------------------------
router.get('/admin/sites', requireAdminSession, (req, res) => {
    db.all(
        `
      SELECT id, domain, company_name, contact_email, contact_phone,
             primary_color, secondary_color, domain_status, domain_last_checked_at
      FROM sites
      ORDER BY domain ASC
    `,
        [],
        (err, rows) => {
            if (err) {
                console.error('Error fetching sites:', err);
                return res.status(500).send('Error loading sites.');
            }

            res.render('admin-sites-list', {
                pageTitle: 'Sites',
                activePage: 'admin-sites',
                sites: rows,
                query: req.query
            });
        }
    );
});

// ------------------------------
// Admin: new site (GET)
// ------------------------------
router.get('/admin/sites/new', requireAdminSession, (req, res) => {
    const emptySite = {
        id: null,
        domain: '',
        company_name: '',
        company_details: '',
        contact_phone: '',
        contact_email: '',
        address_line1: '',
        address_line2: '',
        city: '',
        state: '',
        zip: '',
        country: '',
        business_hours: '',
        logo_url: '/assets/logo.png',
        favicon_url: '/assets/favicon.png',
        primary_color: '#1b1464',
        secondary_color: '#007dc5',
        dark_color: '#282829',
        light_color: '#f1f2f2'
    };

    res.render('admin-site-form', {
        pageTitle: 'New Site',
        activePage: null,
        siteRecord: emptySite,
        query: req.query,
        isEdit: false,
        cnameUrl: CNAME_URL
    });
});

// ------------------------------
// Admin: new site (POST)
// ------------------------------
router.post('/admin/sites/new', requireAdminSession, (req, res) => {
    const body = req.body;

    const domain = (body.domain || '').trim().toLowerCase();
    if (!domain) return res.status(400).send('Domain is required.');

    const params = [
        domain,
        (body.company_name || '').trim(),
        (body.company_details || '').trim(),
        (body.contact_phone || '').trim(),
        (body.contact_email || '').trim(),
        (body.address_line1 || '').trim(),
        (body.address_line2 || '').trim(),
        (body.city || '').trim(),
        (body.state || '').trim(),
        (body.zip || '').trim(),
        (body.country || '').trim(),
        (body.business_hours || '').trim(),
        (body.logo_url || '').trim() || '/assets/logo.png',
        (body.favicon_url || '').trim() || '/assets/favicon.png',
        (body.primary_color || '').trim() || '#1b1464',
        (body.secondary_color || '').trim() || '#007dc5',
        (body.dark_color || '').trim() || '#282829',
        (body.light_color || '').trim() || '#f1f2f2',
        'pending',
        null
    ];

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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        params,
        function (err) {
            if (err) {
                console.error('Error inserting site:', err);
                return res.status(500).send('Error creating site.');
            }
            return res.redirect('/admin/sites/' + this.lastID + '/edit');
        }
    );
});

// ------------------------------
// Admin: edit site (GET)
// ------------------------------
router.get('/admin/sites/:id/edit', requireAdminSession, (req, res) => {
    const id = parseInt(req.params.id, 10);

    db.get('SELECT * FROM sites WHERE id = ?', [id], (err, row) => {
        if (err) {
            console.error('Error loading site:', err);
            return res.status(500).send('Error loading site.');
        }
        if (!row) return res.status(404).send('Site not found.');

        res.render('admin-site-form', {
            pageTitle: `Edit Site: ${row.domain}`,
            activePage: null,
            siteRecord: row,
            query: req.query,
            isEdit: true,
            cnameUrl: CNAME_URL
        });
    });
});

// ------------------------------
// Admin: edit site (POST)
// FIX: include logo_url + favicon_url params correctly (prevents corruption)
// ------------------------------
router.post('/admin/sites/:id/edit', requireAdminSession, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const body = req.body;

    const domain = (body.domain || '').trim().toLowerCase();
    if (!domain) return res.status(400).send('Domain is required.');

    const params = [
        domain,
        (body.company_name || '').trim(),
        (body.company_details || '').trim(),
        (body.contact_phone || '').trim(),
        (body.contact_email || '').trim(),
        (body.address_line1 || '').trim(),
        (body.address_line2 || '').trim(),
        (body.city || '').trim(),
        (body.state || '').trim(),
        (body.zip || '').trim(),
        (body.country || '').trim(),
        (body.business_hours || '').trim(),
        (body.logo_url || '').trim(),     // ✅ FIX
        (body.favicon_url || '').trim(),  // ✅ FIX
        (body.primary_color || '').trim() || '#1b1464',
        (body.secondary_color || '').trim() || '#007dc5',
        (body.dark_color || '').trim() || '#282829',
        (body.light_color || '').trim() || '#f1f2f2',
        id
    ];

    db.run(
        `
      UPDATE sites
      SET
        domain = ?,
        company_name = ?,
        company_details = ?,
        contact_phone = ?,
        contact_email = ?,
        address_line1 = ?,
        address_line2 = ?,
        city = ?,
        state = ?,
        zip = ?,
        country = ?,
        business_hours = ?,
        logo_url = ?,         -- ✅ FIX
        favicon_url = ?,      -- ✅ FIX
        primary_color = ?,
        secondary_color = ?,
        dark_color = ?,
        light_color = ?
      WHERE id = ?
    `,
        params,
        (err) => {
            if (err) {
                console.error('Error updating site:', err);
                return res.status(500).send('Error updating site.');
            }
            return res.redirect('/admin/sites/' + id + '/edit');
        }
    );
});

// ------------------------------
// Admin: delete site (POST)
// ------------------------------
router.post('/admin/sites/:id/delete', requireAdminSession, (req, res) => {
    const id = parseInt(req.params.id, 10);

    db.get('SELECT domain FROM sites WHERE id = ?', [id], (err, row) => {
        if (err) {
            console.error('Error reading site to delete:', err);
            return res.status(500).send('Error.');
        }
        if (!row) return res.status(404).send('Site not found.');
        if (row.domain === 'localhost') return res.status(400).send('Cannot delete localhost site.');

        db.run('DELETE FROM sites WHERE id = ?', [id], (delErr) => {
            if (delErr) {
                console.error('Error deleting site:', delErr);
                return res.status(500).send('Error deleting site.');
            }
            return res.redirect('/admin/sites');
        });
    });
});

// ------------------------------
// Admin: validate domain (DNS + HTTPS)
// ------------------------------
router.post('/admin/sites/:id/validate-domain', requireAdminSession, async (req, res) => {
    const id = parseInt(req.params.id, 10);

    db.get('SELECT * FROM sites WHERE id = ?', [id], async (err, site) => {
        if (err) {
            console.error('Error loading site for validation:', err);
            return res.status(500).send('Error loading site.');
        }
        if (!site) return res.status(404).send('Site not found.');

        const domain = (site.domain || '').trim().toLowerCase();
        if (!domain) return res.status(400).send('Site domain is empty.');

        // Always store check timestamp
        db.run('UPDATE sites SET domain_last_checked_at = ? WHERE id = ?', [new Date().toISOString(), id]);

        try {
            // 1) DNS check
            const dnsResult = await checkDnsCname(domain);

            if (!dnsResult.ok) {
                db.run('UPDATE sites SET domain_status = ? WHERE id = ?', ['dns_error', id], () => {
                    req.session.flash = {
                        type: 'error',
                        message: `DNS validation failed for ${domain}: ${dnsResult.detail} (expected: ${EXPECTED_CNAME_TARGET})`
                    };
                    return res.redirect('/admin/sites');
                });
                return;
            }

            // 2) HTTPS /health
            let httpsResult;
            try {
                httpsResult = await checkHttpsHealth(domain);
            } catch (httpsErr) {
                httpsResult = { ok: false, detail: httpsErr.message || 'HTTPS /health check failed' };
            }

            const newStatus = httpsResult.ok ? 'active' : 'dns_ok_ssl_error';

            db.run('UPDATE sites SET domain_status = ? WHERE id = ?', [newStatus, id], () => {
                req.session.flash = {
                    type: httpsResult.ok ? 'success' : 'warning',
                    message: httpsResult.ok
                        ? `Domain ${domain} is active.`
                        : `Domain ${domain} DNS is OK but HTTPS check had issues: ${httpsResult.detail}`
                };
                return res.redirect('/admin/sites');
            });
        } catch (e) {
            console.error('Unexpected error during domain validation:', e);

            db.run('UPDATE sites SET domain_status = ? WHERE id = ?', ['error_generic', id], () => {
                req.session.flash = {
                    type: 'error',
                    message: `Validation failed for ${domain}: ${e.message || 'Unknown validation error'}`
                };
                return res.redirect('/admin/sites');
            });
        }
    });
});

// ------------------------------
// Admin: upload logo
// ------------------------------
router.post(
    '/admin/sites/:id/upload-logo',
    requireAdminSession,
    upload.single('logo_file'),
    (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!req.file) return res.status(400).send('No file uploaded.');

        const publicPath = '/uploads/' + req.file.filename;

        db.run('UPDATE sites SET logo_url = ? WHERE id = ?', [publicPath, id], (err) => {
            if (err) {
                console.error('Error setting logo_url:', err);
                return res.status(500).send('Error updating logo.');
            }
            return res.redirect('/admin/sites/' + id + '/edit');
        });
    }
);

// ------------------------------
// Admin: upload favicon
// ------------------------------
router.post(
    '/admin/sites/:id/upload-favicon',
    requireAdminSession,
    upload.single('favicon_file'),
    (req, res) => {
        const id = parseInt(req.params.id, 10);
        if (!req.file) return res.status(400).send('No file uploaded.');

        const publicPath = '/uploads/' + req.file.filename;

        db.run('UPDATE sites SET favicon_url = ? WHERE id = ?', [publicPath, id], (err) => {
            if (err) {
                console.error('Error setting favicon_url:', err);
                return res.status(500).send('Error updating favicon.');
            }
            return res.redirect('/admin/sites/' + id + '/edit');
        });
    }
);

// ------------------------------
// Admin: AI generate company_details HTML
// ------------------------------
router.post('/admin/sites/generate-details', requireAdminSession, async (req, res) => {
    try {
        const { company_name, summary, industry, area, existing } = req.body || {};

        if (!company_name && !summary) {
            return res.status(400).json({ error: 'Please provide at least a company name or summary.' });
        }

        const html = await generateCompanyDetailsHTML({
            companyName: company_name,
            summary,
            industry,
            area,
            existing
        });

        return res.json({ html });
    } catch (err) {
        console.error('Error generating company details (admin):', err);

        if (err.code === 'AI_NOT_CONFIGURED') {
            return res.status(500).json({ error: 'AI is not configured on this server. Please set OPENAI_API_KEY.' });
        }

        return res.status(500).json({ error: 'Failed to generate description. Please try again.' });
    }
});

module.exports = router;
