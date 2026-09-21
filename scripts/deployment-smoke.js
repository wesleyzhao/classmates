// Deployment checks select the actual app profile and never default to someone else's site.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const raw=process.argv[2];
if(!raw)throw new Error('Pass your own deployment origin.');
const url=new URL(raw);
const local=url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname);
if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.protocol!=='https:'&&!local)
  throw new Error('Pass an HTTPS origin (or localhost for a local test).');
const response=await fetch(`${url.origin}/api/health`,{signal:AbortSignal.timeout(20000)});
if(!response.ok)throw new Error(`Health returned ${response.status}.`);
const health=await response.json();
const script=health.profile==='gsb'?'gsb/smoke.js':'smoke.js';
execFileSync(process.execPath,[fileURLToPath(new URL(script,import.meta.url)),url.origin],{stdio:'inherit'});
