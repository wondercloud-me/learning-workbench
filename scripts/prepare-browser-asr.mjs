import {createHash, randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {cp, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {generateBrowserServiceWorker, validateBrowserBase} from './build-browser-sw.mjs';

async function fileInfo(file){const hash=createHash('sha256');let bytes=0;for await(const part of createReadStream(file)){bytes+=part.length;hash.update(part);}return {bytes,sha256:hash.digest('hex')};}
async function exists(file){try{return (await stat(file)).isFile();}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function checked(file,expected){const actual=await fileInfo(file);if(actual.bytes!==expected.bytes||actual.sha256!==expected.sha256)throw Error('Optional ASR resource checksum mismatch: '+expected.filename);}

/** Publish an already verified staging directory; discard this new directory on failure. */
export async function publishPreparedBrowserAsr({staging,outDir,base,buildId,manifest}){
 const destination=join(outDir,'optional-asr',manifest.runtimeVersion,buildId);
 let created=false;
 try{
  await mkdir(join(outDir,'optional-asr',manifest.runtimeVersion),{recursive:true});
  await mkdir(destination);created=true;
  await cp(staging,destination,{recursive:true});
  await generateBrowserServiceWorker({outDir,base,buildId,optionalManifest:manifest});
  return {manifest,directory:destination};
 }catch(error){if(created)await rm(destination,{recursive:true,force:true});throw error;}
}

/** Explicit preparation only. No model/token requests are made by this script. */
export async function prepareBrowserAsr({sourceDir=resolve('.'),outDir=join(sourceDir,'dist-browser'),enabled=process.env.WORKBENCH_BROWSER_ASR==='1',modelUrl=process.env.WORKBENCH_BROWSER_ASR_MODEL_URL,archivePath}={}){
 if(!enabled)throw Error('Optional browser ASR must be explicitly enabled with WORKBENCH_BROWSER_ASR=1');
 let shell;
 try{shell=JSON.parse(await readFile(join(outDir,'browser-build.json'),'utf8'));await stat(join(outDir,'index.html'));}catch{throw Error('Optional ASR requires a completed browser shell build');}
 const base=validateBrowserBase(shell.base),buildId=shell.buildId;
 if(typeof buildId!=='string'||!/^[A-Za-z0-9_-]+$/.test(buildId))throw Error('Invalid browser build ID');
 if(!modelUrl)throw Error('Optional ASR requires a recorded model delivery URL');
 const entries={worker:join(sourceDir,'src/browser/voice/runtime.worker.ts'),worklet:join(sourceDir,'src/browser/voice/capture.worklet.ts')};
 for(const entry of Object.values(entries))if(!await exists(entry))throw Error('Task 3 Worker/AudioWorklet is not implemented; optional ASR preparation is unavailable');
 if(shell.optionalAsrEnabled!==true)throw Error('Rebuild the browser shell with WORKBENCH_BROWSER_ASR=1 before optional preparation');
 if(!await exists(join(outDir,'sw.js')))throw Error('Optional ASR requires a completed browser shell build including its service worker');
 const metadata=JSON.parse(await readFile(new URL('../src/browser/voice/resources.json',import.meta.url),'utf8'));
 for(const notice of [metadata.runtime.license,metadata.model.license]){
  const file=join(outDir,notice.repositoryPath);
  if(!await exists(file))throw Error('Required optional ASR notice missing: '+notice.repositoryPath);
  await checked(file,{...notice,filename:'notice '+notice.repositoryPath});
 }
 const basePath=base+'optional-asr/'+metadata.runtime.version+'/'+buildId+'/';
 const model=metadata.files.find(f=>f.role==='model'),tokens=metadata.files.find(f=>f.role==='tokens');
 if(modelUrl!==model.source&&modelUrl!==basePath+model.filename)throw Error('Model delivery URL must be the pinned revision or the exact same-origin deployment path');
 const cacheDir=join(sourceDir,'.cache/browser-local-voice');
 await mkdir(cacheDir,{recursive:true});
 const archive=metadata.runtime.archive;
 if(!archivePath){
  archivePath=join(cacheDir,'sherpa_onnx_web-1.13.8.tar.gz');
  if(!await exists(archivePath)){
   const response=await fetch(archive.url,{credentials:'omit',redirect:'follow'});
   if(!response.ok||response.type==='opaque'||!response.body)throw Error('Pinned browser runtime download failed');
   const partial=join(cacheDir,'runtime-'+randomUUID()+'.partial');
   try{
    const handle=await import('node:fs/promises').then(fs=>fs.open(partial,'wx'));let received=0;
    try{for await(const chunk of response.body){received+=chunk.length;if(received>archive.bytes)throw Error('Pinned runtime archive exceeds expected size');await handle.write(chunk);}}finally{await handle.close();}
    await checked(partial,{...archive,filename:'runtime archive'});await rename(partial,archivePath);
   }finally{await rm(partial,{force:true});}
  }
 }
 await checked(archivePath,{...archive,filename:'runtime archive'});
 const staging=await mkdtemp(join(cacheDir,'prepared-'+buildId+'-'));
 try{
  const runtime=metadata.files.filter(f=>['glue','wasm','wrapper'].includes(f.role));
  execFileSync('tar',['-xzf',archivePath,'-C',staging,...runtime.map(f=>f.archivePath)],{stdio:'pipe'});
  for(const resource of runtime){const extracted=join(staging,resource.archivePath);await checked(extracted,resource);await cp(extracted,join(staging,resource.filename));}
  await rm(join(staging,'assets'),{recursive:true,force:true});
  for(const [role,entry] of Object.entries(entries))await build({entryPoints:[entry],outfile:join(staging,role==='worker'?'runtime.worker.js':'capture.worklet.js'),bundle:true,format:'iife',platform:'browser',target:'es2022',logLevel:'silent'});
  const files=[];
  for(const resource of metadata.files){
   const url=basePath+resource.filename;
   const downloadUrl=resource.role==='model'?modelUrl===model.source?model.source:url+'?wb-asr-download=1':resource.role==='tokens'?modelUrl===model.source?tokens.source:url+'?wb-asr-download=1':url+'?wb-asr-download=1';
   files.push({role:resource.role,filename:resource.filename,url,downloadUrl,bytes:resource.bytes,sha256:resource.sha256});
  }
  for(const [role,filename] of [['worker','runtime.worker.js'],['worklet','capture.worklet.js']]){const info=await fileInfo(join(staging,filename)),url=basePath+filename;files.push({role,filename,url,downloadUrl:url+'?wb-asr-download=1',...info});}
  const manifest={schemaVersion:1,buildId,basePath,modelKind:metadata.model.kind,runtimeVersion:metadata.runtime.version,files};
  await writeFile(join(staging,'resources.json'),JSON.stringify(manifest)+'\n');
  return await publishPreparedBrowserAsr({staging,outDir,base,buildId,manifest});
 }
 finally{await rm(staging,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--archive'))throw Error('Unexpected optional preparation arguments');
  const result=await prepareBrowserAsr({archivePath:args[1]?resolve(args[1]):undefined});
  console.log('Optional ASR resources prepared for '+result.manifest.buildId+'; model weights were not downloaded.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
