import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class RegisterClassroomDeviceDto {
  @ApiProperty() @IsUUID() classroomId!:string;
  @ApiProperty() @IsString() @Length(1,120) deviceName!:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,40) appVersion?:string;
}

export class LoginClassroomDeviceDto {
  @ApiProperty() @IsString() @Length(1,80) organizationSlug!:string;
  @ApiProperty() @IsString() @Length(3,80) loginName!:string;
  @ApiProperty() @IsString() @Length(10,200) password!:string;
  @ApiProperty() @IsString() @Length(1,120) deviceName!:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,40) appVersion?:string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() installationId?:string;
}

export class RevokeClassroomDeviceDto {
  @ApiProperty() @IsString() @Length(20,200) deviceToken!:string;
}

export class DeviceHeartbeatDto {
  @ApiProperty() @IsString() @Length(20,200) deviceToken!:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,40) appVersion?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,20) lanConnectionCode?:string;
}
