<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';
import { Page } from '@vben/common-ui';
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
  Tabs,
  TabPane,
  Tag,
  Upload,
  message,
} from 'ant-design-vue';
import { enterpriseApi } from '#/api';
import { downloadCsv, readCsv } from '#/utils/csv';

const loading = ref(false),
  saving = ref(false),
  rows = ref<any[]>([]),
  campuses = ref<any[]>([]),
  users = ref<any[]>([]),
  subjects = ref<any[]>([]);
const visible = ref(false),
  detailVisible = ref(false),
  editingId = ref(''),
  detail = ref<any>(null),
  studentText = ref('');
const batchVisible = ref(false),
  batchRows = ref<
    Array<{
      name: string;
      campusName: string;
      campusId: string;
      loginName?: string;
    }>
  >([]);
const credentialVisible = ref(false),
  credentials = ref<any[]>([]),
  credentialTitle = ref('教室初始化账号');
const form = reactive({
  name: '',
  campusId: '',
  loginName: '',
  status: 'active',
});
const memberForm = reactive<{
  userId: string;
  role: 'teacher' | 'homeroom';
  subjects: string[];
}>({ userId: '', role: 'teacher', subjects: [] });
const columns = [
  { title: '教室', dataIndex: 'name' },
  { title: '校区', dataIndex: 'campus_name' },
  { title: '教室账号', dataIndex: 'login_name' },
  { title: '学生', dataIndex: 'student_count' },
  { title: '成员', dataIndex: 'member_count' },
  { title: '设备', dataIndex: 'device_count' },
  { title: '状态', dataIndex: 'status' },
  { title: '操作', key: 'actions', width: 290 },
];
const statusLabels: Record<string, string> = {
  active: '正常',
  disabled: '停用',
  archived: '已归档',
  online: '在线',
  offline: '离线',
  revoked: '已吊销',
};
const memberRoleLabels: Record<string, string> = {
  teacher: '任课教师',
  homeroom: '班主任',
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
    const [r, c, u, s] = await Promise.all([
      enterpriseApi.classrooms(),
      enterpriseApi.campuses(),
      enterpriseApi.users({ role: 'teacher', limit: 100 }),
      enterpriseApi.subjects(true),
    ]);
    rows.value = r;
    campuses.value = c;
    users.value = u.items;
    subjects.value = s;
  } finally {
    loading.value = false;
  }
}
function openCreate() {
  editingId.value = '';
  Object.assign(form, {
    name: '',
    campusId: campuses.value[0]?.id || '',
    loginName: '',
    status: 'active',
  });
  visible.value = true;
}
function openEdit(row: any) {
  editingId.value = row.id;
  Object.assign(form, {
    name: row.name,
    campusId: row.campus_id,
    loginName: row.login_name || '',
    status: row.status,
  });
  visible.value = true;
}
function showCredentials(title: string, items: any[]) {
  credentialTitle.value = title;
  credentials.value = items;
  credentialVisible.value = true;
}
async function save() {
  if (!form.name.trim() || !form.campusId) {
    message.warning('请填写教室名称并选择校区');
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) {
      await enterpriseApi.updateClassroom(editingId.value, {
        name: form.name.trim(),
        campusId: form.campusId,
        status: form.status,
      });
      message.success('教室已更新');
    } else {
      const created = await enterpriseApi.createClassroom({
        name: form.name.trim(),
        campusId: form.campusId,
        loginName: form.loginName.trim() || undefined,
      });
      showCredentials('教室初始化账号', [created]);
    }
    visible.value = false;
    await load();
  } finally {
    saving.value = false;
  }
}
async function archive(id: string) {
  await enterpriseApi.archiveClassroom(id);
  message.success('教室已归档');
  await load();
}
async function resetPassword(row: any) {
  const result = await enterpriseApi.resetClassroomPassword(row.id);
  showCredentials(`${row.name} · 新初始化密码`, [
    { ...result, name: row.name },
  ]);
  await load();
}

