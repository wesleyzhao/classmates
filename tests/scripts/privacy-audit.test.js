// Release checks must catch removed secrets in history without echoing them or reading ignored data.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {privacyFindings,auditPrivacy,emailsInText} from '../../scripts/lib/privacy-audit.js';
test('patterns report rules only and allow empty example configuration',()=>{
  assert.deepEqual(privacyFindings('.env.gsb.example',Buffer.from('AUTH_SECRET=\n')),[]);
  for(const path of ['.env.local','.private/manifest.json','private-content/photo.jpg','data/brightcrowd_export.jsonl','photos/key.pem'])
    assert.ok(privacyFindings(path,Buffer.alloc(0)).includes('private-path'));
  const token='ghp_'+'x'.repeat(36),report=privacyFindings('source.js',Buffer.from(token));
  assert.deepEqual(report,['provider-token']);assert.ok(!JSON.stringify(report).includes(token));
  assert.deepEqual(privacyFindings('source.js',Buffer.from('opaque-value-here'),['opaque-value-here']),['local-secret']);
  const address='private.person@example.invalid';
  assert.deepEqual(emailsInText(JSON.stringify({email:address.toUpperCase()})),[address]);
  const emailReport=privacyFindings('fixture.js',Buffer.from(address.toUpperCase()),[],new Set([address]));
  assert.deepEqual(emailReport,['private-email']);assert.ok(!JSON.stringify(emailReport).includes(address));
  assert.deepEqual(privacyFindings('fixture.js',Buffer.from(address+'.another'),[],new Set([address])),[]);
});
test('history catches deleted credentials; working scan handles special paths and rejects tracked symlinks',async t=>{
  const cwd=await mkdtemp(join(tmpdir(),'parlor-audit-'));t.after(()=>rm(cwd,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd,stdio:'pipe'});
  git('init','-q');git('config','user.email','test@example.invalid');git('config','user.name','Synthetic Test');
  const secret='re_'+'x'.repeat(30);
  await writeFile(join(cwd,'old.txt'),secret);git('add','.');git('commit','-qm','fixture');
  git('rm','old.txt');await writeFile(join(cwd,'a#b%.txt'),'safe');await writeFile(join(cwd,'.gitignore'),'.env.local\n');
  await writeFile(join(cwd,'.env.local'),secret);git('add','.');git('commit','-qm','removed fixture');
  assert.deepEqual(auditPrivacy({cwd}).findings,[]);
  const report=auditPrivacy({cwd,history:true});assert.ok(report.findings.some(f=>f.path==='old.txt'&&f.rule==='provider-token'));
  assert.ok(!JSON.stringify(report).includes(secret));
  await symlink('.env.local',join(cwd,'link'));git('add','link');
  assert.deepEqual(auditPrivacy({cwd}).findings,[{path:'link',rule:'tracked-symlink'}]);
});
