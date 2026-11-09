/**
 * Lightweight spam protection for public forms. No third-party services.
 *
 * 1. Honeypot  - a hidden field real visitors never see or fill in.
 * 2. Timing    - a signed render timestamp; forms submitted faster than a
 *                human could type, or from a page loaded too long ago, are rejected.
 * 3. Rate limit - caps submissions per IP per hour (in memory; the app runs as
 *                a single PM2 process, so one shared counter is enough).
 */

const crypto = require('crypto');
const { SESSION_SECRET } = require('../config/appConfig');

const HONEYPOT_FIELD = 'website';
const MIN_FILL_MS = 3 * 1000;               // faster than this = bot
const MAX_AGE_MS = 24 * 60 * 60 * 1000;     // page older than this = stale/replayed token
const RATE_LIMIT = 5;                       // submissions...
const RATE_WINDOW_MS = 60 * 60 * 1000;      // ...per IP per hour

function sign(ts) {
    return crypto.createHmac('sha256', SESSION_SECRET).update(`form:${ts}`).digest('hex').slice(0, 32);
}

/** Token to embed in the form when it is rendered. */
function createFormToken() {
    const ts = Date.now();
    return `${ts}.${sign(ts)}`;
}

function timingFailure(token) {
    if (typeof token !== 'string' || !token.includes('.')) return 'missing-token';
    const [tsStr, sig] = token.split('.');
    const ts = Number(tsStr);
    if (!Number.isFinite(ts)) return 'bad-token';

    const expected = sign(ts);
    if (!sig || sig.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return 'bad-signature';
    }

    const age = Date.now() - ts;
    if (age < MIN_FILL_MS) return 'too-fast';
    if (age > MAX_AGE_MS) return 'expired';
    return null;
}

/**
 * Checks honeypot + timing. Returns null if the submission looks human,
 * otherwise a short reason string (for logging only).
 */
function checkSubmission(body) {
    const honeypot = body[HONEYPOT_FIELD];
    if (typeof honeypot === 'string' && honeypot.trim() !== '') return 'honeypot';
    return timingFailure(body.form_token);
}

// ---- Rate limiting -------------------------------------------------------

const hits = new Map(); // ip -> array of timestamps

/** Records a submission for this IP; returns true if it is over the limit. */
function isRateLimited(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
    recent.push(now);
    hits.set(ip, recent);
    return recent.length > RATE_LIMIT;
}

// Drop stale entries so the map can't grow without bound.
setInterval(() => {
    const now = Date.now();
    for (const [ip, times] of hits) {
        const recent = times.filter((t) => now - t < RATE_WINDOW_MS);
        if (recent.length) hits.set(ip, recent);
        else hits.delete(ip);
    }
}, 10 * 60 * 1000).unref();

module.exports = {
    HONEYPOT_FIELD,
    createFormToken,
    checkSubmission,
    isRateLimited
};
