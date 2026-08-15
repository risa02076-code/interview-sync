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

/**
 * 문제가 생겼을 때 코드 배포 없이 즉시 전체 자동 발송을 멈추는 킬 스위치.
 * Vercel 환경변수에서 EMAIL_SENDING_ENABLED=false로 설정하면 이후 모든 메일
 * 발송이 조용히 건너뛰어진다(에러를 던지면 호출하는 쪽의 나머지 로직—상태 갱신
 * 등—까지 막힐 수 있어서, 실패가 아니라 스킵으로 처리한다).
 */
/**
 * 발송 실패 사유를 채용담당자가 볼 노트에 그대로 노출해도 되는 길이로 정리한다.
 * (SMTP 인증 실패 같은 건 개발자가 봐야 하지만, "잘못된 이메일 주소" 같은 건
 * 채용담당자가 보고 바로 면접관 정보를 고칠 수 있어서 굳이 숨길 이유가 없다.)
 */
export function emailErrorReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

export async function sendEmail(to: string, subject: string, html: string) {
  if (process.env.EMAIL_SENDING_ENABLED === "false") {
    console.warn(`[email-killswitch] 발송 건너뜀 — to=${to}, subject=${subject}`);
    return;
  }

  const from = process.env.GMAIL_USER;
  try {
    await getTransporter().sendMail({
      from: `인터뷰싱크 <${from}>`,
      to,
      subject,
      html,
    });
  } catch (e) {
    // 실패가 조용히 사라지지 않도록 검색 가능한 태그로 로그를 남긴다(Vercel Logs에서
    // "email-failed"로 찾을 수 있음). 호출한 쪽이 실패를 알아야 하므로 그대로 다시 던진다.
    console.error(
      `[email-failed] to=${to}, subject=${subject}, error=${e instanceof Error ? e.message : String(e)}`,
    );
    throw e;
  }
}
