<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  DescriptionsItem,
  Form,
  FormItem,
  Image,
  Input,
  Popconfirm,
  Row,
  Select,
  Space,
  Tag,
  Upload,
  message,
} from 'ant-design-vue';

import { enterpriseApi } from '#/api';
import PrimaryColorPicker from '#/components/primary-color-picker.vue';
import { applyOrganizationBranding } from '#/utils/branding';

const loading = ref(true);
const saving = ref(false);
const uploadingLogo = ref(false);
const organization = ref<any>({});
const form = reactive({
  logoUrl: '',
  name: '',
  primaryColor: '#2563EB',
  shortName: '',
  timezone: 'Asia/Shanghai',
});

function fillForm(value: any) {
  Object.assign(form, {
    logoUrl: value.logo_url || '',
    name: value.name || '',
    primaryColor: value.primary_color || '#2563EB',
    shortName: value.short_name || value.name || '',
    timezone: value.timezone || 'Asia/Shanghai',
  });
}

async function load() {
  loading.value = true;
  try {
    organization.value = await enterpriseApi.organization();
    fillForm(organization.value);
    applyOrganizationBranding(organization.value);
  } finally {
    loading.value = false;
  }
}

async function save() {
  const name = form.name.trim();
  const shortName = form.shortName.trim();
  const primaryColor = form.primaryColor.trim();
  const logoUrl = form.logoUrl.trim();
  if (!name || !shortName) {
    message.warning('请填写企业名称和企业简称');
    return;
  }
  if (!/^#[0-9a-f]{6}$/i.test(primaryColor)) {
    message.warning('品牌主色必须是 6 位十六进制颜色，例如 #2563EB');
    return;
  }
  saving.value = true;
  try {
    organization.value = await enterpriseApi.updateOrganization({
      logoUrl: logoUrl || undefined,
      name,
      primaryColor,
      shortName,
      timezone: form.timezone,
    });
    fillForm(organization.value);
    applyOrganizationBranding(organization.value);
    message.success('企业基本信息已保存');
  } finally {
    saving.value = false;
  }
}

function reset() {
  fillForm(organization.value);
}

async function uploadLogo(file: File) {
  const contentType = resolveLogoContentType(file);
  if (!contentType) {
    message.warning('Logo 仅支持 PNG、JPEG 或 WebP 图片');
    return false;
  }
  if (file.size > 20 * 1024 * 1024) {
    message.warning('Logo 原始文件不能超过 20MB');
    return false;
  }
  uploadingLogo.value = true;
  let optimizedFile: File;
  try {
    const normalizedFile = file.type === contentType
      ? file
      : new File([file], file.name, { lastModified: file.lastModified, type: contentType });
    optimizedFile = await optimizeLogo(normalizedFile);
  } catch {
    message.error('Logo 压缩失败，请更换 PNG、JPEG 或 WebP 图片后重试');
    uploadingLogo.value = false;
    return false;
  }
  try {
    organization.value = await enterpriseApi.uploadOrganizationLogo(optimizedFile);
    form.logoUrl = organization.value.logo_url || '';
    applyOrganizationBranding(organization.value);
    const saved = Math.max(0, file.size - optimizedFile.size);
    const detail = saved > 0 ? `，上传前已压缩 ${Math.round(saved / 1024)}KB` : '';
    message.success(`企业 Logo 已自动优化并立即应用${detail}`);
  } catch {
    // The shared request interceptor displays the specific server-side error.
  } finally {
    uploadingLogo.value = false;
  }
  return false;
}

function resolveLogoContentType(file: File) {
  const declaredType = file.type.toLowerCase().split(';', 1)[0] ?? '';
  const aliases: Record<string, string> = {
    'image/jpg': 'image/jpeg',
    'image/pjpeg': 'image/jpeg',
    'image/x-png': 'image/png',
  };
  const normalizedType = aliases[declaredType] || declaredType;
  if (['image/jpeg', 'image/png', 'image/webp'].includes(normalizedType)) {
    return normalizedType;
  }
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension === 'png'
    ? 'image/png'
    : ['jpeg', 'jpg'].includes(extension || '')
      ? 'image/jpeg'
      : extension === 'webp'
        ? 'image/webp'
        : undefined;
}

