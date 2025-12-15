/**
 * Domain validation:
 * 1) DNS CNAME must match expected target
 * 2) HTTPS GET https://domain/health must return 200
 */

const dns = require('dns').promises;
const https = require('https');
const { CNAME_URL } = require('../config/appConfig');

const EXPECTED_CNAME_TARGET = CNAME_URL;

async function checkDnsCname(domain) {
    const host = domain.trim().toLowerCase();

    try {
        const cnames = await dns.resolveCname(host);

        if (!cnames || cnames.length === 0) {
            return { ok: false, detail: `No CNAME records found for ${host}` };
        }

        const matches = cnames.some(
            (c) => c.replace(/\.$/, '').toLowerCase() === EXPECTED_CNAME_TARGET.toLowerCase()
        );

        if (!matches) {
            return {
                ok: false,
                detail: `CNAME points to [${cnames.join(', ')}], expected ${EXPECTED_CNAME_TARGET}`
            };
        }

        return { ok: true, detail: `CNAME OK → ${cnames.join(', ')}` };
    } catch (err) {
        return { ok: false, detail: `DNS error (${err.code || 'ERR'}): ${err.message}` };
    }
}

function checkHttpsHealth(domain) {
    const host = domain.trim();

    return new Promise((resolve, reject) => {
        const req = https.request(
            {
                host,
                port: 443,
                path: '/health',
                method: 'GET',
                timeout: 8000
            },
            (res) => {
                const { statusCode } = res;
                if (statusCode === 200) resolve({ ok: true, detail: `HTTPS /health returned 200` });
                else resolve({ ok: false, detail: `HTTPS /health returned status ${statusCode}` });
                res.resume();
            }
        );

        req.on('error', (err) => {
            reject(new Error(`HTTPS error: ${err.code || ''} ${err.message || err.toString()}`));
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('HTTPS timeout when calling /health'));
        });

        req.end();
    });
}

module.exports = {
    checkDnsCname,
    checkHttpsHealth,
    EXPECTED_CNAME_TARGET
};
