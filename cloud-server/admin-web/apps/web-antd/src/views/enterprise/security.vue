<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { Page } from '@vben/common-ui';
import {
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Select,
  Table,
  Tag,
  message,
} from 'ant-design-vue';
import { enterpriseApi } from '#/api';
const loading = ref(false),
  rows = ref<any[]>([]),
  action = ref(''),
  nextCursor = ref<null | string>(null),
  detailVisible = ref(false),
  detail = ref<any>(null);
const columns = [
  { title: '时间', dataIndex: 'created_at', width: 190 },
  { title: '操作者', dataIndex: 'actor_name' },
  { title: '动作', dataIndex: 'action' },
  { title: '目标类型', dataIndex: 'target_type' },
  { title: '结果', dataIndex: 'outcome' },
  { title: '来源 IP', dataIndex: 'ip_address' },
  { title: '操作', key: 'actions' },
];
const actionLabels: Record<string, string> = {
  'user.create': '创建用户',
  'user.update': '更新用户',
  'user.delete': '删除教师',
  'user.password.reset': '重置用户密码',
  'device.revoke': '吊销用户设备',
  'role.create': '创建角色',
  'role.permissions.update': '更新角色权限',
  'role.binding.create': '添加角色授权',
  'role.binding.delete': '移除角色授权',
  'campus.create': '创建校区',
  'campus.update': '更新校区',
  'campus.archive': '归档校区',
  'classroom.create': '创建教室',
  'classroom.batch-create': '批量创建教室',
  'classroom.update': '更新教室',
  'classroom.archive': '归档教室',
  'classroom.password.reset': '重置教室密码',
  'classroom.students.replace': '更新学生名单',
  'classroom.member.upsert': '添加或更新教室教师',
  'classroom.member.remove': '移除教室教师',
  'classroom-device.register': '注册教室设备',
  'classroom-device.login': '教室设备登录',
  'classroom-device.revoke': '吊销教室设备',
  'organization.update': '更新组织资料',
  'organization.logo.upload': '上传组织标识',
  'organization.logo.remove': '移除组织标识',
  'subject.create': '创建科目',
  'subject.update': '更新科目',
  'subject.delete': '删除科目',
  'assignment.created': '发布作业',
  'assignment.updated': '更新作业',
  'assignment.deleted': '删除作业',
  'submission.updated': '更新提交状态',
};
const targetLabels: Record<string, string> = {
  user: '用户',
  role: '角色',
  campus: '校区',
  classroom: '教室',
  'classroom-device': '教室设备',
  organization: '组织',
  subject: '科目',
};
const actionOptions = Object.entries(actionLabels).map(([value, label]) => ({
  value,
  label: `${label}（${value}）`,
}));
function actionLabel(value?: string) {
  return actionLabels[value || ''] || value || '-';
}
function targetLabel(value?: string) {
  return targetLabels[value || ''] || value || '-';
}
function outcomeLabel(value?: string) {
  return value === 'success'
    ? '成功'
    : value === 'failure'
      ? '失败'
      : value || '-';
}
async function load(append = false) {
  loading.value = true;
  try {
    const result = await enterpriseApi.audits({
      action: action.value || undefined,
      limit: 100,
      cursor: append ? nextCursor.value || undefined : undefined,
    });
    rows.value = append ? [...rows.value, ...result.items] : result.items;
    nextCursor.value = result.nextCursor;
  } catch (error: any) {
    message.error(error?.message || '审计日志加载失败');
  } finally {
    loading.value = false;
  }
}
function show(row: any) {
  detail.value = row;
  detailVisible.value = true;
}
function format(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}
onMounted(load);
</script>
<template>
  <Page
    title="安全审计"
    description="检索管理员操作、权限变更、账号和设备安全事件"
    ><Card
      ><div class="mb-4 flex flex-wrap gap-2">
        <Select
          v-model:value="action"
          allow-clear
          show-search
          :filter-option="
            (input, option) =>
              String(option?.label || '')
                .toLowerCase()
                .includes(input.toLowerCase())
          "
          :options="actionOptions"
          placeholder="全部操作类型"
          style="min-width: 360px"
          @change="load()"
        /><Button @click="load()">刷新</Button>
      </div>
      <Table
        row-key="id"
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :scroll="{ x: 1100 }"
        ><template #bodyCell="{ column, record, text }"
          ><template v-if="column.dataIndex === 'created_at'">{{
            format(text)
          }}</template
          ><Tag
            v-else-if="column.dataIndex === 'outcome'"
            :color="text === 'success' ? 'green' : 'red'"
            >{{ outcomeLabel(text) }}</Tag
          ><template v-else-if="column.dataIndex === 'action'">{{
            actionLabel(text)
          }}</template
          ><template v-else-if="column.dataIndex === 'target_type'">{{
            targetLabel(text)
          }}</template
          ><Button
            v-else-if="column.key === 'actions'"
            type="link"
            @click="show(record)"
            >详情</Button
          ></template
        ></Table
      >
      <div v-if="nextCursor" class="mt-4 text-center">
        <Button :loading="loading" @click="load(true)">加载更早记录</Button>
      </div></Card
    ><Drawer v-model:open="detailVisible" title="审计详情" width="680"
      ><Descriptions v-if="detail" bordered :column="1"
        ><DescriptionsItem label="时间">{{
          format(detail.created_at)
        }}</DescriptionsItem
        ><DescriptionsItem label="操作者">{{
          detail.actor_name || detail.actor_id || '-'
        }}</DescriptionsItem
        ><DescriptionsItem label="动作"
          ><Tag color="blue">{{ actionLabel(detail.action) }}</Tag>
          <span class="ml-2 text-gray-400">{{
            detail.action
          }}</span></DescriptionsItem
        ><DescriptionsItem label="目标"
          >{{ targetLabel(detail.target_type) }} /
          {{ detail.target_id }}</DescriptionsItem
        ><DescriptionsItem label="结果">{{
          outcomeLabel(detail.outcome)
        }}</DescriptionsItem
        ><DescriptionsItem label="来源 IP">{{
          detail.ip_address || '-'
        }}</DescriptionsItem
        ><DescriptionsItem label="请求 ID">{{
          detail.request_id || '-'
        }}</DescriptionsItem
        ><DescriptionsItem label="元数据">
          <pre class="whitespace-pre-wrap">{{
            JSON.stringify(detail.metadata_json || {}, null, 2)
          }}</pre>
        </DescriptionsItem></Descriptions
      ></Drawer
    ></Page
  >
</template>
