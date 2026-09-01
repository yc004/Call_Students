import { baseRequestClient, requestClient } from '#/api/request';

export namespace AuthApi {
  /** 登录接口参数 */
  export interface LoginParams {
    organizationSlug: string;
    password?: string;
    loginName?: string;
  }

  export interface SetupParams {
    administratorName: string;
    loginName: string;
    organizationName: string;
    organizationShortName: string;
    password: string;
    primaryColor?: string;
    setupToken: string;
  }

  /** 登录接口返回值 */
  export interface LoginResult {
    accessToken: string;
    refreshToken?: string;
  }

  export interface RefreshTokenResult {
    data: string;
    status: number;
  }
}

/**
 * 登录
 */
export async function loginApi(data: AuthApi.LoginParams) {
  return requestClient.post<AuthApi.LoginResult>('/auth/admin/login', {
    loginName: data.loginName?.trim(),
    organizationSlug:data.organizationSlug?.trim(),
    password: data.password,
    deviceName: '企业管理后台',
  },{headers:{'x-banda-client':'admin-web'}});
}

export async function getSetupStatusApi() {
  return requestClient.get<{ initialized: boolean }>('/setup/status');
}

export async function setupApi(data: AuthApi.SetupParams) {
  return requestClient.post<{organization:{slug:string}}>('/setup', data);
}

/**
 * 刷新accessToken
 */
export async function refreshTokenApi() {
  const session = await baseRequestClient.post<{ accessToken: string }>(
    '/auth/refresh',
    {},
    {headers:{'x-banda-client':'admin-web'}},
  );
  return { data: session.accessToken, status: 200 };
}

/**
 * 退出登录
 */
export async function logoutApi() {
  return baseRequestClient.post('/auth/logout', {},{headers:{'x-banda-client':'admin-web'}});
}

/**
 * 获取用户权限码
 */
export async function getAccessCodesApi() {
  const profile = await requestClient.get<{ permissions: string[] }>('/auth/me');
  return profile.permissions;
}
