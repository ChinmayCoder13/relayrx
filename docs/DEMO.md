# Final hackathon demonstration

This walkthrough takes about 5–6 minutes because the waiting threshold is three real minutes. Three minutes represent 30 simulated hours. The timer only flags attention.

## Prepare

1. Add `GEMINI_API_KEY` using [GEMINI-SETUP.md](../GEMINI-SETUP.md), restart or redeploy, and test one question.
2. Start in **Practice staff** mode. For a clean rehearsal, use **System & trust → Reset sample workspace** (synthetic local data only).
3. Keep pharmacy failure simulation off. The existing source-system interactions remain simulated.

## 1. Create a stuck refill

Click **New refill**, enter a fictional alias and sample medication, and choose **No refills remaining**. The case enters **Awaiting clinician** with **12/15** evidence verified. It has its own `03:00` countdown.

Open the round, draggable **AI** button. Ask the **Practice Staff AI Copilot**: “Why is this case blocked, who owns it, and what should happen next?” It should explain the missing clinician authorization. The staff role cannot make that decision.

Select **Clinician** and ask: “Summarize the verified and missing information for my review.” The copilot assists with the review and documentation; the human retains the clinical decision.

## 2. Let the pending action wait

Leave the required review incomplete for three minutes. You can explore the circuit or business playbook while the clock keeps running. Viewing the case and asking questions do not reset it.

At the threshold:

- **Needs attention** increases and the case appears in that filter. Other waiting sample cases can also be counted.
- The workflow badge remains **Awaiting clinician**.
- The signal remains **12/15**.
- The copilot's live state updates. Ask why attention is needed: it should mention the three-minute demo threshold, current owner **Clinician**, and next action **Review & record decision**.

Nothing resolves or advances automatically. Any pre-threshold guidance is hidden after the state changes.

## 3. Human action resumes the workflow

As **Clinician**, click **Review & record decision**, add a clearly synthetic review note, and record the authorized decision. This is a demo of recording a human decision, not an AI recommendation.

The case reaches **15/15 → Ready to route**. Its old attention flag clears and a new three-minute timer begins for routing. If using the Needs Attention filter, the case drops out of that list; its selected detail remains available.

As **Practice staff**, click **Route to pharmacy** and record synthetic handoff evidence. It becomes **Awaiting pharmacy**, with a fresh timer and owner **Pharmacy**.

Optional second demonstration: wait another three minutes here. **Needs Attention** appears alongside **Awaiting pharmacy**. The timer does not resolve the refill, and 15/15 is still only readiness.

## 4. Verify fulfillment and close the loop

Select **Pharmacy**. Ask the Pharmacy AI Copilot: “What still needs verification, and why isn't pickup confirmed?” It must distinguish a queued handoff from verified pharmacy readiness and actual pickup.

1. Click **Confirm ready for pickup** and record synthetic evidence of pharmacy receipt, preparation, and checks.
2. The case becomes **Ready for pickup**, still open, with a new wait for pickup confirmation.
3. Click **Confirm patient pickup**, record sample pickup or delivery confirmation, and submit.
4. Only now does the workflow show **Resolved**, with **Timer stopped**. It leaves Needs Attention and the active queue; Loop closed increases.
5. Ask the copilot for the current status. It should describe the confirmed outcome, with no pending action or active waiting timer.

**Patient update** saves a preview only. No real patient message or prescription is sent.

## Additional checks

- Complete an action before three minutes: the previous step's deadline must not cause a later alert. Only a new three-minute wait for the new pending action can do that.
- Reload during a wait: the countdown continues from the saved timestamp.
- Closed or declined cases never enter Needs Attention.
- Drag the round launcher to reposition it. Arrow keys move a focused launcher; Home returns it to the lower right. Escape closes the panel.
- In **Circuit lab**, a 15/15 signal with a clinician hold stays locked.
- In **Growth playbook**, show pilot qualification, activation, retention, and measurable staff-time/resolution outcomes.
