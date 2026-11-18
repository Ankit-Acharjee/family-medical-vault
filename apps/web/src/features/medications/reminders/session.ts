import type { MedicationScheduleHistory } from '@fmv/contracts';
import { clockDayIndex, localClock } from './clock';
import type { ClockDayIndex } from './clock';
export type ReminderState =
  'checking' | 'enabled' | 'review' | 'unavailable' | 'due';
export type ReminderItem = { id: string; state: ReminderState };
type Selection = {
  id: string;
  medicationRevision: number;
  revision: number;
  timing: Extract<
    NonNullable<MedicationScheduleHistory['current']>['definition']['timing'],
    { kind: 'clock-times' }
  >;
  startDate: string | null;
  endDate: string | null;
  after: number;
  last: number;
};
export function reminderEligible(data: MedicationScheduleHistory) {
  return (
    data.canWrite &&
    data.medicationStatus === 'current' &&
    data.sourceState === 'current-source' &&
    data.current?.recordedState === 'recorded' &&
    data.current.medicationRevision === data.medicationRevision &&
    data.current.definition.timing.kind === 'clock-times'
  );
}
/** Page-memory operational intent only. Every due notice requires a fresh authorized read. */
export class PageReminderSession {
  private selections = new Map<string, Selection>();
  private states = new Map<string, ReminderState>();
  private cache = new Map<string, ClockDayIndex>();
  private active = false;
  private generation = 0;
  private abort = new AbortController();
  private busy = false;
  private lastTick = 0;
  constructor(
    private io: {
      now: () => number;
      load: (
        id: string,
        signal: AbortSignal,
      ) => Promise<MedicationScheduleHistory>;
      yield: (signal: AbortSignal) => Promise<void>;
      publish: (items: ReminderItem[]) => void;
    },
  ) {}
  private publish() {
    this.io.publish([...this.states].map(([id, state]) => ({ id, state })));
  }
  setActive(value: boolean) {
    if (this.active === value) return;
    this.active = value;
    this.generation++;
    this.abort.abort();
    this.abort = new AbortController();
    this.lastTick = this.io.now();
    for (const [id, s] of this.selections) {
      s.after = Math.floor(this.io.now() / 60000) * 60000;
      if (this.states.get(id) === 'due') this.states.set(id, 'enabled');
    }
    // Interrupted opt-ins must be explicitly retried, never silently enabled.
    for (const [id, state] of this.states)
      if (state === 'checking') {
        this.selections.delete(id);
        this.states.delete(id);
      }
    this.publish();
  }
  clear() {
    this.setActive(false);
    this.generation++;
    this.abort.abort();
    this.abort = new AbortController();
    this.selections.clear();
    this.states.clear();
    this.cache.clear();
    this.publish();
  }
  stop(id?: string) {
    if (id) {
      this.selections.delete(id);
      this.states.delete(id);
    } else {
      this.generation++;
      this.abort.abort();
      this.abort = new AbortController();
      this.selections.clear();
      this.states.clear();
    }
    this.publish();
  }
  private same(data: MedicationScheduleHistory, s: Selection) {
    return (
      data.medicationId === s.id &&
      reminderEligible(data) &&
      data.medicationRevision === s.medicationRevision &&
      data.current?.revision === s.revision
    );
  }
  private async index(zone: string, date: string, signal: AbortSignal) {
    const key = zone + ':' + date;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const iterator = clockDayIndex(zone, date);
    let result = iterator.next();
    while (!result.done) {
      signal.throwIfAborted();
      await this.io.yield(signal);
      signal.throwIfAborted();
      result = iterator.next();
    }
    signal.throwIfAborted();
    if (this.cache.size >= 32)
      this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, result.value);
    return result.value;
  }
  private async occurrence(s: Selection, now: number, signal: AbortSignal) {
    const clock = localClock(s.timing.timeZone, now);
    if (!clock) return { review: true, due: false };
    if (
      (s.startDate && clock.date < s.startDate) ||
      (s.endDate && clock.date > s.endDate) ||
      !s.timing.weekdays.includes(clock.weekday)
    )
      return { review: false, due: false };
    const index = await this.index(s.timing.timeZone, clock.date, signal);
    if (
      !index.supported ||
      s.timing.times.some((t) => index.slots.get(t)?.length !== 1)
    )
      return { review: true, due: false };
    const instant = index.slots.get(clock.time)?.[0];
    return {
      review: false,
      due:
        s.timing.times.includes(clock.time) &&
        instant !== undefined &&
        instant > s.after &&
        instant > s.last &&
        now >= instant &&
        now < instant + 60000,
      instant,
    };
  }
  async enable(expected: MedicationScheduleHistory) {
    const id = expected.medicationId;
    if (
      !this.active ||
      this.states.get(id) === 'checking' ||
      this.states.size >= 20 ||
      !reminderEligible(expected)
    )
      return;
    const definition = expected.current?.definition;
    if (!definition || definition.timing.kind !== 'clock-times') return;
    const signal = this.abort.signal,
      generation = this.generation;
    // Object identity fences a stop followed by a new opt-in of the same ID.
    const s: Selection = {
      id,
      medicationRevision: expected.medicationRevision,
      revision: expected.current!.revision,
      timing: {
        ...definition.timing,
        weekdays: [...definition.timing.weekdays],
        times: [...definition.timing.times],
      },
      startDate: definition.startDate,
      endDate: definition.endDate,
      after: Math.floor(this.io.now() / 60000) * 60000,
      last: 0,
    };
    this.selections.set(id, s);
    this.states.set(id, 'checking');
    this.publish();
    const valid = () =>
      this.active &&
      generation === this.generation &&
      this.selections.get(id) === s &&
      !signal.aborted;
    try {
      const data = await this.io.load(id, signal);
      if (!valid()) return;
      if (!this.same(data, s) || data.patientId !== expected.patientId)
        throw Error();
      const d = data.current!.definition;
      if (d.timing.kind !== 'clock-times') throw Error();
      Object.assign(s, {
        id,
        medicationRevision: data.medicationRevision,
        revision: data.current!.revision,
        timing: {
          ...d.timing,
          weekdays: [...d.timing.weekdays],
          times: [...d.timing.times],
        },
        startDate: d.startDate,
        endDate: d.endDate,
        after: Math.floor(this.io.now() / 60000) * 60000,
        last: 0,
      });
      const check = await this.occurrence(s, this.io.now(), signal);
      if (!valid()) return;
      if (check.review) {
        this.selections.delete(id);
        this.states.set(id, 'review');
      } else this.states.set(id, 'enabled');
    } catch {
      if (valid()) {
        this.selections.delete(id);
        this.states.set(id, 'unavailable');
      }
    }
    if (valid() || (!signal.aborted && generation === this.generation))
      this.publish();
  }
  async tick() {
    if (!this.active || this.busy) return;
    const now = this.io.now(),
      previous = this.lastTick;
    this.lastTick = now;
    if (now < previous || now - previous > 90000) {
      for (const [id, s] of this.selections) {
        s.after = Math.floor(now / 60000) * 60000;
        if (this.states.get(id) === 'due') this.states.set(id, 'enabled');
      }
    }
    this.busy = true;
    const signal = this.abort.signal,
      generation = this.generation;
    try {
      for (const [id, s] of this.selections) {
        if (this.states.get(id) === 'checking') continue;
        const valid = () =>
          this.active &&
          !signal.aborted &&
          generation === this.generation &&
          this.selections.get(id) === s;
        try {
          const check = await this.occurrence(s, now, signal);
          if (!valid()) continue;
          if (check.review) {
            this.selections.delete(id);
            this.states.set(id, 'review');
            continue;
          }
          if (!check.due) {
            if (this.states.get(id) === 'due' && now >= s.last + 60000)
              this.states.set(id, 'enabled');
            continue;
          }
          const data = await this.io.load(id, signal);
          if (!valid()) continue;
          if (!this.same(data, s)) throw Error();
          const actual = this.io.now();
          if (actual < check.instant! || actual >= check.instant! + 60000)
            continue;
          s.last = check.instant!;
          this.states.set(id, 'due');
        } catch {
          if (valid()) {
            this.selections.delete(id);
            this.states.set(id, 'unavailable');
          }
        }
      }
      if (this.active && generation === this.generation) this.publish();
    } finally {
      this.busy = false;
    }
  }
}
