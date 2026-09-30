import { INPUTS, nextAction, state, roleNames } from './engine.js';
import type { ActionType, RefillCase, Role } from './engine.js';

/**
 * Auto-drafted evidence notes.
 *
 * Every workflow action needs an evidence note (8–1,500 characters). Instead of
 * making people type it from scratch, we draft one from the case itself: the
 * patient alias, medication, pharmacy, case ID, current state, retry count and
 * the acting person. The wording adapts to the situation (for example, a
 * "Missing information" case reads differently from a routine identity check).
 *
 * The draft is only a starting point. The person can edit it, and nothing is
 * saved until they confirm. Drafts describe the action being recorded; they do
 * not invent clinical facts, sources or outcomes.
 */

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Short, human label for who is recording, e.g. "Practice staff Jordan Ellis". */
function by(role: Role, actor: string) {
  const who = actor.trim();
  return who ? `${roleNames[role]} ${who}` : roleNames[role];
}

export function draftNote(type: ActionType, c: RefillCase, role: Role, actor: string): string {
  const who = by(role, actor);
  const subject = `${c.patient}'s ${c.medication} refill (${c.id})`;
  const rx = `${c.medication} for ${c.patient} (${c.id})`;
  const pharmacy = c.pharmacy;
  const reason = lc(c.reason);
  const next = nextAction(c);

  switch (type) {
    case 'verify_identity':
      return c.reason === 'Missing information'
        ? `${who} re-checked the identifiers for ${c.patient} (${c.id}) that previously did not match, confirmed they now agree across the practice record and the ${pharmacy} request, and cleared the identity mismatch.`
        : `${who} matched ${c.patient}'s identifiers on ${c.id} against the practice record and the ${pharmacy} request. Identity confirmed for the ${c.medication} refill.`;

    case 'verify_prescription':
      return `${who} reconciled the existing ${c.medication} prescription for ${c.patient} (${c.id}) with the practice record and ${pharmacy}'s request. Medication, strength and directions are consistent. This does not authorize a new prescription.`;

    case 'clear_visit':
      return c.reason === 'Clinical review'
        ? `${who} completed the clinical review for ${subject}. The review requirement is recorded as satisfied and the request can move to authorization.`
        : c.reason === 'Visit required'
          ? `${who} reviewed the visit requirement for ${subject}. The requirement is recorded as satisfied or not applicable for this request.`
          : `${who} reviewed whether ${c.patient} needs a visit before ${c.medication} is refilled (${c.id}). No outstanding visit or review requirement remains.`;

    case 'confirm_coverage':
      return c.reason === 'Coverage issue'
        ? `${who} resolved the coverage/administrative issue on ${subject} with ${pharmacy}. The confirmed resolution is recorded; the app does not determine coverage.`
        : `${who} confirmed there is no outstanding coverage or administrative blocker for ${subject} at ${pharmacy}.`;

    case 'approve':
      return `${who} reviewed the refill request for ${rx} and records authorization for this exact request. Identity, prescription details and the visit requirement were verified before this decision.`;

    case 'hold':
      return c.transport === 'not_sent'
        ? `${who} placed a clinical hold on ${subject}. Prior approval is invalidated and routing is blocked until a clinician reviews and releases the hold.`
        : `${who} placed a clinical hold on ${subject} after a handoff to ${pharmacy} already existed. ${pharmacy} must be contacted directly to pause the request.`;

    case 'release_hold':
      return `${who} reviewed the clinical hold on ${subject} and documents that the concern has been resolved. A fresh clinician approval is still required before this refill can be routed.`;

    case 'decline':
      return `${who} reviewed ${rx} and declines this refill. No prescription will be sent to ${pharmacy}. Staff should tell ${c.patient} the recommended next step.`;

    case 'dispatch':
      return `${who} routed ${subject} to ${pharmacy}. All five requirements were verified and no hold is active. The handoff stays open until the pharmacy confirms readiness.`;

    case 'retry':
      return `${who} retried the handoff of ${subject} to ${pharmacy} (attempt ${Math.min(c.attempts + 1, 3)} of 3). No acknowledgment was received on the previous attempt, so the case stays open.`;

    case 'acknowledge':
      return c.transport === 'failed'
        ? `${who} at ${pharmacy} manually confirmed receipt of ${subject} by phone, completed preparation and final checks, and it is ready for pickup.`
        : `${who} at ${pharmacy} confirmed receipt of ${subject}, completed preparation and final checks. The ${c.medication} refill is ready for pickup.`;

    case 'dispense':
      return `${who} at ${pharmacy} recorded that ${c.patient} picked up or received the ${c.medication} refill (${c.id}). The loop is closed.`;

    case 'patient_update':
      return `${who} prepared a patient update for ${c.patient} on ${c.id} while it is "${state(c)}". The wording below was reviewed and is saved to the preview outbox only; nothing is sent.`;

    case 'invalidate':
      return `${who} flagged an identity mismatch on ${subject}. Identity verification is removed and any prior clinician approval is invalidated until staff re-verify ${c.patient}'s identifiers.`;

    case 'escalate':
      return `${who} escalated ${subject} after ${c.attempts} failed handoff attempt${c.attempts === 1 ? '' : 's'} to ${pharmacy}. Owner: ${roleNames.staff}. Follow-up: call ${pharmacy} to confirm the actual outcome; escalation alone does not resolve the refill.`;

    case 'request_info': {
      const missing = INPUTS.filter(i => !c.inputs[i.key].verified).map(i => i.name.toLowerCase());
      return missing.length
        ? `${who} requested missing information for ${subject}: ${missing.join(', ')}. Owner: ${roleNames.staff}. Case status: ${state(c)}.`
        : `${who} requested a follow-up on ${subject}. Next step: ${lc(next.label)}. Case status: ${state(c)}.`;
    }

    default:
      return `${who} recorded an update on ${subject}. Case status: ${state(c)} (${reason}).`;
  }
}
