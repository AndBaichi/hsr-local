import { describe, expect, it } from 'vitest';

import { compareVersions, parseUpdateManifest } from './manifest';

/** 一份合法 manifest（字段与 CI 生成的 update.json 一致） */
const VALID = {
  schemaVersion: 1,
  channel: 'stable',
  packVersion: '4.7.52-local.1',
  upstreamVersion: '4.7.52',
  gameVersion: '4.7.52',
  minAppVersion: '4.7.51',
  archiveBytes: 78_000_000,
  entryCount: 7360,
  sha256: 'a'.repeat(64),
  url: 'https://github.com/AndBaichi/hsr-local/releases/download/datapack-4.7.52/hsr-local-4.7.52.hsrpack',
  releasedAt: '2026-11-18T00:00:00.000Z',
  notes: 'test',
};

describe('parseUpdateManifest', () => {
  it('接受合法 manifest', () => {
    const parsed = parseUpdateManifest(JSON.stringify(VALID));
    expect(parsed.gameVersion).toBe('4.7.52');
    expect(parsed.archiveBytes).toBe(78_000_000);
  });

  it('拒绝 schemaVersion 不为 1 的 manifest', () => {
    expect(() => parseUpdateManifest(JSON.stringify({ ...VALID, schemaVersion: 2 }))).toThrow(
      /schemaVersion/,
    );
  });

  it('拒绝非 HTTPS 下载地址', () => {
    expect(() =>
      parseUpdateManifest(JSON.stringify({ ...VALID, url: 'http://example.com/x.hsrpack' })),
    ).toThrow(/HTTPS/);
  });

  it('拒绝非 64 位 sha256', () => {
    expect(() => parseUpdateManifest(JSON.stringify({ ...VALID, sha256: 'abc' }))).toThrow(/sha256/);
  });

  it('拒绝非正数 archiveBytes', () => {
    expect(() => parseUpdateManifest(JSON.stringify({ ...VALID, archiveBytes: 0 }))).toThrow(
      /archiveBytes/,
    );
  });
});

describe('compareVersions', () => {
  it('按数字段比较而不是字符串比较', () => {
    expect(compareVersions('4.7.52', '4.7.51')).toBeGreaterThan(0);
    expect(compareVersions('4.10.0', '4.9.99')).toBeGreaterThan(0);
    expect(compareVersions('4.7.51', '4.7.51')).toBe(0);
    expect(compareVersions('4.7.50', '4.7.51')).toBeLessThan(0);
  });

  it('缺失段按 0 处理', () => {
    expect(compareVersions('4.8', '4.8.0')).toBe(0);
    expect(compareVersions('5', '4.99.99')).toBeGreaterThan(0);
  });
});
