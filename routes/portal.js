/**
 * routes/portal.js
 * Account user portal routes:
 * - /portal (home)
 * - /portal/site (view/edit site) [account_admin can save]
 * - DNS/SSL validate
 * - upload logo/favicon
 * - AI generate description
 * - view form submissions for the site
 */

const express = require('express');
const router = express.Router();

const { db } = require('../db');
const { requireLogin, requireAccountUser } = require('../auth');
const { upload } = require('../services/upload');
const { checkDnsCname, checkHttpsHealth, EXPECTED_CNAME_TARGET } = require('../services/domainValidation');
const { generateCompanyDetailsHTML } = require('../services/ai');
const { CNAME_URL } = require('../config/appConfig');

// ------------------------------
// Portal home
// ------------------------------
router.get('/portal', requireLogin, (req, res) => {
    const user = req.session.user;

    // Admin -> bounce to admin sites
    if (user.role === 'admin') return res.redirect('/admin/sites');

    // No site attached -> show limited view
    if (!user.site_id) {
        return res.render('portal-home', {
            pageTitle: 'Portal',
            activePage: 'portal',
            siteInfo: null,
            canEdit: false
        });
    }

    db.get(
        'SELECT id, domain, company_name, domain_status, domain_last_checked_at FROM sites WHERE id = ?',
        [user.site_id],
        (err, row) => {
            if (err) {
                console.error('Error loading site for portal:', err);
                return res.status(500).send('Internal error');
            }

            return res.render('portal-home', {
                pageTitle: 'Portal',
                activePage: 'portal',
                siteInfo: row || null,
                canEdit: user.role === 'account_admin'
            });
        }
    );
});

// ------------------------------
// Portal: view/edit site settings
// ------------------------------
router.get('/portal/site', requireAccountUser, (req, res) => {
    const user = req.session.user;

    db.get('SELECT * FROM sites WHERE id = ?', [user.site_id], (err, row) => {
        if (err) {
            console.error('Error loading site for portal edit:', err);
            return res.status(500).send('Error loading site.');
        }
        if (!row) return res.status(404).send('Site not found.');

        return res.render('portal-site-form', {
            pageTitle: 'My Website Settings',
            activePage: 'portal',
            siteRecord: row,
            canEdit: user.role === 'account_admin',
            cnameUrl: CNAME_URL
        });
    });
});

// ------------------------------
// Portal: update site settings (account_admin only)
// FIX: preserve logo_url/favicon_url correctly (prevents overwriting)
// ------------------------------
router.post('/portal/site', requireAccountUser, (req, res) => {
    const user = req.session.user;

    if (user.role !== 'account_admin') {
        return res.status(403).send('Only account admins can update site settings.');
    }

    const body = req.body;
    const siteId = user.site_id;

    const companyName = (body.company_name || '').trim();
    const companyDetails = (body.company_details || '').trim();
    const contactPhone = (body.contact_phone || '').trim();
    const contactEmail = (body.contact_email || '').trim();

    if (!companyName || !companyDetails || !contactPhone || !contactEmail) {
        return res.status(400).send('Company name, details, contact phone, and contact email are required.');
    }

    // ✅ FIX: Portal form typically does not include logo_url/favicon_url inputs.
    // We read current values first so we NEVER clobber them with wrong params.
    db.get('SELECT logo_url, favicon_url FROM sites WHERE id = ?', [siteId], (loadErr, current) => {
        if (loadErr) {
            console.error('Error loading current logo/favicon before portal update:', loadErr);
            return res.status(500).send('Error updating site.');
        }

        const logoUrl = current ? current.logo_url : null;
        const faviconUrl = current ? current.favicon_url : null;

        const params = [
            companyName,
            companyDetails,
            contactPhone,
            contactEmail,
            (body.address_line1 || '').trim(),
            (body.address_line2 || '').trim(),
            (body.city || '').trim(),
            (body.state || '').trim(),
            (body.zip || '').trim(),
            (body.country || '').trim(),
            (body.business_hours || '').trim(),
            logoUrl,    // ✅ preserved
            faviconUrl, // ✅ preserved
            (body.primary_color || '').trim() || '#1b1464',
            (body.secondary_color || '').trim() || '#007dc5',
            (body.dark_color || '').trim() || '#282829',
            (body.light_color || '').trim() || '#f1f2f2',
            siteId
        ];

        db.run(
            `
        UPDATE sites
        SET
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
          logo_url = ?,
          favicon_url = ?,
          primary_color = ?,
          secondary_color = ?,
          dark_color = ?,
          light_color = ?
        WHERE id = ?
      `,
            params,
            (err) => {
                if (err) {
                    console.error('Error updating site from portal:', err);
                    return res.status(500).send('Error updating site.');
                }
                return res.redirect('/portal/site');
            }
        );
    });
});

