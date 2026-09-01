import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsHexColor, IsObject, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class UpdateOrganizationDto {
  @ApiProperty() @IsString() @Length(1,120) name!:string;
  @ApiProperty() @IsString() @Length(1,40) shortName!:string;
  @ApiPropertyOptional() @IsOptional() @MaxLength(500) @Matches(/^(?:https?:\/\/\S+|\/uploads\/logos\/[0-9a-f-]+\.(?:png|jpg|webp))$/i,{message:'Logo 地址格式不正确'}) logoUrl?:string;
  @ApiProperty() @IsHexColor() primaryColor!:string;
  @ApiPropertyOptional({example:'Asia/Shanghai'}) @IsOptional() @IsString() @MaxLength(64) timezone?:string;
  @ApiPropertyOptional() @IsOptional() @IsObject() settings?:Record<string,unknown>;
}
