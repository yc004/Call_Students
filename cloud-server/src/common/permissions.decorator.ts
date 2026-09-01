import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS = 'requiredPermissions';
export const RequirePermissions = (...permissions:string[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);
