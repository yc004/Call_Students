<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Card,
  Form,
  FormItem,
  Input,
  message,
  Steps,
  Step,
} from 'ant-design-vue';

import { getSetupStatusApi, setupApi } from '#/api/core/auth';
import PrimaryColorPicker from '#/components/primary-color-picker.vue';
import { useAuthStore } from '#/store';

defineOptions({ name: 'Setup' });

const router = useRouter();
const authStore = useAuthStore();
const current = ref(0);
const submitting = ref(false);
const form = reactive({
  administratorName: '',
  confirmPassword: '',
  loginName: '',
  organizationName: '',
  organizationShortName: '',
  password: '',
  primaryColor: '#2563EB',
  setupToken: '',
});

onMounted(async () => {
  const status = await getSetupStatusApi();
  if (status.initialized) await router.replace('/auth/login');
});

function next() {
  if (current.value === 0) {
    if (!form.organizationName.trim() || !form.organizationShortName.trim()) {
      message.warning('请填写企业名称和企业简称');
      return;
    }
    if (!/^#[0-9a-f]{6}$/i.test(form.primaryColor)) {
      message.warning('请输入有效的品牌色，例如 #2563EB');
      return;
    }
  }
  if (current.value === 1) {
    if (!form.administratorName.trim() || form.loginName.trim().length < 3) {
      message.warning('请填写管理员姓名和至少 3 位登录账号');
      return;
    }
    if (form.password.length < 12) {
      message.warning('管理员密码至少需要 12 位');
      return;
    }
    if (form.password !== form.confirmPassword) {
      message.warning('两次输入的密码不一致');
      return;
    }
  }
  current.value += 1;
}

async function finish() {
  if (form.setupToken.trim().length < 16) {
    message.warning('请输入部署时配置的一次性初始化授权码');
    return;
  }
  submitting.value = true;
  try {
    const setup=await setupApi({
      administratorName: form.administratorName.trim(),
      loginName: form.loginName.trim(),
      organizationName: form.organizationName.trim(),
      organizationShortName: form.organizationShortName.trim(),
      password: form.password,
      primaryColor: form.primaryColor.toUpperCase(),
      setupToken: form.setupToken.trim(),
    });
    message.success('企业后台初始化完成，正在进入管理中心');
    await authStore.authLogin({
      loginName: form.loginName.trim(),
      organizationSlug:setup.organization.slug,
      password: form.password,
    });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Card class="w-full max-w-[720px]" :bordered="false">
    <div class="mb-8 text-center">
      <h1 class="text-2xl font-semibold">初始化企业管理后台</h1>
      <p class="mt-2 text-gray-500">只需完成一次，系统会创建企业空间和首位管理员</p>
    </div>

    <Steps :current="current" class="mb-8">
      <Step title="企业信息" description="设置名称与品牌" />
      <Step title="管理员账户" description="创建正式登录账户" />
      <Step title="安全确认" description="完成初始化" />
    </Steps>

    <Form layout="vertical">
      <template v-if="current === 0">
        <FormItem label="企业名称" required>
          <Input v-model:value="form.organizationName" :maxlength="120" placeholder="例如：示范教育集团" />
        </FormItem>
        <FormItem label="企业简称" required>
          <Input v-model:value="form.organizationShortName" :maxlength="40" placeholder="用于导航栏和客户端展示" />
        </FormItem>
        <FormItem label="品牌主色" required>
          <PrimaryColorPicker v-model="form.primaryColor" />
        </FormItem>
      </template>

      <template v-else-if="current === 1">
        <Alert class="mb-5" type="info" show-icon message="这是正式管理员账户" description="请由管理员本人设置长期使用的账号和密码，系统不会生成或展示初始密码。" />
        <FormItem label="管理员姓名" required>
          <Input v-model:value="form.administratorName" :maxlength="40" placeholder="请输入管理员姓名" />
        </FormItem>
        <FormItem label="登录账号" required>
          <Input v-model:value="form.loginName" :maxlength="80" autocomplete="username" placeholder="以后登录后台只需填写此账号" />
        </FormItem>
        <FormItem label="设置密码" required extra="至少 12 位，建议同时包含大小写字母、数字和符号">
          <Input.Password v-model:value="form.password" :maxlength="200" autocomplete="new-password" />
        </FormItem>
        <FormItem label="确认密码" required>
          <Input.Password v-model:value="form.confirmPassword" :maxlength="200" autocomplete="new-password" />
        </FormItem>
      </template>

      <template v-else>
        <Alert class="mb-5" type="warning" show-icon message="最后一步：验证部署权限" description="请输入服务器部署时配置的 SETUP_TOKEN。该授权码只在本次初始化使用，完成后不可再次初始化。" />
        <FormItem label="一次性初始化授权码" required>
          <Input.Password v-model:value="form.setupToken" autocomplete="off" placeholder="请输入部署授权码" />
        </FormItem>
        <div class="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
          <div>企业：{{ form.organizationName }}（{{ form.organizationShortName }}）</div>
          <div class="mt-1">管理员：{{ form.administratorName }} / {{ form.loginName }}</div>
        </div>
      </template>
    </Form>

    <div class="mt-8 flex justify-between">
      <Button v-if="current > 0" :disabled="submitting" @click="current -= 1">上一步</Button>
      <span v-else></span>
      <Button v-if="current < 2" type="primary" @click="next">下一步</Button>
      <Button v-else type="primary" :loading="submitting" @click="finish">完成初始化</Button>
    </div>
  </Card>
</template>
