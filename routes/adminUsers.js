/**
 * routes/adminUsers.js
 * Admin-only routes for:
 * - Account users (customers)
 * - Reseller users (Teklink staff) = role 'admin'
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const router = express.Router();

const { db } = require('../db');
const { generateToken, sendUserInviteEmail } = require('../mailer');
const { requireAdminSession } = require('../auth');

// ------------------------------
// Admin: list account users
// ------------------------------
router.get('/admin/account-users', requireAdminSession, (req, res) => {
    const domainFilter = req.query.domain;

    let sql = `
    SELECT
      u.id,
      u.email,
      u.name,
      u.role,
      u.created_at,
      u.site_id,
      s.domain AS site_domain
    FROM users u
    LEFT JOIN sites s ON u.site_id = s.id
    WHERE u.role != 'admin'
  `;
    const params = [];

    if (domainFilter) {
        sql += ' AND s.domain = ?';
        params.push(domainFilter.toLowerCase());
    }

    sql += ' ORDER BY datetime(u.created_at) DESC';

    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('Error fetching account users:', err);
            return res.status(500).send('Error loading users.');
        }

        res.render('admin-account-users-list', {
            pageTitle: 'Account Users',
            activePage: 'admin-users',
            users: rows,
            domainFilter: domainFilter || ''
        });
    });
});

// ------------------------------
// Admin: new account user (GET)
// ------------------------------
router.get('/admin/account-users/new', requireAdminSession, (req, res) => {
    db.all('SELECT id, domain FROM sites ORDER BY domain ASC', [], (err, sites) => {
        if (err) {
            console.error('Error loading sites for user form:', err);
            return res.status(500).send('Error loading sites.');
        }

        const emptyUser = {
            id: null,
            email: '',
            name: '',
            role: 'account_user',
            site_id: null
        };

        res.render('admin-account-user-form', {
            pageTitle: 'New Account User',
            activePage: 'admin-users',
            userRecord: emptyUser,
            sites,
            isEdit: false,
            error: null
        });
    });
});

// ------------------------------
// Admin: new account user (POST)
// ------------------------------
router.post('/admin/account-users/new', requireAdminSession, (req, res) => {
    const { email, name, password, role, site_id } = req.body;

    if (!email) return res.status(400).send('Email is required.');

    const normalizedEmail = email.trim().toLowerCase();
    const now = new Date().toISOString();
    const roleValue = (role || 'account_user').trim() || 'account_user';
    const siteIdValue = site_id ? parseInt(site_id, 10) : null;

    const hasPassword = password && password.trim().length > 0;
    const basePassword = hasPassword ? password.trim() : crypto.randomBytes(16).toString('hex');
    const passwordHash = bcrypt.hashSync(basePassword, 10);

    // If password is not provided, user starts inactive until they set it via invite link.
    const isActive = hasPassword ? 1 : 0;

    const resetToken = generateToken();
    const resetTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.run(
        `
      INSERT INTO users (email, password_hash, name, role, created_at, site_id, is_active, reset_token, reset_token_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        [
            normalizedEmail,
            passwordHash,
            name || null,
            roleValue,
            now,
            siteIdValue,
            isActive,
            resetToken,
            resetTokenExpiresAt
        ],
        function (err) {
            if (err) {
                console.error('Error creating account user:', err);

                const isDuplicate =
                    err.code === 'SQLITE_CONSTRAINT' &&
                    err.message &&
                    err.message.includes('UNIQUE constraint failed: users.email');

                const errorMsg = isDuplicate
                    ? 'A user with this email address already exists.'
                    : 'Error creating user. Please try again.';

                return db.all('SELECT id, domain FROM sites ORDER BY domain ASC', [], (err2, sites) => {
                    if (err2) {
                        console.error('Error loading sites for user form after failure:', err2);
                        return res.status(500).send(errorMsg);
                    }

                    const userRecord = {
                        id: null,
                        email: email || '',
                        name: name || '',
                        role: roleValue,
                        site_id: siteIdValue
                    };

                    res.render('admin-account-user-form', {
                        pageTitle: 'New Account User',
                        activePage: 'admin-users',
                        userRecord,
                        sites,
                        isEdit: false,
                        error: errorMsg
                    });
                });
            }

            const newUser = {
                id: this.lastID,
                email: normalizedEmail,
                name: name || '',
                role: roleValue
            };

            // Invite email (branded by site if possible)
            if (siteIdValue) {
                db.get('SELECT * FROM sites WHERE id = ?', [siteIdValue], (siteErr, siteRow) => {
                    if (siteErr) {
                        console.error('Error loading site for account user invite:', siteErr);
                        sendUserInviteEmail({ user: newUser, site: null, token: resetToken, isReseller: false });
                    } else {
                        sendUserInviteEmail({
                            user: newUser,
                            site: siteRow || null,
                            token: resetToken,
                            isReseller: false
                        });
                    }
                });
            } else {
                sendUserInviteEmail({ user: newUser, site: null, token: resetToken, isReseller: false });
            }

            return res.redirect('/admin/account-users');
        }
    );
});

// ------------------------------
// Admin: edit account user (GET)
// ------------------------------
router.get('/admin/account-users/:id/edit', requireAdminSession, (req, res) => {
    const id = parseInt(req.params.id, 10);

    db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
        if (err) {
            console.error('Error loading user:', err);
            return res.status(500).send('Error loading user.');
        }
        if (!user) return res.status(404).send('User not found.');
        if (user.role === 'admin') return res.status(400).send('Cannot edit admin via this screen.');

        db.all('SELECT id, domain FROM sites ORDER BY domain ASC', [], (err2, sites) => {
            if (err2) {
                console.error('Error loading sites for user form:', err2);
                return res.status(500).send('Error loading sites.');
            }

            res.render('admin-account-user-form', {
                pageTitle: 'Edit Account User',
                activePage: 'admin-users',
                userRecord: user,
                sites,
                isEdit: true,
                error: null
            });
        });
    });
});

// ------------------------------
// Admin: edit account user (POST)
// ------------------------------
router.post('/admin/account-users/:id/edit', requireAdminSession, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { email, name, password, role, site_id } = req.body;

    if (!email) return res.status(400).send('Email is required.');

    const normalizedEmail = email.trim().toLowerCase();
    const roleValue = (role || 'account_user').trim() || 'account_user';
    const siteIdValue = site_id ? parseInt(site_id, 10) : null;

    db.get('SELECT * FROM users WHERE id = ?', [id], (err, existing) => {
        if (err) {
            console.error('Error loading user for update:', err);
            return res.status(500).send('Error loading user.');
        }
        if (!existing) return res.status(404).send('User not found.');
        if (existing.role === 'admin') return res.status(400).send('Cannot edit admin via this screen.');

        let sql;
        let params;

        if (password && password.trim().length > 0) {
            const passwordHash = bcrypt.hashSync(password, 10);
            sql = `
        UPDATE users
        SET email = ?, name = ?, role = ?, site_id = ?, password_hash = ?
        WHERE id = ?
      `;
            params = [normalizedEmail, name || null, roleValue, siteIdValue, passwordHash, id];
        } else {
            sql = `
        UPDATE users
        SET email = ?, name = ?, role = ?, site_id = ?
        WHERE id = ?
      `;
            params = [normalizedEmail, name || null, roleValue, siteIdValue, id];
        }

        db.run(sql, params, (updateErr) => {
            if (updateErr) {
                console.error('Error updating user:', updateErr);
                return res.status(500).send('Error updating user.');
            }
            return res.redirect('/admin/account-users');
        });
    });
});

// ------------------------------
// Admin: delete account user
// ------------------------------
router.post('/admin/account-users/:id/delete', requireAdminSession, (req, res) => {
    const id = parseInt(req.params.id, 10);

    db.get('SELECT role FROM users WHERE id = ?', [id], (err, user) => {
        if (err) {
            console.error('Error checking user for delete:', err);
            return res.status(500).send('Error.');
        }
        if (!user) return res.status(404).send('User not found.');
        if (user.role === 'admin') return res.status(400).send('Cannot delete admin via this screen.');

        db.run('DELETE FROM users WHERE id = ?', [id], (delErr) => {
            if (delErr) {
                console.error('Error deleting user:', delErr);
                return res.status(500).send('Error deleting user.');
            }
            return res.redirect('/admin/account-users');
        });
    });
});

// ------------------------------
// Admin: list reseller users (role='admin')
// ------------------------------
router.get('/admin/reseller-users', requireAdminSession, (req, res) => {
    db.all(
        `
      SELECT id, email, name, role, created_at
      FROM users
      WHERE role = 'admin'
      ORDER BY datetime(created_at) DESC
    `,
        [],
        (err, rows) => {
            if (err) {
                console.error('Error fetching reseller users:', err);
                return res.status(500).send('Error loading reseller users.');
            }

            res.render('admin-reseller-users-list', {
                pageTitle: 'Reseller Users',
                activePage: 'admin-resellers',
                users: rows
            });
        }
    );
});

// ------------------------------
// Admin: new reseller user (GET)
// ------------------------------
router.get('/admin/reseller-users/new', requireAdminSession, (req, res) => {
    const emptyUser = { id: null, email: '', name: '', role: 'admin' };

    res.render('admin-reseller-user-form', {
        pageTitle: 'New Reseller User',
        activePage: 'admin-resellers',
        userRecord: emptyUser,
        isEdit: false,
        error: null
    });
});

// ------------------------------
// Admin: new reseller user (POST)
// ------------------------------
router.post('/admin/reseller-users/new', requireAdminSession, (req, res) => {
    const { email, name, password } = req.body;

    if (!email) {
        return res.render('admin-reseller-user-form', {
            pageTitle: 'New Reseller User',
            activePage: 'admin-resellers',
            userRecord: { id: null, email: email || '', name: name || '', role: 'admin' },
            isEdit: false,
            error: 'Email is required.'
        });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const now = new Date().toISOString();

    const hasPassword = password && password.trim().length > 0;
    const basePassword = hasPassword ? password.trim() : crypto.randomBytes(16).toString('hex');
    const passwordHash = bcrypt.hashSync(basePassword, 10);

    const isActive = hasPassword ? 1 : 0;
    const resetToken = generateToken();
    const resetTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.run(
        `
      INSERT INTO users (email, password_hash, name, role, created_at, site_id, is_active, reset_token, reset_token_expires_at)
      VALUES (?, ?, ?, 'admin', ?, NULL, ?, ?, ?)
    `,
        [normalizedEmail, passwordHash, name || null, now, isActive, resetToken, resetTokenExpiresAt],
        (err) => {
            if (err) {
                console.error('Error creating reseller user:', err);

                const isDuplicate =
                    err.code === 'SQLITE_CONSTRAINT' &&
                    err.message &&
                    err.message.includes('UNIQUE constraint failed: users.email');

                const errorMsg = isDuplicate
                    ? 'A user with this email address already exists.'
                    : 'Error creating user. Please try again.';

                return res.render('admin-reseller-user-form', {
                    pageTitle: 'New Reseller User',
                    activePage: 'admin-resellers',
                    userRecord: { id: null, email: email || '', name: name || '', role: 'admin' },
                    isEdit: false,
                    error: errorMsg
                });
            }

            // Reseller invite (no site branding)
            const newUser = { email: normalizedEmail, name: name || '', role: 'admin' };
            sendUserInviteEmail({ user: newUser, site: null, token: resetToken, isReseller: true });

            return res.redirect('/admin/reseller-users');
        }
    );
});

// ------------------------------
// Admin: edit reseller user (GET)
// ------------------------------
router.get('/admin/reseller-users/:id/edit', requireAdminSession, (req, res) => {
    const id = parseInt(req.params.id, 10);

    db.get("SELECT * FROM users WHERE id = ? AND role = 'admin'", [id], (err, user) => {
        if (err) {
            console.error('Error loading reseller user:', err);
            return res.status(500).send('Error loading user.');
        }
        if (!user) return res.status(404).send('Reseller user not found.');

        res.render('admin-reseller-user-form', {
            pageTitle: 'Edit Reseller User',
            activePage: 'admin-resellers',
            userRecord: user,
            isEdit: true,
            error: null
        });
    });
});

// ------------------------------
// Admin: edit reseller user (POST)
// ------------------------------
router.post('/admin/reseller-users/:id/edit', requireAdminSession, (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { email, name, password } = req.body;

    if (!email) return res.status(400).send('Email is required.');

    const normalizedEmail = email.trim().toLowerCase();

    db.get("SELECT * FROM users WHERE id = ? AND role = 'admin'", [id], (err, existing) => {
        if (err) {
            console.error('Error loading reseller user for update:', err);
            return res.status(500).send('Error loading user.');
        }
        if (!existing) return res.status(404).send('Reseller user not found.');

        const isSelf = req.session.user && req.session.user.id === existing.id;

        let sql;
        let params;

        if (password && password.trim().length > 0) {
            const passwordHash = bcrypt.hashSync(password, 10);
            sql = `
        UPDATE users
        SET email = ?, name = ?, password_hash = ?
        WHERE id = ?
      `;
            params = [normalizedEmail, name || null, passwordHash, id];
        } else {
            sql = `
        UPDATE users
        SET email = ?, name = ?
        WHERE id = ?
      `;
            params = [normalizedEmail, name || null, id];
        }

        db.run(sql, params, (updateErr) => {
            if (updateErr) {
                console.error('Error updating reseller user:', updateErr);
                return res.status(500).send('Error updating user.');
            }

            // If user edited themselves, keep session in sync
            if (isSelf) {
                req.session.user.email = normalizedEmail;
                req.session.user.name = name || null;
            }

            return res.redirect('/admin/reseller-users');
        });
    });
});

// ------------------------------
// Admin: delete reseller user
// ------------------------------
router.post('/admin/reseller-users/:id/delete', requireAdminSession, (req, res) => {
    const id = parseInt(req.params.id, 10);

    db.get("SELECT id, email FROM users WHERE id = ? AND role = 'admin'", [id], (err, user) => {
        if (err) {
            console.error('Error checking reseller user for delete:', err);
            return res.status(500).send('Error.');
        }
        if (!user) return res.status(404).send('Reseller user not found.');

        // Prevent deleting yourself
        if (req.session.user && req.session.user.id === user.id) {
            return res.status(400).send('You cannot delete your own admin account.');
        }

        db.run('DELETE FROM users WHERE id = ?', [id], (delErr) => {
            if (delErr) {
                console.error('Error deleting reseller user:', delErr);
                return res.status(500).send('Error deleting user.');
            }
            return res.redirect('/admin/reseller-users');
        });
    });
});

module.exports = router;
