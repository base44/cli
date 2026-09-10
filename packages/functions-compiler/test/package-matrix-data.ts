/**
 * Package list for the real-world bundle+run matrix (package-matrix.e2e.test.ts).
 *
 * One isolated diagnostic backend function per npm package — never bundle two
 * into one, so each gives a clean per-package signal. Each function imports the
 * library, exercises it meaningfully, and returns a consistent JSON envelope:
 *   { package, version, status: "pass", output }   on success
 *   { package, status: "fail", error }              on a caught error (HTTP 500)
 *
 * `expected` records the CURRENT observed outcome end-to-end (bundle → execute
 * in workerd): "pass" = bundles and the handler runs returning status "pass";
 * "fail" = the package does not currently work (bundle error OR runtime throw).
 * Failing entries are kept on purpose — the failure is the data point about a
 * platform limitation. Do NOT "fix" a function to make it pass; when the
 * platform gains the capability, flip `expected` here instead.
 */

// The redeploy marker mirrors the production builder: whitespace-only changes
// are ignored, so a dated comment is the only reliable redeploy trigger. Inert
// here (just bundled source), kept so these match real functions.
const REDEPLOY = "// redeploy-2026-06-10T01";

/** Wrap a library import + exercise in the standard diagnostic-function shape. */
function fn(pkg: string, version: string, imp: string, body: string): string {
  return `${imp} ${REDEPLOY}
Deno.serve(async (req) => {
  try {
${body}
    return Response.json({ package: ${JSON.stringify(pkg)}, version: ${JSON.stringify(version)}, status: "pass", output });
  } catch (error) {
    return Response.json({ package: ${JSON.stringify(pkg)}, status: "fail", error: error.message }, { status: 500 });
  }
});`;
}

interface PkgCase {
  name: string;
  pkg: string;
  version: string;
  expected: "pass" | "fail";
  source: string;
}

