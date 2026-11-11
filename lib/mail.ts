// Minimal Resend client (https://resend.com). No SDK needed: one HTTPS call.
export interface MailResult {
  ok: boolean;
  error?: string;
}

export function mailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM && process.env.ADMIN_EMAIL);
}

export async function sendReportMail(opts: {
  subject: string;
  text: string;
  filename: string;
  content: Buffer;
}): Promise<MailResult> {
  if (!mailConfigured()) {
    return { ok: false, error: 'שליחת מייל לא מוגדרת (RESEND_API_KEY / MAIL_FROM / ADMIN_EMAIL)' };
  }
  const to = process.env.ADMIN_EMAIL!.split(',').map((s) => s.trim()).filter(Boolean);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to,
      subject: opts.subject,
      text: opts.text,
      attachments: [{ filename: opts.filename, content: opts.content.toString('base64') }],
    }),
  });
  if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${await res.text()}` };
  return { ok: true };
}
