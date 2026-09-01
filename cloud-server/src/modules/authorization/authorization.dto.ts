import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty() @IsString() @Length(2,60) code!:string;
  @ApiProperty() @IsString() @Length(1,80) name!:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,500) description?:string;
  @ApiProperty({ enum:['organization','campus','classroom','self'] }) @IsIn(['organization','campus','classroom','self']) dataScope!:string;
  @ApiProperty({ type:[String] }) @IsArray() @ArrayUnique() @ArrayMaxSize(50) @IsString({each:true}) permissions!:string[];
}

export class SetRolePermissionsDto {
  @ApiProperty({type:[String]}) @IsArray() @ArrayUnique() @ArrayMaxSize(50) @IsString({each:true}) permissions!:string[];
}

export class CreateRoleBindingDto {
  @ApiProperty() @IsUUID() roleId!:string;
  @ApiProperty({enum:['organization','campus','classroom']}) @IsIn(['organization','campus','classroom']) scopeType!:'organization'|'campus'|'classroom';
  @ApiProperty() @IsUUID() scopeId!:string;
}
