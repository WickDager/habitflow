"use client";

import { MyDayView } from "./MyDayView";

/**
 * The Today tab.
 *
 * The screen itself moved to MyDayView when the tab stopped being habits-only
 * and became the merged day (focus + tasks + habits). This stays as the tab's
 * entry point so page.tsx, the tab bar and its aria labels are untouched.
 */
export function TodayView() {
  return <MyDayView />;
}
