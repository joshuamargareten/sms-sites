/**
 * Loads a "site" record based on req.hostname into res.locals.site
 * Falls back to localhost if a domain isn't configured.
 */

const { db, mapRowToSite } = require('../db');

module.exports = function siteResolverMiddleware(req, res, next) {
    const requestHost = (req.hostname || '').toLowerCase();
    const lookupHost = res.locals.normalizeHost(requestHost);

    // Keep both available if you ever need them in templates/logs
    res.locals.requestHost = requestHost; // e.g. "www.customer.com"
    res.locals.lookupHost = lookupHost;   // e.g. "customer.com"

    db.get('SELECT * FROM sites WHERE domain = ?', [lookupHost], (err, row) => {
        if (err) {
            console.error('DB error loading site:', err);
            return next(err);
        }

        if (!row) {
            // Fallback to localhost
            db.get('SELECT * FROM sites WHERE domain = ?', ['localhost'], (err2, fallbackRow) => {
                if (err2) {
                    console.error('DB error loading fallback site:', err2);
                    return next(err2);
                }
                if (!fallbackRow) return res.status(404).send('No site configured yet.');
                res.locals.site = mapRowToSite(fallbackRow);
                return next();
            });
            return;
        }

        res.locals.site = mapRowToSite(row);
        return next();
    });
};
