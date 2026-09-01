import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './auth-context.js';
import { IS_PUBLIC } from './public.decorator.js';
import { REQUIRED_PERMISSIONS } from './permissions.decorator.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector:Reflector) {}

  canActivate(context:ExecutionContext):boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) return true;
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, [context.getHandler(), context.getClass()]) || [];
    if (!required.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth || !required.every(permission => request.auth!.permissions.includes(permission))) {
      throw new ForbiddenException('当前账号没有执行该操作的权限');
    }
    return true;
  }
}
