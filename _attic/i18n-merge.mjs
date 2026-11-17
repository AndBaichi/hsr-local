import { readFileSync, writeFileSync } from 'node:fs';

const data = {
  zh: {
    navAdd: { changelog: '更新日志', endgame: '终局内容', currency: '货币战争', home2: '总览' },
    list: {
      search: '搜索', searchPlaceholder: '按名称或 ID 搜索…', empty: '没有匹配的条目',
      filterRarity: '稀有度', filterPath: '命途', filterElement: '属性', filterKind: '类型',
      filterRank: '阶级', filterMainType: '类别', filterWeak: '弱点',
      next: '下一页', prev: '上一页', all: '全部',
    },
    detail: {
      back: '返回列表', loading: '正在加载详情…', notFound: '未找到该条目',
      favorite: '收藏', unfavorite: '已收藏', tools: '我的标记',
      note: '笔记', notePlaceholder: '写点什么…（自动保存）', noteSaved: '输入后自动保存',
      overview: '概览', skills: '技能', ranks: '星魂', stats: '属性', refinement: '叠影',
      effects: '套装效果', parts: '部位构成', story: '故事', desc: '说明', bgDesc: '背景描述',
      source: '获取来源', basic: '基础信息', id: 'ID', rarity: '稀有度', path: '命途',
      element: '属性', kind: '类型', weakness: '弱点', variants: '变体', hidden: '隐藏',
      noContent: '暂无内容', pieces: '件套', pileLimit: '堆叠上限',
      mainType: '主类别', subType: '子类别', level: '等级', simpleDesc: '简述',
      achievements: '成就列表', count: '共 {{count}} 项', memo: '忆灵', skillTree: '行迹',
    },
  },
  en: {
    navAdd: { changelog: 'Changelog', endgame: 'Endgame', currency: 'Currency Wars', home2: 'Overview' },
    list: {
      search: 'Search', searchPlaceholder: 'Search by name or ID…', empty: 'No matching entries',
      filterRarity: 'Rarity', filterPath: 'Path', filterElement: 'Element', filterKind: 'Type',
      filterRank: 'Rank', filterMainType: 'Category', filterWeak: 'Weakness',
      next: 'Next', prev: 'Previous', all: 'All',
    },
    detail: {
      back: 'Back to list', loading: 'Loading details…', notFound: 'Entry not found',
      favorite: 'Add to favorites', unfavorite: 'Favorited', tools: 'My markers',
      note: 'Note', notePlaceholder: 'Write something… (auto-saved)', noteSaved: 'Saved automatically as you type',
      overview: 'Overview', skills: 'Skills', ranks: 'Eidolons', stats: 'Stats', refinement: 'Superimposition',
      effects: 'Set effects', parts: 'Pieces', story: 'Story', desc: 'Description', bgDesc: 'Flavor text',
      source: 'Sources', basic: 'Basic info', id: 'ID', rarity: 'Rarity', path: 'Path',
      element: 'Element', kind: 'Type', weakness: 'Weakness', variants: 'Variants', hidden: 'Hidden',
      noContent: 'No content', pieces: 'pcs', pileLimit: 'Stack limit',
      mainType: 'Main type', subType: 'Sub type', level: 'Level', simpleDesc: 'Summary',
      achievements: 'Achievements', count: '{{count}} entries', memo: 'Memosprite', skillTree: 'Traces',
    },
  },
  ja: {
    navAdd: { changelog: '更新履歴', endgame: '終局コンテンツ', currency: '通貨戦争', home2: '概要' },
    list: {
      search: '検索', searchPlaceholder: '名前または ID で検索…', empty: '該当する項目がありません',
      filterRarity: 'レアリティ', filterPath: '運命', filterElement: '属性', filterKind: '種類',
      filterRank: 'ランク', filterMainType: 'カテゴリ', filterWeak: '弱点',
      next: '次へ', prev: '前へ', all: 'すべて',
    },
    detail: {
      back: '一覧に戻る', loading: '詳細を読み込み中…', notFound: '項目が見つかりません',
      favorite: 'お気に入りに追加', unfavorite: 'お気に入り済み', tools: 'マイマーク',
      note: 'メモ', notePlaceholder: 'メモを入力…（自動保存）', noteSaved: '入力内容は自動保存されます',
      overview: '概要', skills: 'スキル', ranks: '星魂', stats: 'ステータス', refinement: '重畳',
      effects: 'セット効果', parts: '部位', story: 'ストーリー', desc: '説明', bgDesc: 'フレーバーテキスト',
      source: '入手元', basic: '基本情報', id: 'ID', rarity: 'レアリティ', path: '運命',
      element: '属性', kind: '種類', weakness: '弱点', variants: 'バリエーション', hidden: '隠し',
      noContent: '内容なし', pieces: '件套', pileLimit: 'スタック上限',
      mainType: '主カテゴリ', subType: '副カテゴリ', level: 'レベル', simpleDesc: '概要',
      achievements: '実績一覧', count: '{{count}} 件', memo: '精霊', skillTree: '軌跡',
    },
  },
  ko: {
    navAdd: { changelog: '업데이트 로그', endgame: '종말 콘텐츠', currency: '화폐 전쟁', home2: '개요' },
    list: {
      search: '검색', searchPlaceholder: '이름 또는 ID로 검색…', empty: '일치하는 항목이 없습니다',
      filterRarity: '희귀도', filterPath: '운명', filterElement: '속성', filterKind: '유형',
      filterRank: '등급', filterMainType: '분류', filterWeak: '약점',
      next: '다음', prev: '이전', all: '전체',
    },
    detail: {
      back: '목록으로', loading: '상세 정보를 불러오는 중…', notFound: '항목을 찾을 수 없습니다',
      favorite: '즐겨찾기 추가', unfavorite: '즐겨찾기됨', tools: '내 표시',
      note: '메모', notePlaceholder: '메모를 입력… (자동 저장)', noteSaved: '입력하면 자동으로 저장됩니다',
      overview: '개요', skills: '스킬', ranks: '성혼', stats: '능력치', refinement: '중첩',
      effects: '세트 효과', parts: '부위', story: '이야기', desc: '설명', bgDesc: '배경 설명',
      source: '획득처', basic: '기본 정보', id: 'ID', rarity: '희귀도', path: '운명',
      element: '속성', kind: '유형', weakness: '약점', variants: '변형', hidden: '숨김',
      noContent: '내용 없음', pieces: '세트', pileLimit: '보유 한도',
      mainType: '주 분류', subType: '부 분류', level: '레벨', simpleDesc: '요약',
      achievements: '업적 목록', count: '{{count}}개 항목', memo: '정령', skillTree: '행적',
    },
  },
};

for (const [lang, add] of Object.entries(data)) {
  const path = `src/i18n/locales/${lang}.json`;
  const json = JSON.parse(readFileSync(path, 'utf8'));
  json.nav = { ...(json.nav ?? {}), ...add.navAdd };
  json.list = { ...(json.list ?? {}), ...add.list };
  json.detail = { ...(json.detail ?? {}), ...add.detail };
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  const keys = Object.keys(json.list).length + Object.keys(json.detail).length;
  console.log(`${lang}: list+detail keys=${keys}, nav has changelog=${'changelog' in json.nav}`);
}
