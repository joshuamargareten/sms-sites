/**
 * routes/notFound.js
 * Keep your original behavior:
 * - Any GET that doesn't match -> render 404 page
 * - Any non-GET -> plain text 404
 * - Error handler -> 500
 */

const express = require('express');
const router = express.Router();

// 404 page for GET routes
router.get('*', (req, res) => {
    return res.render('404', { pageTitle: 'Page Not Found', activePage: null });
});

// 404 for everything else (POST/PUT/etc)
router.use((req, res) => {
    return res.status(404).send('Page not found');
});

// Error handler (basic)
router.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    return res.status(500).send('Internal server error');
});

module.exports = router;
