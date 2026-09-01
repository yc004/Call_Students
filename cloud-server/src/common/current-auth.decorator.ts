import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext, AuthenticatedRequest } from './auth-context.js';

export const CurrentAuth = createParamDecorator((_data:unknown, context:ExecutionContext):AuthContext => {
  return context.switchToHttp().getRequest<AuthenticatedRequest>().auth!;
});
