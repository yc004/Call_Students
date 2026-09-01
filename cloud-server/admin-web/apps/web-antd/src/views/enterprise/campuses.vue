<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';
import { Page } from '@vben/common-ui';
import { Button, Card, Form, FormItem, Input, Modal, Popconfirm, Space, Table, Tag, message } from 'ant-design-vue';
import { enterpriseApi } from '#/api';

const loading=ref(false);const saving=ref(false);const rows=ref<any[]>([]);const visible=ref(false);const editingId=ref('');
const form=reactive({name:'',code:'',address:''});
const columns=[{title:'校区',dataIndex:'name'},{title:'编码',dataIndex:'code'},{title:'地址',dataIndex:'address'},{title:'教室数',dataIndex:'classroom_count'},{title:'状态',dataIndex:'status'},{title:'操作',key:'actions',width:180}];
async function load(){loading.value=true;try{rows.value=await enterpriseApi.campuses();}finally{loading.value=false;}}
function openCreate(){editingId.value='';Object.assign(form,{name:'',code:'',address:''});visible.value=true;}
function openEdit(row:any){editingId.value=row.id;Object.assign(form,{name:row.name,code:row.code,address:row.address||''});visible.value=true;}
async function save(){if(!form.name.trim()||!form.code.trim()){message.warning('请填写校区名称和编码');return;}saving.value=true;try{const data={name:form.name.trim(),code:form.code.trim(),address:form.address.trim()||undefined};if(editingId.value)await enterpriseApi.updateCampus(editingId.value,data);else await enterpriseApi.createCampus(data);message.success(editingId.value?'校区已更新':'校区已创建');visible.value=false;await load();}finally{saving.value=false;}}
async function archive(id:string){await enterpriseApi.archiveCampus(id);message.success('校区已归档');await load();}
onMounted(load);
</script>
<template><Page title="校区管理" description="创建、编辑和归档组织下的校区"><Card><div class="mb-4 flex justify-end"><Button type="primary" @click="openCreate">新建校区</Button></div><Table row-key="id" :columns="columns" :data-source="rows" :loading="loading"><template #bodyCell="{column,record,text}"><Tag v-if="column.dataIndex==='status'" :color="text==='active'?'green':'default'">{{text}}</Tag><Space v-else-if="column.key==='actions'"><Button type="link" @click="openEdit(record)">编辑</Button><Popconfirm title="归档后该校区将不再显示，确认继续？" @confirm="archive(record.id)"><Button type="link" danger>归档</Button></Popconfirm></Space></template></Table></Card><Modal v-model:open="visible" :title="editingId?'编辑校区':'新建校区'" :confirm-loading="saving" @ok="save"><Form layout="vertical"><FormItem label="校区名称" required><Input v-model:value="form.name" :maxlength="120"/></FormItem><FormItem label="校区编码" required><Input v-model:value="form.code" :maxlength="40" placeholder="例如 main-campus"/></FormItem><FormItem label="地址"><Input v-model:value="form.address" :maxlength="500"/></FormItem></Form></Modal></Page></template>
