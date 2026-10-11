import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI calls Rust routes without credentials, ignoring legacy saved keys', async () => {
  const home = await mkdtemp(join(tmpdir(),'ledgerline-test-'));
  await mkdir(join(home,'legerline'));
  await writeFile(join(home,'legerline','config.json'), JSON.stringify({apiKey:'obsolete'}));
  let received = '';
  const api = createServer((req,res) => {
    assert.equal(req.headers['x-api-key'], undefined);
    assert.equal(req.headers.authorization, undefined);
    received = req.url!;
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({data:[{symbol:'/company/RELIANCE/'}]}));
  });
  await new Promise<void>(resolve => api.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${(api.address() as {port:number}).port}`;
  async function cli(args: string[]) {
    return await new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject) => {
      const child = spawn(process.execPath,['--import','tsx','apps/legerline-cli/src/index.ts',...args], {
        cwd: new URL('../../../',import.meta.url), env:{...process.env,XDG_CONFIG_HOME:home,LEGERLINE_API_URL:url,LEGERLINE_API_KEY:'obsolete-env'}, stdio:['ignore','pipe','pipe']
      });
      let stdout='',stderr='';
      child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
      child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));
    });
  }
  try {
    const search = await cli(['get_v1_company_search','--q','reliance']);
    assert.equal(search.code,0,search.stderr);
    assert.equal(received,'/v1/company-search?q=reliance');
    assert.equal(JSON.parse(search.stdout).data[0].symbol,'/company/RELIANCE/');
    const screen = await cli(['get_api_v1_screen','--query','Market Capitalization > 500']);
    assert.equal(screen.code,0,screen.stderr);
    assert.equal(new URL(received,url).searchParams.get('query'),'Market Capitalization > 500');
    const invalid = await cli(['get_api_v1_screen']);
    assert.equal(invalid.code,1);assert.match(invalid.stderr,/Missing --query/);
    const config = await cli(['config']);assert.doesNotMatch(config.stdout,/apiKey|obsolete/);
  } finally { await new Promise<void>(resolve=>api.close(()=>resolve())); await rm(home,{recursive:true,force:true}); }
});
