const CRON_SCAN_LIMIT_MINUTES = 60 * 24 * 366 * 5;

export type ParsedCron = {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
};

function normalizeCronNumber(value: string, min: number, max: number, label: string, allowSunday7 = false): number {
  const text = value.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`cron ${label} must use numbers, ranges, lists, or steps`);
  }
  const raw = Number(text);
  if (!Number.isInteger(raw)) {
    throw new Error(`cron ${label} is invalid`);
  }
  const normalized = allowSunday7 && raw === 7 ? 0 : raw;
  if (normalized < min || normalized > max) {
    throw new Error(`cron ${label} must be between ${min} and ${allowSunday7 ? 7 : max}`);
  }
  return normalized;
}

function addCronRange(target: Set<number>, start: number, end: number, step: number, label: string): void {
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`cron ${label} step must be a positive integer`);
  }
  if (start > end) {
    throw new Error(`cron ${label} range is invalid`);
  }
  for (let value = start; value <= end; value += step) {
    target.add(value);
  }
}

export function parseCronField(
  source: string,
  min: number,
  max: number,
  label: string,
  allowSunday7 = false,
): Set<number> {
  const values = new Set<number>();
  const tokens = source.split(",").map((item) => item.trim()).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error(`cron ${label} is required`);
  }

  for (const token of tokens) {
    const [baseRaw, stepRaw, extraRaw] = token.split("/");
    if (extraRaw !== undefined) {
      throw new Error(`cron ${label} has too many step separators`);
    }
    const base = baseRaw.trim();
    const step = stepRaw === undefined ? 1 : normalizeCronNumber(stepRaw, 1, max - min + 1, `${label} step`);

    if (base === "*") {
      addCronRange(values, min, max, step, label);
      continue;
    }

    const dashIndex = base.indexOf("-");
    if (dashIndex >= 0) {
      const start = normalizeCronNumber(base.slice(0, dashIndex), min, max, label, allowSunday7);
      const end = normalizeCronNumber(base.slice(dashIndex + 1), min, max, label, allowSunday7);
      addCronRange(values, start, end, step, label);
      continue;
    }

    const start = normalizeCronNumber(base, min, max, label, allowSunday7);
    const end = stepRaw === undefined ? start : max;
    addCronRange(values, start, end, step, label);
  }

  return values;
}

export function parseCronExpression(expr: string): ParsedCron {
  const source = expr.trim().replace(/\s+/g, " ").trim();
  const fields = source.split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    throw new Error("cronExpr must contain exactly 5 fields: minute hour day month weekday");
  }

  return {
    minutes: parseCronField(fields[0], 0, 59, "minute"),
    hours: parseCronField(fields[1], 0, 23, "hour"),
    daysOfMonth: parseCronField(fields[2], 1, 31, "day"),
    months: parseCronField(fields[3], 1, 12, "month"),
    weekdays: parseCronField(fields[4], 0, 6, "weekday", true),
  };
}

export function matchesCron(parsed: ParsedCron, date: Date): boolean {
  return parsed.minutes.has(date.getUTCMinutes())
    && parsed.hours.has(date.getUTCHours())
    && parsed.daysOfMonth.has(date.getUTCDate())
    && parsed.months.has(date.getUTCMonth() + 1)
    && parsed.weekdays.has(date.getUTCDay());
}

export function nextCronTriggerAt(cronExpr: string, afterMs: number): string {
  const parsed = parseCronExpression(cronExpr);
  const cursor = new Date(afterMs);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let i = 0; i < CRON_SCAN_LIMIT_MINUTES; i += 1) {
    if (matchesCron(parsed, cursor)) {
      return cursor.toISOString();
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new Error("cronExpr has no matching trigger within 5 years");
}
