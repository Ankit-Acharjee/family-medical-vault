// Package foundation; implementation follows in its dedicated delivery task.
// Provider tokens, Person IDs and patient grants are intentionally absent.
export type AuthBootstrap = { enabled: boolean; csrf: string | null };
export type AuthAccount = { email: string };
export type AuthNotice = { message: string };
export type AuthCredentials = { email: string; password: string };
