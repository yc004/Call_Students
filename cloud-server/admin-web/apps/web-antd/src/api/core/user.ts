import type { UserInfo } from '@vben/types';

import { requestClient } from '#/api/request';
import { applyOrganizationBranding } from '#/utils/branding';

/**
 * 获取用户信息
 */
export async function getUserInfoApi() {
  const profile = await requestClient.get<{
    organization: {
      logoUrl?: string;
      name: string;
      primaryColor?: string;
      shortName?: string;
    };
    permissions: string[];
    user: { id: string; loginName: string; name: string; role: string };
  }>('/auth/me');
  applyOrganizationBranding(profile.organization);
  return {
    avatar: '',
    desc: profile.organization.name,
    homePath: '/dashboard/overview',
    realName: profile.user.name,
    // Vben uses `roles` as the authority collection when filtering routes.
    roles: [profile.user.role, ...(profile.permissions || [])],
    token: '',
    userId: profile.user.id,
    username: profile.user.loginName,
  } satisfies UserInfo;
}
