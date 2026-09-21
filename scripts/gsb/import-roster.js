// Import your own local content without BrightCrowd, macOS utilities, emails or network photo downloads.
import { prepareRoster,publishRoster } from '../lib/private-roster.js';
const [filename,...flags]=process.argv.slice(2);
if(!filename||flags.some(flag=>!['--publish','--dry-run'].includes(flag))||flags.includes('--publish')&&flags.includes('--dry-run'))
  throw new Error('Usage: node scripts/gsb/import-roster.js .private/roster/manifest.json [--dry-run | --publish]');
const roster=await prepareRoster(filename);
if(flags.includes('--publish')) {
  if(!process.env.DATABASE_URL||!process.env.BLOB_READ_WRITE_TOKEN)throw new Error('Set your own DATABASE_URL and private BLOB_READ_WRITE_TOKEN before publishing.');
  const {database}=await import('../../server/gsb/db.js'),{put}=await import('@vercel/blob');
  await publishRoster(roster,{query:database().query,put});
}
console.log(JSON.stringify({published:flags.includes('--publish'),people:roster.cards.length,bytes:roster.bytes,revision:roster.revision}));
