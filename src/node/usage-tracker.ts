import {randomUUID} from 'node:crypto';
import {ModelResponseError, type ChatTurn, type ModelReply, type ModelUsage} from '../core/providers';
import {usageRecord, type UsagePurpose, type UsageRecord} from '../core/usage';
import type {ModelSnapshot} from './model-runtime';
/** Text extraction and billing are independent; even an empty response can consume tokens. */
export async function trackRequest(snapshot:ModelSnapshot,system:string,turns:ChatTurn[],purpose:UsagePurpose,persist:(record:UsageRecord)=>Promise<void>,timeout=180000):Promise<ModelReply> {
  let reply:ModelReply | undefined;let failure:unknown;let failed=false;
  try{reply=await snapshot.chatDetailed(system,turns,AbortSignal.timeout(timeout));}
  catch(error){failure=error;failed=true;}
  const usage:ModelUsage|null=reply?.usage??(failure instanceof ModelResponseError?failure.usage:null);
  await persist(usageRecord(snapshot.profile.id,snapshot.settings.model,purpose,usage,new Date().toISOString(),randomUUID()));
  if(failed)throw failure;
  return reply!;
}
