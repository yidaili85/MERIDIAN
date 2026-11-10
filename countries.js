// 国家/地区、州省与邮编规则（零依赖）
// postal: 正则；不匹配时前端提示、服务端拒绝
export const COUNTRIES = [
  { code: 'US', name: 'United States', postal: /^\d{5}(-\d{4})?$/, states: 'US' },
  { code: 'CA', name: 'Canada', postal: /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/, states: 'CA' },
  { code: 'GB', name: 'United Kingdom', postal: /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}$/ },
  { code: 'DE', name: 'Germany', postal: /^\d{5}$/ },
  { code: 'FR', name: 'France', postal: /^\d{5}$/ },
  { code: 'IT', name: 'Italy', postal: /^\d{5}$/ },
  { code: 'ES', name: 'Spain', postal: /^\d{5}$/ },
  { code: 'NL', name: 'Netherlands', postal: /^\d{4}\s?[A-Za-z]{2}$/ },
  { code: 'BE', name: 'Belgium', postal: /^\d{4}$/ },
  { code: 'AT', name: 'Austria', postal: /^\d{4}$/ },
  { code: 'CH', name: 'Switzerland', postal: /^\d{4}$/ },
  { code: 'SE', name: 'Sweden', postal: /^\d{3}\s?\d{2}$/ },
  { code: 'NO', name: 'Norway', postal: /^\d{4}$/ },
  { code: 'DK', name: 'Denmark', postal: /^\d{4}$/ },
  { code: 'FI', name: 'Finland', postal: /^\d{5}$/ },
  { code: 'IE', name: 'Ireland', postal: /^[A-Za-z]\d[A-Za-z\d]\s?[A-Za-z\d]{4}$/ },
  { code: 'PT', name: 'Portugal', postal: /^\d{4}-\d{3}$/ },
  { code: 'PL', name: 'Poland', postal: /^\d{2}-\d{3}$/ },
  { code: 'CZ', name: 'Czechia', postal: /^\d{3}\s?\d{2}$/ },
  { code: 'GR', name: 'Greece', postal: /^\d{3}\s?\d{2}$/ },
  { code: 'AU', name: 'Australia', postal: /^\d{4}$/, states: 'AU' },
  { code: 'NZ', name: 'New Zealand', postal: /^\d{4}$/ },
  { code: 'JP', name: 'Japan', postal: /^\d{3}-?\d{4}$/ },
  { code: 'KR', name: 'South Korea', postal: /^\d{5}$/ },
  { code: 'SG', name: 'Singapore', postal: /^\d{6}$/ },
  { code: 'HK', name: 'Hong Kong', postal: /^\d{3,6}$/ },
  { code: 'TW', name: 'Taiwan', postal: /^\d{3,5}$/ },
  { code: 'CN', name: 'China', postal: /^\d{6}$/ },
  { code: 'AE', name: 'United Arab Emirates', postal: /^\d{4,6}$/ },
  { code: 'SA', name: 'Saudi Arabia', postal: /^\d{5}(-\d{4})?$/ },
  { code: 'IL', name: 'Israel', postal: /^\d{5,7}$/ },
  { code: 'IN', name: 'India', postal: /^\d{6}$/ },
  { code: 'ID', name: 'Indonesia', postal: /^\d{5}$/ },
  { code: 'MY', name: 'Malaysia', postal: /^\d{5}$/ },
  { code: 'TH', name: 'Thailand', postal: /^\d{5}$/ },
  { code: 'PH', name: 'Philippines', postal: /^\d{4}$/ },
  { code: 'VN', name: 'Vietnam', postal: /^\d{5,6}$/ },
  { code: 'TR', name: 'Türkiye', postal: /^\d{5}$/ },
  { code: 'RU', name: 'Russia', postal: /^\d{6}$/ },
  { code: 'UA', name: 'Ukraine', postal: /^\d{5}$/ },
  { code: 'RO', name: 'Romania', postal: /^\d{6}$/ },
  { code: 'HU', name: 'Hungary', postal: /^\d{4}$/ },
  { code: 'BG', name: 'Bulgaria', postal: /^\d{4}$/ },
  { code: 'HR', name: 'Croatia', postal: /^\d{5}$/ },
  { code: 'SI', name: 'Slovenia', postal: /^\d{4}$/ },
  { code: 'SK', name: 'Slovakia', postal: /^\d{3}\s?\d{2}$/ },
  { code: 'LT', name: 'Lithuania', postal: /^\d{5}$/ },
  { code: 'LV', name: 'Latvia', postal: /^\d{4}$/ },
  { code: 'EE', name: 'Estonia', postal: /^\d{5}$/ },
  { code: 'MX', name: 'Mexico', postal: /^\d{5}$/ },
  { code: 'BR', name: 'Brazil', postal: /^\d{5}-?\d{3}$/ },
  { code: 'AR', name: 'Argentina', postal: /^\d{4}$/ },
  { code: 'CL', name: 'Chile', postal: /^\d{7}$/ },
  { code: 'CO', name: 'Colombia', postal: /^\d{6}$/ },
  { code: 'ZA', name: 'South Africa', postal: /^\d{4}$/ },
  { code: 'EG', name: 'Egypt', postal: /^\d{5}$/ },
  { code: 'NG', name: 'Nigeria', postal: /^\d{6}$/ },
  { code: 'KE', name: 'Kenya', postal: /^\d{5}$/ },
  { code: 'MA', name: 'Morocco', postal: /^\d{5}$/ }
];

export const STATES = {
  US: [['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']],
  CA: [['AB','Alberta'],['BC','British Columbia'],['MB','Manitoba'],['NB','New Brunswick'],['NL','Newfoundland and Labrador'],['NS','Nova Scotia'],['NT','Northwest Territories'],['NU','Nunavut'],['ON','Ontario'],['PE','Prince Edward Island'],['QC','Quebec'],['SK','Saskatchewan'],['YT','Yukon']],
  AU: [['ACT','Australian Capital Territory'],['NSW','New South Wales'],['NT','Northern Territory'],['QLD','Queensland'],['SA','South Australia'],['TAS','Tasmania'],['VIC','Victoria'],['WA','Western Australia']]
};

export const byCode = (code) => COUNTRIES.find(c => c.code === String(code || '').toUpperCase());
export const stateList = (code) => STATES[String(code || '').toUpperCase()] || null;
export const postcodeValid = (code, postal) => {
  const c = byCode(code);
  if (!c) return false;
  const clean = String(postal || '').trim();
  if (!clean) return false;
  return c.postal ? c.postal.test(clean) : clean.length >= 3 && clean.length <= 12;
};
