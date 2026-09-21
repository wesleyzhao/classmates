// A small release gate: identify private paths and credential patterns without printing their values.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const patterns = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['database-credential', /postgres(?:ql)?:\/\/[^\s:/"']+:[^\s@"']{8,}@/],
  ['provider-token', /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|vercel_blob_rw_[A-Za-z0-9_]{25,}|re_[A-Za-z0-9]{25,}|sk-[A-Za-z0-9_-]{25,})/],
];

/** Extract addresses locally for an operator-supplied private email comparison, never for reporting.
 * @param {string} text
 * @returns {string[]}
 */
export function emailsInText(text) {
  return [...new Set((text.match(/[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)||[]).map(email=>email.toLowerCase()))];
}

/** Return rule names only; contents and credentials are never included in reports.
 * @param {string} path
 * @param {Buffer} bytes
 * @param {string[]} [knownSecrets]
 * @param {Set<string>} [privateEmails]
 * @returns {string[]}
 */
export function privacyFindings(path, bytes, knownSecrets = [], privateEmails = new Set()) {
  const findings = [];
  if (/(^|\/)(\.private|private-content|node_modules|\.vercel|test-results|playwright-report)(\/|$)/.test(path) ||
      /(^|\/)\.env(?:\.|$)/.test(path) && !/^\.env(?:\.gsb)?\.example$/.test(path) ||
      /(?:brightcrowd.*\.(?:jsonl|json|csv)|(?:roster|contacts)\.(?:jsonl|csv|xlsx)|\.(?:pem|p12|key)|(?:outbox|test-mail)\.jsonl)$/i.test(path)) findings.push('private-path');
  const text = bytes.toString('utf8');
  for (const [rule, pattern] of patterns) if (/** @type {RegExp} */(pattern).test(text)) findings.push(String(rule));
  if (knownSecrets.some(secret => secret.length >= 12 && text.includes(secret))) findings.push('local-secret');
  if (privateEmails.size && emailsInText(text).some(email=>privateEmails.has(email))) findings.push('private-email');
  return findings;
}

/** Scan tracked working files or every reachable Git object, including old/deleted content.
 * @param {{history?:boolean,knownSecrets?:string[],privateEmails?:string[],cwd?:string}} [options]
 */
export function auditPrivacy({ history = false, knownSecrets = [], privateEmails = [], cwd = process.cwd() } = {}) {
  const git = args => execFileSync('git',args,{cwd,maxBuffer:128*1024*1024});
  const findings = [], emails=new Set(privateEmails.map(email=>email.toLowerCase()));let scanned = 0;
  const inspect = (path, bytes, object = undefined) => {
    scanned++;
    for (const rule of privacyFindings(path,bytes,knownSecrets,emails)) findings.push({path,rule,...(object ? {object} : {})});
  };
  if (!history) {
    for (const path of git(['ls-files','-z']).toString().split('\0').filter(Boolean)) {
      try {
        const file=resolve(cwd,path);
        if(lstatSync(file).isSymbolicLink()){findings.push({path,rule:'tracked-symlink'});continue;}
        inspect(path,readFileSync(file));
      }
      catch(error) { if(error.code !== 'ENOENT')throw error; }
    }
  } else {
    const lines = git(['rev-list','--objects','--all']).toString().trim().split('\n').filter(Boolean);
    const objects = lines.map(line => {const i=line.indexOf(' ');return i<0 ? [line,''] : [line.slice(0,i),line.slice(i+1)];});
    const data = execFileSync('git',['cat-file','--batch'],{cwd,input:objects.map(([id])=>id).join('\n')+'\n',maxBuffer:128*1024*1024});
    let offset = 0;
    for (const [id,path] of objects) {
      const end = data.indexOf(10,offset), header = data.subarray(offset,end).toString().split(' '), size=Number(header[2]);
      if(!Number.isSafeInteger(size))throw new Error('Unable to read a Git object.');
      offset=end+1;
      if(header[1]==='blob'||header[1]==='commit')inspect(path||`<commit ${id.slice(0,12)}>`,data.subarray(offset,offset+size),id.slice(0,12));
      offset+=size+1;
    }
  }
  return {scanned,findings};
}