function downloadClassroomTemplate() {
  downloadCsv('教室批量导入模板.csv', [
    ['教室名称', '校区名称', '登录账号（可选）'],
    ['一年级一班', campuses.value[0]?.name || '主校区', 'room-grade1-1'],
    ['一年级二班', campuses.value[0]?.name || '主校区', ''],
  ]);
}
async function importClassroomCsv(file: File) {
  try {
    const data = await readCsv(file),
      header = data[0] || [];
    const nameIndex = header.findIndex((value) =>
      ['教室名称', 'name'].includes(value),
    );
    const campusIndex = header.findIndex((value) =>
      ['校区名称', 'campus'].includes(value),
    );
    const loginIndex = header.findIndex((value) =>
      ['登录账号（可选）', '登录账号', 'loginName'].includes(value),
    );
    if (nameIndex < 0 || campusIndex < 0)
      throw new Error('模板必须包含“教室名称”和“校区名称”两列');
    const campusMap = new Map(
      campuses.value.map((item) => [
        String(item.name).trim().toLowerCase(),
        item.id,
      ]),
    );
    batchRows.value = data
      .slice(1)
      .map((row) => {
        const campusName = String(row[campusIndex] || '').trim();
        return {
          name: String(row[nameIndex] || '').trim(),
          campusName,
          campusId: campusMap.get(campusName.toLowerCase()) || '',
          loginName:
            loginIndex >= 0
              ? String(row[loginIndex] || '').trim() || undefined
              : undefined,
        };
      })
      .filter((row) => row.name || row.campusName);
    if (!batchRows.value.length) throw new Error('文件中没有教室数据');
    const invalid = batchRows.value.filter((row) => !row.campusId);
    if (invalid.length)
      throw new Error(
        `以下校区不存在：${[...new Set(invalid.map((row) => row.campusName))].join('、')}`,
      );
    message.success(`已读取 ${batchRows.value.length} 个教室，请确认后创建`);
  } catch (error: any) {
    batchRows.value = [];
    message.error(error?.message || '教室文件读取失败');
  }
  return false;
}
async function createClassrooms() {
  if (!batchRows.value.length) {
    message.warning('请先选择导入文件');
    return;
  }
  if (batchRows.value.some((row) => !row.name || !row.campusId)) {
    message.warning('存在教室名称或校区为空的行');
    return;
  }
  saving.value = true;
  try {
    const result = await enterpriseApi.batchCreateClassrooms(
      batchRows.value.map(({ name, campusId, loginName }) => ({
        name,
        campusId,
        loginName,
      })),
    );
    batchVisible.value = false;
    showCredentials('教室初始化账号', result.items);
    await load();
  } finally {
    saving.value = false;
  }
}
function downloadCredentials() {
  downloadCsv(`${credentialTitle.value}.csv`, [
    ['教室名称', '登录账号', '初始密码'],
    ...credentials.value.map((item) => [
      item.name,
      item.login_name || item.loginName,
      item.initialPassword,
    ]),
  ]);
}

