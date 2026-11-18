package com.example.harbeat;

import org.junit.Test;
import static org.junit.Assert.assertEquals;

public class ExecutionTrialRoutingTest {
    private static final String CLOUD = "https://47.108.118.177";
    private static final String USB = "http://127.0.0.1:18796";
    private static final String HASH = new String(new char[64]).replace('\0', 'a');

    @Test public void absentTrialMarkerKeepsExistingRoutes() {
        assertEquals(CLOUD, ExecutionTrialRouting.origin(false, CLOUD, "/listen/execution/index.json"));
        assertEquals(CLOUD, ExecutionTrialRouting.origin(false, CLOUD, "/listen/smart-api/plans"));
    }

    @Test public void onlyExactExecutionRoutesUseThePrivateTrial() {
        for (String path : new String[]{"/listen/execution/index.json",
                "/listen/execution/tracks/track-000.json", "/listen/execution/profiles/" + HASH + ".json",
                "/listen/execution-media/" + HASH + ".wav", "/listen/execution-media/" + HASH + ".flac",
                "/listen/smart-api/plans", "/listen/smart-api/plans/" + HASH}) {
            assertEquals(path, USB, ExecutionTrialRouting.origin(true, CLOUD, path));
        }
        for (String path : new String[]{"/listen/library.json", "/listen/media/" + HASH + ".flac",
                "/listen/smart-api/jobs", "/listen/execution/../index.json",
                "/listen/smart-api/plans/" + HASH + "/extra", "/api/login"}) {
            assertEquals(path, CLOUD, ExecutionTrialRouting.origin(true, CLOUD, path));
        }
    }
}
