import {ModelResponseError, type ChatTurn, type ModelReply, type ModelUsage} from '../core/providers';
import {usageRecord, type UsagePurpose, type UsageRecord} from '../core/usage';
import type {ModelSnapshot} from './model-runtime';
/** Text extraction and billing are independent; even an empty response can consume tokens. */
export async function trackRequest(snapshot:ModelSnapshot,system:string,turns:ChatTurn[],purpose:UsagePurpose,persist:(record:UsageRecord)=>Promise<void>,timeout=180000,id:()=>string=()=>globalThis.crypto.randomUUID(),signal?:AbortSignal):Promise<ModelReply> {
  signal?.throwIfAborted();
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout);
  const profileId=snapshot.profile.id;const model=snapshot.settings.model;
  let reply:ModelReply | undefined;let failure:unknown;let failed=false;
  try{reply=await snapshot.chatDetailed(system,turns,requestSignal);}
  catch(error){failure=error;failed=true;}
  const usage:ModelUsage|null=reply?.usage??(failure instanceof ModelResponseError?failure.usage:null);
  await persist(usageRecord(profileId,model,purpose,usage,new Date().toISOString(),id()));
  if(failed)throw failure;
  return reply!;
}
