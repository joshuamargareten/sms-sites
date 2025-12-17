/**
 * Public site routes (landing pages).
 */

const express = require('express');
const router = express.Router();

const { db } = require('../db');
const { sendContactEmail } = require('../mailer');

router.get('/', (req, res) => res.render('home', { pageTitle: 'Home', activePage: 'home' }));

router.get('/privacy-policy', (req, res) =>
    res.render('privacy-policy', { pageTitle: 'Privacy Policy', activePage: 'privacy' })
);

router.get('/sms-terms', (req, res) =>
    res.render('sms-terms', { pageTitle: 'SMS Terms & Conditions', activePage: 'sms-terms' })
);

router.get('/contact', (req, res) =>
    res.render('contact', { pageTitle: 'Contact Us', activePage: 'contact' })
);

router.post('/contact', (req, res) => {
    const { name, email, phone, message, sms_consent, consent_contact } = req.body;
    const site = res.locals.site;
    const host = res.locals.lookupHost || req.hostname.toLowerCase();

    const consentFlag = sms_consent === 'yes' ? 1 : 0;
    const contactConsent = consent_contact === 'yes' ? 1 : 0;
    const createdAt = new Date().toISOString();

    const formData = {
        site_domain: host,
        name: name && name.trim(),
        email: email && email.trim(),
        phone: phone && phone.trim(),
        message: message && message.trim(),
        sms_consent: consentFlag,
        contact_consent: contactConsent,
        created_at: createdAt
    };

    if (!formData.name || !formData.email || !formData.message) {
        return res.status(400).send('Name, email, and message are required.');
    }

    const sql = `
    INSERT INTO form_submissions (
      site_domain,
      name,
      email,
      phone,
      message,
      sms_consent,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

    const params = [
        formData.site_domain,
        formData.name,
        formData.email,
        formData.phone,
        formData.message,
        formData.sms_consent,
        formData.created_at
    ];

    db.run(sql, params, function (err) {
        if (err) {
            console.error('Error inserting form submission:', err);
            return res
                .status(500)
                .send('Could not submit the form at this time. Please try again later.');
        }

        try {
            sendContactEmail({ site, form: formData });
        } catch (emailErr) {
            console.error('Unexpected error when sending contact email:', emailErr);
        }

        return res.render('thank-you', {
            name: formData.name,
            pageTitle: 'Thank You',
            activePage: 'contact'
        });
    });
});

router.get('/health', (req, res) => {
  res.set('X-Sms-Sites', '1');
  res.type('text').send('OK');
});

module.exports = router;
