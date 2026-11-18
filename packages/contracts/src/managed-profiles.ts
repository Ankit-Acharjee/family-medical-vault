export type CreateManagedProfile = {
  requestId: string;
  displayName: string;
  confirmed: true;
};
export function isCreateManagedProfile(v: unknown): v is CreateManagedProfile {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    Object.keys(o).length === 3 &&
    typeof o.requestId === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      o.requestId,
    ) &&
    typeof o.displayName === 'string' &&
    o.displayName.trim() === o.displayName &&
    Array.from(o.displayName).length >= 1 &&
    Array.from(o.displayName).length <= 100 &&
    Array.from(o.displayName).every((c) => {
      const n = c.charCodeAt(0);
      return n >= 32 && n !== 127;
    }) &&
    o.confirmed === true
  );
}
export type CreatedManagedProfile = {
  id: string;
  displayName: string;
  relationship: 'caregiver';
  created: boolean;
};
export function isCreatedManagedProfile(
  v: unknown,
): v is CreatedManagedProfile {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return (
    Object.keys(o).length === 4 &&
    typeof o.id === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      o.id,
    ) &&
    o.relationship === 'caregiver' &&
    typeof o.created === 'boolean' &&
    isCreateManagedProfile({
      requestId: o.id,
      displayName: o.displayName,
      confirmed: true,
    })
  );
}
