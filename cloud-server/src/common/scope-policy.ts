import type { AuthContext } from './auth-context.js';

function hasGrant(auth:AuthContext,permission:string,type:'organization'|'campus'|'classroom',id:string):boolean {
  return auth.grants.some(grant=>grant.permissions.includes(permission)&&grant.scope.type===type&&grant.scope.id===id);
}

export function hasOrganizationScope(auth:AuthContext,permission:string):boolean {
  return hasGrant(auth,permission,'organization',auth.organizationId);
}

export function accessibleCampusIds(auth:AuthContext,permission:string):string[] {
  return auth.grants.filter(grant=>grant.permissions.includes(permission)&&grant.scope.type==='campus'&&grant.scope.id).map(grant=>grant.scope.id!);
}

export function accessibleClassroomIds(auth:AuthContext,permission:string):string[] {
  return auth.grants.filter(grant=>grant.permissions.includes(permission)&&grant.scope.type==='classroom'&&grant.scope.id).map(grant=>grant.scope.id!);
}

export function canAccessCampus(auth:AuthContext,campusId:string,permission:string):boolean {
  return hasOrganizationScope(auth,permission)||accessibleCampusIds(auth,permission).includes(campusId);
}

export function canAccessClassroom(auth:AuthContext,classroomId:string,campusId:string|null,permission:string):boolean {
  return hasOrganizationScope(auth,permission)
    ||(!!campusId&&accessibleCampusIds(auth,permission).includes(campusId))
    ||accessibleClassroomIds(auth,permission).includes(classroomId);
}
