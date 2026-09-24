import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { CurrentUser, Public, type RequestUser } from "../common/decorators";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { AuthService } from "./auth.service";
import { LoginDto, RegisterDto } from "./dto/auth.dto";

@Controller("auth")
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) _res: Response) {
    // TODO(phase-2): set the refresh_token cookie — HttpOnly, SameSite=Lax,
    // Max-Age = JWT_REFRESH_TTL — and strip it from the JSON body.
    return this.auth.login(dto);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Req() req: Request, @Res({ passthrough: true }) _res: Response) {
    return this.auth.refresh(String(req.cookies?.refresh_token ?? ""));
  }

  @Post("logout")
  @HttpCode(204)
  logout(
    @CurrentUser() _user: RequestUser,
    @Res({ passthrough: true }) _res: Response,
  ) {
    // TODO(phase-2): revoke the presented jti and clear both cookies.
    return;
  }

  @Get("me")
  me(@CurrentUser() user: RequestUser) {
    return user;
  }
}
