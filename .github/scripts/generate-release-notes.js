'use strict';

const fs = require('node:fs');

const outputPath = process.argv[2];
const tag = String(process.env.GITHUB_REF_NAME || '').trim();
const repository = String(process.env.GITHUB_REPOSITORY || '').trim();
if (!outputPath || !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag) || !/^[^/]+\/[^/]+$/.test(repository)) {
  throw new Error('Usage: GITHUB_REF_NAME=v1.2.3 GITHUB_REPOSITORY=owner/repo node generate-release-notes.js <output>');
}

const version = tag.slice(1);
const base = `https://github.com/${repository}/releases/download/${tag}`;
const link = (file) => `[下载安装包](${base}/${file})`;
const notes = `# 班达 ${version}

请根据使用场景和电脑类型下载对应的安装包：

| 客户端 | Windows 10/11（x64） | macOS Apple 芯片（arm64） | macOS Intel 芯片（x64） |
| --- | --- | --- | --- |
| 教室端 | ${link(`Banda-Classroom-${version}-Setup-x64.exe`)} | ${link(`Banda-Classroom-${version}-macOS-arm64.dmg`)} | ${link(`Banda-Classroom-${version}-macOS-x64.dmg`)} |
| 教师端 | ${link(`Banda-Teacher-${version}-Setup-x64.exe`)} | ${link(`Banda-Teacher-${version}-macOS-arm64.dmg`)} | ${link(`Banda-Teacher-${version}-macOS-x64.dmg`)} |

## 如何选择

- 教室大屏电脑安装“教室端”。
- 教师个人电脑安装“教师端”。
- Apple M 系列 Mac 选择 arm64；Intel 处理器 Mac 选择 x64。
- 页面底部由 GitHub 自动生成的 Source code 文件仅供开发者使用，普通用户无需下载。
`;

fs.writeFileSync(outputPath, notes, 'utf8');
console.log(`[release] download guide generated for ${tag}`);
