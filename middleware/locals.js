/**
 * res.locals helpers:
 * - Phone formatting helpers used in EJS
 * - Flash support (req.session.flash)
 */

function normalizeUsPhone(raw) {
    if (!raw) return null;
    let digits = String(raw).replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    if (digits.length !== 10) return null;
    return digits;
}

function formatPhoneE164(raw) {
    const digits = normalizeUsPhone(raw);
    if (!digits) return null;
    return '+1' + digits;
}

function formatPhoneNational(raw) {
    const digits = normalizeUsPhone(raw);
    if (!digits) return raw;
    const area = digits.slice(0, 3);
    const prefix = digits.slice(3, 6);
    const line = digits.slice(6);
    return `(${area}) ${prefix}-${line}`;
}

// ------------------------------
// Host/domain normalization
// - lowercases
// - strips port (just in case)
// - strips trailing dot
// - strips leading "www."
// ------------------------------
function normalizeHost(rawHost) {
  if (!rawHost) return '';
  let host = String(rawHost).trim().toLowerCase();

  // strip port if present (rare with req.hostname, but safe)
  host = host.split(':')[0];

  // strip trailing dot (some DNS setups)
  host = host.replace(/\.$/, '');

  // ignore leading www.
  host = host.replace(/^www\./, '');

  return host;
}

module.exports = function localsMiddleware(req, res, next) {
    res.locals.formatPhoneE164 = formatPhoneE164;
    res.locals.formatPhoneNational = formatPhoneNational;
    res.locals.normalizeHost = normalizeHost;
    
    // Flash: expose once then clear
    res.locals.flash = req.session && req.session.flash ? req.session.flash : null;
    if (req.session && req.session.flash) delete req.session.flash;

    next();
};
