"use client";

import { useMemo, useRef, useState } from "react";
import { kstDateLabel, kstDayKey, kstTimeLabel } from "@/lib/slots";

export type GridSlot = { key: string };

export type CellInfo = {
  key: string;
  /** 이 슬롯에 겹치는 인원 수 (히트맵용). 지정하지 않으면 색을 칠하지 않는다. */
  conflictCount?: number;
  disabled?: boolean;
  /** 이미 응답을 마친 다른 사람이 이 시간을 불가능하다고 표시했음을 참고용으로 보여준다 */
  warn?: boolean;
  /**
   * 이 칸의 값이 확정이 아니라 추정임을 사선 무늬로 표시한다(미응답자가 있을 때).
   * 색(conflictCount)과 별도 채널이어야 한다 — 하나로 합치면 "가능하다고 답한 것"과
   * "아직 답하지 않은 것"이 같은 색이 되어, 추정이 확정처럼 보인다.
   */
  estimated?: boolean;
  /** 칸 위에 겹쳐 보여줄 짧은 표식(후보자 순위 메달 등) */
  mark?: string;
  /** 툴팁에 덧붙일 설명 */
  hint?: string;
};

type SlotGridProps = {
  /** generateUpcomingSlots()가 반환하는 것과 같은, 시간순으로 정렬된 평평한 슬롯 목록 */
  slots: GridSlot[];
  selected: Set<string>;
  /**
   * 셀 하나가 "선택되거나 선택 해제될 때" 호출된다. 클릭/드래그 모두 이걸 통해서만 상태를
   * 바꾼다 — 실제로 selected에 반영할지는 호출하는 쪽이 결정한다(단일 선택 모드에서는
   * select 값을 무시하고 항상 그 키 하나로 교체하면 된다).
   */
  onPaint: (key: string, select: boolean) => void;
  /** true면 마우스를 누른 채 드래그해서 여러 칸을 한번에 칠할 수 있다(when2meet 방식) */
  allowDrag?: boolean;
  /** 인원수 기준 충돌 히트맵을 표시할 때, 정규화 기준이 되는 전체 인원 수 */
  panelSize?: number;
  cellInfo?: (key: string) => CellInfo | undefined;
  /**
   * 보기 전용. 칠하는 화면이 아니라 "눌러서 상세를 보는" 화면에서 쓴다.
   * 드래그를 끄고, 선택 표시를 배경 대신 테두리로 해서 히트맵 색을 가리지 않는다.
   */
  readOnly?: boolean;
  /** roomy는 표식(mark)이 들어갈 수 있도록 칸을 키운다 */
  size?: "compact" | "roomy";
};

/**
 * ISO 슬롯 키들을 요일(열) × 시간(행) 그리드 좌표로 묶는다.
 *
 * 날짜·시간은 반드시 한국 시간 기준으로 계산한다. Date의 로컬 getter를 쓰면 보는
 * 사람의 시간대에 따라 같은 슬롯이 다른 칸에 놓인다 — 해외에 있는 후보자는 09:00
 * 슬롯을 전날 밤 시간으로 보게 되고, 격자의 행·열 구조 자체가 어긋난다.
 */
function useGridShape(slots: GridSlot[]) {
  return useMemo(() => {
    const dayOrder: string[] = [];
    const dayLabels = new Map<string, string>();
    const timeOrder: string[] = [];
    const cellKey = new Map<string, string>();

    for (const s of slots) {
      const dayId = kstDayKey(s.key);
      const timeId = kstTimeLabel(s.key);

      if (!dayLabels.has(dayId)) {
        dayOrder.push(dayId);
        dayLabels.set(dayId, kstDateLabel(s.key));
      }
      if (!timeOrder.includes(timeId)) timeOrder.push(timeId);
      cellKey.set(`${dayId}|${timeId}`, s.key);
    }

    return { dayOrder, dayLabels, timeOrder, cellKey };
  }, [slots]);
}

/** 충돌 인원 비율에 따라 초록(0명)~빨강(전원)으로 배경색을 보간한다. */
function heatColor(conflictCount: number, panelSize: number): string {
  if (panelSize <= 0) return "transparent";
  const ratio = Math.min(1, conflictCount / panelSize);
  if (ratio === 0) return "rgba(34,197,94,0.18)"; // green-500
  const r = Math.round(234 + (239 - 234) * ratio);
  const g = Math.round(179 - 111 * ratio);
  const b = Math.round(8 - 8 * ratio);
  return `rgba(${r},${g},${b},${0.15 + ratio * 0.45})`;
}

