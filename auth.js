// auth.js

// ---- Login-based admin/auth ----
function attachCurrentUser(req, res, next) {
  if (req.session && req.session.user) {
    res.locals.currentUser = req.session.user;
  } else {
    res.locals.currentUser = null;
  }
  next();
}

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function requireAdminSession(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).send('Forbidden');
  }
  next();
}

function requireAccountUser(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.redirect('/login');
  }

  const role = req.session.user.role;
  const siteId = req.session.user.site_id;

  if (role !== 'account_user' && role !== 'account_admin') {
    return res.status(403).send('Forbidden');
  }

  if (!siteId) {
    return res.status(400).send('User is not associated with a site.');
  }

  next();
}

// (Old token-based admin code kept here as a comment for reference)
// const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;
// function requireAdmin(req, res, next) { ... }

module.exports = {
  attachCurrentUser,
  requireLogin,
  requireAdminSession,
  requireAccountUser
};
