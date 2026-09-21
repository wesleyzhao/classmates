// Audit the repository without printing secret contents; optional local credentials stay in this process.
import { readFileSync } from 'node:fs';
import { auditPrivacy, emailsInText } from './lib/privacy-audit.js';
const args=process.argv.slice(2), knownSecrets=[];
let privateEmails=[];
const emailFlag=args.indexOf('--private-emails');
if(emailFlag>=0){
  const path=args[emailFlag+1];
  if(!path||path.startsWith('--'))throw new Error('Pass a private local source file after --private-emails.');
  privateEmails=emailsInText(readFileSync(path,'utf8'));
  if(!privateEmails.length)throw new Error('No email addresses found in the comparison file.');
  args.splice(emailFlag,2);
}
if(args.some(arg=>!['--history','--local-secrets'].includes(arg)))throw new Error('Use --history, --local-secrets and/or --private-emails PATH.');
if(args.includes('--local-secrets')) {
  // Only compare credential variables, not public origins, project IDs or test switches.
  const env=readFileSync('.env.local','utf8');
  for(const line of env.split('\n')) {
    const match=line.match(/^([A-Z_]+)=(.*)$/);
    if(!match||!/(SECRET|API_KEY|READ_WRITE_TOKEN|DATABASE_URL)/.test(match[1]))continue;
    const value=match[2].replace(/^(["'])(.*)\1$/,'$2');
    if(value.length>=12)knownSecrets.push(value);
    if(/^postgres(?:ql)?:/.test(value)) {try{knownSecrets.push(decodeURIComponent(new URL(value).password));}catch{}}
  }
}
const report=auditPrivacy({history:args.includes('--history'),knownSecrets,privateEmails});
console.log(JSON.stringify(report,null,2));
if(report.findings.length)process.exitCode=1;
