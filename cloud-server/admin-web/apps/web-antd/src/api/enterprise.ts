import { requestClient } from './request';

type Query = Record<string, number | string | undefined>;

export const enterpriseApi = {
  organization: () => requestClient.get<any>('/organization'),
  updateOrganization: (data: Record<string, unknown>) =>
    requestClient.request<any>('/organization', { data, method: 'PATCH' }),
  uploadOrganizationLogo: async (file: File) => {
    const data = await file.arrayBuffer();
    return requestClient.request<any>('/organization/logo', {
      data,
      headers: { 'Content-Type': file.type },
      method: 'POST',
      // The shared request client defaults to JSON. Keep the image bytes intact.
      transformRequest: [(value) => value],
    });
  },
  removeOrganizationLogo: () => requestClient.delete<any>('/organization/logo'),
  campuses: () => requestClient.get<any[]>('/campuses'),
  createCampus: (data: Record<string, unknown>) =>
    requestClient.post<any>('/campuses', data),
  updateCampus: (id: string, data: Record<string, unknown>) =>
    requestClient.request<any>(`/campuses/${id}`, { data, method: 'PATCH' }),
  archiveCampus: (id: string) => requestClient.delete(`/campuses/${id}`),
  subjects: (activeOnly = false) =>
    requestClient.get<any[]>('/subjects', {
      params: { activeOnly: activeOnly ? 'true' : undefined },
    }),
  createSubject: (data: Record<string, unknown>) =>
    requestClient.post<any>('/subjects', data),
  updateSubject: (id: string, data: Record<string, unknown>) =>
    requestClient.request<any>(`/subjects/${id}`, { data, method: 'PATCH' }),
  deleteSubject: (id: string) => requestClient.delete(`/subjects/${id}`),
  users: (params: Query = {}) =>
    requestClient.get<{ items: any[]; nextCursor: null | string; total: number }>('/users', { params }),
  user: (id: string) => requestClient.get<any>(`/users/${id}`),
  createUser: (data: Record<string, unknown>) => requestClient.post<any>('/users', data),
  batchCreateTeachers: (items: Array<{ loginName: string; name: string }>) => requestClient.post<any>('/users/batch', { items }),
  updateUser: (id: string, data: Record<string, unknown>) => requestClient.request<any>(`/users/${id}`, { data, method: 'PATCH' }),
  resetUserPassword: (id: string) => requestClient.post<any>(`/users/${id}/reset-password`),
  deleteUser: (id: string) => requestClient.delete(`/users/${id}`),
  revokeUserDevice: (userId: string, deviceId: string) => requestClient.delete(`/users/${userId}/devices/${deviceId}`),
  permissions: () => requestClient.get<string[]>('/permissions'),
  roles: () => requestClient.get<any[]>('/roles'),
  createRole: (data: Record<string, unknown>) => requestClient.post<any>('/roles', data),
  setRolePermissions: (id: string, permissions: string[]) => requestClient.put(`/roles/${id}/permissions`, { permissions }),
  bindRole: (userId: string, data: Record<string, unknown>) => requestClient.post<any>(`/users/${userId}/role-bindings`, data),
  unbindRole: (id: string) => requestClient.delete(`/role-bindings/${id}`),
  classrooms: () => requestClient.get<any[]>('/classrooms'),
  classroomStatus: () => requestClient.get<any>('/classrooms/status/overview'),
  classroom: (id: string) => requestClient.get<any>(`/classrooms/${id}`),
  createClassroom: (data: Record<string, unknown>) => requestClient.post<any>('/classrooms', data),
  batchCreateClassrooms: (items: Array<{ campusId: string; loginName?: string; name: string }>) => requestClient.post<any>('/classrooms/batch', { items }),
  resetClassroomPassword: (id: string) => requestClient.post<any>(`/classrooms/${id}/reset-password`),
  updateClassroom: (id: string, data: Record<string, unknown>) => requestClient.request<any>(`/classrooms/${id}`, { data, method: 'PATCH' }),
  archiveClassroom: (id: string) => requestClient.delete(`/classrooms/${id}`),
  replaceStudents: (id: string, students: Array<{ id?: string; name: string }>) => requestClient.put<any>(`/classrooms/${id}/students`, { students }),
  upsertMember: (id: string, data: Record<string, unknown>) => requestClient.put(`/classrooms/${id}/members`, data),
  removeMember: (id: string, userId: string) => requestClient.delete(`/classrooms/${id}/members/${userId}`),
  classroomDevices: () => requestClient.get<any[]>('/classroom-devices'),
  revokeClassroomDevice: (id: string) => requestClient.delete(`/classroom-devices/${id}`),
  audits: (params: Query = {}) => requestClient.get<{ items: any[]; nextCursor: null | string }>('/audit-logs', { params }),
};
