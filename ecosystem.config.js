const path = require('path');

module.exports = {
    apps: [
        {
            name: 'sms-sites',
            script: path.join(__dirname, 'server.js'),
            cwd: __dirname,

            // SQLite + local file session stores are NOT safe with multi-process clustering.
            exec_mode: 'fork',
            instances: 1,

            autorestart: true,
            max_memory_restart: '300M',

            // Keep env minimal; secrets stay in .env (loaded by dotenv in server.js)
            env: {
                NODE_ENV: 'production',
                PORT: 3000
            },

            // Nice-to-have logging consistency
            merge_logs: true,
            time: true
            // optional:
            // out_file: '/home/ubuntu/.pm2/logs/sms-sites-out.log',
            // error_file: '/home/ubuntu/.pm2/logs/sms-sites-error.log',
        }
    ]
};