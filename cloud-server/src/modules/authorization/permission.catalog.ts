export const PERMISSIONS = [
  'organization.read','organization.manage','campus.read','campus.manage','user.read','user.manage',
  'role.read','role.manage','classroom.read','classroom.manage','device.read','device.manage',
  'content.read','content.manage','audit.read','audit.export','operations.read','operations.manage',
] as const;
export type Permission = typeof PERMISSIONS[number];
