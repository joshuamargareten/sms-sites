/**
 * Centralized config values (env + defaults).
 * Keep defaults identical to your current behavior.
 */

module.exports = {
    PORT: process.env.PORT || 3000,
    SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret-change-me',
    CNAME_URL: process.env.CNAME_URL || 'localhost',
    OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-4.1-mini'
};
