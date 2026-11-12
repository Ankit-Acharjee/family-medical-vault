import { randomUUID } from 'node:crypto';

const opaque = /^[a-f0-9]{32}$/;
const documentUuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const namespaced = /^originals\/v1\/[a-f0-9]{32}\/[a-f0-9]{32}\/[a-f0-9]{32}$/;

export function isObjectKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ((value.length === 32 && opaque.test(value)) ||
      (value.length === 111 && namespaced.test(value)))
  );
}

export function createObjectKey(scope: string, documentId: string): string {
  if (
    scope.length !== 32 ||
    documentId.length !== 36 ||
    !opaque.test(scope) ||
    !documentUuid.test(documentId)
  )
    throw new Error('Invalid storage identity');
  return `originals/v1/${scope}/${documentId.replaceAll('-', '')}/${randomUUID().replaceAll('-', '')}`;
}
