import type { AccessSubject } from '../security.js';

export type AuthContext = AccessSubject & {
  permissions:string[];
  scopes:Array<{ type:'organization'|'campus'|'classroom'; id:string|null }>;
  grants:Array<{
    roleId:string;
    scope:{ type:'organization'|'campus'|'classroom'; id:string|null };
    permissions:string[];
  }>;
};

export type AuthenticatedRequest = {
  id?:string;
  ip:string;
  headers:Record<string, string | string[] | undefined>;
  auth?:AuthContext;
};
