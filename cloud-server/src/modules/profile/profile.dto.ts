import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,40) name?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,40) nickname?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) currentPassword?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(10) @MaxLength(200) newPassword?:string;
}
