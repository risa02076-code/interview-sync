"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type InterviewRow,
  calendarColor,
  CAL_COLOR_CLASS,
  CAL_COLOR_LABEL,
  HOURS,
  isSameDay,
  addDays,
  dayLabel,
} from "./types";

export function DayView({
  interviews,
  onSelect,
}: {
  interviews: InterviewRow[];
  onSelect: (iv: InterviewRow) => void;
}) {
  const [dayOffset, setDayOffset] = useState(0);
  const day = useMemo(() => addDays(new Date(), dayOffset), [dayOffset]);

  const eventsByHour = useMemo(() => {
    const map = new Map<number, InterviewRow[]>();
    for (const h of HOURS) map.set(h, []);
    interviews
      .filter((iv) => iv.matched_slot && isSameDay(new Date(iv.matched_slot), day))
      .forEach((iv) => {
        const h = new Date(iv.matched_slot!).getHours();
        if (map.has(h)) map.get(h)!.push(iv);
      });
    return map;
  }, [interviews, day]);

  const isToday = isSameDay(day, new Date());

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b p-3">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setDayOffset((d) => d - 1)}>
            ‹
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDayOffset(0)}>
            오늘
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDayOffset((d) => d + 1)}>
            ›
          </Button>
        </div>
        <p className={`text-sm font-medium ${isToday ? "text-blue-700" : "text-muted-foreground"}`}>
          {dayLabel(day)}
          {isToday && " · 오늘"}
        </p>
      </div>

      <div className="max-h-[640px] overflow-y-auto p-4">
        <div className="flex flex-col">
          {HOURS.map((h) => {
            const events = eventsByHour.get(h) ?? [];
            return (
              <div key={h} className="flex gap-3 border-t py-3 first:border-t-0">
                <div className="w-12 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">{h}:00</div>
                <div className="flex flex-1 flex-col gap-2">
                  {events.length === 0 && <div className="h-3" />}
                  {events.map((iv) => {
                    const color = calendarColor(iv);
                    return (
                      <div
                        key={iv.id}
                        className={`rounded-lg border p-3 text-sm ${CAL_COLOR_CLASS[color]}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{iv.candidate_name}</span>
                          <span className="rounded-full border bg-white/60 px-2 py-0.5 text-[11px] font-semibold">
                            {CAL_COLOR_LABEL[color]}
                          </span>
                        </div>
                        <p className="opacity-90">{iv.position}</p>
                        <p className="mt-1 text-xs opacity-80">
                          면접관 {iv.panelDetail.map((p) => p.name).join(", ")}
                        </p>
                        <p className="text-xs opacity-80">{iv.roomName ?? iv.interview_type}</p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 bg-white/70"
                          onClick={() => onSelect(iv)}
                        >
                          상세보기
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
