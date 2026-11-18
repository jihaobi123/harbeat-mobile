package com.example.harbeat;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.Semaphore;

/** Coordinates immutable audio cache files without blocking unrelated assets. */
final class AudioLoadCoordinator {
    private static final class AssetWork { int users; }
    private final Map<String, AssetWork> assets = new HashMap<>();
    private final Semaphore downloads;
    private final Semaphore preparations;

    AudioLoadCoordinator() { this(3); }
    AudioLoadCoordinator(int maximumDownloads) {
        if (maximumDownloads < 1) throw new IllegalArgumentException("Positive download limit required");
        downloads = new Semaphore(maximumDownloads, true);
        preparations = new Semaphore(Math.max(1, maximumDownloads - 1), true);
    }

    <T> T withAsset(String key, Callable<T> work) throws Exception {
        AssetWork asset;
        synchronized (assets) {
            asset = assets.get(key);
            if (asset == null) { asset = new AssetWork(); assets.put(key, asset); }
            asset.users++;
        }
        try {
            synchronized (asset) { return work.call(); }
        } finally {
            synchronized (assets) {
                if (--asset.users == 0) assets.remove(key);
            }
        }
    }

    <T> T withDownload(Callable<T> work) throws Exception {
        downloads.acquire();
        try { return work.call(); }
        finally { downloads.release(); }
    }

    <T> T withDownload(boolean preparation, Callable<T> work) throws Exception {
        // Acquire background capacity before total capacity: queued/cancelled JS
        // preparations cannot consume the slot reserved for current playback.
        if (preparation) preparations.acquire();
        try { return withDownload(work); }
        finally { if (preparation) preparations.release(); }
    }

    Set<String> activeKeys() {
        synchronized (assets) { return new HashSet<>(assets.keySet()); }
    }
}
