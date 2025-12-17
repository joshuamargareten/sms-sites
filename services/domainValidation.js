/**
 * Domain validation:
 * 1) DNS: CNAME -> expected OR A/AAAA matches expected A/AAAA (apex flattening)
 * 2) HTTPS: GET https://domain/health must return 200 and prove it's our app
 */

const dns = require('dns').promises;
const https = require('https');
const { CNAME_URL } = require('../config/appConfig');

const EXPECTED_CNAME_TARGET = String(CNAME_URL || '').trim().replace(/\.$/, '').toLowerCase();
const HEALTH_SIGNATURE_HEADER = 'x-sms-sites'; // from /health

function normHost(h) {
    return String(h || '').trim().toLowerCase().replace(/\.$/, '');
}

async function resolveCnames(host) {
    try {
        const cn = await dns.resolveCname(host);
        return (cn || []).map(normHost);
    } catch (e) {
        // No CNAME is normal for apex domains (and for Cloudflare flattening).
        return [];
    }
}

async function resolveIps(host) {
    const ips = new Set();

    try {
        (await dns.resolve4(host)).forEach(ip => ips.add(ip));
    } catch { }

    try {
        (await dns.resolve6(host)).forEach(ip => ips.add(ip));
    } catch { }

    return [...ips];
}

/**
 * DNS check:
 * - If CNAME exists => must match expected target
 * - Else (apex/flattening) => compare A/AAAA with expected target's A/AAAA
 *
 * NOTE: If user is using Cloudflare PROXY (orange cloud), A/AAAA will be Cloudflare IPs,
 *       and this comparison will fail. That’s OK: HTTPS check will still validate the domain.
 */
async function checkDnsTarget(domain) {
    const host = normHost(domain);
    if (!host) return { ok: false, detail: 'Empty domain' };

    // 1) CNAME
    const cnames = await resolveCnames(host);
    if (cnames.length) {
        const ok = cnames.some(c => c === EXPECTED_CNAME_TARGET);
        return ok
            ? { ok: true, method: 'cname', detail: `CNAME OK → ${cnames.join(', ')}` }
            : {
                ok: false,
                method: 'cname',
                detail: `CNAME points to [${cnames.join(', ')}], expected ${EXPECTED_CNAME_TARGET}`
            };
    }

    // 2) A/AAAA fallback (apex / ALIAS / ANAME / flattening)
    const hostIps = await resolveIps(host);
    if (!hostIps.length) {
        return { ok: false, method: 'a/aaaa', detail: `No A/AAAA records found for ${host}` };
    }

    const expectedIps = await resolveIps(EXPECTED_CNAME_TARGET);
    if (!expectedIps.length) {
        return {
            ok: false,
            method: 'a/aaaa',
            detail: `Expected target ${EXPECTED_CNAME_TARGET} has no A/AAAA records (cannot compare)`
        };
    }

    const match = hostIps.some(ip => expectedIps.includes(ip));
    return match
        ? { ok: true, method: 'a/aaaa', detail: `A/AAAA OK → ${hostIps.join(', ')}` }
        : {
            ok: false,
            method: 'a/aaaa',
            detail: `A/AAAA was [${hostIps.join(', ')}], expected one of [${expectedIps.join(', ')}] (Cloudflare proxy can cause this)`
        };
}

/**
 * HTTPS check:
 * - Requires 200 from /health
 * - Strongly recommended: require header X-Sms-Sites: 1 (or body === 'OK') to prove it's our app
 * - Adds SNI (servername) explicitly
 * - Optional small retry to allow cert provisioning/on-demand TLS
 */
function checkHttpsHealth(domain, { retries = 2, retryDelayMs = 1500 } = {}) {
    const host = String(domain || '').trim();
    if (!host) return Promise.resolve({ ok: false, detail: 'Empty domain' });

    const attemptOnce = () =>
        new Promise((resolve) => {
            const req = https.request(
                {
                    host,
                    port: 443,
                    path: '/health',
                    method: 'GET',
                    timeout: 8000,
                    servername: host, // SNI
                    headers: {
                        'User-Agent': 'sms-sites-domain-validator/1.0',
                        'Accept': 'text/plain,*/*'
                    }
                },
                (res) => {
                    const { statusCode, headers } = res;

                    let body = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk) => {
                        body += chunk;
                        if (body.length > 64) body = body.slice(0, 64); // we only need tiny proof
                    });

                    res.on('end', () => {
                        const sigHeader = String(headers[HEALTH_SIGNATURE_HEADER] || '').trim();
                        const bodyTrim = String(body || '').trim();

                        const isOurApp =
                            sigHeader === '1' || bodyTrim === 'OK'; // either one (header preferred)

                        if (statusCode === 200 && isOurApp) {
                            return resolve({ ok: true, detail: 'HTTPS /health returned 200 (validated)' });
                        }

                        if (statusCode === 200 && !isOurApp) {
                            return resolve({
                                ok: false,
                                detail: `HTTPS /health returned 200 but did not match signature (missing ${HEALTH_SIGNATURE_HEADER}: 1)`
                            });
                        }

                        return resolve({ ok: false, detail: `HTTPS /health returned status ${statusCode}` });
                    });

                    res.resume();
                }
            );

            req.on('error', (err) => {
                resolve({ ok: false, detail: `HTTPS error: ${err.code || ''} ${err.message || String(err)}` });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve({ ok: false, detail: 'HTTPS timeout when calling /health' });
            });

            req.end();
        });

    return (async () => {
        let last;
        for (let i = 0; i <= retries; i++) {
            last = await attemptOnce();
            if (last.ok) return last;
            if (i < retries) await new Promise(r => setTimeout(r, retryDelayMs));
        }
        return last;
    })();
}

module.exports = {
    checkDnsTarget,
    checkHttpsHealth,
    EXPECTED_CNAME_TARGET
};
