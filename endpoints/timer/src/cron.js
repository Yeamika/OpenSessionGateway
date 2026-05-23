const SCAN_LIMIT_MINUTES = 60 * 24 * 366 * 5;

export function parseCronExpression(expr) {
  const fields = String(expr || "").trim().replace(/\s+/g, " ").split(/\s+/).filter(Boolean);
  if (fields.length !== 5) throw new Error("cronExpr must contain exactly 5 fields: minute hour day month weekday");
  return {
    minutes: parseField(fields[0], 0, 59, "minute"),
    hours: parseField(fields[1], 0, 23, "hour"),
    daysOfMonth: parseField(fields[2], 1, 31, "day"),
    months: parseField(fields[3], 1, 12, "month"),
    weekdays: parseField(fields[4], 0, 6, "weekday", true),
  };
}

export function nextCronTriggerAt(expr, afterMs) {
  const parsed = parseCronExpression(expr);
  const cursor = new Date(afterMs);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let i = 0; i < SCAN_LIMIT_MINUTES; i += 1) {
    if (matches(parsed, cursor)) return cursor.toISOString();
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  throw new Error("cronExpr has no matching trigger within 5 years");
}

function parseField(source, min, max, label, allowSunday7 = false) {
  const values = new Set();
  const tokens = source.split(",").map((item) => item.trim()).filter(Boolean);
  if (!tokens.length) throw new Error(`cron ${label} is required`);
  for (const token of tokens) {
    const [baseRaw, stepRaw, extra] = token.split("/");
    if (extra !== undefined) throw new Error(`cron ${label} has too many step separators`);
    const step = stepRaw === undefined ? 1 : number(stepRaw, 1, max - min + 1, `${label} step`);
    const base = baseRaw.trim();
    if (base === "*") addRange(values, min, max, step, label);
    else if (base.includes("-")) {
      const [startRaw, endRaw] = base.split("-");
      addRange(values, number(startRaw, min, max, label, allowSunday7), number(endRaw, min, max, label, allowSunday7), step, label);
    } else {
      const start = number(base, min, max, label, allowSunday7);
      addRange(values, start, stepRaw === undefined ? start : max, step, label);
    }
  }
  return values;
}

function number(value, min, max, label, allowSunday7 = false) {
  if (!/^\d+$/.test(String(value).trim())) throw new Error(`cron ${label} must use numbers, ranges, lists, or steps`);
  const raw = Number(value);
  const normalized = allowSunday7 && raw === 7 ? 0 : raw;
  if (!Number.isInteger(raw) || normalized < min || normalized > max) {
    throw new Error(`cron ${label} must be between ${min} and ${allowSunday7 ? 7 : max}`);
  }
  return normalized;
}

function addRange(target, start, end, step, label) {
  if (!Number.isInteger(step) || step <= 0) throw new Error(`cron ${label} step must be a positive integer`);
  if (start > end) throw new Error(`cron ${label} range is invalid`);
  for (let value = start; value <= end; value += step) target.add(value);
}

function matches(parsed, date) {
  return parsed.minutes.has(date.getUTCMinutes())
    && parsed.hours.has(date.getUTCHours())
    && parsed.daysOfMonth.has(date.getUTCDate())
    && parsed.months.has(date.getUTCMonth() + 1)
    && parsed.weekdays.has(date.getUTCDay());
}
