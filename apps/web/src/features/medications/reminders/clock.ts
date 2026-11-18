export type LocalClock = {
  date: string;
  time: string;
  second: string;
  weekday: number;
};
export type ClockDayIndex = {
  supported: boolean;
  slots: ReadonlyMap<string, readonly number[]>;
};
const minute = 60000;
function formatter(zone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}
function parts(f: Intl.DateTimeFormat, instant: number): LocalClock | null {
  if (!Number.isFinite(instant)) return null;
  const p = Object.fromEntries(
    f.formatToParts(instant).map((v) => [v.type, v.value]),
  );
  const date = `${p.year?.padStart(4, '0')}-${p.month}-${p.day}`,
    time = `${p.hour}:${p.minute}`;
  if (
    !/^\d{4}-\d\d-\d\d$/.test(date) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    !p.second ||
    !/^[0-5]\d$/.test(p.second)
  )
    return null;
  const epoch = Date.parse(date + 'T00:00:00.000Z');
  if (
    !Number.isFinite(epoch) ||
    new Date(epoch).toISOString().slice(0, 10) !== date
  )
    return null;
  return {
    date,
    time,
    second: p.second,
    weekday: new Date(epoch).getUTCDay() || 7,
  };
}
export function localClock(zone: string, instant: number): LocalClock | null {
  try {
    return parts(formatter(zone), instant);
  } catch {
    return null;
  }
}
/**
 * Enumerate a bounded five-day UTC minute window around one calendar label.
 * The index never disambiguates. Two stored candidates means two or more;
 * unsupported/sub-minute offsets remain informational instead of being rounded.
 * Consumers must yield between chunks and cancel when their page is inactive.
 */
export function* clockDayIndex(
  zone: string,
  date: string,
): Generator<void, ClockDayIndex, void> {
  const empty = () => ({
    supported: false,
    slots: new Map<string, number[]>(),
  });
  const base = Date.parse(date + 'T00:00:00.000Z');
  if (
    !/^\d{4}-\d\d-\d\d$/.test(date) ||
    !Number.isFinite(base) ||
    new Date(base).toISOString().slice(0, 10) !== date ||
    base < Date.UTC(1970, 0, 1)
  )
    return empty();
  let f: Intl.DateTimeFormat;
  try {
    f = formatter(zone);
  } catch {
    return empty();
  }
  const slots = new Map<string, number[]>();
  let supported = true;
  for (let offset = -48 * 60; offset <= 72 * 60; offset++) {
    const instant = base + offset * minute,
      p = parts(f, instant);
    if (!p) {
      supported = false;
    } else if (p.date === date) {
      if (p.second !== '00') supported = false;
      else {
        const matches = slots.get(p.time) ?? [];
        if (matches.length < 2) matches.push(instant);
        slots.set(p.time, matches);
      }
    }
    if ((offset + 48 * 60 + 1) % 60 === 0) yield;
  }
  return { supported, slots };
}
