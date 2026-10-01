export function isValidScheduleRange(startsAt: Date, endsAt: Date): boolean {
  return Number.isFinite(startsAt.getTime())
    && Number.isFinite(endsAt.getTime())
    && endsAt.getTime() > startsAt.getTime();
}

export function containsScheduleRange(
  availableStartsAt: Date,
  availableEndsAt: Date,
  scheduledStartsAt: Date,
  scheduledEndsAt: Date,
): boolean {
  return availableStartsAt.getTime() <= scheduledStartsAt.getTime()
    && availableEndsAt.getTime() >= scheduledEndsAt.getTime();
}

export function scheduleRangesOverlap(
  firstStartsAt: Date,
  firstEndsAt: Date,
  secondStartsAt: Date,
  secondEndsAt: Date,
): boolean {
  return firstStartsAt.getTime() < secondEndsAt.getTime()
    && firstEndsAt.getTime() > secondStartsAt.getTime();
}

export function scheduledOrderConflicts(
  candidateStartsAt: Date,
  candidateEndsAt: Date,
  existingStartsAt: Date,
  existingEndsAt: Date | null,
): boolean {
  if (existingEndsAt) {
    return scheduleRangesOverlap(candidateStartsAt, candidateEndsAt, existingStartsAt, existingEndsAt);
  }
  return existingStartsAt.getTime() >= candidateStartsAt.getTime()
    && existingStartsAt.getTime() < candidateEndsAt.getTime();
}