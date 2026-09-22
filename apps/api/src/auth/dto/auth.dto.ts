import { IsEmail, IsString, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '@myflix/shared';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  password!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}
