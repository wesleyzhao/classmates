// Builds the two geography decks that ship with Parlor: public/decks/countries.js (a flag
// and a country to name) and public/decks/capitals.js (a country and its capital city).
//
// Everything the decks contain comes from the COUNTRIES table below plus Intl.DisplayNames,
// so the output is a pure function of this file: running it twice writes the same bytes.
// The generated files are committed, because they are what ships; re-run this only when
// the table changes.
//
//   node scripts/gen-countries.js            write both decks
//   node scripts/gen-countries.js --check    fail if the files on disk are out of date
//
// Scope: the 193 UN member states plus Taiwan, Kosovo, Vatican City and Palestine. Places
// that are not commonly called countries (territories, dependencies, constituent nations)
// are left out on purpose.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { normalize as asAnswer } from '../public/shared/match.js';
import { renderDeck } from './lib/deck-file.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} Entry
 * @property {'africa' | 'asia' | 'europe' | 'north-america' | 'south-america' | 'oceania'} continent
 * @property {string} capital             the official seat, or the de facto one where they differ
 * @property {string} [name]              overrides the Intl name when players say something else
 * @property {string[]} [aliases]         other ways people name the country
 * @property {string[]} [capitalAliases]  other ways people name the capital
 * @property {string} [capitalPrompt]     a written question, for the few where the usual one
 *                                        would contain its own answer (Monaco, Tunisia, ...)
 */

/**
 * Every country in both decks, by ISO 3166-1 alpha-2 code. The code drives the name
 * (Intl.DisplayNames), the flag emoji (regional indicator letters) and the flag image
 * (flagcdn). Capitals are the official seat unless a country separates the seat of
 * government from the official capital, in which case the other city is an alias.
 * @type {Record<string, Entry>}
 */
