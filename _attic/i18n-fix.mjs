import { readFileSync, writeFileSync } from 'node:fs';
const patch = {
  zh: { cavern: '隧洞遗器', planar: '位面饰品' },
  en: { cavern: 'Cavern Relics', planar: 'Planar Ornaments' },
  ja: { cavern: 'トンネル遺器', planar: '次元界オーナメント' },
  ko: { cavern: '동굴 유물', planar: '차원 장신구' },
};
for (const [lang, labels] of Object.entries(patch)) {
  const path = `src/i18n/locales/${lang}.json`;
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.list.kindCavern = labels.cavern;
  json.list.kindPlanar = labels.planar;
  if (lang === 'ja') json.detail.pieces = 'セット';
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  console.log(lang, json.list.kindCavern, '/', json.list.kindPlanar, '/ pieces=', json.detail.pieces);
}
