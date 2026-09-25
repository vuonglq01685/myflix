import type { UserRole } from "../enums";

export interface RegisterRequest {
  email: string;
  password: string;
}
export interface RegisterResponse {
  userId: string;
  email: string;
  role: UserRole;
}

export interface LoginRequest {
  email: string;
  password: string;
}
export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
  profiles: ProfileSummary[];
}

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}
export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

export interface ProfileSummary {
  id: string;
  name: string;
  avatarUrl: string | null;
  isKids: boolean;
}

export interface CreateProfileRequest {
  name: string;
  isKids?: boolean;
  avatarKey?: string;
}

export interface UpdateProfileRequest {
  name?: string;
  avatarKey?: string;
  language?: string;
  autoplayNext?: boolean;
  autoplayPreviews?: boolean;
}
