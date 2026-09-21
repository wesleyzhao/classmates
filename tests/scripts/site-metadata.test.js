// Clones must share their own link previews; configured labels must remain escaped HTML.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {siteMetadata} from '../../scripts/lib/site-metadata.js';
const source=readFileSync('public/gsb/index.html','utf8');
test('metadata retains the existing title and substitutes only safe owner configuration',()=>{
  assert.equal(siteMetadata(source,{}),source);
  const changed=siteMetadata(source,{APP_ORIGIN:'https://my-class.example',CLASSMATES_COHORT_LABEL:'Class "A" <B>',CLASSMATES_EMAIL_DOMAINS:'example.edu'});
  assert.ok(!changed.includes('https://gsb-classmates.vercel.app'));
  assert.ok(changed.includes('https://my-class.example/gsb/og.png'));
  assert.ok(changed.includes('Class &quot;A&quot; &lt;B&gt;'));
  assert.equal(changed.match(/<title>(.*?)<\/title>/)[1],source.match(/<title>(.*?)<\/title>/)[1]);
  for(const APP_ORIGIN of ['ftp://localhost','https://user:pass@example.test','https://example.test/path','http://example.test'])assert.throws(()=>siteMetadata(source,{APP_ORIGIN}));
});
