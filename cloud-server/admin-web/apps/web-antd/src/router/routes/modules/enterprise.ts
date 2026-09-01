import type { RouteRecordRaw } from 'vue-router';
const routes: RouteRecordRaw[] = [
  { name:'Dashboard',path:'/dashboard',redirect:'/dashboard/overview',meta:{icon:'lucide:layout-dashboard',order:-1,title:'运营总览'},children:[
    {name:'EnterpriseOverview',path:'overview',component:()=>import('#/views/enterprise/overview.vue'),meta:{affixTab:true,icon:'lucide:area-chart',title:'运营总览'}},
    {name:'ClassroomStatus',path:'classroom-status',component:()=>import('#/views/enterprise/classroom-status.vue'),meta:{icon:'lucide:monitor-check',title:'教室状态',authority:['classroom.read']}},
  ]},
  {name:'EnterpriseManagement',path:'/enterprise',meta:{icon:'lucide:building-2',order:0,title:'企业管理'},children:[
    {name:'OrganizationProfile',path:'profile',component:()=>import('#/views/enterprise/organization.vue'),meta:{icon:'lucide:building',title:'企业基本信息',authority:['organization.manage']}},
    {name:'SubjectManagement',path:'subjects',component:()=>import('#/views/enterprise/subjects.vue'),meta:{icon:'lucide:book-open-check',title:'科目配置',authority:['organization.manage']}},
    {name:'CampusManagement',path:'campuses',component:()=>import('#/views/enterprise/campuses.vue'),meta:{icon:'lucide:map-pin',title:'校区管理',authority:['campus.read']}},
    {name:'UserManagement',path:'users',component:()=>import('#/views/enterprise/users.vue'),meta:{icon:'lucide:users',title:'用户管理',authority:['user.read']}},
    {name:'RoleManagement',path:'roles',component:()=>import('#/views/enterprise/roles.vue'),meta:{icon:'lucide:key-round',title:'角色与权限',authority:['role.read']}},
    {name:'ClassroomManagement',path:'classrooms',component:()=>import('#/views/enterprise/classrooms.vue'),meta:{icon:'lucide:school',title:'教室管理',authority:['classroom.read']}},
    {name:'SecurityAudit',path:'security',component:()=>import('#/views/enterprise/security.vue'),meta:{icon:'lucide:shield-check',title:'安全审计',authority:['audit.read']}},
  ]},
];
export default routes;
