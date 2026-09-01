import{ApiProperty,ApiPropertyOptional,PartialType}from'@nestjs/swagger';import{IsDateString,IsIn,IsOptional,IsString,Length}from'class-validator';
export class CreateAssignmentDto{@ApiProperty()@IsString()@Length(1,80)subject!:string;@ApiProperty({enum:['homework','notice']})@IsIn(['homework','notice'])type!:'homework'|'notice';@ApiProperty()@IsString()@Length(1,1000)title!:string;@ApiPropertyOptional()@IsOptional()@IsDateString()deadline?:string;}
export class UpdateAssignmentDto extends PartialType(CreateAssignmentDto){}
export class UpdateSubmissionDto{@ApiProperty({enum:['未提交','已提交','请假','免交']})@IsIn(['未提交','已提交','请假','免交'])status!:'未提交'|'已提交'|'请假'|'免交';}
