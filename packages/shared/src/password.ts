import { hash, verify, Algorithm } from "@node-rs/argon2";

/** Argon2id parameters fixed by doc 04 §3.1. */
export const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (plain: string) => hash(plain, ARGON2_OPTIONS);

export const verifyPassword = (digest: string, plain: string) =>
  verify(digest, plain, ARGON2_OPTIONS);

/** BR: at least 10 characters, at least one letter and one digit. */
export const PASSWORD_MIN_LENGTH = 10;
export function isPasswordAcceptable(plain: string): boolean {
  return (
    plain.length >= PASSWORD_MIN_LENGTH &&
    /[A-Za-z]/.test(plain) &&
    /[0-9]/.test(plain)
  );
}
