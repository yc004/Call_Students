<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';
import { Page } from '@vben/common-ui';
import { useUserStore } from '@vben/stores';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Form,
  FormItem,
  Input,
  Modal,
  Popconfirm,
  Select,
  SelectOption,
  Space,
  Table,
  Tag,
  Upload,
  message,
} from 'ant-design-vue';
import { enterpriseApi } from '#/api';
import { downloadCsv, readCsv } from '#/utils/csv';

const loading = ref(false),
  saving = ref(false),
  rows = ref<any[]>([]),
  roles = ref<any[]>([]),
  organization = ref<any>({});
const userStore = useUserStore();
const visible = ref(false),
  detailVisible = ref(false),
  editingId = ref(''),
  detail = ref<any>(null),
  search = ref('');
const batchVisible = ref(false),
  batchRows = ref<Array<{ name: string; loginName: string }>>([]);
const credentialVisible = ref(false),
  credentials = ref<any[]>([]),
  credentialTitle = ref('初始化账号');
const form = reactive({
  name: '',
  loginName: '',
  serverRole: 'teacher',
  status: 'active',
  roleId: '',
});
const columns = [
  { title: '姓名', dataIndex: 'name' },
  { title: '登录账号', dataIndex: 'login_name' },
  { title: '账号类型', dataIndex: 'server_role' },
  { title: '角色授权', dataIndex: 'bindings' },
  { title: '设备', dataIndex: 'device_count' },
  { title: '状态', dataIndex: 'status' },
  { title: '操作', key: 'actions', width: 300 },
];
const roleLabels: Record<string, string> = { admin: '管理员', teacher: '教师' };
const statusLabels: Record<string, string> = {
  active: '正常',
  disabled: '停用',
  archived: '已归档',
};
const scopeLabels: Record<string, string> = {
  organization: '全组织',
  campus: '校区',
  classroom: '教室',
};
const deviceTypeLabels: Record<string, string> = {
  desktop: '桌面端',
  mobile: '移动端',
  web: '浏览器',
  mini_program: '微信小程序',
};
function label(map: Record<string, string>, value?: string) {
  return map[value || ''] || value || '-';
}
function formatTime(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN') : '-';
}

async function load() {
  loading.value = true;
  try {
    const [result, roleRows, org] = await Promise.all([
      enterpriseApi.users({ search: search.value || undefined }),
      enterpriseApi.roles(),
      enterpriseApi.organization(),
    ]);
    rows.value = result.items;
    roles.value = roleRows;
    organization.value = org;
  } finally {
    loading.value = false;
  }
}
function openCreate() {
  editingId.value = '';
  Object.assign(form, {
    name: '',
    loginName: '',
    serverRole: 'teacher',
    status: 'active',
    roleId: '',
  });
  visible.value = true;
}
function openEdit(row: any) {
  editingId.value = row.id;
  Object.assign(form, {
    name: row.name,
    loginName: row.login_name,
    serverRole: row.server_role,
    status: row.status,
    roleId: '',
  });
  visible.value = true;
}
function showCredentials(title: string, items: any[]) {
  credentialTitle.value = title;
  credentials.value = items;
  credentialVisible.value = true;
}

async function save() {
  if (!form.name.trim() || !form.loginName.trim()) {
    message.warning('请填写姓名和登录账号');
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) {
      const data: any = {
        name: form.name.trim(),
        loginName: form.loginName.trim(),
        serverRole: form.serverRole,
      };
      if (form.serverRole === 'admin') data.status = form.status;
      await enterpriseApi.updateUser(editingId.value, data);
      message.success('用户已更新，涉及安全设置时旧会话会自动失效');
    } else {
      const created = await enterpriseApi.createUser({
        name: form.name.trim(),
        loginName: form.loginName.trim(),
        serverRole: form.serverRole,
      });
      if (form.roleId)
        await enterpriseApi.bindRole(created.id, {
          roleId: form.roleId,
          scopeType: 'organization',
          scopeId: organization.value.id,
        });
      showCredentials('用户初始化账号', [created]);
    }
    visible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}

