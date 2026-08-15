import { describe, it, expect } from "vitest";
import { computeInterviewerProgress } from "./interviewerProgress";

describe("computeInterviewerProgress", () => {
  it("재문의 라운드가 쌓여도 실제 인원수 기준으로 진행률을 센다 (4/4 버그 회귀 테스트)", () => {
    // 2명 패널이 재문의(조회 기간 확장)를 한 번씩 더 받아 response_requests가 4행이 된 상황.
    // 예전엔 이 4행을 그대로 세서 "4/4"로 보였다.
    const panel = ["a", "b"];
    const requests = [
      { interviewer_id: "a", status: "submitted" },
      { interviewer_id: "a", status: "submitted" },
      { interviewer_id: "b", status: "submitted" },
      { interviewer_id: "b", status: "submitted" },
    ];
    const progress = computeInterviewerProgress(panel, requests);
    expect(progress.total).toBe(2);
    expect(progress.submitted).toBe(2);
    expect(progress.respondedIds).toEqual(new Set(["a", "b"]));
  });

  it("최신 라운드에 pending이 남아있으면 과거 submitted가 있어도 미응답으로 본다", () => {
    const panel = ["a", "b"];
    const requests = [
      { interviewer_id: "a", status: "submitted" }, // 이전 라운드 응답
      { interviewer_id: "a", status: "pending" }, // 새 라운드 재문의, 아직 미응답
      { interviewer_id: "b", status: "submitted" },
    ];
    const progress = computeInterviewerProgress(panel, requests);
    expect(progress.respondedIds.has("a")).toBe(false);
    expect(progress.respondedIds.has("b")).toBe(true);
    expect(progress.submitted).toBe(1);
    expect(progress.total).toBe(2);
  });

  it("요청이 아예 없는 면접관은 미응답으로 본다", () => {
    const progress = computeInterviewerProgress(["a", "b"], [{ interviewer_id: "a", status: "submitted" }]);
    expect(progress.respondedIds).toEqual(new Set(["a"]));
    expect(progress.submitted).toBe(1);
    expect(progress.total).toBe(2);
  });
});
