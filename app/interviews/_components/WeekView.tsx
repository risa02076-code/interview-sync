"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatSlotLabel, kstHour, kstMinute } from "@/lib/slots";
import {
  type InterviewRow,
  calendarColor,
  CAL_COLOR_CLASS,
  HOURS,
  startOfWeek,
  addDays,
  isSameDay,
  isSameDayAsSlot,
  dayLabel,
  dateRangeLabel,
  kstNow,
} from "./types";

const ROW_HEIGHT = 64;

export function WeekView({
  interviews,
  onSelect,
}: {
  interviews: InterviewRow[];
  onSelect: (iv: InterviewRow) => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);

  // 주 이동과 "지금" 표시 모두 한국 시간 기준으로 계산한다(시프트된 Date끼리만 비교).
  const monday = useMemo(() => addDays(startOfWeek(kstNow()), weekOffset * 7), [weekOffset]);
  const days = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(monday, i)), [monday]);
  const now = kstNow();

  const eventsByDay = useMemo(() => {
    return days.map((day) =>
      interviews
        .filter((iv) => iv.matched_slot && isSameDayAsSlot(day, iv.matched_slot))
        .sort((a, b) => new Date(a.matched_slot!).getTime() - new Date(b.matched_slot!).getTime()),
    );
  }, [days, interviews]);

  const nowInRange =
    now.getUTCHours() >= HOURS[0] &&
    now.getUTCHours() < HOURS[HOURS.length - 1] + 1 &&
    days.some((d) => isSameDay(d, now));
  const nowTopPct = ((now.getUTCHours() + now.getUTCMinutes() / 60 - HOURS[0]) / HOURS.length) * 100;

  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center justify-between border-b p-3">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setWeekOffset((w) => w - 1)}>
            ‹
          </Button>
          <Button size="sm" variant="outline" onClick={() => setWeekOffset(0)}>
            이번 주
          </Button>
          <Button size="sm" variant="outline" onClick={() => setWeekOffset((w) => w + 1)}>
            ›
          </Button>
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          {dateRangeLabel(days[0], days[4])}
        </p>
      </div>

      <div className="flex">
        <div className="w-14 shrink-0" />
        {days.map((d) => {
          const today = isSameDay(d, now);
          return (
            <div
              key={d.toISOString()}
              className={`flex-1 border-l p-2 text-center text-xs ${
                today ? "bg-blue-50 font-bold text-blue-700" : "text-muted-foreground"
              }`}
            >
              {dayLabel(d)}
            </div>
          );
        })}
      </div>

      <div className="max-h-[640px] overflow-y-auto">
        <div className="flex" style={{ height: HOURS.length * ROW_HEIGHT }}>
          <div className="w-14 shrink-0">
            {HOURS.map((h) => (
              <div
                key={h}
                className="border-t px-2 text-right text-xs text-muted-foreground"
                style={{ height: ROW_HEIGHT }}
              >
                {h}:00
              </div>
            ))}
          </div>

          <div className="relative flex flex-1">
            {HOURS.map((h, i) => (
              <div
                key={h}
                className="pointer-events-none absolute inset-x-0 border-t"
                style={{ top: i * ROW_HEIGHT }}
              />
            ))}

            {nowInRange && (
              <div
                className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                style={{ top: `${nowTopPct}%` }}
              />
            )}

            {days.map((d, ci) => (
              <div key={d.toISOString()} className="relative flex-1 border-l">
                {eventsByDay[ci].map((iv) => {
                  const hourOffset =
                    kstHour(iv.matched_slot!) + kstMinute(iv.matched_slot!) / 60 - HOURS[0];
                  const color = calendarColor(iv);
                  return (
                    <button
                      key={iv.id}
                      onClick={() => onSelect(iv)}
                      className={`absolute left-1 right-1 overflow-hidden rounded-md border p-1.5 text-left text-xs shadow-sm transition ${CAL_COLOR_CLASS[color]}`}
                      style={{ top: hourOffset * ROW_HEIGHT + 2, height: ROW_HEIGHT - 4 }}
                    >
                      <div className="truncate font-mono text-[10px] opacity-80">
                        {formatSlotLabel(iv.matched_slot!).split(") ")[1]}
                      </div>
                      <div className="truncate font-semibold">{iv.candidate_name}</div>
                      <div className="truncate opacity-80">{iv.position}</div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