const COUNTRIES = {
  // --- Africa (54) ---------------------------------------------------------
  DZ: { continent: 'africa', capital: 'Algiers' },
  AO: { continent: 'africa', capital: 'Luanda' },
  BJ: { continent: 'africa', capital: 'Porto-Novo', capitalAliases: ['Cotonou'] },
  BW: { continent: 'africa', capital: 'Gaborone' },
  BF: { continent: 'africa', capital: 'Ouagadougou' },
  BI: { continent: 'africa', capital: 'Gitega', capitalAliases: ['Bujumbura'] },
  CV: { continent: 'africa', capital: 'Praia', aliases: ['Cabo Verde'] },
  CM: { continent: 'africa', capital: 'Yaoundé', capitalAliases: ['Yaounde'] },
  CF: { continent: 'africa', capital: 'Bangui', aliases: ['CAR'] },
  TD: { continent: 'africa', capital: "N'Djamena", capitalAliases: ['Ndjamena'] },
  KM: { continent: 'africa', capital: 'Moroni' },
  CG: {
    continent: 'africa',
    capital: 'Brazzaville',
    name: 'Republic of the Congo',
    aliases: ['Congo', 'Congo-Brazzaville', 'Republic of Congo'],
  },
  CD: {
    continent: 'africa',
    capital: 'Kinshasa',
    name: 'Democratic Republic of the Congo',
    aliases: ['DR Congo', 'DRC', 'Democratic Republic of Congo', 'Congo-Kinshasa', 'Zaire'],
  },
  CI: {
    continent: 'africa',
    capital: 'Yamoussoukro',
    name: "Côte d'Ivoire",
    aliases: ['Ivory Coast', "Cote d'Ivoire"],
    capitalAliases: ['Abidjan'],
  },
  DJ: {
    continent: 'africa',
    capital: 'Djibouti',
    capitalPrompt: 'Which East African port city is both a national capital and the name of its country?',
  },
  EG: { continent: 'africa', capital: 'Cairo' },
  GQ: { continent: 'africa', capital: 'Malabo' },
  ER: { continent: 'africa', capital: 'Asmara' },
  SZ: { continent: 'africa', capital: 'Mbabane', aliases: ['Swaziland'], capitalAliases: ['Lobamba'] },
  ET: { continent: 'africa', capital: 'Addis Ababa' },
  GA: { continent: 'africa', capital: 'Libreville' },
  GM: { continent: 'africa', capital: 'Banjul', aliases: ['The Gambia'] },
  GH: { continent: 'africa', capital: 'Accra' },
  GN: { continent: 'africa', capital: 'Conakry' },
  GW: {
    continent: 'africa',
    capital: 'Bissau',
    aliases: ['Guinea Bissau'],
    capitalPrompt: "Which West African capital gives the second half of its country's name?",
  },
  KE: { continent: 'africa', capital: 'Nairobi' },
  LS: { continent: 'africa', capital: 'Maseru' },
  LR: { continent: 'africa', capital: 'Monrovia' },
  LY: { continent: 'africa', capital: 'Tripoli' },
  MG: { continent: 'africa', capital: 'Antananarivo' },
  MW: { continent: 'africa', capital: 'Lilongwe' },
  ML: { continent: 'africa', capital: 'Bamako' },
  MR: { continent: 'africa', capital: 'Nouakchott' },
  MU: { continent: 'africa', capital: 'Port Louis' },
  MA: { continent: 'africa', capital: 'Rabat' },
  MZ: { continent: 'africa', capital: 'Maputo' },
  NA: { continent: 'africa', capital: 'Windhoek' },
  NE: { continent: 'africa', capital: 'Niamey' },
  NG: { continent: 'africa', capital: 'Abuja', capitalAliases: ['Lagos'] },
  RW: { continent: 'africa', capital: 'Kigali' },
  ST: {
    continent: 'africa',
    capital: 'São Tomé',
    aliases: ['Sao Tome and Principe'],
    capitalAliases: ['Sao Tome'],
    capitalPrompt: 'Which capital city stands on the larger of two islands in the Gulf of Guinea?',
  },
  SN: { continent: 'africa', capital: 'Dakar' },
  SC: { continent: 'africa', capital: 'Victoria' },
  SL: { continent: 'africa', capital: 'Freetown' },
  SO: { continent: 'africa', capital: 'Mogadishu' },
  ZA: { continent: 'africa', capital: 'Pretoria', capitalAliases: ['Cape Town', 'Bloemfontein'] },
  SS: { continent: 'africa', capital: 'Juba' },
  SD: { continent: 'africa', capital: 'Khartoum' },
  TZ: { continent: 'africa', capital: 'Dodoma', capitalAliases: ['Dar es Salaam'] },
  TG: { continent: 'africa', capital: 'Lomé', capitalAliases: ['Lome'] },
  TN: {
    continent: 'africa',
    capital: 'Tunis',
    capitalPrompt: 'Which North African capital lies beside the ruins of Carthage?',
  },
  UG: { continent: 'africa', capital: 'Kampala' },
  ZM: { continent: 'africa', capital: 'Lusaka' },
  ZW: { continent: 'africa', capital: 'Harare' },

  // --- Asia (48) -----------------------------------------------------------
  AF: { continent: 'asia', capital: 'Kabul' },
  AM: { continent: 'asia', capital: 'Yerevan' },
  AZ: { continent: 'asia', capital: 'Baku' },
  BH: { continent: 'asia', capital: 'Manama' },
  BD: { continent: 'asia', capital: 'Dhaka' },
  BT: { continent: 'asia', capital: 'Thimphu' },
  BN: { continent: 'asia', capital: 'Bandar Seri Begawan', aliases: ['Brunei Darussalam'] },
  KH: { continent: 'asia', capital: 'Phnom Penh' },
  CN: { continent: 'asia', capital: 'Beijing', aliases: ["People's Republic of China", 'PRC'], capitalAliases: ['Peking'] },
  GE: { continent: 'asia', capital: 'Tbilisi' },
  IN: { continent: 'asia', capital: 'New Delhi', capitalAliases: ['Delhi'] },
  ID: { continent: 'asia', capital: 'Jakarta', capitalAliases: ['Nusantara'] },
  IR: { continent: 'asia', capital: 'Tehran' },
  IQ: { continent: 'asia', capital: 'Baghdad' },
  IL: { continent: 'asia', capital: 'Jerusalem', capitalAliases: ['Tel Aviv'] },
  JP: { continent: 'asia', capital: 'Tokyo' },
  JO: { continent: 'asia', capital: 'Amman' },
  KZ: { continent: 'asia', capital: 'Astana', capitalAliases: ['Nur-Sultan', 'Akmola'] },
  KW: { continent: 'asia', capital: 'Kuwait City' },
  KG: { continent: 'asia', capital: 'Bishkek' },
  LA: { continent: 'asia', capital: 'Vientiane' },
  LB: { continent: 'asia', capital: 'Beirut' },
  MY: { continent: 'asia', capital: 'Kuala Lumpur', capitalAliases: ['Putrajaya'] },
  MV: { continent: 'asia', capital: 'Malé', capitalAliases: ['Male'] },
  MN: { continent: 'asia', capital: 'Ulaanbaatar', capitalAliases: ['Ulan Bator'] },
  MM: { continent: 'asia', capital: 'Naypyidaw', aliases: ['Burma'], capitalAliases: ['Nay Pyi Taw', 'Yangon', 'Rangoon'] },
  NP: { continent: 'asia', capital: 'Kathmandu' },
  KP: { continent: 'asia', capital: 'Pyongyang', aliases: ['DPRK', "Democratic People's Republic of Korea"] },
  OM: { continent: 'asia', capital: 'Muscat' },
  PK: { continent: 'asia', capital: 'Islamabad' },
  PS: {
    continent: 'asia',
    capital: 'Ramallah',
    name: 'Palestine',
    aliases: ['Palestinian Territories', 'State of Palestine'],
    capitalAliases: ['East Jerusalem', 'Jerusalem'],
  },
  PH: { continent: 'asia', capital: 'Manila', capitalAliases: ['Metro Manila', 'Quezon City'] },
  QA: { continent: 'asia', capital: 'Doha' },
  SA: { continent: 'asia', capital: 'Riyadh' },
  SG: {
    continent: 'asia',
    capital: 'Singapore',
    capitalPrompt: 'Which island city-state at the tip of the Malay Peninsula is its own capital?',
  },
  KR: { continent: 'asia', capital: 'Seoul', aliases: ['Korea', 'Republic of Korea'] },
  LK: { continent: 'asia', capital: 'Sri Jayawardenepura Kotte', aliases: ['Ceylon'], capitalAliases: ['Colombo', 'Kotte'] },
  SY: { continent: 'asia', capital: 'Damascus' },
  TW: { continent: 'asia', capital: 'Taipei', aliases: ['Republic of China', 'Chinese Taipei'] },
  TJ: { continent: 'asia', capital: 'Dushanbe' },
  TH: { continent: 'asia', capital: 'Bangkok' },
  TL: { continent: 'asia', capital: 'Dili', aliases: ['East Timor'] },
  TR: { continent: 'asia', capital: 'Ankara', aliases: ['Turkey', 'Turkiye'] },
  TM: { continent: 'asia', capital: 'Ashgabat' },
  AE: { continent: 'asia', capital: 'Abu Dhabi', aliases: ['UAE', 'Emirates'] },
  UZ: { continent: 'asia', capital: 'Tashkent' },
  VN: { continent: 'asia', capital: 'Hanoi', aliases: ['Viet Nam'] },
  YE: { continent: 'asia', capital: 'Sanaa', capitalAliases: ["Sana'a", 'Aden'] },

  // --- Europe (46) ---------------------------------------------------------
  AL: { continent: 'europe', capital: 'Tirana' },
  AD: { continent: 'europe', capital: 'Andorra la Vella' },
  AT: { continent: 'europe', capital: 'Vienna' },
  BY: { continent: 'europe', capital: 'Minsk' },
  BE: { continent: 'europe', capital: 'Brussels' },
  BA: { continent: 'europe', capital: 'Sarajevo', aliases: ['Bosnia'] },
  BG: { continent: 'europe', capital: 'Sofia' },
  HR: { continent: 'europe', capital: 'Zagreb' },
  CY: { continent: 'europe', capital: 'Nicosia' },
  CZ: { continent: 'europe', capital: 'Prague', aliases: ['Czech Republic'] },
  DK: { continent: 'europe', capital: 'Copenhagen' },
  EE: { continent: 'europe', capital: 'Tallinn' },
  FI: { continent: 'europe', capital: 'Helsinki' },
  FR: { continent: 'europe', capital: 'Paris', aliases: ['French Republic'] },
  DE: { continent: 'europe', capital: 'Berlin' },
  GR: { continent: 'europe', capital: 'Athens' },
  HU: { continent: 'europe', capital: 'Budapest' },
  IS: { continent: 'europe', capital: 'Reykjavík', capitalAliases: ['Reykjavik'] },
  IE: { continent: 'europe', capital: 'Dublin', aliases: ['Republic of Ireland', 'Eire'] },
  IT: { continent: 'europe', capital: 'Rome' },
  LV: { continent: 'europe', capital: 'Riga' },
  LI: { continent: 'europe', capital: 'Vaduz' },
  LT: { continent: 'europe', capital: 'Vilnius' },
  LU: { continent: 'europe', capital: 'Luxembourg City', capitalAliases: ['Luxembourg'] },
  MT: { continent: 'europe', capital: 'Valletta' },
  MD: { continent: 'europe', capital: 'Chisinau', capitalAliases: ['Chișinău', 'Kishinev'] },
  MC: {
    continent: 'europe',
    capital: 'Monaco',
    capitalPrompt: 'Which Mediterranean city-state on the French Riviera serves as its own capital?',
  },
  ME: { continent: 'europe', capital: 'Podgorica' },
  NL: { continent: 'europe', capital: 'Amsterdam', aliases: ['Holland', 'The Netherlands'], capitalAliases: ['The Hague'] },
  MK: { continent: 'europe', capital: 'Skopje', aliases: ['Macedonia'] },
  NO: { continent: 'europe', capital: 'Oslo' },
  PL: { continent: 'europe', capital: 'Warsaw' },
  PT: { continent: 'europe', capital: 'Lisbon' },
  RO: { continent: 'europe', capital: 'Bucharest' },
  RU: { continent: 'europe', capital: 'Moscow', aliases: ['Russian Federation'] },
  SM: {
    continent: 'europe',
    capital: 'San Marino',
    capitalAliases: ['City of San Marino'],
    capitalPrompt: "Which capital sits on Monte Titano, in the world's oldest surviving republic?",
  },
  RS: { continent: 'europe', capital: 'Belgrade' },
  SK: { continent: 'europe', capital: 'Bratislava' },
  SI: { continent: 'europe', capital: 'Ljubljana' },
  ES: { continent: 'europe', capital: 'Madrid' },
  SE: { continent: 'europe', capital: 'Stockholm' },
  CH: { continent: 'europe', capital: 'Bern', capitalAliases: ['Berne'] },
  UA: { continent: 'europe', capital: 'Kyiv', capitalAliases: ['Kiev'] },
  GB: { continent: 'europe', capital: 'London', aliases: ['UK', 'Britain', 'Great Britain'] },
  VA: {
    continent: 'europe',
    capital: 'Vatican City',
    aliases: ['Vatican', 'The Vatican', 'Holy See'],
    capitalPrompt: 'Which walled enclave inside Rome is both a country and its own capital?',
  },
  XK: { continent: 'europe', capital: 'Pristina', aliases: ['Republic of Kosovo'], capitalAliases: ['Prishtina', 'Priština'] },

  // --- North America (23) --------------------------------------------------
  AG: { continent: 'north-america', capital: "Saint John's", aliases: ['Antigua'], capitalAliases: ["St John's"] },
  BS: { continent: 'north-america', capital: 'Nassau', aliases: ['The Bahamas'] },
  BB: { continent: 'north-america', capital: 'Bridgetown' },
  BZ: { continent: 'north-america', capital: 'Belmopan' },
  CA: { continent: 'north-america', capital: 'Ottawa' },
  CR: { continent: 'north-america', capital: 'San José', capitalAliases: ['San Jose'] },
  CU: { continent: 'north-america', capital: 'Havana' },
  DM: { continent: 'north-america', capital: 'Roseau' },
  DO: { continent: 'north-america', capital: 'Santo Domingo' },
  SV: { continent: 'north-america', capital: 'San Salvador' },
  GD: { continent: 'north-america', capital: "Saint George's", capitalAliases: ["St George's"] },
  GT: { continent: 'north-america', capital: 'Guatemala City' },
  HT: { continent: 'north-america', capital: 'Port-au-Prince' },
  HN: { continent: 'north-america', capital: 'Tegucigalpa' },
  JM: { continent: 'north-america', capital: 'Kingston' },
  MX: { continent: 'north-america', capital: 'Mexico City' },
  NI: { continent: 'north-america', capital: 'Managua' },
  PA: { continent: 'north-america', capital: 'Panama City' },
  KN: { continent: 'north-america', capital: 'Basseterre', aliases: ['St Kitts and Nevis', 'Saint Kitts'] },
  LC: { continent: 'north-america', capital: 'Castries', aliases: ['St Lucia'] },
  VC: {
    continent: 'north-america',
    capital: 'Kingstown',
    name: 'Saint Vincent and the Grenadines',
    aliases: ['St Vincent and the Grenadines', 'Saint Vincent'],
  },
  TT: { continent: 'north-america', capital: 'Port of Spain', aliases: ['Trinidad'] },
  US: {
    continent: 'north-america',
    capital: 'Washington, D.C.',
    aliases: ['USA', 'United States of America', 'America', 'US'],
    capitalAliases: ['Washington', 'Washington DC', 'DC'],
  },

  // --- South America (12) --------------------------------------------------
  AR: { continent: 'south-america', capital: 'Buenos Aires' },
  BO: { continent: 'south-america', capital: 'Sucre', capitalAliases: ['La Paz'] },
  BR: { continent: 'south-america', capital: 'Brasília', capitalAliases: ['Brasilia'] },
  CL: { continent: 'south-america', capital: 'Santiago' },
  CO: { continent: 'south-america', capital: 'Bogotá', capitalAliases: ['Bogota'] },
  EC: { continent: 'south-america', capital: 'Quito' },
  GY: { continent: 'south-america', capital: 'Georgetown' },
  PY: { continent: 'south-america', capital: 'Asunción', capitalAliases: ['Asuncion'] },
  PE: { continent: 'south-america', capital: 'Lima' },
  SR: { continent: 'south-america', capital: 'Paramaribo' },
  UY: { continent: 'south-america', capital: 'Montevideo' },
  VE: { continent: 'south-america', capital: 'Caracas' },

  // --- Oceania (14) --------------------------------------------------------
  AU: { continent: 'oceania', capital: 'Canberra' },
  FJ: { continent: 'oceania', capital: 'Suva' },
  KI: { continent: 'oceania', capital: 'South Tarawa', capitalAliases: ['Tarawa'] },
  MH: { continent: 'oceania', capital: 'Majuro' },
  FM: { continent: 'oceania', capital: 'Palikir', aliases: ['Federated States of Micronesia'] },
  NR: { continent: 'oceania', capital: 'Yaren' },
  NZ: { continent: 'oceania', capital: 'Wellington' },
  PW: { continent: 'oceania', capital: 'Ngerulmud', capitalAliases: ['Melekeok'] },
  PG: { continent: 'oceania', capital: 'Port Moresby' },
  WS: { continent: 'oceania', capital: 'Apia' },
  SB: { continent: 'oceania', capital: 'Honiara' },
  TO: { continent: 'oceania', capital: "Nuku'alofa", capitalAliases: ['Nukualofa'] },
  TV: { continent: 'oceania', capital: 'Funafuti' },
  VU: { continent: 'oceania', capital: 'Port Vila' },
};

