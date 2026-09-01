<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Page } from '@vben/common-ui';
import { Alert, Badge, Button, Card, Col, Input, Row, Select, SelectOption, Space, Statistic, Switch, Table, Tag, message } from 'ant-design-vue';
import { enterpriseApi } from '#/api';

type ConnectionStatus = 'offline' | 'online' | 'unbound';
interface ClassroomStatusItem {
  app_ready:boolean;app_version?:null|string;campus_id:string;campus_name:string;classroom_status:string;configured:boolean;
  connection_status:ConnectionStatus;device_last_seen_at?:null|string;device_name?:null|string;device_status_fresh:boolean;
  id:string;name:string;revision:number;student_count:number;teacher_count:number;
}
interface StatusOverview {
  generatedAt:string;items:ClassroomStatusItem[];privacy:{attendanceCloudAvailable:false;message:string};
  summary:{offlineClassrooms:number;onlineClassrooms:number;registeredStudents:number;teacherMembers:number;totalClassrooms:number;unboundClassrooms:number};
}

const loading=ref(false),loadError=ref(''),overview=ref<StatusOverview|null>(null),keyword=ref(''),campusFilter=ref('all'),autoRefresh=ref(true);
const statusFilter=ref<'all'|ConnectionStatus>('all');
let refreshTimer:ReturnType<typeof setInterval>|undefined;
const columns=[
  {key:'classroom',title:'教室',width:210},{dataIndex:'connection_status',key:'connection_status',title:'连接状态',width:110},
  {dataIndex:'student_count',key:'student_count',title:'学生人数',width:110},{dataIndex:'teacher_count',key:'teacher_count',title:'教师成员',width:100},
  {key:'health',title:'应用状态',width:120},
  {key:'device',title:'教室端设备',width:190},{dataIndex:'device_last_seen_at',key:'last_seen',title:'最近在线',width:170},{key:'configuration',title:'配置状态',width:110},
];
const summary=computed(()=>overview.value?.summary??{offlineClassrooms:0,onlineClassrooms:0,registeredStudents:0,teacherMembers:0,totalClassrooms:0,unboundClassrooms:0});
const campusOptions=computed(()=>{const campuses=new Map<string,string>();for(const item of overview.value?.items??[])campuses.set(item.campus_id,item.campus_name);return[...campuses.entries()].map(([value,label])=>({label,value}));});
const filteredRows=computed(()=>{const text=keyword.value.trim().toLowerCase();return(overview.value?.items??[]).filter(item=>(!text||item.name.toLowerCase().includes(text)||item.campus_name.toLowerCase().includes(text)||item.device_name?.toLowerCase().includes(text))&&(statusFilter.value==='all'||item.connection_status===statusFilter.value)&&(campusFilter.value==='all'||item.campus_id===campusFilter.value));});
const statusMeta:Record<ConnectionStatus,{label:string;status:'default'|'error'|'success'}>={offline:{label:'离线',status:'error'},online:{label:'在线',status:'success'},unbound:{label:'未绑定',status:'default'}};

async function load(silent=false){if(!silent)loading.value=true;try{overview.value=await enterpriseApi.classroomStatus();loadError.value='';}catch{loadError.value='无法读取教室运行状态，请检查服务连接后重试。';if(silent)message.error('教室状态自动刷新失败');}finally{loading.value=false;}}
function formatTime(value?:null|string){if(!value)return'从未在线';return new Intl.DateTimeFormat('zh-CN',{day:'2-digit',hour:'2-digit',minute:'2-digit',month:'2-digit',second:'2-digit'}).format(new Date(value));}
function startRefresh(){if(refreshTimer)clearInterval(refreshTimer);refreshTimer=setInterval(()=>{if(autoRefresh.value&&document.visibilityState==='visible')void load(true);},20_000);}
onMounted(()=>{void load();startRefresh();});onBeforeUnmount(()=>{if(refreshTimer)clearInterval(refreshTimer);});
</script>

