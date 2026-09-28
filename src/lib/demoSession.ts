import type { RefillCase } from '../domain/engine';
import { seedCases } from '../domain/seed';

/** A document owns its demo. Reloads and new tabs get the original six cases. */
export function createDemoSession(){
 let records:RefillCase[]|undefined;
 return {
  load():RefillCase[]{records??=seedCases();return structuredClone(records);},
  save(cases:RefillCase[]){records=structuredClone(cases);},
 };
}