/**
 * Countries whose names take "the" in a sentence: the capital of the Netherlands, not the
 * capital of Netherlands. The answer itself never carries the article.
 */
const TAKES_THE = new Set(['BS', 'GM', 'NL', 'PH', 'MV', 'MH', 'SB', 'US', 'GB', 'AE', 'KM', 'CF', 'DO', 'CD', 'CG']);

/** The continents, in the order they appear in both decks. */
const CONTINENTS = [
  { id: 'africa', name: 'Africa', emoji: '🌍', color: '#e0a81a' },
  { id: 'asia', name: 'Asia', emoji: '🌏', color: '#e0533d' },
  { id: 'europe', name: 'Europe', emoji: '🇪🇺', color: '#2456f5' },
  { id: 'north-america', name: 'North America', emoji: '🌎', color: '#1f7a4d' },
  { id: 'south-america', name: 'South America', emoji: '🌴', color: '#c2408f' },
  { id: 'oceania', name: 'Oceania', emoji: '🏝️', color: '#2aa3c7' },
];

/**
 * Five ways to ask the same thing. A deck where every card opens with the same three
 * words is what the deck audit warns about, so both decks rotate through these.
 */
const FLAG_PROMPTS = [
  "Which country's flag is this?",
  'This flag belongs to which country?',
  'Name the country that flies this flag.',
  'Which country flies this flag?',
  'This is the flag of which country?',
];

