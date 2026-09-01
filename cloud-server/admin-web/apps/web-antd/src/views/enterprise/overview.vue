<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';
import { Alert, Button, Card, Col, Form, FormItem, Input, Modal, Row, Space, Statistic, Tag, message } from 'ant-design-vue';

import { enterpriseApi } from '#/api';
import PrimaryColorPicker from '#/components/primary-color-picker.vue';
import { applyOrganizationBranding } from '#/utils/branding';

const router=useRouter();
const loading=ref(true),saving=ref(false),visible=ref(false);
const organization=ref<any>(null);
const totals=ref<Record<'campuses'|'classrooms'|'devices'|'users',number|null>>({campuses:null,users:null,classrooms:null,devices:null});
const unavailable=ref<string[]>([]);
const form=reactive({name:'',shortName:'',primaryColor:''});

async function load(){
  loading.value=true;
  try{
    const results=await Promise.allSettled([
      enterpriseApi.organization(),enterpriseApi.campuses(),enterpriseApi.users(),enterpriseApi.classrooms(),enterpriseApi.classroomDevices(),
    ]);
    const names=['组织资料','校区','用户','教室','设备'];
    unavailable.value=results.flatMap((result,index)=>result.status==='rejected'?[names[index] ?? '未知数据']:[]);
    const[org,campuses,users,classrooms,devices]=results;
    if(org?.status==='fulfilled'){organization.value=org.value;applyOrganizationBranding(org.value);}
    totals.value={
      campuses:campuses?.status==='fulfilled'?campuses.value.length:null,
      users:users?.status==='fulfilled'?users.value.total:null,
      classrooms:classrooms?.status==='fulfilled'?classrooms.value.length:null,
      devices:devices?.status==='fulfilled'?devices.value.filter((item:any)=>!item.revoked_at).length:null,
    };
  }finally{loading.value=false;}
}

function edit(){
  if(!organization.value)return;
  Object.assign(form,{name:organization.value.name||'',shortName:organization.value.short_name||organization.value.name||'',primaryColor:organization.value.primary_color||'#2563EB'});
  visible.value=true;
}

async function save(){
  if(!form.name.trim()||!form.shortName.trim()||!/^#[0-9a-f]{6}$/i.test(form.primaryColor.trim())){message.warning('请填写组织名称、简称和有效的品牌色（例如 #2563EB）');return;}
  saving.value=true;
  try{
    organization.value=await enterpriseApi.updateOrganization({logoUrl:organization.value.logo_url||undefined,name:form.name.trim(),shortName:form.shortName.trim(),primaryColor:form.primaryColor.trim()});
    applyOrganizationBranding(organization.value);message.success('组织资料已更新，后台品牌样式已同步');visible.value=false;
  }finally{saving.value=false;}
}

onMounted(load);
</script>

<template>
  <Page title="运营总览" description="组织、校区、用户、教室和设备运行概况">
    <Alert v-if="unavailable.length && !loading" class="mb-4" type="info" show-icon message="部分数据未显示" :description="`当前账号没有以下数据的读取权限：${unavailable.join('、')}`" />
    <Alert v-else-if="totals.campuses === 0 && !loading" class="mb-4" type="info" show-icon message="开始配置企业后台" description="依次创建校区、用户和教室，再配置角色权限。" />
    <Card :loading="loading" class="mb-4">
      <div class="flex items-center justify-between">
        <div><h2 class="text-xl font-semibold">{{organization?.name||'班达云服务'}}</h2><p class="text-gray-500">组织标识：{{organization?.slug||'-'}}</p></div>
        <Space><Tag v-if="organization" color="green">{{organization.status||'active'}}</Tag><Button v-if="organization" @click="edit">编辑组织资料</Button></Space>
      </div>
    </Card>
    <Row :gutter="16">
      <Col :xs="24" :md="6"><Card><Statistic title="校区" :value="totals.campuses ?? '—'" suffix="个" /></Card></Col>
      <Col :xs="24" :md="6"><Card><Statistic title="用户" :value="totals.users ?? '—'" suffix="人" /></Card></Col>
      <Col :xs="24" :md="6"><Card><Statistic title="教室" :value="totals.classrooms ?? '—'" suffix="间" /></Card></Col>
      <Col :xs="24" :md="6"><Card><Statistic title="有效设备" :value="totals.devices ?? '—'" suffix="台" /></Card></Col>
    </Row>
    <Card title="快速开始" class="mt-4"><Space wrap><Button type="primary" @click="router.push({name:'CampusManagement'})">1. 创建校区</Button><Button @click="router.push({name:'UserManagement'})">2. 创建用户</Button><Button @click="router.push({name:'RoleManagement'})">3. 配置权限</Button><Button @click="router.push({name:'ClassroomManagement'})">4. 创建教室</Button></Space></Card>
    <Modal v-model:open="visible" title="编辑组织资料" :confirm-loading="saving" @ok="save"><Form layout="vertical"><FormItem label="组织名称" required><Input v-model:value="form.name" /></FormItem><FormItem label="组织简称"><Input v-model:value="form.shortName" /></FormItem><FormItem label="品牌主色"><PrimaryColorPicker v-model="form.primaryColor" /></FormItem></Form></Modal>
  </Page>
</template>
