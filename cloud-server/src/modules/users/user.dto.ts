import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';

export class UserQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() search?:string;
  @ApiPropertyOptional({enum:['active','disabled']}) @IsOptional() @IsIn(['active','disabled']) status?:string;
  @ApiPropertyOptional({enum:['admin','teacher']}) @IsOptional() @IsIn(['admin','teacher']) role?:string;
  @ApiPropertyOptional({default:50}) @Type(()=>Number) @IsInt() @Min(1) @Max(100) limit=50;
  @ApiPropertyOptional() @IsOptional() @IsString() cursor?:string;
}

export class CreateUserDto {
  @ApiProperty() @IsString() @Length(1,40) name!:string;
  @ApiProperty() @IsString() @Length(3,80) loginName!:string;
  @ApiProperty({enum:['admin','teacher']}) @IsIn(['admin','teacher']) serverRole!:'admin'|'teacher';
}

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({enum:['active','disabled']}) @IsOptional() @IsIn(['active','disabled']) status?:'active'|'disabled';
}

export class BatchCreateTeacherItemDto {
  @ApiProperty() @IsString() @Length(1,40) name!:string;
  @ApiProperty() @IsString() @Length(3,80) loginName!:string;
}

export class BatchCreateTeachersDto {
  @ApiProperty({type:[BatchCreateTeacherItemDto]}) @IsArray() @ArrayMaxSize(500)
  @ValidateNested({each:true}) @Type(()=>BatchCreateTeacherItemDto) items!:BatchCreateTeacherItemDto[];
}
