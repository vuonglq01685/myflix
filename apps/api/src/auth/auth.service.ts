import { Injectable, NotImplementedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import type {
  LoginResponse,
  RefreshResponse,
  RegisterResponse,
} from "@myflix/shared";
import { PrismaService } from "../prisma/prisma.service";
import { RefreshTokenService } from "./refresh-token.service";
import type { RegisterDto, LoginDto } from "./dto/auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  // TODO(phase-2): hashPassword, honour ALLOW_REGISTRATION, create the
  // default profile in the same transaction as the user.
  register(_dto: RegisterDto): Promise<RegisterResponse> {
    throw new NotImplementedException("AuthService.register");
  }

  // TODO(phase-2): verifyPassword, then issue access + refresh, returning the
  // profile list so the client can render "Ai đang xem?" without a round trip.
  login(_dto: LoginDto): Promise<LoginResponse & { refreshToken: string }> {
    throw new NotImplementedException("AuthService.login");
  }

  // TODO(phase-2): consume the old jti; on a miss call revokeAll and throw
  // TOKEN_REUSED (AC-002-2).
  refresh(
    _refreshToken: string,
  ): Promise<RefreshResponse & { refreshToken: string }> {
    throw new NotImplementedException("AuthService.refresh");
  }

  logout(_userId: string, _jti: string): Promise<void> {
    throw new NotImplementedException("AuthService.logout");
  }
}