// ------------------------------
// Portal: validate DNS for current account's site
// ------------------------------
router.post('/portal/sites/:id/validate-domain', requireAccountUser, async (req, res) => {
    const user = req.session.user;
    const siteId = parseInt(req.params.id, 10);

    if (!user.site_id || user.site_id !== siteId) {
        return res.status(403).send('You can only validate your own site.');
    }

    db.get('SELECT * FROM sites WHERE id = ?', [siteId], async (err, siteRow) => {
        if (err) {
            console.error('Error loading site for validation:', err);
            return res.status(500).send('Error loading site.');
        }
        if (!siteRow) return res.status(404).send('Site not found.');

        const domain = (siteRow.domain || '').trim().toLowerCase();
        if (!domain) return res.status(400).send('Site domain is empty.');

        db.run('UPDATE sites SET domain_last_checked_at = ? WHERE id = ?', [new Date().toISOString(), siteId]);

        try {
            const dnsResult = await checkDnsCname(domain);

            if (!dnsResult.ok) {
                db.run('UPDATE sites SET domain_status = ? WHERE id = ?', ['dns_error', siteId], () => {
                    req.session.flash = {
                        type: 'error',
                        message: `DNS validation failed for ${domain}: ${dnsResult.detail} (expected: ${EXPECTED_CNAME_TARGET})`
                    };
                    return res.redirect('/portal/site');
                });
                return;
            }

            let httpsResult;
            try {
                httpsResult = await checkHttpsHealth(domain);
            } catch (httpsErr) {
                httpsResult = { ok: false, detail: httpsErr.message || 'HTTPS /health check failed' };
            }

            const newStatus = httpsResult.ok ? 'active' : 'dns_ok_ssl_error';

            db.run('UPDATE sites SET domain_status = ? WHERE id = ?', [newStatus, siteId], () => {
                req.session.flash = {
                    type: httpsResult.ok ? 'success' : 'warning',
                    message: httpsResult.ok
                        ? `Domain ${domain} is active.`
                        : `Domain ${domain} DNS is OK but HTTPS check had issues: ${httpsResult.detail}`
                };
                return res.redirect('/portal/site');
            });
        } catch (e) {
            console.error('Unexpected error during domain validation:', e);

            db.run('UPDATE sites SET domain_status = ? WHERE id = ?', ['error_generic', siteId], () => {
                req.session.flash = {
                    type: 'error',
                    message: `Validation failed for ${domain}: ${e.message || 'Unknown validation error'}`
                };
                return res.redirect('/portal/site');
            });
        }
    });
});

