import nodemailer from "nodemailer";

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("GMAIL_USER / GMAIL_APP_PASSWORD가 설정되지 않았습니다.");
  }

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string) {
  const from = process.env.GMAIL_USER;
  await getTransporter().sendMail({
    from: `인터뷰싱크 <${from}>`,
    to,
    subject,
    html,
  });
}
