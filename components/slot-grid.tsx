"use client";

import { useMemo, useRef, useState } from "react";
import { kstDateLabel, kstDayKey, kstTimeLabel } from "@/lib/slots";

export type GridSlot = { key: string };

type CellInfo = {
  key: string;
  /** 이 슬롯에 겹치는 인원 수 (히트맵용). 지정하지 않으면 색을 칠하지 않는다. */
  conflictCount?: number;
  disabled?: boolean;
  /** 이미 응답을 마친 다른 사람이 이 시간을 불가능하다고 표시했음을 참고용으로 보여준다 */
  warn?: boolean;
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

export function SlotGrid({
  slots,
  selected,
  onPaint,
  allowDrag = true,
  panelSize,
  cellInfo,
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
    if (!allowDrag || !isPointerDown || !dragState.current) return;
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
                const heat =
                  panelSize && info?.conflictCount !== undefined
                    ? heatColor(info.conflictCount, panelSize)
                    : undefined;
                const warnColor = !heat && info?.warn ? "rgba(245,158,11,0.16)" : undefined;
                const tint = heat ?? warnColor;
                const title = info?.disabled ? undefined : info?.warn ? `${t} · 다른 면접관 이미 불가능` : t;

                return (
                  <td key={d} className="p-0.5">
                    <button
                      type="button"
                      title={title}
                      disabled={info?.disabled}
                      onMouseDown={() => !info?.disabled && handleDown(key)}
                      onMouseEnter={() => !info?.disabled && handleEnter(key)}
                      className={`h-5 w-8 rounded-sm border transition-colors ${
                        info?.disabled
                          ? "cursor-not-allowed border-border bg-muted"
                          : isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : warnColor
                              ? "border-amber-300 bg-background"
                              : "border-border bg-background hover:border-primary/50"
                      }`}
                      style={!isSelected && tint ? { backgroundColor: tint } : undefined}
                    />
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
