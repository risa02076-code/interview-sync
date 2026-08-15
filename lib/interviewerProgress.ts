type RequestRow = { interviewer_id: string | null; status: string; created_at: string };

/**
 * 면접관 링크를 재사용할 수 있게 되면서, 재문의(조회 기간 확장)나 재발송이 나갈
 * 때마다 response_requests 행이 계속 쌓인다. 그래서 단순히 행 개수로 "N/M"을 세면
 * 패널이 2명인데 재문의를 한 번 더 받아 4/4처럼 실제 인원보다 커지는 문제가 있었다.
 *
 * "응답 완료"의 진짜 의미는 이 면접관의 **가장 최근** 요청이 제출됐는지다 — 단순히
 * "대기 중인 요청이 하나라도 있으면 미응답"으로 보면, 발송 실패 등으로 재발송했을 때
 * 아무도 답할 수 없는 예전 요청(발송이 안 됐으니 링크 자체를 받은 적이 없음)이 영원히
 * pending으로 남아, 최신 요청에 답했는데도 계속 미응답으로 잘못 판단하게 된다.
 * 최신 요청 하나만 보면 이 문제가 자연스럽게 해결된다.
 */
export function computeInterviewerProgress(panel: string[], requests: RequestRow[]) {
  const respondedIds = new Set(
    panel.filter((pid) => {
      const forThis = requests.filter((r) => r.interviewer_id === pid);
      if (!forThis.length) return false;
      const latest = forThis.reduce((a, b) => (a.created_at > b.created_at ? a : b));
      return latest.status === "submitted";
    }),
  );

  return { respondedIds, submitted: respondedIds.size, total: panel.length };
}
