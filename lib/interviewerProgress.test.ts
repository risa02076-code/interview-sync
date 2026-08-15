import { describe, it, expect } from "vitest";
import { computeInterviewerProgress } from "./interviewerProgress";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

describe("computeInterviewerProgress", () => {
  it("재문의 라운드가 쌓여도 실제 인원수 기준으로 진행률을 센다 (4/4 버그 회귀 테스트)", () => {
    // 2명 패널이 재문의(조회 기간 확장)를 한 번씩 더 받아 response_requests가 4행이 된 상황.
    // 예전엔 이 4행을 그대로 세서 "4/4"로 보였다.
    const panel = ["a", "b"];
    const requests = [
      { interviewer_id: "a", status: "submitted", created_at: T1 },
      { interviewer_id: "a", status: "submitted", created_at: T2 },
      { interviewer_id: "b", status: "submitted", created_at: T1 },
      { interviewer_id: "b", status: "submitted", created_at: T2 },
    ];
    const progress = computeInterviewerProgress(panel, requests);
    expect(progress.total).toBe(2);
    expect(progress.submitted).toBe(2);
    expect(progress.respondedIds).toEqual(new Set(["a", "b"]));
  });

  it("가장 최근 요청이 pending이면 과거 submitted가 있어도 미응답으로 본다", () => {
    const panel = ["a", "b"];
    const requests = [
      { interviewer_id: "a", status: "submitted", created_at: T1 }, // 이전 라운드 응답
      { interviewer_id: "a", status: "pending", created_at: T2 }, // 새 라운드 재문의, 아직 미응답
      { interviewer_id: "b", status: "submitted", created_at: T1 },
    ];
    const progress = computeInterviewerProgress(panel, requests);
    expect(progress.respondedIds.has("a")).toBe(false);
    expect(progress.respondedIds.has("b")).toBe(true);
    expect(progress.submitted).toBe(1);
    expect(progress.total).toBe(2);
  });

  it("발송 실패로 방치된 예전 pending 요청이 있어도, 재발송한 최신 요청에 답했으면 응답 완료로 본다", () => {
    // 첫 발송이 실패해서 아무도 받지 못한 요청이 pending으로 영원히 남고, 그 뒤
    // "재발송"으로 만든 새 요청에 실제로 답한 상황 — 예전 로직(hasPending이면 무조건
    // 미응답)이라면 이 사람은 영원히 미응답으로 잡혀서 자동 확정이 절대 안 됐다.
    const panel = ["a", "b"];
    const requests = [
      { interviewer_id: "a", status: "pending", created_at: T1 }, // 발송 실패로 방치된 예전 요청
      { interviewer_id: "a", status: "submitted", created_at: T2 }, // 재발송 후 실제 응답
      { interviewer_id: "b", status: "submitted", created_at: T1 },
    ];
    const progress = computeInterviewerProgress(panel, requests);
    expect(progress.respondedIds.has("a")).toBe(true);
    expect(progress.submitted).toBe(2);
    expect(progress.total).toBe(2);
  });

  it("요청이 여러 번 재발송돼도 가장 최근 것 하나만 본다", () => {
    const panel = ["a"];
    const requests = [
      { interviewer_id: "a", status: "submitted", created_at: T1 },
      { interviewer_id: "a", status: "pending", created_at: T2 },
      { interviewer_id: "a", status: "pending", created_at: T3 }, // 가장 최근인데 아직 미응답
    ];
    const progress = computeInterviewerProgress(panel, requests);
    expect(progress.respondedIds.has("a")).toBe(false);
  });

  it("요청이 아예 없는 면접관은 미응답으로 본다", () => {
    const progress = computeInterviewerProgress(["a", "b"], [
      { interviewer_id: "a", status: "submitted", created_at: T1 },
    ]);
    expect(progress.respondedIds).toEqual(new Set(["a"]));
    expect(progress.submitted).toBe(1);
    expect(progress.total).toBe(2);
  });
});