function downloadTeacherTemplate() {
  downloadCsv('教师批量导入模板.csv', [
    ['姓名', '登录账号'],
    ['张老师', 'teacher.zhang'],
    ['李老师', 'teacher.li'],
  ]);
}
async function importTeacherCsv(file: File) {
  try {
    const data = await readCsv(file);
    const header = data[0] || [];
    const nameIndex = header.findIndex((value) =>
      ['姓名', 'name'].includes(value),
    );
    const loginIndex = header.findIndex((value) =>
      ['登录账号', '用户名', 'loginName'].includes(value),
    );
    if (nameIndex < 0 || loginIndex < 0)
      throw new Error('模板必须包含“姓名”和“登录账号”两列');
    batchRows.value = data
      .slice(1)
      .map((row) => ({
        name: String(row[nameIndex] || '').trim(),
        loginName: String(row[loginIndex] || '').trim(),
      }))
      .filter((row) => row.name || row.loginName);
    if (!batchRows.value.length) throw new Error('文件中没有教师数据');
    message.success(`已读取 ${batchRows.value.length} 名教师，请确认后创建`);
  } catch (error: any) {
    message.error(error?.message || '教师文件读取失败');
  }
  return false;
}
async function createTeachers() {
  if (!batchRows.value.length) {
    message.warning('请先选择导入文件');
    return;
  }
  if (batchRows.value.some((row) => !row.name || !row.loginName)) {
    message.warning('存在姓名或登录账号为空的行');
    return;
  }
  saving.value = true;
  try {
    const result = await enterpriseApi.batchCreateTeachers(batchRows.value);
    batchVisible.value = false;
    showCredentials('教师初始化账号', result.items);
    await load();
  } finally {
    saving.value = false;
  }
}
function downloadCredentials() {
  downloadCsv(`${credentialTitle.value}.csv`, [
    ['姓名/教室', '登录账号', '一次性密码'],
    ...credentials.value.map((item) => [
      item.name,
      item.login_name || item.loginName,
      item.initialPassword,
    ]),
  ]);
}

async function showDetail(row: any) {
  detailVisible.value = true;
  detail.value = null;
  detail.value = await enterpriseApi.user(row.id);
}
async function revokeDevice(deviceId: string) {
  await enterpriseApi.revokeUserDevice(detail.value.id, deviceId);
  message.success('登录设备已吊销');
  detail.value = await enterpriseApi.user(detail.value.id);
  await load();
}
async function unbindRole(bindingId: string) {
  await enterpriseApi.unbindRole(bindingId);
  message.success('角色授权已移除，用户需要重新登录');
  detail.value = await enterpriseApi.user(detail.value.id);
  await load();
}
async function toggle(row: any) {
  await enterpriseApi.updateUser(row.id, {
    status: row.status === 'active' ? 'disabled' : 'active',
  });
  message.success(row.status === 'active' ? '账号已停用' : '账号已启用');
  await load();
}
async function resetPassword(row: any) {
  saving.value = true;
  try {
    const credential = await enterpriseApi.resetUserPassword(row.id);
    showCredentials('密码重置结果', [credential]);
    message.success('已生成新的随机临时密码');
    await load();
  } finally {
    saving.value = false;
  }
}
async function deleteTeacher(row: any) {
  await enterpriseApi.deleteUser(row.id);
  message.success('教师账号已删除');
  if (detail.value?.id === row.id) detailVisible.value = false;
  await load();
}
onMounted(load);
</script>

