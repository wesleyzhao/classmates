// Portable local rosters publish only names, opaque IDs and sanitized JPEG portraits to private storage.
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = message => {throw new Error(message);};

/** Validate bounded JPEGs and remove application metadata/comments before upload.
 * Images must be resized and rotated upright before importing; no new image library is required.
 * @param {Buffer} bytes
 * @returns {Buffer}
 */
export function privateJpeg(bytes) {
  if(bytes.length>512*1024 || bytes.length<12 || bytes.readUInt16BE(0)!==0xffd8)fail('Use JPEG portraits no larger than 512 KB.');
  const parts=[bytes.subarray(0,2)];let at=2, frame=false, scan=false;
  while(at<bytes.length) {
    const start=at;
    if(bytes[at++]!==0xff)fail('Invalid JPEG marker.');
    while(bytes[at]===0xff)at++;
    const marker=bytes[at++];
    if(marker===0xd9) {
      if(!frame||!scan)fail('JPEG has no usable image.');
      parts.push(Buffer.from([0xff,0xd9]));return Buffer.concat(parts);
    }
    if(marker===0x00||marker===0xd8||marker>=0xd0&&marker<=0xd7)fail('Invalid JPEG structure.');
    if(at+2>bytes.length)fail('Truncated JPEG.');
    const size=bytes.readUInt16BE(at),end=at+size;
    if(size<2||end>bytes.length)fail('Truncated JPEG segment.');
    if([0xc0,0xc1,0xc2].includes(marker)) {
      if(size<8)fail('Invalid JPEG dimensions.');
      const height=bytes.readUInt16BE(at+3),width=bytes.readUInt16BE(at+5);
      if(!width||!height||width>1024||height>1024)fail('Resize portraits to at most 1024 pixels per side (480 recommended).');
      if(bytes[at+2]!==8||![1,3].includes(bytes[at+7])||size!==8+3*bytes[at+7])fail('Use an 8-bit sRGB or grayscale JPEG.');
      frame=true;
    }
    // EXIF can contain GPS, device identifiers and a rotation flag; strip APP and COM segments.
    if(!(marker>=0xe0&&marker<=0xef)&&marker!==0xfe)parts.push(bytes.subarray(start,end));
    at=end;
    if(marker===0xda) {
      scan=true;const begin=at;
      // Entropy-coded bytes escape FF as FF00; restart markers are part of the scan.
      while(at<bytes.length) {
        if(bytes[at]!==0xff){at++;continue;}
        let next=at+1;while(bytes[next]===0xff)next++;
        if(bytes[next]===0 || bytes[next]>=0xd0&&bytes[next]<=0xd7){at=next+1;continue;}
        break;
      }
      parts.push(bytes.subarray(begin,at));
    }
  }
  return fail('JPEG is missing its end marker.');
}

/** Validate all rows and files before any cloud operation. Paths stay inside the manifest folder.
 * @param {string} filename
 */
export async function prepareRoster(filename) {
  const file=await realpath(filename),root=dirname(file);
  if((await stat(file)).size>1024*1024)fail('The roster manifest exceeds 1 MB.');
  let manifest;
  try {manifest=JSON.parse(await readFile(file,'utf8'));}
  catch {fail('The roster manifest must be valid JSON.');}
  if(!manifest || typeof manifest!=='object' || Array.isArray(manifest) || Object.keys(manifest).some(k=>!['cohort','people'].includes(k)) ||
      typeof manifest.cohort!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(manifest.cohort))fail('Use a cohort slug and a people array; keep contact details out of this manifest.');
  if(!Array.isArray(manifest.people)||manifest.people.length<4||manifest.people.length>600)fail('Provide between 4 and 600 people.');
  const seen=new Set(), people=[];let totalBytes=0;
  for(const [index,row] of manifest.people.entries()) {
    if(!row || Object.keys(row).some(k=>!['id','name','photo'].includes(k)) || typeof row.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(row.id) || seen.has(row.id) ||
        typeof row.name!=='string'||!row.name.trim()||row.name.trim().length>120||/[\x00-\x1f\x7f]/.test(row.name) ||
        typeof row.photo!=='string'||isAbsolute(row.photo)||! /\.jpe?g$/i.test(row.photo))fail(`Roster row ${index+1} needs a unique id, name and relative JPEG photo path only.`);
    seen.add(row.id);
    const path=await realpath(resolve(root,row.photo)),within=relative(root,path);
    if(within==='..'||within.startsWith('..'+sep)||isAbsolute(within))fail(`Roster row ${index+1} points outside its folder.`);
    if((await stat(path)).size>512*1024)fail(`Roster row ${index+1} exceeds 512 KB.`);
    const bytes=privateJpeg(await readFile(path));totalBytes+=bytes.length;
    if(totalBytes>50*1024*1024)fail('Prepared portraits exceed the 50 MB import budget.');
    const id=digest(`${manifest.cohort}:${row.id}`).slice(0,24),asset=`${id}-${digest(bytes).slice(0,12)}`;
    people.push({id,name:row.name.trim(),asset,path:`portraits/${asset}.jpg`,bytes});
  }
  people.sort((a,b)=>a.id.localeCompare(b.id));
  const cards=people.map(p=>({id:p.id,prompt:'Recognize a classmate.',answer:p.name,image:`/api/media/${p.asset}`}));
  return {people,cards,bytes:totalBytes,revision:`${manifest.cohort}-${digest(JSON.stringify(cards)).slice(0,16)}`};
}

/** Publish a validated roster, preserving exclusions and existing accounts/progress.
 * Repeating the same import reuses content-addressed assets and the immutable revision.
 * @param {Awaited<ReturnType<typeof prepareRoster>>} roster
 * @param {{query:(sql:string,params?:any[])=>Promise<any[]>,put:(path:string,bytes:Buffer,options:any)=>Promise<any>}} deps
 */
export async function publishRoster(roster,{query,put}) {
  for(let offset=0;offset<roster.people.length;offset+=3) await Promise.all(roster.people.slice(offset,offset+3).map(async person=>{
    const existing=await query('select id from gsb_assets where id=$1',[person.asset]);
    if(!existing.length)await put(person.path,person.bytes,{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'image/jpeg'});
    await query(`with person as (
      insert into gsb_people(id,name,blob_path,revision) values($1,$2,$3,$4)
      on conflict(id) do update set name=excluded.name,blob_path=excluded.blob_path,revision=excluded.revision returning id)
      insert into gsb_assets(id,person_id,path) select $4,id,$3 from person on conflict do nothing`,[person.id,person.name,person.path,person.asset]);
  }));
  await query('insert into gsb_revisions(id,cards) values($1,$2::jsonb) on conflict do nothing',[roster.revision,JSON.stringify(roster.cards)]);
}
