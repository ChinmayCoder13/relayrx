import type { Role } from './engine.js';

// Shared by the role switcher display and the actor recorded in demo evidence.
export const demoActors:Record<Role,string>={
 staff:'Jordan Ellis',
 clinician:'Dr. Alex Morgan',
 pharmacy:'Sam Lee',
};

export function actorInitials(name:string){
 const words=name.replace(/^Dr\.?\s+/i,'').trim().split(/\s+/).filter(Boolean);
 return words.length?`${words[0][0]}${words.length>1?words[words.length-1][0]:''}`.toUpperCase():'?';
}