<template>
  <Page title="教室状态" description="集中查看各校区教室的设备在线与应用健康状态">
    <Alert class="mb-4" show-icon type="info" message="数据与隐私说明" :description="overview?.privacy.message||'人脸识别和学生出勤结果仅保留在教室本机。'" />
    <Alert v-if="loadError" class="mb-4" show-icon type="error" message="教室状态读取失败" :description="loadError"><template #action><Button size="small" @click="load(false)">重新加载</Button></template></Alert>
    <Row :gutter="[16,16]" class="mb-4">
      <Col :xs="12" :sm="8" :xl="4"><Card size="small"><Statistic title="教室总数" :value="overview ? summary.totalClassrooms : '—'" /></Card></Col>
      <Col :xs="12" :sm="8" :xl="4"><Card size="small"><Statistic title="在线教室" :value="overview ? summary.onlineClassrooms : '—'" :value-style="{color:'#16a34a'}" /></Card></Col>
      <Col :xs="12" :sm="8" :xl="4"><Card size="small"><Statistic title="离线教室" :value="overview ? summary.offlineClassrooms : '—'" :value-style="{color:'#dc2626'}" /></Card></Col>
      <Col :xs="12" :sm="8" :xl="4"><Card size="small"><Statistic title="未绑定设备" :value="overview ? summary.unboundClassrooms : '—'" :value-style="{color:'#d97706'}" /></Card></Col>
      <Col :xs="12" :sm="8" :xl="4"><Card size="small"><Statistic title="已录入学生" :value="overview ? summary.registeredStudents : '—'" suffix="人" /></Card></Col>
      <Col :xs="12" :sm="8" :xl="4"><Card size="small"><Statistic title="教师成员" :value="overview ? summary.teacherMembers : '—'" suffix="人" /></Card></Col>
    </Row>
    <Card>
      <div class="status-toolbar mb-4"><Space wrap><Input.Search v-model:value="keyword" allow-clear placeholder="搜索教室、校区或设备" style="width:250px" /><Select v-model:value="statusFilter" style="width:130px"><SelectOption value="all">全部状态</SelectOption><SelectOption value="online">在线</SelectOption><SelectOption value="offline">离线</SelectOption><SelectOption value="unbound">未绑定</SelectOption></Select><Select v-model:value="campusFilter" style="width:160px"><SelectOption value="all">全部校区</SelectOption><SelectOption v-for="campus in campusOptions" :key="campus.value" :value="campus.value">{{campus.label}}</SelectOption></Select></Space><Space wrap><span class="text-gray-500">自动刷新</span><Switch v-model:checked="autoRefresh" /><span class="text-gray-500">最后更新：{{formatTime(overview?.generatedAt)}}</span><Button :loading="loading" @click="load(false)">立即刷新</Button></Space></div>
      <Table row-key="id" :columns="columns" :data-source="filteredRows" :loading="loading" :pagination="{pageSize:20,showSizeChanger:true,showTotal:(total:number)=>`共 ${total} 间教室`}" :scroll="{x:1480}">
        <template #bodyCell="{column,record}">
          <template v-if="column.key==='classroom'"><div class="font-medium">{{record.name}}</div><div class="mt-1 text-xs text-gray-500">{{record.campus_name}}</div></template>
          <Badge v-else-if="column.key==='connection_status'" :status="statusMeta[record.connection_status as ConnectionStatus].status" :text="statusMeta[record.connection_status as ConnectionStatus].label" />
          <span v-else-if="column.key==='student_count'" class="font-medium">{{record.student_count}} 人</span><span v-else-if="column.key==='teacher_count'">{{record.teacher_count}} 人</span>
          <template v-else-if="column.key==='health'"><Tag :color="record.app_ready?'green':'default'">{{record.device_status_fresh?(record.app_ready?'运行正常':'初始化中'):'无最新状态'}}</Tag></template>
          <template v-else-if="column.key==='device'"><template v-if="record.device_name"><div>{{record.device_name}}</div><div class="mt-1 text-xs text-gray-500">{{record.app_version?`版本 ${record.app_version}`:'版本未知'}}</div></template><span v-else class="text-gray-400">暂无设备</span></template>
          <span v-else-if="column.key==='last_seen'" :class="record.device_last_seen_at?'':'text-gray-400'">{{formatTime(record.device_last_seen_at)}}</span>
          <template v-else-if="column.key==='configuration'"><Tag :color="record.configured?'green':'orange'">{{record.configured?'已配置':'待配置'}}</Tag><Tag v-if="record.classroom_status!=='active'" class="mt-1">已停用</Tag></template>
        </template>
      </Table>
    </Card>
  </Page>
</template>

<style scoped>.status-toolbar{align-items:center;display:flex;gap:16px;justify-content:space-between}@media(max-width:900px){.status-toolbar{align-items:flex-start;flex-direction:column}}</style>
