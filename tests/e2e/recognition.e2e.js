// Exercise the reusable recognition renderer with real browser input and a sanitized real JPEG.
import {test,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {privateJpeg} from '../../scripts/lib/private-roster.js';
test('recognition supports both directions, safe pending input and retry at phone and desktop sizes',async({page,browserName})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  const encoded=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=200;c.height=200;const ctx=c.getContext('2d');ctx.fillStyle='#844';ctx.fillRect(0,0,200,200);return c.toDataURL('image/jpeg').split(',')[1];});
  const image=`data:image/jpeg;base64,${privateJpeg(Buffer.from(encoded,'base64')).toString('base64')}`;
  await page.evaluate(async image=>{
    const {html,render}=await import(String('/app/h.js')),{Play}=await import(String('/kits/recognition/ui.js'));
    render(null,document.getElementById('app'));
    const target=document.getElementById('app');target.className='page';
    const view={phase:'question',mode:'race',progress:{n:1,total:4},roundAt:0,standings:[{playerId:'p1',score:0}],reveal:null,
      mine:{finishedAt:null,blockedUntil:0,wrong:[],choice:null},question:{id:'q1',image,prompt:'What is their name?',choices:['Alex','Blair','Casey','Devon'].map((label,i)=>({id:String(i),label}))}};
    (/** @type {any} */(window)).recognition={view,calls:[],reject:false,paint:()=>render(html`<${Play} view=${view} me="p1" players=${[{id:'p1',name:'Tester'}]} now=${Date.now()} send=${(type,payload)=>{(/** @type {any} */(window)).recognition.calls.push({type,payload});return new Promise((resolve,reject)=>{(/** @type {any} */(window)).recognition.release=()=>(/** @type {any} */(window)).recognition.reject?reject(new Error('offline')):resolve({});});}} />`,target)};
    (/** @type {any} */(window)).recognition.paint();
  },image);
  await expect(page.locator('.stage-image')).toBeVisible();
  expect(await page.locator('.stage-image').evaluate(img=>img instanceof HTMLImageElement && img.complete&&img.naturalWidth===200)).toBe(true);
  await page.getByRole('button',{name:'Alex',exact:true}).click();
  await expect(page.getByRole('button',{name:'Blair',exact:true})).toBeDisabled();
  await page.locator('.choice').first().evaluate(el=>{if(el instanceof HTMLElement){el.click();el.click();}});
  expect(await page.evaluate(()=>(/** @type {any} */(window)).recognition.calls)).toEqual([{type:'answer',payload:{questionId:'q1',choice:'0'}}]);
  await page.evaluate(()=>{(/** @type {any} */(window)).recognition.reject=true;(/** @type {any} */(window)).recognition.release();});
  await expect(page.getByRole('alert')).toContainText('Try again');
  await expect(page.getByRole('button',{name:'Alex',exact:true})).toBeEnabled();
  await page.evaluate(image=>{
    const r=(/** @type {any} */(window)).recognition;r.view.question={id:'q2',prompt:'Which face belongs to Alex Example?',choices:[0,1,2,3].map(i=>({id:String(i),image}))};
    r.view.mine.wrong=['1'];r.paint();
  },image);
  await expect(page.getByRole('heading',{name:'Alex Example',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.choice img')).toHaveCount(4);await expect(page.locator('.choice').nth(1)).toBeDisabled();
  await mkdir(`output/recognition/${browserName}`,{recursive:true});
  for(const {label,width,height} of [{label:'phone',width:390,height:844},{label:'desktop',width:1365,height:900}]){
    await page.setViewportSize({width,height});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const first=await page.locator('.choice').first().boundingBox(),second=await page.locator('.choice').nth(1).boundingBox(),last=await page.locator('.choice').last().boundingBox();
    expect(Math.abs(first.y-second.y)).toBeLessThan(2);expect(last.y+last.height).toBeLessThan(height);
    await page.screenshot({path:`output/recognition/${browserName}/${label}.png`,fullPage:true});
  }
  expect(errors).toEqual([]);
});
