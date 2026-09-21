// Fork policies must fail closed while retaining the original deployment and explicit tester grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import {emailDomains,publicSiteConfig} from '../../server/gsb/site-config.js';
import {stanfordEmail,authenticate,consumeLink,appOrigin} from '../../server/gsb/auth.js';

test('public configuration has safe defaults, explicit domains and no credential values',()=>{
  assert.deepEqual(emailDomains({}),['stanford.edu']);
  assert.deepEqual(emailDomains({CLASSMATES_EMAIL_DOMAINS:' Example.edu,ALUMNI.example.edu,example.edu '}),['example.edu','alumni.example.edu']);
  assert.equal(publicSiteConfig({}).emailLabel,'Your Stanford email');
  assert.equal(publicSiteConfig({}).landingMode,'games');
  assert.equal(publicSiteConfig({CLASSMATES_LANDING:'quick'}).landingMode,'quick');
  const config=publicSiteConfig({CLASSMATES_EMAIL_DOMAINS:'example.edu',CLASSMATES_COHORT_LABEL:'Our class',AUTH_SECRET:'hidden'});
  assert.equal(config.cohortLabel,'Our class');assert.equal(config.emailPlaceholder,'you@example.edu');
  assert.deepEqual(Object.keys(config).sort(),['cohortLabel','emailHint','emailLabel','emailPlaceholder','landingMode']);
  for(const domains of ['',',','*.example.edu','example.edu,','example.edu@evil.test','localhost','-bad.edu','bad-.edu','bad..edu','https://example.edu'])
    assert.throws(()=>emailDomains({CLASSMATES_EMAIL_DOMAINS:domains}),/not configured/);
  for(const label of ['', 'a'.repeat(101), 'a\nb'])assert.throws(()=>publicSiteConfig({CLASSMATES_COHORT_LABEL:label}));
});

test('domain policy rejects lookalikes and revoked sessions/links, without deleting tester access',async(t)=>{
  const keys=['CLASSMATES_EMAIL_DOMAINS','APP_ORIGIN','VERCEL'];
  const before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  t.after(()=>{for(const k of keys)before[k]===undefined?delete process.env[k]:process.env[k]=before[k];});
  process.env.CLASSMATES_EMAIL_DOMAINS='example.edu';process.env.APP_ORIGIN='https://classmates.example';delete process.env.VERCEL;
  assert.equal(stanfordEmail(' Person+play@EXAMPLE.edu '),'person+play@example.edu');
  for(const value of ['person@stanford.edu','person@sub.example.edu','person@example.edu.evil.test','person@evil-example.edu','x\n@example.edu','.x@example.edu','a..b@example.edu'])
    assert.throws(()=>stanfordEmail(value));
  const cookie={headers:{cookie:`gsb=${'a'.repeat(43)}`}};
  for(const access of ['email','descope','door','owner-preview']) {
    const account={id:'fixture',email:'fixture@removed.edu',access};
    const result=await authenticate({query:async()=>[account]},cookie);
    assert.equal(result,['door','owner-preview'].includes(access)?account:null);
  }
  let queries=0;
  assert.equal(await authenticate({query:async()=>{queries++;return[];}},{headers:{cookie:'gsb=malformed'}}),null);
  assert.equal(queries,0);
  for(const purpose of ['email','descope'])await assert.rejects(consumeLink({query:async sql=>{
    assert.ok(sql.startsWith('select '),'a disallowed link must not mutate the database');
    return[{email:'fixture@removed.edu',purpose}];
  }},'a'.repeat(43)),/example.edu/);
  process.env.CLASSMATES_EMAIL_DOMAINS='*';
  await assert.rejects(authenticate({query:async()=>[{email:'person@example.edu',access:'email'}]},cookie),/not configured/);
});

test('email origins reject credentials, paths and non-HTTP localhost schemes',t=>{
  const saved={APP_ORIGIN:process.env.APP_ORIGIN,VERCEL:process.env.VERCEL};
  t.after(()=>{for(const k of Object.keys(saved))saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k];});
  delete process.env.VERCEL;
  for(const value of ['ftp://localhost','https://user:pass@example.test','https://example.test/path','https://example.test/?x=1','https://example.test/#token=abc','http://example.test']){
    process.env.APP_ORIGIN=value;assert.throws(appOrigin);
  }
  process.env.APP_ORIGIN='http://localhost:3137';assert.equal(appOrigin(),'http://localhost:3137');
  process.env.VERCEL='1';assert.throws(appOrigin);
  process.env.APP_ORIGIN='https://classmates.example/';assert.equal(appOrigin(),'https://classmates.example');
});
