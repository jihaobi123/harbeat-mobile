type Overlap = {
 end: number
 plan: {duration: number; window: {start: number; end: number}}
}

/** Map the time-stretched overlap back to B's source playhead. */
export function overlapSourcePosition(now: number, {end,plan}: Overlap) {
 if(plan.duration<=0)return plan.window.end
 const elapsed = Math.max(0,Math.min(plan.duration,now-(end-plan.duration)))
 const {start,end: takeover} = plan.window
 return start + elapsed / plan.duration * (takeover - start)
}
