// Build-time Classmates link previews follow the owner's deployment, without embedding credentials.
import {publicSiteConfig} from '../../server/gsb/site-config.js';
/** Replace only metadata controlled by deployment configuration; visual title stays in the HTML source.
 * @param {string} source
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function siteMetadata(source,env=process.env){
  const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const set=(key,value)=>{source=source.replace(new RegExp(`(<meta (?:property|name)="${key}" content=")[^"]*("\\s*/?>)`),(_,before,after)=>before+escape(value)+after);};
  if(env.APP_ORIGIN){
    const url=new URL(env.APP_ORIGIN),local=!env.VERCEL&&url.protocol==='http:'&&url.hostname==='localhost';
    if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.protocol!=='https:'&&!local)throw new Error('Configure APP_ORIGIN as your HTTPS deployment origin.');
    set('og:url',url.origin+'/');for(const key of ['og:image','twitter:image'])set(key,url.origin+'/gsb/og.png');
  }
  if(env.CLASSMATES_COHORT_LABEL||env.CLASSMATES_EMAIL_DOMAINS)
    set('og:description',`Faces to names, names to faces, against the clock and against your classmates. ${publicSiteConfig(env).cohortLabel}.`);
  return source;
}
