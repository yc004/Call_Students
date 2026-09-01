<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';
import { Page } from '@vben/common-ui';
import { Alert, Button, Card, Form, FormItem, Input, InputNumber, Modal, Popconfirm, Select, SelectOption, Space, Table, Tag, message } from 'ant-design-vue';
import { enterpriseApi } from '#/api';

const loading=ref(false),saving=ref(false),rows=ref<any[]>([]),visible=ref(false),editingId=ref('');
const form=reactive({name:'',sortOrder:0,status:'active'});
const columns=[{title:'科目名称',dataIndex:'name'},{title:'系统编码',dataIndex:'code'},{title:'排序',dataIndex:'sort_order',width:100},{title:'状态',dataIndex:'status',width:100},{title:'操作',key:'actions',width:170}];
async function load(){loading.value=true;try{rows.value=await enterpriseApi.subjects();}finally{loading.value=false;}}
function openCreate(){editingId.value='';Object.assign(form,{name:'',sortOrder:rows.value.length?Math.max(...rows.value.map(item=>Number(item.sort_order)||0))+10:10,status:'active'});visible.value=true;}
function openEdit(row:any){editingId.value=row.id;Object.assign(form,{name:row.name,sortOrder:Number(row.sort_order)||0,status:row.status});visible.value=true;}
async function save(){if(!form.name.trim()){message.warning('请填写科目名称');return;}saving.value=true;try{const data={name:form.name.trim(),sortOrder:form.sortOrder,...(editingId.value?{status:form.status}:{})};if(editingId.value)await enterpriseApi.updateSubject(editingId.value,data);else await enterpriseApi.createSubject(data);message.success(editingId.value?'科目已更新':'科目已创建');visible.value=false;await load();}finally{saving.value=false;}}
async function remove(id:string){await enterpriseApi.deleteSubject(id);message.success('科目已删除，不再提供选择');await load();}
onMounted(load);
</script>

<template>
  <Page title="科目配置" description="统一维护企业内教师和教学内容可选择的科目">
    <Alert class="mb-4" type="info" show-icon message="停用或删除的科目不会出现在新选择中，已经产生的历史记录仍会保留。" />
    <Card>
      <div class="mb-4 flex justify-end"><Button type="primary" @click="openCreate">新增科目</Button></div>
      <Table row-key="id" :columns="columns" :data-source="rows" :loading="loading">
        <template #bodyCell="{column,record,text}">
          <Tag v-if="column.dataIndex==='status'" :color="text==='active'?'green':'default'">{{text==='active'?'启用':'停用'}}</Tag>
          <Space v-else-if="column.key==='actions'">
            <Button type="link" @click="openEdit(record)">编辑</Button>
            <Popconfirm title="删除后该科目将不再提供选择，确认继续？" @confirm="remove(record.id)"><Button type="link" danger>删除</Button></Popconfirm>
          </Space>
        </template>
      </Table>
    </Card>
    <Modal v-model:open="visible" :title="editingId?'编辑科目':'新增科目'" :confirm-loading="saving" @ok="save">
      <Form layout="vertical">
        <FormItem label="科目名称" required><Input v-model:value="form.name" :maxlength="80" placeholder="例如：语文" /></FormItem>
        <FormItem label="显示排序"><InputNumber v-model:value="form.sortOrder" :min="0" :max="9999" style="width:100%" /></FormItem>
        <FormItem v-if="editingId" label="状态"><Select v-model:value="form.status"><SelectOption value="active">启用</SelectOption><SelectOption value="disabled">停用</SelectOption></Select></FormItem>
      </Form>
    </Modal>
  </Page>
</template>
