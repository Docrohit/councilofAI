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
  TRUST_PROXY:'1', ALLOW_SIGNUP:'true', EMAIL_CONFIRMATION_REQUIRED:'true',
  BUSINESS_EMAIL:'cosmicwisdomyt@gmail.com', SMTP_FROM:'cosmicwisdomyt@gmail.com',
  BILLING_ADMIN_EMAILS:'cosmicwisdomyt@gmail.com,rohitsharma9000@gmail.com',
  FREE_MESSAGE_LIMIT:'10', PAYMENT_SATOSHIS:'100000',
  COUNCIL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),
  ...existing,
};
// Install only model settings requested for Council. Never copy unrelated credentials.
for (const key of ['OPENAI_API_KEY','OPENAI_BASE_URL','OPENAI_IDEA_MODEL','OPENAI_CREATIVE_MODEL',
 'ANTHROPIC_API_KEY','ANTHROPIC_MODEL','GLM_API_KEY','GLM_MODEL','ZAI_API_KEY']) {
 if (!env[key] && source[key]) env[key] = source[key];
}
for (const key of ['SMTP_HOST','SMTP_PORT','SMTP_SECURE','SMTP_USER','SMTP_PASS','SMTP_FROM',
 'BUSINESS_EMAIL','BILLING_ADMIN_EMAILS','ADMIN_TOKEN','FREE_MESSAGE_LIMIT','PAYMENT_SATOSHIS','LIGHTNING_WALLET',
 'EMAIL_CONFIRMATION_REQUIRED']) {
 if (process.env[key]) env[key] = process.env[key];
}
// These keys are held server-side until explicitly provisioned to an owner's account.
// Public signups never inherit them.
const encode = value => '"' + String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"';
if (Object.values(env).some(v => /[\r\n\0]/.test(v))) throw new Error('Multiline environment values are unsupported');
writeFileSync(target, Object.entries(env).map(([k,v])=>`${k}=${encode(v)}`).join('\n')+'\n', {mode:0o600});
chmodSync(target,0o600);
console.log('Council environment installed; configured model keys:', ['OPENAI_API_KEY','ANTHROPIC_API_KEY','GLM_API_KEY','ZAI_API_KEY'].filter(k=>!!env[k]).join(', ') || 'none');