async function showDetail(row: any) {
  detailVisible.value = true;
  await reloadDetail(row.id);
}
async function reloadDetail(id: string) {
  detail.value = await enterpriseApi.classroom(id);
  studentText.value = (detail.value.students || [])
    .map((item: any) => item.name)
    .join('\n');
}
async function importStudents(file: File) {
  try {
    const data = await readCsv(file);
    const header = data[0] || [];
    const nameIndex = header.findIndex((value) =>
      ['学生姓名', '姓名', 'name'].includes(value),
    );
    if (nameIndex < 0) throw new Error('学生模板必须包含“学生姓名”列');
    const names = data
      .slice(1)
      .map((row) => String(row[nameIndex] || '').trim())
      .filter(Boolean);
    if (!names.length) throw new Error('文件中没有学生数据');
    studentText.value = names.join('\n');
    message.success(
      `已导入 ${names.length} 名学生，请点击“保存学生名单”完成提交`,
    );
  } catch (error: any) {
    message.error(error?.message || '学生文件读取失败');
  }
  return false;
}
function downloadStudentTemplate() {
  downloadCsv(`${detail.value?.classroom?.name || '教室'}-学生导入模板.csv`, [
    ['学生姓名'],
    ['张三'],
    ['李四'],
  ]);
}
async function persistStudents(students: Array<{ name: string }>) {
  saving.value = true;
  try {
    await enterpriseApi.replaceStudents(detail.value.classroom.id, students);
    message.success(`学生名单已保存，共 ${students.length} 人`);
    await reloadDetail(detail.value.classroom.id);
    await load();
  } finally {
    saving.value = false;
  }
}
async function saveStudents() {
  const students = studentText.value
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
  const nextNames = new Set(students.map((item) => item.name));
  const removed = (detail.value?.students || [])
    .map((item: any) => String(item.name))
    .filter((name: string) => !nextNames.has(name));
  if (!removed.length) {
    await persistStudents(students);
    return;
  }
  Modal.confirm({
    title: students.length ? '确认移除名单中的学生？' : '确认清空全部学生？',
    content: students.length
      ? `本次将移除 ${removed.length} 名学生：${removed.slice(0, 8).join('、')}${removed.length > 8 ? ' 等' : ''}。相关提交记录将不再出现在当前名单统计中。`
      : `将从“${detail.value.classroom.name}”移除全部 ${removed.length} 名学生。此操作不可直接撤销。`,
    okText: students.length ? '确认保存' : '确认清空',
    okType: 'danger',
    cancelText: '取消',
    onOk: () => persistStudents(students),
  });
}
async function addMember() {
  if (!memberForm.userId) {
    message.warning('请选择教师');
    return;
  }
  if (!memberForm.subjects.length) {
    message.warning('请至少选择一个授课科目');
    return;
  }
  await enterpriseApi.upsertMember(detail.value.classroom.id, {
    userId: memberForm.userId,
    role: memberForm.role,
    subjects: memberForm.subjects,
  });
  message.success('教室成员已保存');
  Object.assign(memberForm, { userId: '', role: 'teacher', subjects: [] });
  await reloadDetail(detail.value.classroom.id);
  await load();
}
async function removeMember(userId: string) {
  await enterpriseApi.removeMember(detail.value.classroom.id, userId);
  message.success('成员已移除');
  await reloadDetail(detail.value.classroom.id);
  await load();
}
onMounted(load);
</script>

