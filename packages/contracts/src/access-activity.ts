export type AccessActivityEvent = {
  id: string;
  source: 'document' | 'shared-link';
  kind:
    | 'document.viewed'
    | 'document.exported'
    | 'link.opened'
    | 'original.accessed';
  actor: 'you' | 'authenticated-account' | 'anonymous-link-holder';
  recordedAt: string;
  documentId: string | null;
  documentLabel: string | null;
};
export type AccessActivity = {
  patientId: string;
  events: AccessActivityEvent[];
  nextCursor: string | null;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const uuid = (v: unknown) =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    v,
  );
export const isActivityCursor = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,240}$/.test(v);
export function isAccessActivity(v: unknown): v is AccessActivity {
  return (
    object(v) &&
    Object.keys(v).length === 3 &&
    uuid(v.patientId) &&
    (v.nextCursor === null || isActivityCursor(v.nextCursor)) &&
    Array.isArray(v.events) &&
    v.events.length <= 20 &&
    v.events.every(
      (e) =>
        object(e) &&
        Object.keys(e).length === 7 &&
        uuid(e.id) &&
        (e.documentId === null || uuid(e.documentId)) &&
        (e.documentId === null
          ? e.documentLabel === null
          : typeof e.documentLabel === 'string' &&
            Array.from(e.documentLabel).length > 0 &&
            Array.from(e.documentLabel).length <= 200) &&
        typeof e.recordedAt === 'string' &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.recordedAt) &&
        Number.isFinite(Date.parse(e.recordedAt)) &&
        new Date(e.recordedAt).toISOString() === e.recordedAt &&
        (e.source === 'document'
          ? ['document.viewed', 'document.exported'].includes(
              e.kind as string,
            ) &&
            ['you', 'authenticated-account'].includes(e.actor as string) &&
            e.documentId !== null
          : e.source === 'shared-link' &&
            ['link.opened', 'original.accessed'].includes(e.kind as string) &&
            e.actor === 'anonymous-link-holder' &&
            (e.kind !== 'original.accessed' || e.documentId !== null)),
    ) &&
    new Set(v.events.map((e) => `${e.source}:${e.id}`)).size ===
      v.events.length &&
    (v.nextCursor === null || v.events.length === 20)
  );
}