const CAPITAL_PROMPTS = [
  (/** @type {string} */ name) => `What is the capital of ${name}?`,
  (/** @type {string} */ name) => `Which city is the capital of ${name}?`,
  (/** @type {string} */ name) => `Name the capital city of ${name}.`,
  (/** @type {string} */ name) => `Which city serves as the capital of ${name}?`,
  (/** @type {string} */ name) => `The government of ${name} sits in which city?`,
];

/**
 * The English name players would say. Intl.DisplayNames is the source; the table
 * overrides the few CLDR spellings that read oddly in a question ("Congo - Kinshasa").
 * @param {string} code  ISO 3166-1 alpha-2
 * @returns {string}
 */
export function countryName(code) {
  const entry = COUNTRIES[code];
  if (entry?.name) return entry.name;
  const display = new Intl.DisplayNames(['en'], { type: 'region' });
  const name = display.of(code);
  if (!name || name === code) throw new Error(`Intl does not name the region ${code}`);
  // CLDR writes names for lists, not for sentences: typographic quotes, an ampersand, an
  // abbreviated saint, a parenthetical alternative. A question says all of it in words.
  return name
    .replace(/[‘’]/g, "'")
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/ & /g, ' and ')
    .replace(/\bSt\. /g, 'Saint ')
    .trim();
}