async function optimizeLogo(file: File) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 1024 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image compression failed')), 'image/webp', 0.86);
    });
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'logo'}.webp`, { type: 'image/webp' });
  } finally {
    bitmap.close();
  }
}

async function removeLogo() {
  uploadingLogo.value = true;
  try {
    organization.value = await enterpriseApi.removeOrganizationLogo();
    form.logoUrl = '';
    applyOrganizationBranding(organization.value);
    message.success('企业 Logo 已移除');
  } finally {
    uploadingLogo.value = false;
  }
}

onMounted(load);
</script>

<template>
  <Page title="企业基本信息" description="维护企业品牌资料和组织展示信息">
    <Alert
      class="mb-4"
      message="组织标识用于登录和数据隔离，创建后不可修改。"
      show-icon
      type="info"
    />
    <Row :gutter="16">
      <Col :lg="9" :xs="24">
        <Card :loading="loading" title="组织信息">
          <Descriptions bordered :column="1" size="small">
            <DescriptionsItem label="组织标识">
              {{ organization.slug || '-' }}
            </DescriptionsItem>
            <DescriptionsItem label="服务方案">
              {{ organization.plan || '-' }}
            </DescriptionsItem>
            <DescriptionsItem label="运行状态">
              <Tag :color="organization.status === 'active' ? 'green' : 'default'">
                {{ organization.status === 'active' ? '正常' : organization.status || '-' }}
              </Tag>
            </DescriptionsItem>
            <DescriptionsItem label="创建时间">
              {{ organization.created_at || '-' }}
            </DescriptionsItem>
            <DescriptionsItem label="最近更新">
              {{ organization.updated_at || '-' }}
            </DescriptionsItem>
          </Descriptions>
        </Card>
      </Col>
      <Col :lg="15" :xs="24">
        <Card :loading="loading" title="基础资料">
          <Form layout="vertical">
            <FormItem label="企业名称" required>
              <Input v-model:value="form.name" :maxlength="120" show-count />
            </FormItem>
            <FormItem label="企业简称" required>
              <Input v-model:value="form.shortName" :maxlength="40" show-count />
            </FormItem>
            <FormItem label="企业 Logo">
              <div class="logo-upload-panel">
                <div class="logo-preview">
                  <Image
                    v-if="form.logoUrl"
                    :height="80"
                    :preview="false"
                    :src="form.logoUrl"
                    :width="80"
                  />
                  <span v-else class="text-sm text-gray-400">暂无 Logo</span>
                </div>
                <div>
                  <Space wrap>
                    <Upload
                      accept="image/png,image/jpeg,image/webp"
                      :before-upload="uploadLogo"
                      :show-upload-list="false"
                    >
                      <Button :loading="uploadingLogo">上传并立即应用</Button>
                    </Upload>
                    <Popconfirm
                      v-if="form.logoUrl"
                      title="确认移除当前企业 Logo？"
                      @confirm="removeLogo"
                    >
                      <Button danger :disabled="uploadingLogo">移除 Logo</Button>
                    </Popconfirm>
                  </Space>
                  <p class="mb-0 mt-2 text-xs text-gray-500">
                    支持 PNG、JPEG、WebP，原图最大 20MB；大图会自动缩放至 512px 并压缩，建议使用正方形透明背景图片。
                  </p>
                  <p class="mb-0 mt-1 text-xs text-orange-600">
                    Logo 上传或移除后会立即生效，不受页面底部“重置”按钮影响。
                  </p>
                </div>
              </div>
            </FormItem>
            <FormItem label="品牌主色" required>
              <PrimaryColorPicker v-model="form.primaryColor" />
            </FormItem>
            <FormItem label="业务时区" required>
              <Select
                v-model:value="form.timezone"
                :options="[
                  { label: '中国标准时间（上海）', value: 'Asia/Shanghai' },
                  { label: '香港时间', value: 'Asia/Hong_Kong' },
                  { label: '东京时间', value: 'Asia/Tokyo' },
                  { label: '新加坡时间', value: 'Asia/Singapore' },
                  { label: '协调世界时（UTC）', value: 'UTC' },
                ]"
              />
            </FormItem>
            <div class="text-right">
              <Space>
                <Button :disabled="loading || saving" @click="reset">重置未保存资料</Button>
                <Button type="primary" :loading="saving" @click="save">保存信息</Button>
              </Space>
            </div>
          </Form>
        </Card>
      </Col>
    </Row>
  </Page>
</template>

<style scoped>
.logo-upload-panel {
  align-items: center;
  display: flex;
  gap: 16px;
}

.logo-preview {
  align-items: center;
  background: #fafafa;
  border: 1px dashed #d9d9d9;
  border-radius: 8px;
  display: flex;
  height: 96px;
  justify-content: center;
  overflow: hidden;
  width: 96px;
}
</style>
