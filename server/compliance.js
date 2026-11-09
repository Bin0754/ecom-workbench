// 亚马逊 / FDA 化妆品宣称风险规则（简单规则清单，命中即提示，最终以人工和法务判断为准）
// 依据：FDA 区分化妆品与药品——宣称「治疗、治愈、预防疾病或影响身体结构/功能」即可能被认定为药品宣称；
// 亚马逊 A+/图片禁止价格、促销、保修、竞品对比等内容。
export const RULES = [
  {
    id: 'drug-cure',
    level: 'high',
    re: /\b(cure[sd]?|curing|heal(s|ed|ing)?|remed(y|ies))\b/i,
    msg: '治愈/治疗类用语属于药品宣称',
    fix: '改为外观描述，如 "helps skin look smoother"',
  },
  {
    id: 'drug-treat',
    level: 'high',
    re: /\b(treat(s|ed|ing|ment)?|therap(y|eutic))\b/i,
    msg: '"treat/treatment" 属于药品宣称',
    fix: '改为 "care"、"routine" 等',
  },
  {
    id: 'drug-prevent',
    level: 'high',
    re: /\b(prevent(s|ing)?|protects? against)\b.*\b(disease|infection|acne|aging|wrinkles?)\b/i,
    msg: '预防疾病/衰老属于药品或结构功能宣称',
    fix: '删除或改为 "reduces the look of"',
  },
  {
    id: 'disease',
    level: 'high',
    re: /\b(acne|eczema|psoriasis|rosacea|dermatitis|infection|inflammation|anti-?inflammatory|fungal)\b/i,
    msg: '提及皮肤疾病（痘痘治疗在美国属 OTC 药品）',
    fix: '删除疾病名称，改为外观描述',
  },
  {
    id: 'structure',
    level: 'high',
    re: /\b(boosts?|stimulates?|increases?|repairs?|regenerat\w*|rebuild\w*)\b.*\b(collagen|elastin|cells?|dna|barrier function)\b/i,
    msg: '影响胶原/细胞等身体结构功能的宣称',
    fix: '改为 "visibly firmer-looking skin"',
  },
  {
    id: 'permanent',
    level: 'high',
    re: /\b(permanent(ly)?|eliminat\w*|eras(e|es|ing)|remove[sd]? (wrinkles|scars|dark spots))\b/i,
    msg: '永久/消除类绝对化宣称',
    fix: '改为 "reduces the appearance of"',
  },
  {
    id: 'sunscreen',
    level: 'high',
    re: /\b(spf\s?\d*|sunscreen|uv protection|sun protection)\b/i,
    msg: '防晒在美国属 OTC 药品，需要药品标签与资质',
    fix: '无 OTC 资质时删除',
  },
  {
    id: 'antimicrobial',
    level: 'high',
    re: /\b(antibacterial|anti-?bacterial|antimicrobial|kills? (germs|bacteria))\b/i,
    msg: '抗菌杀菌属于药品宣称',
    fix: '删除',
  },
  {
    id: 'medical',
    level: 'high',
    re: /\b(fda[- ]?(approved|cleared|registered)|medical[- ]grade|prescription|clinically approved)\b/i,
    msg: '暗示 FDA 认证/医疗级，化妆品无 FDA 批准',
    fix: '删除',
  },
  {
    id: 'whitening',
    level: 'high',
    re: /\b(whiten\w*|bleach\w*|skin lightening|hydroquinone)\b/i,
    msg: '美白/漂白类宣称在亚马逊受限，含氢醌产品禁售',
    fix: '改为 "brightening-looking"、"radiant"',
  },
  { id: 'hormone', level: 'medium', re: /\b(hormone|steroid|cortisone|retinoic acid|tretinoin)\b/i, msg: '激素/处方成分提及', fix: '核实成分合规' },
  {
    id: 'clinical',
    level: 'medium',
    re: /\b(clinically (proven|tested)|dermatologist (recommended|approved)|\d+% (of users|saw|reported))\b/i,
    msg: '临床/医生推荐/数据类宣称需保留实证',
    fix: '准备检测报告，或改为不带数据的描述',
  },
  {
    id: 'superlative',
    level: 'medium',
    re: /\b(#\s?1|number one|best[- ]selling|best seller|guaranteed?|miracle|instant(ly)? results?)\b/i,
    msg: '最高级/保证类用语，亚马逊图片中易被拒',
    fix: '删除',
  },
  {
    id: 'promo',
    level: 'medium',
    re: /(\$\s?\d|\bsale\b|\bdiscount\b|\bfree shipping\b|\bwarranty\b|% off|\bdeal\b|\bcoupon\b)/i,
    msg: '价格/促销/物流/保修信息，亚马逊图片与 A+ 禁用',
    fix: '删除',
  },
  {
    id: 'natural',
    level: 'low',
    re: /\b(100% natural|chemical[- ]free|non[- ]toxic|organic)\b/i,
    msg: '"天然/无化学"类宣称需可证实（organic 需认证）',
    fix: '核实或删除',
  },
];

export function checkTexts(texts) {
  const hits = [];
  for (const { field, text } of texts) {
    if (!text) continue;
    for (const r of RULES) {
      const m = String(text).match(r.re);
      if (m) hits.push({ rule: r.id, level: r.level, field, match: m[0], msg: r.msg, fix: r.fix });
    }
  }
  return hits;
}
