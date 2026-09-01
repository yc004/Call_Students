import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateCampusDto {
  @ApiProperty() @IsString() @Length(1,120) name!:string;
  @ApiProperty() @IsString() @Length(1,40) code!:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?:string;
  @ApiPropertyOptional() @IsOptional() @IsObject() settings?:Record<string,unknown>;
}

export class UpdateCampusDto extends PartialType(CreateCampusDto) {
  @ApiPropertyOptional() @IsOptional() @IsIn(['active','disabled','archived']) status?:string;
}