export const PACKAGES: PkgCase[] = [
  { name: "testLodash", pkg: "lodash", version: "4.17.21", expected: "pass", source: fn("lodash", "4.17.21",
    "import _ from 'npm:lodash@4.17.21';",
    "    const output = { sorted: _.sortBy([3,1,2]), chunked: _.chunk([1,2,3,4],2), grouped: _.groupBy([1.1,1.2,2.3], Math.floor), uniq: _.uniq([1,1,2]), merged: _.merge({a:1},{b:2}) };") },
  { name: "testMoment", pkg: "moment", version: "2.30.1", expected: "pass", source: fn("moment", "2.30.1",
    "import moment from 'npm:moment@2.30.1';",
    "    const m = moment('2020-01-01'); const output = { formatted: m.format('YYYY-MM-DD'), fromNow: m.fromNow(), durationMin: moment.duration(2,'hours').asMinutes() };") },
  { name: "testDateFns", pkg: "date-fns", version: "3.6.0", expected: "pass", source: fn("date-fns", "3.6.0",
    "import { format, addDays, differenceInDays } from 'npm:date-fns@3.6.0';",
    "    const d = new Date(2020,0,1); const output = { formatted: format(d,'yyyy-MM-dd'), added: format(addDays(d,5),'yyyy-MM-dd'), diff: differenceInDays(addDays(d,5), d) };") },
  { name: "testUuid", pkg: "uuid", version: "9.0.0", expected: "pass", source: fn("uuid", "9.0.0",
    "import { v4, v5 } from 'npm:uuid@9.0.0';",
    "    const NS='6ba7b810-9dad-11d1-80b4-00c04fd430c8'; const output = { v4: v4(), v5: v5('hello', NS) };") },
  { name: "testCryptoJs", pkg: "crypto-js", version: "4.2.0", expected: "pass", source: fn("crypto-js", "4.2.0",
    "import CryptoJS from 'npm:crypto-js@4.2.0';",
    "    const output = { md5: CryptoJS.MD5('hi').toString(), sha256: CryptoJS.SHA256('hi').toString(), aes: CryptoJS.AES.encrypt('hi','key').toString() };") },
  { name: "testMarked", pkg: "marked", version: "12.0.0", expected: "pass", source: fn("marked", "12.0.0",
    "import { marked } from 'npm:marked@12.0.0';",
    "    const output = { html: marked.parse('# Hi') };") },
  { name: "testSlugify", pkg: "slugify", version: "1.6.6", expected: "pass", source: fn("slugify", "1.6.6",
    "import slugify from 'npm:slugify@1.6.6';",
    "    const output = { slug: slugify('Hello World!', { lower: true }) };") },
  { name: "testValidator", pkg: "validator", version: "13.11.0", expected: "pass", source: fn("validator", "13.11.0",
    "import validator from 'npm:validator@13.11.0';",
    "    const output = { isEmail: validator.isEmail('a@b.com'), isURL: validator.isURL('https://x.com'), isIP: validator.isIP('127.0.0.1') };") },
  { name: "testYaml", pkg: "js-yaml", version: "4.1.0", expected: "pass", source: fn("js-yaml", "4.1.0",
    "import yaml from 'npm:js-yaml@4.1.0';",
    "    const dumped = yaml.dump({ a: 1, b: [2,3] }); const loaded = yaml.load(dumped); const output = { dumped, loaded };") },
  { name: "testNumeral", pkg: "numeral", version: "2.0.6", expected: "pass", source: fn("numeral", "2.0.6",
    "import numeral from 'npm:numeral@2.0.6';",
    "    const output = { currency: numeral(1234.56).format('$0,0.00'), percent: numeral(0.25).format('0%'), bytes: numeral(1024).format('0b') };") },
  { name: "testMimeTypes", pkg: "mime-types", version: "2.1.35", expected: "pass", source: fn("mime-types", "2.1.35",
    "import mimeTypes from 'npm:mime-types@2.1.35';",
    "    const output = { json: mimeTypes.lookup('file.json'), html: mimeTypes.contentType('html') };") },
  { name: "testQs", pkg: "qs", version: "6.12.0", expected: "pass", source: fn("qs", "6.12.0",
    "import qs from 'npm:qs@6.12.0';",
    "    const str = qs.stringify({ a: 1, b: { c: 2 } }); const parsed = qs.parse(str); const output = { str, parsed };") },
  { name: "testJsonwebtoken", pkg: "jsonwebtoken", version: "9.0.2", expected: "pass", source: fn("jsonwebtoken", "9.0.2",
    "import jwt from 'npm:jsonwebtoken@9.0.2';",
    "    const token = jwt.sign({ id: 1 }, 'secret'); const decoded = jwt.verify(token, 'secret'); const output = { token, decoded };") },
  { name: "testCsvStringify", pkg: "csv-stringify", version: "6.4.6", expected: "pass", source: fn("csv-stringify", "6.4.6",
    "import { stringify } from 'npm:csv-stringify@6.4.6/sync';",
    "    const output = { csv: stringify([['a','b'],['1','2']]) };") },
  { name: "testChance", pkg: "chance", version: "1.1.11", expected: "pass", source: fn("chance", "1.1.11",
    "import Chance from 'npm:chance@1.1.11';",
    "    const chance = new Chance(); const output = { name: chance.name(), email: chance.email(), address: chance.address() };") },
  { name: "testDayjs", pkg: "dayjs", version: "1.11.10", expected: "pass", source: fn("dayjs", "1.11.10",
    "import dayjs from 'npm:dayjs@1.11.10';",
    "    const d = dayjs('2020-01-01'); const output = { formatted: d.format('YYYY-MM-DD'), added: d.add(1,'day').format('YYYY-MM-DD'), diff: dayjs('2020-01-10').diff(d,'day') };") },
  { name: "testDiff", pkg: "diff", version: "5.2.0", expected: "pass", source: fn("diff", "5.2.0",
    "import { diffWords } from 'npm:diff@5.2.0';",
    "    const output = { changes: diffWords('hello world','hello there').map(p => ({ value: p.value, added: !!p.added, removed: !!p.removed })) };") },
  // FAILS at runtime — ajv.compile() builds validators with `new Function(...)`;
  // workerd forbids runtime code generation ("Code generation from strings
  // disallowed"). Bundles fine, throws when the handler runs.
  { name: "testAjv", pkg: "ajv", version: "8.12.0", expected: "fail", source: fn("ajv", "8.12.0",
    "import Ajv from 'npm:ajv@8.12.0';",
    "    const ajv = new Ajv(); const validate = ajv.compile({ type: 'object', properties: { x: { type: 'number' } }, required: ['x'] }); const output = { valid: validate({ x: 1 }), invalid: validate({}) };") },
  { name: "testHumanizeDuration", pkg: "humanize-duration", version: "3.31.0", expected: "pass", source: fn("humanize-duration", "3.31.0",
    "import humanizeDuration from 'npm:humanize-duration@3.31.0';",
    "    const output = { human: humanizeDuration(3600000) };") },
  { name: "testPluralize", pkg: "pluralize", version: "8.0.0", expected: "pass", source: fn("pluralize", "8.0.0",
    "import pluralize from 'npm:pluralize@8.0.0';",
    "    const output = { plural: pluralize('apple', 3), singular: pluralize.singular('apples'), isPlural: pluralize.isPlural('apples') };") },
  { name: "testColorConvert", pkg: "color-convert", version: "2.0.1", expected: "pass", source: fn("color-convert", "2.0.1",
    "import convert from 'npm:color-convert@2.0.1';",
    "    const output = { hsl: convert.rgb.hsl(255,0,0), hex: convert.rgb.hex(255,0,0), rgb: convert.hex.rgb('FF0000') };") },
  { name: "testFlatted", pkg: "flatted", version: "3.3.1", expected: "pass", source: fn("flatted", "3.3.1",
    "import { stringify, parse } from 'npm:flatted@3.3.1';",
    "    const obj = {}; obj.self = obj; const str = stringify(obj); const parsed = parse(str); const output = { str, hasSelf: parsed.self === parsed };") },
  { name: "testNanoid", pkg: "nanoid", version: "5.0.4", expected: "pass", source: fn("nanoid", "5.0.4",
    "import { nanoid } from 'npm:nanoid@5.0.4';",
    "    const output = { id: nanoid(), id10: nanoid(10) };") },
  { name: "testZod", pkg: "zod", version: "3.23.8", expected: "pass", source: fn("zod", "3.23.8",
    "import { z } from 'npm:zod@3.23.8';",
    "    const schema = z.object({ name: z.string(), age: z.number() }); const parsed = schema.parse({ name: 'a', age: 1 }); const safe = schema.safeParse({ name: 'a' }); const output = { parsed, safeSuccess: safe.success };") },
  { name: "testAxios", pkg: "axios", version: "1.7.2", expected: "pass", source: fn("axios", "1.7.2",
    "import axios from 'npm:axios@1.7.2';",
    "    const res = await axios.get('https://jsonplaceholder.typicode.com/todos/1'); const output = { id: res.data.id, title: res.data.title };") },
  { name: "testRamda", pkg: "ramda", version: "0.30.1", expected: "pass", source: fn("ramda", "0.30.1",
    "import { map, filter, reduce, compose } from 'npm:ramda@0.30.1';",
    "    const inc = x => x + 1; const isEven = x => x % 2 === 0; const f = compose(filter(isEven), map(inc)); const output = { mapped: map(inc, [1,2,3]), filtered: filter(isEven, [1,2,3,4]), reduced: reduce((a,b)=>a+b, 0, [1,2,3]), composed: f([1,2,3,4]) };") },
  { name: "testFuse", pkg: "fuse.js", version: "7.0.0", expected: "pass", source: fn("fuse.js", "7.0.0",
    "import Fuse from 'npm:fuse.js@7.0.0';",
    "    const fuse = new Fuse(['apple','banana','orange'], {}); const output = { result: fuse.search('aple').map(r => r.item) };") },
  { name: "testJoiValidation", pkg: "joi", version: "17.13.1", expected: "pass", source: fn("joi", "17.13.1",
    "import Joi from 'npm:joi@17.13.1';",
    "    const schema = Joi.object({ name: Joi.string().required(), age: Joi.number() }); const { error, value } = schema.validate({ name: 'a', age: 1 }); const output = { valid: !error, value };") },
  // Now works: the Deno resolver correctly resolves parse5 → entities' ESM
  // exports (`htmlDecodeTree`/`EntityDecoder`), which the old homegrown resolver
  // could not match.
  { name: "testCheerio", pkg: "cheerio", version: "1.0.0", expected: "pass", source: fn("cheerio", "1.0.0",
    "import * as cheerio from 'npm:cheerio@1.0.0';",
    "    const $ = cheerio.load('<h1>Hi</h1>'); const output = { text: $('h1').text() };") },
  { name: "testXlsx", pkg: "xlsx", version: "0.18.5", expected: "pass", source: fn("xlsx", "0.18.5",
    "import * as XLSX from 'npm:xlsx@0.18.5';",
    "    const ws = XLSX.utils.aoa_to_sheet([['a','b'],[1,2]]); const csv = XLSX.utils.sheet_to_csv(ws); const output = { csv };") },
  { name: "testJszip", pkg: "jszip", version: "3.10.1", expected: "pass", source: fn("jszip", "3.10.1",
    "import JSZip from 'npm:jszip@3.10.1';",
    "    const zip = new JSZip(); zip.file('hello.txt', 'world'); const b64 = await zip.generateAsync({ type: 'base64' }); const reloaded = await JSZip.loadAsync(b64, { base64: true }); const text = await reloaded.file('hello.txt').async('string'); const output = { zipped: b64.length > 0, text };") },
  { name: "testCurrencyCodes", pkg: "currency.js", version: "2.0.4", expected: "pass", source: fn("currency.js", "2.0.4",
    "import currency from 'npm:currency.js@2.0.4';",
    "    const output = { sum: currency(1.23).add(4.56).value, product: currency(1.23).multiply(3).value, distributed: currency(10).distribute(3).map(c => c.value) };") },
  { name: "testObjectHash", pkg: "object-hash", version: "3.0.0", expected: "pass", source: fn("object-hash", "3.0.0",
    "import objectHash from 'npm:object-hash@3.0.0';",
    "    const output = { hash: objectHash({ a: 1, b: 2 }), sameHash: objectHash({ b: 2, a: 1 }) };") },
  // Exercises npm package-alias support: @isaacs/cliui's package.json declares
  // `"wrap-ansi-cjs": "npm:wrap-ansi@^7.0.0"` (+ strip-ansi-cjs, string-width-cjs).
  { name: "testIsaacsCliui", pkg: "@isaacs/cliui", version: "8.0.2", expected: "pass", source: fn("@isaacs/cliui", "8.0.2",
    "import cliui from 'npm:@isaacs/cliui@8.0.2';",
    "    const ui = cliui({ width: 40 }); ui.div('hello world'); const output = { rendered: ui.toString() };") },
  // Entry in `main`/`module` (no `exports`, no root index.js), root + @jimp/*
  // sub-packages alike — resolved via the package.json entry fallback (#17077).
  { name: "testJimp", pkg: "jimp", version: "0.16.13", expected: "pass", source: fn("jimp", "0.16.13",
    "import Jimp from 'npm:jimp@0.16.13';",
    "    const img = new Jimp(1, 1, 0xFF0000FF); const base64 = await img.getBase64Async(Jimp.MIME_PNG); const output = { hasData: base64.length > 0 };") },
];