/**
 * The flag emoji for a country code: the two letters as regional indicator symbols.
 * @param {string} code
 * @returns {string}
 */
export function flagEmoji(code) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Lowercase, unaccented, punctuation-free. Used to prove a question never gives itself away. */
function normalize(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The alternatives worth storing: the ones public/shared/match.js would not already accept.
 * "Turkiye" for "Türkiye" and "The Gambia" for "Gambia" are free; "Ivory Coast" is not.
 * @param {string} answer
 * @param {string[]} [aliases]
 * @returns {string[]}
 */
function usefulAliases(answer, aliases) {
  const seen = new Set([asAnswer(answer)]);
  const out = [];
  for (const alias of aliases || []) {
    const key = asAnswer(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
  }
  return out;
}

/** True when the answer sits inside the question as whole words. */
/**
 * Which template a country gets, from its code rather than its position in the list, so a
 * game that plays one continent does not hear the same five phrasings cycle in order.
 * @param {string} code
 * @param {number} count
 */
function spread(code, count) {
  let h = 7;
  for (const ch of String(code)) h = (h * 31 + ch.charCodeAt(0)) % 1000003;
  return h % count;
}

function promptGivesItAway(prompt, answer) {
  return ` ${normalize(prompt)} `.includes(` ${normalize(answer)} `);
}

/**
 * Both decks, built from the table.
 * @returns {{ countries: import('../types/parlor.js').Deck, capitals: import('../types/parlor.js').Deck }}
 */
export function buildDecks() {
  const order = CONTINENTS.map((c) => c.id);
  const codes = Object.keys(COUNTRIES).sort((a, b) => {
    const byContinent = order.indexOf(COUNTRIES[a].continent) - order.indexOf(COUNTRIES[b].continent);
    return byContinent || countryName(a).localeCompare(countryName(b), 'en');
  });

  /** @type {import('../types/parlor.js').Card[]} */
  const flagCards = [];
  /** @type {import('../types/parlor.js').Card[]} */
  const capitalCards = [];

  codes.forEach((code, index) => {
    const entry = COUNTRIES[code];
    const name = countryName(code);
    const lower = code.toLowerCase();
    const countryAliases = usefulAliases(name, entry.aliases);
    const cityAliases = usefulAliases(entry.capital, entry.capitalAliases);

    flagCards.push({
      id: lower,
      prompt: FLAG_PROMPTS[spread(code, FLAG_PROMPTS.length)],
      // Kosovo's flag emoji is not in the standard set and shows as two letters, so its card uses the image only.
      ...(code === 'XK' ? {} : { emoji: flagEmoji(code) }),
      image: `https://flagcdn.com/w320/${lower}.png`,
      answer: name,
      ...(countryAliases.length ? { aliases: countryAliases } : {}),
      category: entry.continent,
      note: '',
    });

    // Capitals carry their own card ids: the two decks share a "recently seen" list per
    // table, and a player who just saw France's flag should still get France's capital.
    const inSentence = TAKES_THE.has(code) ? `the ${name}` : name;
    const prompt = entry.capitalPrompt || CAPITAL_PROMPTS[spread(code, CAPITAL_PROMPTS.length)](inSentence);
    if (promptGivesItAway(prompt, entry.capital)) {
      throw new Error(`${code}: the capitals question contains its own answer (${entry.capital}). Add a capitalPrompt.`);
    }
    capitalCards.push({
      id: `cap-${lower}`,
      prompt,
      // Kosovo's flag emoji is not in the standard set and shows as two letters, so its card uses the image only.
      ...(code === 'XK' ? {} : { emoji: flagEmoji(code) }),
      answer: entry.capital,
      ...(cityAliases.length ? { aliases: cityAliases } : {}),
      category: entry.continent,
      note: '',
    });
  });

  return {
    countries: {
      id: 'countries',
      title: 'Countries of the world',
      description: 'Every country in the world, one flag at a time, sorted by continent.',
      language: 'en',
      version: 1,
      categories: CONTINENTS,
      cards: flagCards,
    },
    capitals: {
      id: 'capitals',
      title: 'Capital cities',
      description: 'The seat of government of every country, from Abuja to Yaren.',
      language: 'en',
      version: 1,
      categories: CONTINENTS,
      cards: capitalCards,
    },
  };
}

const COUNTRIES_HEADER = `// The flags deck: every country in the world, with its flag as the picture and the country
// as the answer. Generated by scripts/gen-countries.js; edit the table there, not this file.
//
// Images come from flagcdn.com at 320px wide. Categories are continents, which is what the
// flags-europe game filters on.`;

const CAPITALS_HEADER = `// The capitals deck: a country, and the city that governs it. Generated by
// scripts/gen-countries.js; edit the table there, not this file.
//
// Where a country separates its official capital from its seat of government, the official
// one is the answer and the other is an alias, so both are accepted.`;

/**
 * Write both decks. With --check, compare instead and exit non-zero when they differ.
 * @param {{ check?: boolean }} [opts]
 * @returns {number}  a process exit code
 */
export function main(opts = {}) {
  const decks = buildDecks();
  const files = [
    { path: join(ROOT, 'public/decks/countries.js'), text: renderDeck(decks.countries, COUNTRIES_HEADER) },
    { path: join(ROOT, 'public/decks/capitals.js'), text: renderDeck(decks.capitals, CAPITALS_HEADER) },
  ];
  let stale = 0;
  for (const file of files) {
    const current = readOr(file.path);
    if (opts.check) {
      if (current !== file.text) { stale += 1; console.error(`stale: ${file.path}`); }
      continue;
    }
    if (current === file.text) {
      console.log(`unchanged  ${file.path}`);
      continue;
    }
    writeFileSync(file.path, file.text);
    console.log(`written    ${file.path}`);
  }
  if (!opts.check) console.log(`${decks.countries.cards.length} countries, ${decks.capitals.cards.length} capitals.`);
  return stale ? 1 : 0;
}

function readOr(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main({ check: process.argv.includes('--check') }));
}
