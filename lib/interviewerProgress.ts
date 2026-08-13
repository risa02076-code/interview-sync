type RequestRow = { interviewer_id: string | null; status: string };

/**
 * 면접관 링크를 재사용할 수 있게 되면서, 재문의(조회 기간 확장)가 나갈 때마다
 * response_requests 행이 계속 쌓인다. 그래서 단순히 행 개수로 "N/M"을 세면
 * 패널이 2명인데 재문의를 한 번 더 받아 4/4처럼 실제 인원보다 커지는 문제가 있었다.
 *
 * "응답 완료"의 진짜 의미는 "이 면접관에게 걸려있는 대기 중(pending) 요청이 없다"이다 —
 * 과거 라운드의 submitted 행이 아무리 쌓여도, 최신 라운드에 pending이 남아있으면
 * 아직 응답을 안 한 것으로 본다.
 */
export function computeInterviewerProgress(panel: string[], requests: RequestRow[]) {
  const respondedIds = new Set(
    panel.filter((pid) => {
      const forThis = requests.filter((r) => r.interviewer_id === pid);
      if (!forThis.length) return false;
      const hasPending = forThis.some((r) => r.status === "pending");
      const hasSubmitted = forThis.some((r) => r.status === "submitted");
      return hasSubmitted && !hasPending;
    }),
  );

  return { respondedIds, submitted: respondedIds.size, total: panel.length };
}
