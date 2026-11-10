// Public API shapes never contain provider tokens or patient grants.
export type AuthBootstrap = { enabled: boolean; csrf: string | null };
export type AuthAccount = { email: string };
export type AuthNotice = { message: string };
export type AuthCredentials = { email: string; password: string };
export type OwnPerson = { id: string; displayName: string };
export type OwnPersonResult = { person: OwnPerson | null };