// ------------------------------
// Portal: upload logo for current account's site
// ------------------------------
router.post(
    '/portal/sites/:id/upload-logo',
    requireAccountUser,
    upload.single('logo_file'),
    (req, res) => {
        const user = req.session.user;
        const siteId = parseInt(req.params.id, 10);

        if (!user.site_id || user.site_id !== siteId) {
            return res.status(403).send('You can only upload a logo for your own site.');
        }
        if (!req.file) return res.status(400).send('No file uploaded.');

        const logoUrl = '/uploads/' + req.file.filename;

        db.run('UPDATE sites SET logo_url = ? WHERE id = ?', [logoUrl, siteId], (err) => {
            if (err) {
                console.error('Error saving portal logo:', err);
                return res.status(500).send('Error saving logo.');
            }
            return res.redirect('/portal/site');
        });
    }
);

// ------------------------------
// Portal: upload favicon for current account's site
// ------------------------------
router.post(
    '/portal/sites/:id/upload-favicon',
    requireAccountUser,
    upload.single('favicon_file'),
    (req, res) => {
        const user = req.session.user;
        const siteId = parseInt(req.params.id, 10);

        if (!user.site_id || user.site_id !== siteId) {
            return res.status(403).send('You can only upload a favicon for your own site.');
        }
        if (!req.file) return res.status(400).send('No file uploaded.');

        const faviconUrl = '/uploads/' + req.file.filename;

        db.run('UPDATE sites SET favicon_url = ? WHERE id = ?', [faviconUrl, siteId], (err) => {
            if (err) {
                console.error('Error saving portal favicon:', err);
                return res.status(500).send('Error saving favicon.');
            }
            return res.redirect('/portal/site');
        });
    }
);

// ------------------------------
// Portal: AI generate company_details HTML for this site
// ------------------------------
router.post('/portal/site/generate-details', requireAccountUser, async (req, res) => {
    try {
        const user = req.session.user;
        if (!user.site_id) return res.status(400).json({ error: 'User is not associated with a site.' });

        const { company_name, summary, industry, area, existing } = req.body || {};

        // If company_name not provided, load it from DB
        let effectiveName = company_name;
        if (!effectiveName) {
            const row = await new Promise((resolve, reject) => {
                db.get('SELECT company_name FROM sites WHERE id = ?', [user.site_id], (err, r) => {
                    if (err) return reject(err);
                    resolve(r);
                });
            });
            effectiveName = row && row.company_name;
        }

        if (!effectiveName && !summary) {
            return res.status(400).json({ error: 'Please provide at least a company name or summary.' });
        }

        const html = await generateCompanyDetailsHTML({
            companyName: effectiveName,
            summary,
            industry,
            area,
            existing
        });

        return res.json({ html });
    } catch (err) {
        console.error('Error generating company details (portal):', err);

        if (err.code === 'AI_NOT_CONFIGURED') {
            return res.status(500).json({ error: 'AI is not configured on this server. Please set OPENAI_API_KEY.' });
        }

        return res.status(500).json({ error: 'Failed to generate description. Please try again.' });
    }
});

// ------------------------------
// Portal: view form submissions for this site
// ------------------------------
router.get('/portal/forms', requireAccountUser, (req, res) => {
    const user = req.session.user;

    db.get('SELECT domain, company_name FROM sites WHERE id = ?', [user.site_id], (err, siteRow) => {
        if (err) {
            console.error('Error loading site for portal forms:', err);
            return res.status(500).send('Error loading site.');
        }
        if (!siteRow) return res.status(404).send('Site not found.');

        const domain = siteRow.domain.toLowerCase();

        const sql = `
      SELECT id, site_domain, name, email, phone, message, sms_consent, created_at
      FROM form_submissions
      WHERE site_domain = ?
      ORDER BY datetime(created_at) DESC
      LIMIT 100
    `;

        db.all(sql, [domain], (err2, rows) => {
            if (err2) {
                console.error('Error fetching portal form submissions:', err2);
                return res.status(500).send('Error loading submissions.');
            }

            return res.render('portal-forms', {
                pageTitle: 'Contact Form Submissions',
                activePage: 'portal',
                submissions: rows,
                siteInfo: siteRow
            });
        });
    });
});

module.exports = router;