<template>
  <Page
    title="用户管理"
    description="创建管理员和教师、批量导入教师并生成一次性初始化凭据"
  >
    <Card>
      <div class="mb-4 flex gap-2">
        <Input.Search
          v-model:value="search"
          allow-clear
          placeholder="搜索姓名或登录账号"
          style="max-width: 360px"
          @search="load"
        /><Button @click="load">刷新</Button>
        <div class="flex-1"></div>
        <Button @click="batchVisible = true">批量创建教师</Button
        ><Button type="primary" @click="openCreate">新建用户</Button>
      </div>
      <Table
        row-key="id"
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :scroll="{ x: 1150 }"
        ><template #bodyCell="{ column, record, text }"
          ><Tag
            v-if="column.dataIndex === 'status'"
            :color="text === 'active' ? 'green' : 'red'"
            >{{ label(statusLabels, text) }}</Tag
          ><template v-else-if="column.dataIndex === 'server_role'">{{
            label(roleLabels, text)
          }}</template
          ><Space v-else-if="column.dataIndex === 'bindings'" wrap
            ><Tag v-for="item in text" :key="item.id" color="blue">{{
              item.roleName
            }}</Tag
            ><span v-if="!text?.length" class="text-gray-400"
              >未授权</span
            ></Space
          ><Space v-else-if="column.key === 'actions'"
            ><Button type="link" @click="showDetail(record)">详情</Button
            ><Button type="link" @click="openEdit(record)">编辑</Button
            ><Popconfirm
              :disabled="record.id === userStore.userInfo?.id"
              :title="`系统将为 ${record.name} 生成新的随机临时密码，旧密码和已有登录将立即失效。确认重置？`"
              @confirm="resetPassword(record)"
              ><Button
                type="link"
                :disabled="record.id === userStore.userInfo?.id"
                >重置密码</Button
              ></Popconfirm
            ><Popconfirm
              v-if="record.server_role === 'teacher'"
              title="确认永久删除该教师账号？相关角色授权、登录设备和教室成员关系将同步删除。"
              @confirm="deleteTeacher(record)"
              ><Button type="link" danger>删除</Button></Popconfirm
            ><Popconfirm
              v-else
              :title="
                record.status === 'active'
                  ? '确认停用该管理员账号？'
                  : '确认重新启用该管理员账号？'
              "
              @confirm="toggle(record)"
              ><Button type="link" :danger="record.status === 'active'">{{
                record.status === 'active' ? '停用' : '启用'
              }}</Button></Popconfirm
            ></Space
          ></template
        ></Table
      >
    </Card>

    <Modal
      v-model:open="visible"
      :title="editingId ? '编辑用户' : '新建用户'"
      :confirm-loading="saving"
      width="620px"
      @ok="save"
      ><Form layout="vertical"
        ><FormItem label="姓名" required
          ><Input v-model:value="form.name" :maxlength="40" /></FormItem
        ><FormItem label="登录账号" required
          ><Input v-model:value="form.loginName" :maxlength="80" /></FormItem
        ><Alert
          v-if="!editingId"
          class="mb-4"
          show-icon
          type="info"
          message="系统将自动生成符合安全规则的随机初始密码，创建后仅展示一次。"
        /><FormItem label="账号类型"
          ><Select v-model:value="form.serverRole"
            ><SelectOption value="teacher">教师</SelectOption
            ><SelectOption value="admin">管理员</SelectOption></Select
          ></FormItem
        ><FormItem v-if="!editingId" label="组织角色"
          ><Select
            v-model:value="form.roleId"
            allow-clear
            placeholder="可选：为管理员分配组织级角色"
            ><SelectOption
              v-for="role in roles.filter(
                (item) => item.data_scope === 'organization',
              )"
              :key="role.id"
              :value="role.id"
              >{{ role.name }}</SelectOption
            ></Select
          ></FormItem
        ><FormItem v-if="editingId && form.serverRole === 'admin'" label="状态"
          ><Select v-model:value="form.status"
            ><SelectOption value="active">正常</SelectOption
            ><SelectOption value="disabled">停用</SelectOption></Select
          ></FormItem
        ></Form
      ></Modal
    >

    <Modal
      v-model:open="batchVisible"
      title="批量创建教师"
      :confirm-loading="saving"
      width="760px"
      ok-text="确认创建"
      @ok="createTeachers"
      ><Alert
        class="mb-4"
        show-icon
        type="info"
        message="每批最多 500 名教师；系统为每位教师生成 T-XXXX-XXXX-XX 格式的随机初始密码。" /><Space
        class="mb-4"
        ><Button @click="downloadTeacherTemplate">下载 CSV 模板</Button
        ><Upload
          accept=".csv,text/csv"
          :before-upload="importTeacherCsv"
          :show-upload-list="false"
          ><Button type="primary" ghost>选择填写后的 CSV</Button></Upload
        ></Space
      ><Table
        size="small"
        :pagination="{ pageSize: 8 }"
        :data-source="batchRows"
        :columns="[
          { title: '姓名', dataIndex: 'name' },
          { title: '登录账号', dataIndex: 'loginName' },
        ]"
    /></Modal>

    <Modal
      v-model:open="credentialVisible"
      :title="credentialTitle"
      width="760px"
      :footer="null"
      ><Alert
        class="mb-4"
        show-icon
        type="warning"
        message="密码只在本次显示，请立即下载并安全发放；关闭后无法再次查看。"
      /><Table
        row-key="id"
        size="small"
        :pagination="{ pageSize: 8 }"
        :data-source="credentials"
        :columns="[
          { title: '姓名/教室', dataIndex: 'name' },
          { title: '登录账号', key: 'login' },
          { title: '一次性密码', dataIndex: 'initialPassword' },
        ]"
        ><template #bodyCell="{ column, record }"
          ><code v-if="column.key === 'login'">{{
            record.login_name || record.loginName
          }}</code
          ><code v-else-if="column.dataIndex === 'initialPassword'">{{
            record.initialPassword
          }}</code></template
        ></Table
      >
      <div class="mt-4 text-right">
        <Button type="primary" @click="downloadCredentials"
          >下载一次性凭据 CSV</Button
        >
      </div></Modal
    >

    <Drawer v-model:open="detailVisible" title="用户详情" width="720"
      ><template v-if="detail"
        ><Descriptions bordered :column="2"
          ><DescriptionsItem label="姓名">{{ detail.name }}</DescriptionsItem
          ><DescriptionsItem label="账号">{{
            detail.login_name
          }}</DescriptionsItem
          ><DescriptionsItem label="类型">{{
            label(roleLabels, detail.server_role)
          }}</DescriptionsItem
          ><DescriptionsItem label="状态">{{
            label(statusLabels, detail.status)
          }}</DescriptionsItem></Descriptions
        >
        <h3 class="mb-3 mt-6 font-semibold">角色授权</h3>
        <Space wrap
          ><Space v-for="item in detail.bindings" :key="item.id"
            ><Tag color="blue"
              >{{ item.roleName }} ·
              {{ label(scopeLabels, item.scopeType) }}</Tag
            ><Popconfirm
              title="确认移除该角色授权？组织所有者授权不可移除。"
              @confirm="unbindRole(item.id)"
              ><Button type="link" danger size="small">移除</Button></Popconfirm
            ></Space
          ><span v-if="!detail.bindings?.length" class="text-gray-400"
            >尚未分配角色</span
          ></Space
        >
        <h3 class="mb-3 mt-6 font-semibold">登录设备</h3>
        <Table
          row-key="id"
          size="small"
          :pagination="false"
          :data-source="detail.devices || []"
          :columns="[
            { title: '设备', dataIndex: 'name' },
            { title: '类型', dataIndex: 'type' },
            { title: '最近在线', dataIndex: 'lastSeenAt' },
            { title: '状态', key: 'state' },
            { title: '操作', key: 'action' },
          ]"
          ><template #bodyCell="{ column, record, text }"
            ><template v-if="column.dataIndex === 'type'">{{
              label(deviceTypeLabels, text)
            }}</template
            ><template v-else-if="column.dataIndex === 'lastSeenAt'">{{
              formatTime(text)
            }}</template
            ><Tag
              v-else-if="column.key === 'state'"
              :color="record.revokedAt ? 'red' : 'green'"
              >{{ record.revokedAt ? '已吊销' : '有效' }}</Tag
            ><Popconfirm
              v-else-if="column.key === 'action' && !record.revokedAt"
              title="确认吊销该设备？"
              @confirm="revokeDevice(record.id)"
              ><Button type="link" danger>吊销</Button></Popconfirm
            ></template
          ></Table
        ></template
      ></Drawer
    >
  </Page>
</template>
