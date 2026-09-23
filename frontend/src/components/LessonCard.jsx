import { DAYS, money, timeRange } from "../lib/format";
import { CapacityBar, CoachTag, StageTag } from "./ui";

export default function LessonCard({ lesson, onOpen, mySwimmers = [] }) {
  const enrolledNames = lesson.myEnrollments
    .map((e) => mySwimmers.find((s) => s.id === e.swimmerId)?.firstName)
    .filter(Boolean);
  return (
    <button
      type="button"
      onClick={() => onOpen(lesson)}
      className={`card flex flex-col gap-2.5 p-4 text-left transition hover:border-line-strong hover:shadow-md ${lesson.isFull ? "bg-slate-50/60" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-snug">{lesson.name}</h3>
        <StageTag stage={lesson.stage} />
      </div>
      <div className="text-sm text-muted">
        {DAYS[lesson.dayOfWeek]}s · {timeRange(lesson.startTime, lesson.endTime)}
        {lesson.location ? ` · ${lesson.location}` : ""}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CoachTag coach={lesson.coach} />
        {lesson.pricePerSessionCents !== null && (
          <span className="text-xs text-muted">{money(lesson.pricePerSessionCents)}/session</span>
        )}
      </div>
      <CapacityBar enrolled={lesson.enrolledCount} capacity={lesson.capacity} />
      {enrolledNames.length > 0 && (
        <div className="rounded-md bg-primary-light px-2 py-1 text-xs font-medium text-primary-dark">
          Enrolled: {enrolledNames.join(", ")}
        </div>
      )}
    </button>
  );
}
