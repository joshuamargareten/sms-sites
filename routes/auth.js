/**
 * Auth routes: login, logout, forgot/reset password
 */

const express = require('express');
const bcrypt = require('bcryptjs');

const router = express.Router();

const { db } = require('../db');
const { sendPasswordResetEmail, generateToken } = require('../mailer');

router.get('/login', (req, res) => {
    if (req.session && req.session.user) {
        // Fix: redirect based on role (admin -> admin, account -> portal)
        return req.session.user.role === 'admin'
            ? res.redirect('/admin/sites')
            : res.redirect('/portal');
    }
    res.render('login', { pageTitle: 'Login', activePage: null, error: null });
});

router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.render('login', {
            pageTitle: 'Login',
            activePage: null,
            error: 'Email and password are required.'
        });
    }

    const normalizedEmail = email.trim().toLowerCase();

    db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail], (err, user) => {
        if (err) {
            console.error('Error reading user for login:', err);
            return res.status(500).send('Internal error.');
        }

        if (!user) {
            return res.render('login', { pageTitle: 'Login', activePage: null, error: 'Invalid email or password.' });
        }

        if (user.is_active === 0) {
            return res.render('login', {
                pageTitle: 'Login',
                activePage: null,
                error:
                    'Your account is not active yet. Please use the link in your invitation email or request a new password reset.'
            });
        }

        const passwordOk = user.password_hash ? bcrypt.compareSync(password, user.password_hash) : false;

        if (!passwordOk) {
            return res.render('login', { pageTitle: 'Login', activePage: null, error: 'Invalid email or password.' });
        }

        req.session.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            site_id: user.site_id || null
        };

        return user.role === 'admin' ? res.redirect('/admin/sites') : res.redirect('/portal');
    });
});

router.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { pageTitle: 'Forgot Password', activePage: null, error: null, info: null });
});

router.post('/forgot-password', (req, res) => {
    const { email } = req.body;
    const genericInfo = 'If an account exists with that email address, a reset link will be sent shortly.';

    if (!email) {
        return res.render('forgot-password', {
            pageTitle: 'Forgot Password',
            activePage: null,
            error: 'Please enter your email address.',
            info: null
        });
    }

    const normalizedEmail = email.trim().toLowerCase();

    db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail], (err, user) => {
        if (err || !user) {
            if (err) console.error('Error looking up user for password reset:', err);
            return res.render('forgot-password', { pageTitle: 'Forgot Password', activePage: null, error: null, info: genericInfo });
        }

        const token = generateToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        db.run(
            'UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?',
            [token, expiresAt, user.id],
            (updateErr) => {
                if (updateErr) {
                    console.error('Error saving reset token:', updateErr);
                    return res.render('forgot-password', {
                        pageTitle: 'Forgot Password',
                        activePage: null,
                        error: null,
                        info: genericInfo
                    });
                }

                if (user.site_id) {
                    db.get('SELECT * FROM sites WHERE id = ?', [user.site_id], (siteErr, siteRow) => {
                        if (siteErr) {
                            console.error('Error loading site for reset email:', siteErr);
                            sendPasswordResetEmail({ user, site: null, token });
                        } else {
                            sendPasswordResetEmail({ user, site: siteRow || null, token });
                        }
                    });
                } else {
                    sendPasswordResetEmail({ user, site: null, token });
                }

                return res.render('forgot-password', { pageTitle: 'Forgot Password', activePage: null, error: null, info: genericInfo });
            }
        );
    });
});

router.get('/reset-password', (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(400).send('Invalid reset link.');

    db.get('SELECT * FROM users WHERE reset_token = ?', [token], (err, user) => {
        if (err) {
            console.error('Error loading user for reset:', err);
            return res.status(500).send('Internal error.');
        }
        if (!user) return res.status(400).send('Invalid or expired reset link.');

        if (!user.reset_token_expires_at || new Date(user.reset_token_expires_at) < new Date()) {
            return res.status(400).send('This reset link has expired. Please request a new one.');
        }

        res.render('reset-password', { pageTitle: 'Reset Password', activePage: null, token, error: null });
    });
});

router.post('/reset-password', (req, res) => {
    const { token, password, password_confirm } = req.body;
    if (!token) return res.status(400).send('Invalid reset request.');

    if (!password || !password_confirm || password !== password_confirm) {
        return res.render('reset-password', {
            pageTitle: 'Reset Password',
            activePage: null,
            token,
            error: 'Passwords do not match or are missing.'
        });
    }

    db.get('SELECT * FROM users WHERE reset_token = ?', [token], (err, user) => {
        if (err) {
            console.error('Error loading user for reset POST:', err);
            return res.status(500).send('Internal error.');
        }
        if (!user) return res.status(400).send('Invalid or expired reset link.');

        if (!user.reset_token_expires_at || new Date(user.reset_token_expires_at) < new Date()) {
            return res.status(400).send('This reset link has expired. Please request a new one.');
        }

        const passwordHash = bcrypt.hashSync(password, 10);

        db.run(
            `
        UPDATE users
        SET password_hash = ?, is_active = 1, reset_token = NULL, reset_token_expires_at = NULL
        WHERE id = ?
      `,
            [passwordHash, user.id],
            (updateErr) => {
                if (updateErr) {
                    console.error('Error updating password on reset:', updateErr);
                    return res.status(500).send('Could not reset password.');
                }

                return res.render('reset-password-success', { pageTitle: 'Password Reset', activePage: null });
            }
        );
    });
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
