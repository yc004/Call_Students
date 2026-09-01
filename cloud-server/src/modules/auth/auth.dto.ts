import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class SetupDto {
  @ApiProperty() @IsString() @MinLength(16) setupToken!:string;
  @ApiProperty() @IsString() @Length(1,120) organizationName!:string;
  @ApiProperty() @IsString() @Length(1,40) organizationShortName!:string;
  @ApiPropertyOptional({ example:'#2563EB' }) @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) primaryColor?:string;
  @ApiProperty() @IsString() @Length(1,40) administratorName!:string;
  @ApiProperty() @IsString() @Length(3,80) loginName!:string;
  @ApiProperty() @IsString() @Length(12,200) password!:string;
}

export class AdminLoginDto {
  @ApiProperty() @IsString() @Length(1,80) organizationSlug!:string;
  @ApiProperty() @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1,80,{ message:'登录账号不能为空且不能超过 80 个字符' }) loginName!:string;
  @ApiProperty() @IsString() @MaxLength(200) password!:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) deviceName?:string;
}

export class LoginDto {
  @ApiProperty() @IsString() @Length(1,80) organizationSlug!:string;
  @ApiProperty()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1,80,{ message:'登录账号不能为空且不能超过 80 个字符' })
  loginName!:string;
  @ApiProperty() @IsString() @MaxLength(200) password!:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) deviceName?:string;
}

export class RefreshDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(20) refreshToken?:string;
}

export class WechatCodeDto {
  @ApiProperty() @IsString() @Length(5,200) code!:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) deviceName?:string;
}
