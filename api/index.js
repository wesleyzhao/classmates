// One Vercel function selects the app profile while retaining Parlor's original deployment behavior.
import { createHandler } from '../server/router.js';
import { createGsbHandler } from '../server/gsb/router.js';
export default process.env.APP_PROFILE==='gsb'?createGsbHandler():createHandler();
