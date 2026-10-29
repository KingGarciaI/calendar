import { CalendarView } from "@/components/calendar/calendar-view";

export const metadata = { title: "Calendrier" };

export default function CalendarPage() {
  return (
    <div className="flex h-[calc(100dvh-56px-64px-env(safe-area-inset-bottom))] flex-col pt-1 md:h-[calc(100dvh-56px)]">
      <CalendarView />
    </div>
  );
}
