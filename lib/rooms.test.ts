import { describe, it, expect } from "vitest";
import {
  buildRoomOccupancy,
  isRoomUsable,
  requiredCapacity,
  roomExclusionReason,
  type ManagedRoom,
} from "./rooms";

function room(over: Partial<ManagedRoom> = {}): ManagedRoom {
  return { id: "r1", name: "면접실 A", busy_slots: [], ...over };
}

describe("requiredCapacity", () => {
  it("면접관 수에 후보자 한 명을 더한다", () => {
    expect(requiredCapacity(2)).toBe(3);
    expect(requiredCapacity(4)).toBe(5);
  });

  it("면접관이 없어도 후보자 자리는 필요하다", () => {
    expect(requiredCapacity(0)).toBe(2);
  });
});

describe("isRoomUsable", () => {
  it("정원이 넉넉하면 쓸 수 있다", () => {
    expect(isRoomUsable(room({ capacity: 6 }), 4)).toBe(true);
  });

  it("면접관 수 + 후보자와 정확히 맞으면 쓸 수 있다", () => {
    expect(isRoomUsable(room({ capacity: 5 }), 4)).toBe(true);
  });

  it("후보자 자리 한 명이 모자라면 쓸 수 없다", () => {
    // 면접관 4명이 들어가는 4인실은 후보자가 앉을 자리가 없다.
    expect(isRoomUsable(room({ capacity: 4 }), 4)).toBe(false);
  });

  it("정원이 없으면(null) 종전대로 제한하지 않는다", () => {
    // 값을 모르는 것과 "작다"는 것은 다르다. 모른다고 막으면 정원을 입력하기
    // 전까지 확정이 전부 멈춘다.
    expect(isRoomUsable(room({ capacity: null }), 10)).toBe(true);
  });

  it("정원 컬럼이 아예 없는 조회 결과도 제한하지 않는다", () => {
    expect(isRoomUsable(room(), 10)).toBe(true);
  });

  it("사용 안 함으로 표시된 방은 정원이 넉넉해도 쓸 수 없다", () => {
    expect(isRoomUsable(room({ capacity: 20, active: false }), 2)).toBe(false);
  });

  it("active가 undefined면 사용 안 함으로 읽지 않는다", () => {
    // 마이그레이션 전 데이터나 이 컬럼을 안 고른 조회에서 undefined가 온다.
    // 이걸 false로 읽으면 모든 방이 한꺼번에 후보에서 빠진다.
    expect(isRoomUsable(room({ active: undefined }), 2)).toBe(true);
  });
});

describe("roomExclusionReason", () => {
  it("쓸 수 있는 방은 사유가 없다", () => {
    expect(roomExclusionReason(room({ capacity: 6 }), 4)).toBeNull();
  });

  it("사용 안 함이 정원보다 먼저 설명된다", () => {
    expect(roomExclusionReason(room({ capacity: 2, active: false }), 4)).toBe(
      "사용 안 함으로 표시된 면접실",
    );
  });

  it("정원이 모자라면 필요한 인원까지 함께 알려준다", () => {
    expect(roomExclusionReason(room({ capacity: 3 }), 4)).toBe(
      "정원 3명 — 이 면접에는 5명(면접관 4명 + 후보자)이 필요",
    );
  });
});

describe("buildRoomOccupancy", () => {
  const A = "2024-01-02T01:00:00.000Z";
  const B = "2024-01-02T01:30:00.000Z";
  const C = "2024-01-02T05:00:00.000Z";

  it("확정 면접이 설명하는 슬롯에는 후보자 이름이 붙는다", () => {
    const map = buildRoomOccupancy([A, B], [{ interviewId: "iv1", candidateName: "이하은", slots: [A, B] }]);
    expect(map.get(A)).toBe("이하은");
    expect(map.get(B)).toBe("이하은");
  });

  it("면접으로 설명되지 않는 사용 중 시간은 사유 미상(null)으로 남는다", () => {
    // busy_slots에는 면접 말고 다른 이유로 막은 시간도 섞여 들어간다.
    const map = buildRoomOccupancy([A, C], [{ interviewId: "iv1", candidateName: "이하은", slots: [A] }]);
    expect(map.get(A)).toBe("이하은");
    expect(map.get(C)).toBeNull();
  });

  it("비어 있는 시간은 아예 들어가지 않는다", () => {
    const map = buildRoomOccupancy([A], []);
    expect(map.has(B)).toBe(false);
  });

  it("면접이 차지하는데 busy_slots에 빠진 시간도 사용 중으로 잡는다", () => {
    // 확정 저장이 반쪽으로 끝났거나 소요시간 도입 이전 데이터가 이 경우다.
    // 화면에서 빈칸으로 보이면 그 자리에 다른 면접을 넣게 된다.
    const map = buildRoomOccupancy([A], [{ interviewId: "iv1", candidateName: "이하은", slots: [A, B] }]);
    expect(map.get(B)).toBe("이하은");
  });

  it("여러 면접이 각자의 구간을 가진다", () => {
    const map = buildRoomOccupancy(
      [A, B, C],
      [
        { interviewId: "iv1", candidateName: "이하은", slots: [A, B] },
        { interviewId: "iv2", candidateName: "김서준", slots: [C] },
      ],
    );
    expect([...map.entries()].sort()).toEqual([
      [A, "이하은"],
      [B, "이하은"],
      [C, "김서준"],
    ]);
  });
});
