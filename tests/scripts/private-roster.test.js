// The portable importer validates locally, strips metadata and preserves existing private-data boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {prepareRoster,privateJpeg,publishRoster} from '../../scripts/lib/private-roster.js';

function segment(marker,data){const head=Buffer.from([255,marker,0,0]);head.writeUInt16BE(data.length+2,2);return Buffer.concat([head,data]);}
// A structural JPEG fixture; browser tests separately exercise a real canvas-encoded portrait.
const frame=segment(0xc0,Buffer.from([8,0,2,0,2,1,1,17,0]));
const scan=segment(0xda,Buffer.from([1,1,0,0,63,0]));
const jpeg=Buffer.concat([Buffer.from([255,216]),frame,scan,Buffer.from([1,255,0,2,255,208,3,255,217])]);
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'parlor-roster-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'portrait.jpg'),jpeg);
  const manifest={cohort:'example-2027',people:['Alex','Blair','Casey','Devon'].map((name,i)=>({id:`person-${i}`,name:`${name} Example`,photo:'portrait.jpg'}))};
  const path=join(root,'manifest.json');
  const save=()=>writeFile(path,JSON.stringify(manifest));await save();return{root,path,manifest,save};
}
test('JPEG sanitizer removes metadata and trailing payload while retaining escaped entropy and progressive scans',()=>{
  const secret=Buffer.from('location-and-camera-identifier');
  const input=Buffer.concat([jpeg.subarray(0,2),segment(0xe1,secret),segment(0xfe,secret),jpeg.subarray(2),secret]);
  assert.deepEqual(privateJpeg(input),jpeg);
  const progressive=Buffer.concat([jpeg.subarray(0,-2),segment(0xe2,secret),scan,Buffer.from([4,255,217])]);
  const expected=Buffer.concat([jpeg.subarray(0,-2),scan,Buffer.from([4,255,217])]);
  assert.deepEqual(privateJpeg(progressive),expected);
  for(const invalid of [Buffer.alloc(0),Buffer.alloc(513*1024),jpeg.subarray(0,-1),Buffer.from('<svg/>'),Buffer.from([255,216,255,225,0,99,0,0,0,0,0,0])])
    assert.throws(()=>privateJpeg(invalid));
  const oversized=Buffer.from(jpeg);oversized.writeUInt16BE(1025,9);assert.throws(()=>privateJpeg(oversized),/Resize/);
  const cmyk=Buffer.from(jpeg);cmyk[11]=4;assert.throws(()=>privateJpeg(cmyk),/sRGB/);
});
test('rosters have stable opaque IDs, change revisions with content, and dry-run without cloud credentials',async t=>{
  const f=await fixture(t),first=await prepareRoster(f.path);
  f.manifest.people.reverse();await f.save();assert.deepEqual(await prepareRoster(f.path),first);
  f.manifest.people[0].name='Renamed Example';await f.save();const changed=await prepareRoster(f.path);
  assert.notEqual(changed.revision,first.revision);assert.deepEqual(changed.people.map(p=>p.id),first.people.map(p=>p.id));
  assert.ok(first.cards.every(c=>/^[a-f0-9]{24}$/.test(c.id)&&c.image.startsWith('/api/media/')));
  const report=JSON.parse(execFileSync(process.execPath,['scripts/gsb/import-roster.js',f.path,'--dry-run'],{env:{PATH:process.env.PATH},encoding:'utf8'}));
  assert.equal(report.published,false);assert.equal(report.people,4);assert.ok(!JSON.stringify(report).includes('Renamed'));
});
test('invalid rows, contact details, duplicate IDs and file escapes fail before publication',async t=>{
  const f=await fixture(t),original=structuredClone(f.manifest.people);
  for(const mutate of [p=>p[0].email='private@example.test',p=>p[0].id=p[1].id,p=>p[0].name='\n',p=>p[0].photo='https://example.test/photo.jpg',p=>p.pop(),p=>p[0].id={}]){
    f.manifest.people=structuredClone(original);mutate(f.manifest.people);await f.save();await assert.rejects(prepareRoster(f.path));
  }
  f.manifest.people=structuredClone(original);
  const outside=await mkdtemp(join(tmpdir(),'parlor-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));
  await writeFile(join(outside,'portrait.jpg'),jpeg);await symlink(join(outside,'portrait.jpg'),join(f.root,'escaped.jpg'));
  f.manifest.people[0].photo='escaped.jpg';await f.save();await assert.rejects(prepareRoster(f.path),/outside/);
});
test('publishing uses private content-addressed storage, retains opt-outs and only then publishes a revision',async t=>{
  const f=await fixture(t),roster=await prepareRoster(f.path),assets=new Set(),calls=[],uploads=[];
  const query=async(sql,params)=>{
    calls.push(sql);
    if(sql.startsWith('select id'))return assets.has(params[0])?[{id:params[0]}]:[];
    if(sql.startsWith('with person')){assert.ok(!/set\s+excluded\s*=/.test(sql));assets.add(params[3]);}
    return[];
  };
  const put=async(path,bytes,options)=>{assert.equal(options.access,'private');assert.ok(path.startsWith('portraits/'));uploads.push(path);};
  await publishRoster(roster,{query,put});assert.equal(uploads.length,4);assert.ok(calls.at(-1).startsWith('insert into gsb_revisions'));
  await publishRoster(roster,{query,put});assert.equal(uploads.length,4);
  let revised=false;
  await assert.rejects(publishRoster(roster,{query:async sql=>{if(sql.includes('gsb_revisions'))revised=true;return[];},put:async()=>{throw new Error('storage unavailable');}}),/storage unavailable/);
  assert.equal(revised,false);
});
