// Browser integration checks. All Supabase requests are mocked: no emails/SMS,
// real accounts or financial records are created by this test.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('.');
const server = createServer(async (req, res) => {
  try {
    let path = new URL(req.url, 'http://test').pathname;
    if (path.endsWith('/')) path += 'index.html';
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + '/')) throw Error('path');
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'})[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? {executablePath: process.env.CHROMIUM_PATH, args:['--no-sandbox','--disable-gpu']} : {}) });
const ctx = await browser.newContext({serviceWorkers:'block', viewport:{width:1280,height:900}});
const errors = [];
const records = new Map();
const ids = {a:'00000000-0000-4000-8000-000000000001',b:'00000000-0000-4000-8000-000000000002'};
const jwt = id => [Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({sub:id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'signature'].join('.');
const user = id => ({id,aud:'authenticated',role:'authenticated',email:id===ids.a?'a@example.test':'b@example.test',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:new Date().toISOString()});
let pushes = 0;
await ctx.route('https://hoalgldxzrbaydeplcqp.supabase.co/**', async route => {
  const req=route.request(),url=new URL(req.url()),body=req.postDataJSON();
  const auth=req.headers().authorization?.split(' ')[1];
  let id; try{id=JSON.parse(Buffer.from(auth.split('.')[1],'base64url')).sub;}catch{}
  const json = (v,status=200) => route.fulfill({status,json:v});
  if(url.pathname.endsWith('/settings')) return json({external:{email:true,phone:false}});
  if(url.pathname.endsWith('/token')) {
    id=body.email.startsWith('a')?ids.a:ids.b;
    return json({access_token:jwt(id),refresh_token:'refresh-'+id,expires_in:3600,token_type:'bearer',user:user(id)});
  }
  if(url.pathname.endsWith('/user')) return json(user(id));
  if(url.pathname.endsWith('/logout')) return route.fulfill({status:204});
  if(url.pathname.endsWith('/steadypath_snapshots')) return json(records.get(id)||null);
  if(url.pathname.endsWith('/steadypath_save')) {
    const previous=records.get(id);
    if((previous?.revision||0)!==body.expected_revision) return json({code:'40001',message:'stale'},409);
    pushes++; const revision=(previous?.revision||0)+1;
    records.set(id,{data:body.snapshot,revision});return json(revision);
  }
  throw Error('Unexpected Supabase request: '+req.method()+' '+url.pathname);
});
try {
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto(origin+'/app/?signin=1');
  await p.waitForFunction(()=>!document.documentElement.classList.contains('sp-loading'));
  await p.locator('#spAccount input[name=identifier]').waitFor();
  assert.equal(await p.title(),'SteadyPath');
  assert.equal(await p.locator('[data-sp=phone]').isDisabled(),true);
  const fixture=await p.evaluate(()=>({...initial(false),welcome:false,name:'Guest budget'}));
  records.set(ids.a,{data:{...fixture,name:'Account A'},revision:1});
  await p.evaluate(f=>{state=f;save();},fixture);
  const login=async who=>{
    if(!await p.locator('#spAccount').evaluate(d=>d.open)) await p.locator('#mmAccountButton').click();
    await p.locator('#spAccount input[name=identifier]').fill(who+'@example.test');
    await p.locator('#spAccount input[name=password]').fill('Test-password-123');
    await p.locator('#spAccount form button').click();
    await p.locator('[data-sp=logout]').waitFor();
  };
  await login('a');
  await p.waitForFunction(()=>state.name==='Account A');
  assert.equal(pushes,0,'guest data must not be uploaded at sign-in');
  await p.evaluate(()=>{state.name='Account A edited';save();});
  await p.waitForFunction(()=>document.querySelector('#spSyncStatus')?.textContent==='Up to date');
  assert.equal(records.get(ids.a).data.name,'Account A edited');
  await p.locator('[data-sp=change-password]').click();
  await p.locator('input[name=password]').fill('Do-not-erase-this');
  await p.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await p.waitForTimeout(300);
  assert.equal(await p.locator('input[name=password]').inputValue(),'Do-not-erase-this');
  await p.locator('[data-sp=close]').click();
  // Leave recovery form through a successful password change.
  await p.locator('#mmAccountButton').click();
  await p.locator('input[name=password]').fill('Test-password-1234');
  await p.locator('input[name=confirm]').fill('Test-password-1234');
  await p.locator('#spAccount form button').click();
  await p.locator('[data-sp=logout]').waitFor();
  await p.locator('[data-sp=logout]').click();
  await p.waitForFunction(()=>state.name==='Guest budget');
  assert.equal(await p.evaluate(()=>localStorage.getItem('steadypath-active-owner')),null);
  await login('b');
  await p.waitForFunction(()=>localStorage.getItem('steadypath-active-owner')==='00000000-0000-4000-8000-000000000002');
  assert.notEqual(await p.evaluate(()=>state.name),'Account A edited');
  assert.notEqual(await p.evaluate(()=>state.name),'Guest budget');
  assert.equal(records.has(ids.b),false,'account B starts empty');
  await p.evaluate(f=>{state={...f,name:'Account B'};save();},fixture);
  await p.waitForFunction(()=>document.querySelector('#spSyncStatus')?.textContent==='Up to date');
  assert.equal(records.get(ids.b).data.name,'Account B');
  // Offline edits must not silently replace a newer cloud snapshot.
  records.set(ids.b,{data:{...fixture,name:'Other device B'},revision:2});
  await p.evaluate(()=>{state.name='Local B pending';save();});
  await p.locator('[data-sp=remote]').waitFor();
  assert.equal(await p.evaluate(()=>state.name),'Local B pending');
  assert.equal(records.get(ids.b).data.name,'Other device B');
  const downloadPromise=p.waitForEvent('download');await p.locator('[data-sp=export]').first().click();
  const download=await downloadPromise;
  let content='';for await(const chunk of await download.createReadStream()) content+=chunk;
  const backup=JSON.parse(content);
  assert.equal(backup.format,'money-mission');assert.equal(backup.data.name,'Local B pending');
  p.once('dialog',d=>d.accept());await p.locator('[data-sp=remote]').click();
  await p.waitForFunction(()=>state.name==='Other device B');
  await p.setViewportSize({width:375,height:812});
  const box=await p.locator('#spAccount').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=376,'dialog fits mobile');
  await p.screenshot({path:'/tmp/steadypath-mobile.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: sign-in, guest isolation, private accounts, saving, recovery form, sign-out, account switching, conflicts, backup format, mobile layout; no network emails/SMS.');
} finally {await browser.close();await new Promise(r=>server.close(r));}
