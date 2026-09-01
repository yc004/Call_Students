import { updatePreferences } from '@vben/preferences';

interface OrganizationBranding {
  logo_url?: null | string;
  logoUrl?: null | string;
  name?: null | string;
  primary_color?: null | string;
  primaryColor?: null | string;
  short_name?: null | string;
  shortName?: null | string;
}

const DEFAULT_LOGO = '/admin/logo.svg';
const DEFAULT_NAME = '企业管理中心';
const DEFAULT_PRIMARY_COLOR = '#2563EB';

function normalizeColor(value?: null | string) {
  return /^#[0-9a-f]{6}$/i.test(value || '')
    ? value!.toUpperCase()
    : DEFAULT_PRIMARY_COLOR;
}

export function applyOrganizationBranding(organization?: OrganizationBranding | null) {
  if (!organization) return;
  const fullName = organization.name?.trim() || DEFAULT_NAME;
  const displayName = organization.shortName?.trim() || organization.short_name?.trim() || fullName;
  const logo = organization.logoUrl?.trim() || organization.logo_url?.trim() || DEFAULT_LOGO;
  const primaryColor = normalizeColor(organization.primaryColor || organization.primary_color);

  updatePreferences({
    app: {
      name: displayName,
    },
    copyright: {
      companyName: fullName,
    },
    logo: {
      source: logo,
      sourceDark: logo,
    },
    theme: {
      builtinType: 'custom',
      colorPrimary: primaryColor,
    },
  });

  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) favicon.href = logo;
  let themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!themeColor) {
    themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    document.head.append(themeColor);
  }
  themeColor.content = primaryColor;
}
