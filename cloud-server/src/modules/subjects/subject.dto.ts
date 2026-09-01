import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateSubjectDto {
  @ApiProperty() @IsString() @Length(1,80) name!:string;
  @ApiPropertyOptional({ minimum:0, maximum:9999 }) @IsOptional() @IsInt() @Min(0) @Max(9999) sortOrder?:number;
}

export class UpdateSubjectDto extends PartialType(CreateSubjectDto) {
  @ApiPropertyOptional({ enum:['active','disabled'] }) @IsOptional() @IsIn(['active','disabled']) status?:'active'|'disabled';
}
