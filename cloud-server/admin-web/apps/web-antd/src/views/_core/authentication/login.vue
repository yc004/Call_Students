<script lang="ts" setup>
import type { VbenFormSchema } from '@vben/common-ui';
import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { AuthenticationLogin, z } from '@vben/common-ui';
import { $t } from '@vben/locales';

import { useAuthStore } from '#/store';
import { getSetupStatusApi } from '#/api/core/auth';

defineOptions({ name: 'Login' });

const authStore = useAuthStore();
const router = useRouter();

onMounted(async () => {
  const status = await getSetupStatusApi();
  if (!status.initialized) await router.replace('/auth/setup');
});

const formSchema = computed((): VbenFormSchema[] => {
  return [
    {
      component: 'VbenInput',
      componentProps: { placeholder:'例如：my-school' },
      fieldName:'organizationSlug',
      label:'组织标识',
      rules:z.string().trim().min(1,{message:'请输入组织标识'}),
    },
    {
      component: 'VbenInput',
      componentProps: {
        placeholder: $t('authentication.usernameTip'),
      },
      fieldName: 'loginName',
      label: $t('authentication.username'),
      rules: z
        .string()
        .trim()
        .min(1, { message: $t('authentication.usernameTip') }),
    },
    {
      component: 'VbenInputPassword',
      componentProps: {
        placeholder: $t('authentication.password'),
      },
      fieldName: 'password',
      label: $t('authentication.password'),
      rules: z.string().min(1, { message: $t('authentication.passwordTip') }),
    },
  ];
});
</script>

<template>
  <AuthenticationLogin
    :form-schema="formSchema"
    :loading="authStore.loginLoading"
    :show-code-login="false"
    :show-forget-password="false"
    :show-qrcode-login="false"
    :show-register="false"
    :show-third-party-login="false"
    sub-title="使用组织标识、管理员账号和密码登录企业管理中心"
    @submit="authStore.authLogin"
  />
</template>
