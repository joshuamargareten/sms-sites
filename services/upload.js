/**
 * Multer upload config
 * - Saves in /public/uploads
 * - Filename: site-<id>-logo.ext / site-<id>-favicon.ext
 * - Limit 2MB
 */

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const siteId = req.params.id || 'general';
        const type = file.fieldname === 'logo_file' ? 'logo' : 'favicon';
        cb(null, `site-${siteId}-${type}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.png', '.jpg', '.jpeg', '.ico', '.svg'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowed.includes(ext)) return cb(new Error('Only image files are allowed.'));
        cb(null, true);
    }
});

module.exports = { upload };
