// mailer.js
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';

// ---- Email (SMTP) transport ----
const smtpPort = Number(process.env.SMTP_PORT || 587);
const mailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: smtpPort,
  secure: smtpPort === 465, // use TLS if 465
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

// Small helper so we don’t repeat this check everywhere
function isSmtpConfigured() {
  return Boolean(
    mailTransport.options &&
    mailTransport.options.auth &&
    mailTransport.options.auth.user &&
    mailTransport.options.auth.pass
  );
}

// Contact form email
function sendContactEmail({ site, form }) {
  const brandName =
    (site && (site.company_name || site.companyName)) || 'Website Contact';
  const fromAddress = process.env.FROM_EMAIL || (site && site.contactEmail) || '';
  const toEmail = site && site.contactEmail ? site.contactEmail : fromAddress;

  const subject = `New contact form submission – ${brandName}`;
  const smsText = form.sms_consent ? 'YES' : 'NO';
  const contactText = form.contact_consent ? 'YES' : 'NO';

  const textBody = [
    `You have received a new contact form submission for ${brandName}.`,
    '',
    `Name:   ${form.name}`,
    `Email:  ${form.email}`,
    `Phone:  ${form.phone || '(none provided)'}`,
    '',
    `Message:`,
    form.message,
    '',
    `SMS consent: ${smsText}`,
    '',
    `Contact consent: ${contactText}`,
    '',
    `Submitted at: ${form.created_at}`,
    `Site/domain: ${form.site_domain}`
  ].join('\n');

  const primaryColor =
    (site &&
      (site.primary_color ||
        (site.branding && site.branding.primaryColor))) ||
    '#1b1464';

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; font-size:14px; line-height:1.5; color:#111;">
      <div style="border-bottom:4px solid ${primaryColor}; padding-bottom:8px; margin-bottom:16px;">
        <h1 style="margin:0; font-size:18px; color:${primaryColor};">
          ${brandName} – New Contact Form Submission
        </h1>
      </div>

      <p>You have received a new contact form submission.</p>

      <table cellpadding="4" cellspacing="0" style="border-collapse:collapse; margin:10px 0 16px 0; font-size:13px;">
        <tr>
          <td style="font-weight:bold; padding-right:8px;">Name:</td>
          <td>${form.name || '(not provided)'}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding-right:8px;">Email:</td>
          <td>${form.email}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding-right:8px;">Phone:</td>
          <td>${form.phone || '(none provided)'}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding-right:8px; vertical-align:top;">Message:</td>
          <td style="white-space:pre-wrap;">${(form.message || '').replace(/\n/g, '<br>')}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding-right:8px;">SMS consent:</td>
          <td>${smsText}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding-right:8px;">Contact consent:</td>
          <td>${contactText}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding-right:8px;">Submitted at:</td>
          <td>${form.created_at}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; padding-right:8px;">Site/domain:</td>
          <td>${form.site_domain}</td>
        </tr>
      </table>

      <p style="font-size:12px; color:#666; margin-top:16px;">
        This notification was sent automatically from your SMS website contact form.
      </p>
    </div>
  `;

  const mailOptions = {
    from: fromAddress
      ? `"${brandName}" <${fromAddress}>`
      : undefined,
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody,
    replyTo: form.email
  };

  if (!isSmtpConfigured()) {
    console.warn('SMTP not configured (no SMTP_USER/SMTP_PASS). Skipping contact email send.');
    console.log('Would send email:\n', textBody);
    return;
  }

  mailTransport.sendMail(mailOptions, (err, info) => {
    if (err) {
      console.error('Error sending contact email:', err);
    } else {
      console.log('Contact email sent:', info.response || info);
    }
  });
}

// Invite email for account/reseller users
function sendUserInviteEmail({ user, site, token, isReseller }) {
  if (!isSmtpConfigured()) {
    console.warn('SMTP not configured. Skipping invite email.');
    console.log('Would send invite email to:', user.email, 'token:', token);
    return;
  }

  const brandName = site
    ? site.company_name || site.companyName || 'Your Company'
    : 'Teklink';

  const primaryColor =
    (site &&
      (site.primary_color ||
        (site.branding && site.branding.primaryColor))) ||
    '#1b1464';

  const loginUrl = `${APP_BASE_URL}/login`;
  const resetUrl = `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(
    token
  )}`;

  const subject = isReseller
    ? `You’ve been invited to the Teklink SMS Sites admin portal`
    : `You’ve been invited to access ${brandName}’s SMS website portal`;

  const html = `
    <div style="font-family: Arial, sans-serif; font-size:14px; line-height:1.5; color:#333;">
      <div style="border-bottom:4px solid ${primaryColor}; padding-bottom:8px; margin-bottom:16px;">
        <h1 style="margin:0; font-size:18px; color:${primaryColor};">
          ${brandName}
        </h1>
      </div>

      <p>Hi ${user.name || user.email},</p>

      <p>
        You’ve been given access to the
        ${isReseller
      ? 'Teklink SMS Sites admin portal'
      : 'SMS website portal for ' + brandName
    }.
      </p>

      <p>
        To activate your account and set your password, click the button below:
      </p>

      <p style="margin:16px 0;">
        <a href="${resetUrl}"
           style="background:${primaryColor}; color:#fff; text-decoration:none; padding:10px 16px; border-radius:4px; display:inline-block;">
          Set Your Password
        </a>
      </p>

      <p style="font-size:12px; color:#666;">
        This link is valid for 24 hours. If it expires, you can request a new link from the login page using
        "Forgot your password?" with the same email address.
      </p>

      <p>You can always log in at:</p>
      <p><a href="${loginUrl}">${loginUrl}</a></p>

      <p style="margin-top:24px; font-size:12px; color:#999;">
        If you did not expect this invitation, you can ignore this email.
      </p>
    </div>
  `;

  const fromAddress = process.env.FROM_EMAIL || mailTransport.options.auth.user;

  mailTransport.sendMail(
    {
      from: `"${brandName}" <${fromAddress}>`,
      to: user.email,
      subject,
      html
    },
    (err, info) => {
      if (err) {
        console.error('Error sending invite email:', err);
      } else {
        console.log('Invite email sent:', info.response || info);
      }
    }
  );
}

// Password reset email
function sendPasswordResetEmail({ user, site, token }) {
  if (!isSmtpConfigured()) {
    console.warn('SMTP not configured. Skipping password reset email.');
    console.log('Would send reset email to:', user.email, 'token:', token);
    return;
  }

  const brandName = site
    ? site.company_name || site.companyName || 'Your Company'
    : 'Teklink';

  const primaryColor =
    (site &&
      (site.primary_color ||
        (site.branding && site.branding.primaryColor))) ||
    '#1b1464';

  const resetUrl = `${APP_BASE_URL}/reset-password?token=${encodeURIComponent(
    token
  )}`;

  const subject = `Password reset for ${brandName} portal`;

  const html = `
    <div style="font-family: Arial, sans-serif; font-size:14px; line-height:1.5; color:#333;">
      <div style="border-bottom:4px solid ${primaryColor}; padding-bottom:8px; margin-bottom:16px;">
        <h1 style="margin:0; font-size:18px; color:${primaryColor};">
          ${brandName}
        </h1>
      </div>

      <p>Hi ${user.name || user.email},</p>

      <p>We received a request to reset the password for your account.</p>

      <p>
        To set a new password, click the button below:
      </p>

      <p style="margin:16px 0;">
        <a href="${resetUrl}"
           style="background:${primaryColor}; color:#fff; text-decoration:none; padding:10px 16px; border-radius:4px; display:inline-block;">
          Reset Your Password
        </a>
      </p>

      <p style="font-size:12px; color:#666;">
        This link is valid for 24 hours. If it expires, you can request another from the login page.
      </p>

      <p style="margin-top:24px; font-size:12px; color:#999;">
        If you did not request a password reset, you can safely ignore this email.
      </p>
    </div>
  `;

  const fromAddress = process.env.FROM_EMAIL || mailTransport.options.auth.user;

  mailTransport.sendMail(
    {
      from: `"${brandName}" <${fromAddress}>`,
      to: user.email,
      subject,
      html
    },
    (err, info) => {
      if (err) {
        console.error('Error sending password reset email:', err);
      } else {
        console.log('Password reset email sent:', info.response || info);
      }
    }
  );
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  sendContactEmail,
  sendUserInviteEmail,
  sendPasswordResetEmail,
  generateToken
};
