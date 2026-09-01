import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../common/auth-context.js';
import type { Database } from '../../database.js';
import { DATABASE } from '../../platform/tokens.js';

@Injectable()
export class ClientAccessService {
  constructor(@Inject(DATABASE) private readonly database:Database) {}

  async classrooms(auth:AuthContext) {
    return(await this.database.query(
      `SELECT c.id,c.name,c.configured,c.revision,c.status,m.role,m.subjects_json,
       d.status AS device_status,d.lan_connection_code,d.lan_addresses_json,d.last_seen_at AS device_last_seen_at,
       CASE WHEN d.status='online' AND d.last_seen_at>now()-interval '60 seconds' THEN true ELSE false END AS public_relay_available
       FROM classroom_members m JOIN classrooms c ON c.id=m.classroom_id
       LEFT JOIN LATERAL(SELECT status,lan_connection_code,lan_addresses_json,last_seen_at FROM classroom_devices
         WHERE classroom_id=c.id AND revoked_at IS NULL ORDER BY last_seen_at DESC NULLS LAST,created_at DESC LIMIT 1)d ON true
       WHERE m.user_id=$1 AND m.status='approved' AND c.organization_id=$2 AND c.deleted_at IS NULL AND c.status='active'
       ORDER BY c.name`,[auth.subjectId,auth.organizationId])).rows;
  }

  async subjects(auth:AuthContext) {
    return(await this.database.query(
      `SELECT id,name,code,sort_order FROM subjects WHERE organization_id=$1 AND status='active' AND deleted_at IS NULL ORDER BY sort_order,name`,
      [auth.organizationId])).rows;
  }

  async snapshot(auth:AuthContext,classroomId:string) {
    const teacher=await this.membership(auth,classroomId);
    const allSubjects=teacher.role==='homeroom';
    const subjects=(Array.isArray(teacher.subjects_json)?teacher.subjects_json:[]).map((value:unknown)=>String(value).toLowerCase());
    const[classroom,students,assignments,submissions,members]=await Promise.all([
      this.database.query('SELECT id,name,configured,revision,status,updated_at FROM classrooms WHERE id=$1',[classroomId]),
      this.database.query("SELECT id,name,sort_order FROM students WHERE classroom_id=$1 AND status='active' ORDER BY sort_order,created_at",[classroomId]),
      this.database.query("SELECT id,subject,type,title,publish_at,deadline,source,created_at,updated_at FROM assignments WHERE classroom_id=$1 AND status='active' AND ($2::boolean OR lower(subject)=ANY($3::text[])) ORDER BY created_at DESC",[classroomId,allSubjects,subjects]),
      this.database.query(`SELECT s.assignment_id,s.student_id,s.status,s.updated_at FROM submissions s JOIN assignments a ON a.id=s.assignment_id JOIN students st ON st.id=s.student_id AND st.classroom_id=a.classroom_id WHERE a.classroom_id=$1 AND a.status='active' AND st.status='active' AND ($2::boolean OR lower(a.subject)=ANY($3::text[]))`,[classroomId,allSubjects,subjects]),
      this.database.query(`SELECT m.user_id,u.name,m.role,m.subjects_json,m.joined_at FROM classroom_members m JOIN users u ON u.id=m.user_id WHERE m.classroom_id=$1 AND m.status='approved' ORDER BY m.created_at`,[classroomId]),
    ]);
    return{classroom:classroom.rows[0],students:students.rows,assignments:assignments.rows,submissions:submissions.rows,members:members.rows,teacher};
  }

  async leave(auth:AuthContext,classroomId:string) {
    const member=await this.membership(auth,classroomId);
    if(member.role==='homeroom')throw new ForbiddenException('班主任不能直接退出教室，请先在管理后台移交班主任');
    await this.database.query('DELETE FROM classroom_members WHERE classroom_id=$1 AND user_id=$2',[classroomId,auth.subjectId]);
  }

  private async membership(auth:AuthContext,classroomId:string) {
    const row=(await this.database.query(
      `SELECT m.user_id,m.role,m.subjects_json FROM classroom_members m JOIN classrooms c ON c.id=m.classroom_id
       WHERE m.classroom_id=$1 AND m.user_id=$2 AND m.status='approved' AND c.organization_id=$3 AND c.deleted_at IS NULL`,
      [classroomId,auth.subjectId,auth.organizationId])).rows[0];
    if(!row)throw new NotFoundException('教室不存在或当前账号不是教室成员');
    return row;
  }
}
