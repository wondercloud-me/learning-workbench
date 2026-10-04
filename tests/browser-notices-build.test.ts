import {afterEach, describe, expect, it} from 'vitest';
import {cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const sourceDir=resolve('.');
const generatorPath=resolve('scripts/build-browser-sw.mjs');
const requiredNotices=['LICENSE','THIRD_PARTY_NOTICES.md','licenses'];
const folders:string[]=[];
afterEach(async()=>{await Promise.all(folders.splice(0).map(p=>rm(p,{recursive:true,force:true})));});

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'workbench-browser-notices-'));folders.push(root);
 for(const name of requiredNotices)await cp(join(sourceDir,name),join(root,name),{recursive:true});
 const outDir=join(root,'dist-browser');await mkdir(join(outDir,'assets'),{recursive:true});
 await writeFile(join(outDir,'index.html'),'<h1>browser shell</h1>');
 await writeFile(join(outDir,'assets/lab.worker-test.js'),'worker');
 await writeFile(join(outDir,'assets/quickjs-test.wasm'),'wasm');
 await writeFile(join(outDir,'manifest.webmanifest'),JSON.stringify({icons:[]}));
 await writeFile(join(outDir,'browser-build.json'),JSON.stringify({base:'/learning-workbench/learn/',buildId:'notice-test'}));
 return {root,outDir};
}
function packageBrowser(root:string){
 return execFileSync(process.execPath,[generatorPath],{cwd:root,env:{...process.env,WORKBENCH_BROWSER_BASE:'/learning-workbench/learn/'},stdio:'pipe'});
}
async function noticeFiles(directory:string,prefix='licenses'):Promise<string[]>{
 const entries=await readdir(directory,{withFileTypes:true});
 return (await Promise.all(entries.map(entry=>entry.isDirectory()?noticeFiles(join(directory,entry.name),join(prefix,entry.name)):[join(prefix,entry.name)]))).flat();
}

describe('browser build notice packaging',()=>{
 it('copies every source notice byte into fresh output before including notices in precache',async()=>{
  const {root,outDir}=await fixture();
  expect(await readdir(outDir)).not.toContain('LICENSE');
  packageBrowser(root);
  expect(await readdir(outDir)).toContain('LICENSE');
  const expected=['LICENSE','THIRD_PARTY_NOTICES.md',...await noticeFiles(join(sourceDir,'licenses'))];
  const worker=await readFile(join(outDir,'sw.js'),'utf8');
  const assets=JSON.parse(worker.match(/^const ASSETS=(.*);$/m)![1]) as string[];
  expect(assets).toContain('/learning-workbench/learn/licenses/NOTICE.md');
  expect(assets).toContain('/learning-workbench/learn/licenses/jitl-quickjs-wasmfile-release-sync-0.32.0-LICENSE');
  for(const name of expected){
   expect(await readFile(join(outDir,name))).toEqual(await readFile(join(sourceDir,name)));
   expect(assets).toContain('/learning-workbench/learn/'+name.replaceAll('\\','/'));
  }
  const manifest=JSON.parse(await readFile(join(outDir,'manifest.webmanifest'),'utf8'));
  expect([manifest.id,manifest.start_url,manifest.scope]).toEqual(['/learning-workbench/learn/','/learning-workbench/learn/','/learning-workbench/learn/']);
  expect(await readFile(join(outDir,'index.html'),'utf8')).toBe('<h1>browser shell</h1>');
 });
 it.each(requiredNotices)('fails clearly before generating a worker when required %s source is missing',async(name)=>{
  const {root,outDir}=await fixture();await rm(join(root,name),{recursive:true,force:true});
  let failure:any;
  try{packageBrowser(root);}catch(error){failure=error;}
  expect(failure).toBeDefined();
  expect(failure.stderr.toString()).toContain('Required browser notice source missing: '+name);
  expect(await readdir(outDir)).not.toContain('sw.js');
 });
});
