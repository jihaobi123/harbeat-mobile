package com.example.harbeat;
import java.util.*;
/** Native requests may select a fixed protocol, never supply executable controls. */
final class PlanRequestPolicy {
 static boolean allowed(boolean dataPlan, Set<String> fields, String version) {
  Set<String> base=new HashSet<>(Arrays.asList("from","to","windowId","start"));
  if(fields.equals(base))return version==null;
  base.add("stemTimelineVersion");
  return dataPlan && fields.equals(base) && ("stem-timeline-v1".equals(version)||"stem-timeline-v2".equals(version));
 }
}
