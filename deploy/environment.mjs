import { readFileSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
const target = '/etc/councilofai/council.env';
const existing = existsSync(target) ? parseEnv(readFileSync(target, 'utf8')) : {};
const sourcePath = process.env.MODEL_ENV_SOURCE;
const source = sourcePath && existsSync(sourcePath) ? parseEnv(readFileSync(sourcePath, 'utf8')) : {};
const env = {
  NODE_ENV:'production', HOST:'127.0.0.1', PORT:'4310',
  DATA_DIR:'/var/lib/councilofai', DEPLOYMENT_MODE:'hosted',
  APP_ORIGIN:'https://councilofai.nftforger.com', COOKIE_SECURE:'true',
  TRUST_PROXY:'1', ALLOW_SIGNUP:'true',
  COUNCIL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),
  ...existing,
};
// Install only model settings requested for Council. Never copy unrelated credentials.
for (const key of ['OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_IDEA_MODEL','OPENAI_CREATIVE_MODEL',
 'ANTHROPIC_API_KEY','ANTHROPIC_MODEL','GLM_API_KEY','GLM_MODEL','ZAI_API_KEY']) {
 if (!env[key] && source[key]) env[key] = source[key];
}
// These keys are held server-side until explicitly provisioned to an owner's account.
// Public signups never inherit them.
const encode = value => '"' + String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"';
if (Object.values(env).some(v => /[\r\n\0]/.test(v))) throw new Error('Multiline environment values are unsupported');
writeFileSync(target, Object.entries(env).map(([k,v])=>`${k}=${encode(v)}`).join('\n')+'\n', {mode:0o600});
chmodSync(target,0o600);
console.log('Council environment installed; configured model keys:', ['OPENAI_API_KEY','ANTHROPIC_API_KEY','GLM_API_KEY','ZAI_API_KEY'].filter(k=>!!env[k]).join(', ') || 'none');
