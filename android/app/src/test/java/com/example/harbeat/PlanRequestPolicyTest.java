package com.example.harbeat;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;
public class PlanRequestPolicyTest {
 private Set<String> fields(String... extra){Set<String> x=new HashSet<>(Arrays.asList("from","to","windowId","start"));x.addAll(Arrays.asList(extra));return x;}
 @Test public void oldPlanAndRenderRequestsRemainValid(){assertTrue(PlanRequestPolicy.allowed(true,fields(),null));assertTrue(PlanRequestPolicy.allowed(false,fields(),null));}
 @Test public void onlyPlansCanOptIntoTheFixedTimelineVersion(){assertTrue(PlanRequestPolicy.allowed(true,fields("stemTimelineVersion"),"stem-timeline-v1"));assertFalse(PlanRequestPolicy.allowed(false,fields("stemTimelineVersion"),"stem-timeline-v1"));}
 @Test public void calibratedTimelinesUseTheirOwnFixedVersion(){assertTrue(PlanRequestPolicy.allowed(true,fields("stemTimelineVersion"),"stem-timeline-v2"));assertFalse(PlanRequestPolicy.allowed(false,fields("stemTimelineVersion"),"stem-timeline-v2"));}
 @Test public void arbitraryControlsAndVersionsAreRejected(){assertFalse(PlanRequestPolicy.allowed(true,fields("stemTimelineVersion","timeline"),"stem-timeline-v1"));assertFalse(PlanRequestPolicy.allowed(true,fields("stemTimelineVersion"),"arbitrary"));assertFalse(PlanRequestPolicy.allowed(true,fields("timeline"),null));}
}
