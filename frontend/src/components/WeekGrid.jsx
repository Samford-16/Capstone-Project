import { DAYS, WEEK_ORDER, addDays, time12, toMinutes, todayISO } from "../lib/format";
import { CoachTag } from "./ui";

const HOUR_PX = 72;

/**
 * Lay out same-day items that overlap in time side by side.
 * Returns a Map(item -> { lane, lanes }).
 */
function layoutDay(items) {
  const sorted = [...items].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const result = new Map();
  let cluster = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanesEnd = [];
    for (const it of cluster) {
      const start = toMinutes(it.startTime);
      let lane = lanesEnd.findIndex((end) => end <= start);
      if (lane === -1) lane = lanesEnd.length;
      lanesEnd[lane] = toMinutes(it.endTime);
      result.set(it, { lane });
    }
    for (const it of cluster) result.get(it).lanes = lanesEnd.length;
    cluster = [];
  };
  for (const it of sorted) {
    if (cluster.length && toMinutes(it.startTime) >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, toMinutes(it.endTime));
  }
  if (cluster.length) flush();
  return result;
}

/**
 * Monday-to-Sunday calendar of weekly items (lessons or template slots),
 * colored by stage with a coach tag on each block.
 */
export default function WeekGrid({ items, onSelect, weekStart, emptyText = "Nothing scheduled." }) {
  if (!items.length) {
    return <div className="card px-6 py-12 text-center text-sm text-muted">{emptyText}</div>;
  }
  // Only show the hours that have classes (at least a 4-hour window).
  const startHour = Math.min(...items.map((i) => Math.floor(toMinutes(i.startTime) / 60)));
  let endHour = Math.max(...items.map((i) => Math.ceil(toMinutes(i.endTime) / 60)));
  if (endHour - startHour < 4) endHour = Math.min(24, startHour + 4);
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const height = hours.length * HOUR_PX;

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
      <div className="min-w-[760px]">
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border-b border-line bg-canvas text-xs font-semibold tracking-wide text-muted uppercase">
          <div />
          {WEEK_ORDER.map((d, i) => {
            // With a week chosen (the schedule), show each column's date; templates have none.
            const date = weekStart ? addDays(weekStart, i) : null;
            const isToday = date === todayISO();
            return (
              <div key={d} className={`border-l border-line px-2 py-2 text-center ${isToday ? "bg-primary/10 text-primary" : ""}`}>
                {DAYS[d].slice(0, 3)}
                {date && <span className="ml-1 font-normal normal-case">{Number(date.slice(8))}</span>}
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]" style={{ height }}>
          <div className="relative">
            {hours.map((h, i) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[11px] text-muted" style={{ top: i * HOUR_PX }}>
                {i === 0 ? "" : time12(`${h}:00`).replace(":00", "")}
              </div>
            ))}
          </div>
          {WEEK_ORDER.map((d) => {
            const dayItems = items.filter((i) => i.dayOfWeek === d);
            const layout = layoutDay(dayItems);
            return (
              <div
                key={d}
                className="relative border-l border-line"
                style={{
                  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--color-line) ${HOUR_PX - 1}px, var(--color-line) ${HOUR_PX}px)`,
                }}
              >
                {dayItems.map((it, idx) => {
                  const top = ((toMinutes(it.startTime) - startHour * 60) / 60) * HOUR_PX;
                  const h = Math.max(((toMinutes(it.endTime) - toMinutes(it.startTime)) / 60) * HOUR_PX - 2, 30);
                  const { lane, lanes } = layout.get(it);
                  const full = it.isFull;
                  return (
                    <button
                      key={it.id ?? idx}
                      type="button"
                      onClick={() => onSelect && onSelect(it)}
                      className={`absolute overflow-hidden rounded-md border border-slate-900/10 px-1.5 py-1 text-left text-[11px] leading-tight shadow-sm transition hover:z-10 hover:shadow-md ${full ? "opacity-70" : ""}`}
                      style={{
                        top: top + 1,
                        height: h,
                        left: `calc(${(lane / lanes) * 100}% + 2px)`,
                        width: `calc(${100 / lanes}% - 4px)`,
                        background: it.stage?.color,
                      }}
                      title={`${it.name || `Stage ${it.stage?.id}`}, ${time12(it.startTime)} to ${time12(it.endTime)}${it.coach ? `, Coach ${it.coach.name}` : ""}`}
                    >
                      <div className="truncate font-bold">{it.name || `Stage ${it.stage?.id}`}</div>
                      <div className="truncate opacity-80">
                        {time12(it.startTime)}
                        {/* Short blocks have no room for the coach chip, so name the coach inline. */}
                        {h < 40 ? ` · ${it.coach ? it.coach.name.split(" ")[0] : "No coach"}` : ""}
                        {it.enrolledCount !== undefined ? ` · ${it.enrolledCount}/${it.capacity}` : ` · cap ${it.capacity}`}
                        {full ? " · FULL" : ""}
                      </div>
                      {h >= 40 && (
                        <div className="mt-0.5">
                          <CoachTag coach={it.coach} size="xs" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