<template>
  <Page
    title="教室管理"
    description="创建和批量导入教室，维护学生名单、教师成员与教室账号"
  >
    <Card
      ><div class="mb-4 flex justify-end gap-2">
        <Button :disabled="!campuses.length" @click="batchVisible = true"
          >批量创建教室</Button
        ><Button type="primary" :disabled="!campuses.length" @click="openCreate"
          >新建教室</Button
        >
      </div>
      <div
        v-if="!campuses.length"
        class="mb-4 rounded border border-dashed p-4 text-gray-500"
      >
        请先在“校区管理”中创建校区，再创建教室。
      </div>
      <Table
        row-key="id"
        :columns="columns"
        :data-source="rows"
        :loading="loading"
        :scroll="{ x: 1200 }"
        ><template #bodyCell="{ column, record, text }"
          ><Tag
            v-if="column.dataIndex === 'status'"
            :color="text === 'active' ? 'green' : 'default'"
            >{{ label(statusLabels, text) }}</Tag
          ><code v-else-if="column.dataIndex === 'login_name'">{{
            text || '尚未生成'
          }}</code
          ><Space v-else-if="column.key === 'actions'"
            ><Button type="link" @click="showDetail(record)">管理</Button
            ><Button type="link" @click="openEdit(record)">编辑</Button
            ><Popconfirm
              title="将生成新的教室密码，旧密码将立即失效。确认继续？"
              @confirm="resetPassword(record)"
              ><Button type="link">重置密码</Button></Popconfirm
            ><Popconfirm title="确认归档该教室？" @confirm="archive(record.id)"
              ><Button type="link" danger>归档</Button></Popconfirm
            ></Space
          ></template
        ></Table
      ></Card
    >

    <Modal
      v-model:open="visible"
      :title="editingId ? '编辑教室' : '新建教室'"
      :confirm-loading="saving"
      @ok="save"
      ><Form layout="vertical"
        ><FormItem label="教室名称" required
          ><Input v-model:value="form.name" :maxlength="120" /></FormItem
        ><FormItem label="所属校区" required
          ><Select v-model:value="form.campusId"
            ><SelectOption
              v-for="campus in campuses"
              :key="campus.id"
              :value="campus.id"
              >{{ campus.name }}</SelectOption
            ></Select
          ></FormItem
        ><FormItem v-if="!editingId" label="教室登录账号（可选）"
          ><Input
            v-model:value="form.loginName"
            :maxlength="80"
            placeholder="留空则由系统自动生成" /></FormItem
        ><Alert
          v-if="!editingId"
          class="mb-4"
          show-icon
          type="info"
          message="系统将生成 C-XXXX-XXXX-XX 格式的随机初始密码，创建后仅展示一次。"
        /><FormItem v-if="editingId" label="状态"
          ><Select v-model:value="form.status"
            ><SelectOption value="active">正常</SelectOption
            ><SelectOption value="disabled">停用</SelectOption
            ><SelectOption value="archived">归档</SelectOption></Select
          ></FormItem
        ></Form
      ></Modal
    >

    <Modal
      v-model:open="batchVisible"
      title="批量创建教室"
      :confirm-loading="saving"
      width="820px"
      ok-text="确认创建"
      @ok="createClassrooms"
      ><Alert
        class="mb-4"
        show-icon
        type="info"
        message="每批最多 500 个教室；登录账号可以留空自动生成，初始密码创建后仅显示一次。" /><Space
        class="mb-4"
        ><Button @click="downloadClassroomTemplate">下载 CSV 模板</Button
        ><Upload
          accept=".csv,text/csv"
          :before-upload="importClassroomCsv"
          :show-upload-list="false"
          ><Button type="primary" ghost>选择填写后的 CSV</Button></Upload
        ></Space
      ><Table
        size="small"
        :pagination="{ pageSize: 8 }"
        :data-source="batchRows"
        :columns="[
          { title: '教室名称', dataIndex: 'name' },
          { title: '校区名称', dataIndex: 'campusName' },
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
        message="初始密码只在本次显示，请立即下载并保存；关闭后只能重新生成。"
      /><Table
        row-key="id"
        size="small"
        :pagination="{ pageSize: 8 }"
        :data-source="credentials"
        :columns="[
          { title: '教室', dataIndex: 'name' },
          { title: '登录账号', key: 'login' },
          { title: '初始密码', dataIndex: 'initialPassword' },
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
          >下载初始化账号 CSV</Button
        >
      </div></Modal
    >

    <Drawer v-model:open="detailVisible" title="教室运营管理" width="880"
      ><template v-if="detail"
        ><Descriptions bordered :column="3"
          ><DescriptionsItem label="教室">{{
            detail.classroom.name
          }}</DescriptionsItem
          ><DescriptionsItem label="校区">{{
            detail.classroom.campus_name
          }}</DescriptionsItem
          ><DescriptionsItem label="教室账号"
            ><code>{{
              detail.classroom.login_name || '尚未生成'
            }}</code></DescriptionsItem
          ></Descriptions
        ><Tabs class="mt-5"
          ><TabPane key="students" tab="学生名单"
            ><p class="mb-3 text-gray-500">
              支持 CSV
              导入或每行输入一名学生。保存后未出现在名单中的学生会被移出。
            </p>
            <Space class="mb-3"
              ><Button @click="downloadStudentTemplate">下载学生模板</Button
              ><Upload
                accept=".csv,text/csv"
                :before-upload="importStudents"
                :show-upload-list="false"
                ><Button type="primary" ghost>导入学生 CSV</Button></Upload
              ></Space
            ><Input.TextArea
              v-model:value="studentText"
              :rows="15"
              placeholder="张三&#10;李四"
            />
            <div class="mt-3 text-right">
              <Button type="primary" :loading="saving" @click="saveStudents"
                >保存学生名单</Button
              >
            </div></TabPane
          ><TabPane key="members" tab="教师成员"
            ><Card size="small" class="mb-4"
              ><Form layout="inline"
                ><FormItem label="教师"
                  ><Select
                    v-model:value="memberForm.userId"
                    style="width: 190px"
                    ><SelectOption
                      v-for="user in users"
                      :key="user.id"
                      :value="user.id"
                      >{{ user.name }}（{{ user.login_name }}）</SelectOption
                    ></Select
                  ></FormItem
                ><FormItem label="身份"
                  ><Select v-model:value="memberForm.role" style="width: 120px"
                    ><SelectOption value="teacher">任课教师</SelectOption
                    ><SelectOption value="homeroom"
                      >班主任</SelectOption
                    ></Select
                  ></FormItem
                ><FormItem label="科目"
                  ><Select
                    v-model:value="memberForm.subjects"
                    mode="multiple"
                    allow-clear
                    show-search
                    placeholder="请选择科目"
                    style="min-width: 220px"
                    ><SelectOption
                      v-for="item in subjects"
                      :key="item.id"
                      :value="item.name"
                      >{{ item.name }}</SelectOption
                    ></Select
                  ></FormItem
                ><Button type="primary" @click="addMember"
                  >添加/更新</Button
                ></Form
              >
              <div v-if="!subjects.length" class="mt-3 text-gray-500">
                暂无可选科目，请先到“科目配置”中新增并启用科目。
              </div></Card
            ><Table
              row-key="id"
              size="small"
              :pagination="false"
              :data-source="detail.members"
              :columns="[
                { title: '教师', dataIndex: 'name' },
                { title: '身份', dataIndex: 'role' },
                { title: '科目', dataIndex: 'subjects_json' },
                { title: '操作', key: 'action' },
              ]"
              ><template #bodyCell="{ column, record, text }"
                ><Space v-if="column.dataIndex === 'subjects_json'" wrap
                  ><Tag v-for="subject in text" :key="subject">{{
                    subject
                  }}</Tag></Space
                ><template v-else-if="column.dataIndex === 'role'">{{
                  label(memberRoleLabels, text)
                }}</template
                ><Popconfirm
                  v-else-if="column.key === 'action'"
                  title="确认移除该成员？"
                  @confirm="removeMember(record.user_id)"
                  ><Button type="link" danger>移除</Button></Popconfirm
                ></template
              ></Table
            ></TabPane
          ><TabPane key="devices" tab="教室设备"
            ><Table
              row-key="id"
              size="small"
              :pagination="false"
              :data-source="detail.devices"
              :columns="[
                { title: '设备', dataIndex: 'device_name' },
                { title: '版本', dataIndex: 'app_version' },
                { title: '最近在线', dataIndex: 'last_seen_at' },
                { title: '状态', dataIndex: 'status' },
              ]"
              ><template #bodyCell="{ column, text }"
                ><template v-if="column.dataIndex === 'last_seen_at'">{{
                  formatTime(text)
                }}</template
                ><Tag
                  v-else-if="column.dataIndex === 'status'"
                  :color="
                    text === 'online' || text === 'active' ? 'green' : 'default'
                  "
                  >{{ label(statusLabels, text) }}</Tag
                ></template
              ></Table
            ></TabPane
          ></Tabs
        ></template
      ></Drawer
    >
  </Page>
</template>