/**
 * 칸의 배경색. 색은 "불가능하다고 답한 인원 수"만 나타낸다.
 * panelSize가 없거나 conflictCount가 없으면 색을 칠하지 않는다.
 */
export function cellTint(info: CellInfo | undefined, panelSize: number | undefined): string | undefined {
  if (panelSize && info?.conflictCount !== undefined) return heatColor(info.conflictCount, panelSize);
  if (info?.warn) return "rgba(245,158,11,0.16)";
  return undefined;
}

/** 추정 구간에 겹칠 사선 무늬. 색과 독립된 채널이라 함께 표시된다. */
export function cellStripe(info: CellInfo | undefined): string | undefined {
  if (!info?.estimated) return undefined;
  return "repeating-linear-gradient(45deg, rgba(100,116,139,0.28) 0 2px, transparent 2px 5px)";
}

export function SlotGrid({
  slots,
  selected,
  onPaint,
  allowDrag = true,
  panelSize,
  cellInfo,
  readOnly = false,
  size = "compact",
}: SlotGridProps) {
  const { dayOrder, dayLabels, timeOrder, cellKey } = useGridShape(slots);
  const dragState = useRef<{ paintValue: boolean } | null>(null);
  const [isPointerDown, setIsPointerDown] = useState(false);

  function paint(key: string, select: boolean) {
    onPaint(key, select);
  }

  function handleDown(key: string) {
    const nextValue = !selected.has(key);
    dragState.current = { paintValue: nextValue };
    setIsPointerDown(true);
    paint(key, nextValue);
  }

  function handleEnter(key: string) {
    if (readOnly || !allowDrag || !isPointerDown || !dragState.current) return;
    paint(key, dragState.current.paintValue);
  }

  function handleUp() {
    setIsPointerDown(false);
    dragState.current = null;
  }

  return (
    <div className="overflow-x-auto" onMouseUp={handleUp} onMouseLeave={handleUp}>
      <table className="border-collapse select-none text-xs">
        <thead>
          <tr>
            <th className="w-14" />
            {dayOrder.map((d) => (
              <th key={d} className="px-1 pb-1 text-center font-medium text-muted-foreground">
                {dayLabels.get(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {timeOrder.map((t) => (
            <tr key={t}>
              <td className="pr-2 text-right font-mono text-muted-foreground">{t}</td>
              {dayOrder.map((d) => {
                const key = cellKey.get(`${d}|${t}`);
                if (!key) return <td key={d} />;
                const info = cellInfo?.(key);
                const isSelected = selected.has(key);
                const tint = cellTint(info, panelSize);
                const stripe = cellStripe(info);
                const isWarn = tint === "rgba(245,158,11,0.16)";
                // 보기 전용에서는 선택을 배경 대신 테두리로 표시한다 — 배경을 덮으면
                // 정작 보려던 히트맵 색이 가려진다.
                const fillSelected = isSelected && !readOnly;
                const title = info?.disabled
                  ? undefined
                  : [t, info?.hint, info?.estimated ? "일부 미응답 — 추정" : null]
                      .filter(Boolean)
                      .join(" · ");

                return (
                  <td key={d} className="p-0.5">
                    <button
                      type="button"
                      title={title}
                      disabled={info?.disabled}
                      onMouseDown={() => !info?.disabled && handleDown(key)}
                      onMouseEnter={() => !info?.disabled && handleEnter(key)}
                      className={`${
                        size === "roomy" ? "h-7 w-12 text-[11px]" : "h-5 w-8"
                      } rounded-sm border leading-none transition-colors ${
                        info?.disabled
                          ? "cursor-not-allowed border-border bg-muted"
                          : fillSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : isSelected
                              ? "bg-background"
                              : isWarn
                                ? "border-amber-300 bg-background"
                                : "border-border bg-background hover:border-primary/50"
                      }`}
                      style={{
                        ...(!fillSelected && (tint || stripe)
                          ? { backgroundColor: tint, backgroundImage: stripe }
                          : {}),
                        ...(isSelected && !fillSelected
                          ? { outline: "2px solid hsl(var(--foreground))", outlineOffset: "-1px" }
                          : {}),
                      }}
                    >
                      {info?.mark}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
