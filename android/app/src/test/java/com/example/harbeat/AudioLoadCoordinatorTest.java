package com.example.harbeat;

import org.junit.Test;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class AudioLoadCoordinatorTest {
    @Test public void unrelatedBodyChunkDoesNotWaitForSlowPreparation() throws Exception {
        AudioLoadCoordinator loads = new AudioLoadCoordinator(3);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        try {
            Future<?> slow = pool.submit(() -> loads.withAsset("next-entry", () -> loads.withDownload(() -> {
                entered.countDown(); release.await(); return null;
            })));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            Future<String> body = pool.submit(() -> loads.withAsset("current-body", () -> loads.withDownload(() -> "body")));
            assertEquals("body", body.get(1, TimeUnit.SECONDS));
            release.countDown(); slow.get(2, TimeUnit.SECONDS);
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test public void slowOrCancelledPreparationsCannotOccupyThePlaybackSlot() throws Exception {
        AudioLoadCoordinator loads = new AudioLoadCoordinator(3);
        ExecutorService pool = Executors.newFixedThreadPool(5);
        CountDownLatch entered = new CountDownLatch(2), release = new CountDownLatch(1);
        AtomicInteger backgroundInside = new AtomicInteger();
        List<Future<?>> preparations = new ArrayList<>();
        try {
            // Three distinct cold chunks, including a replacement for a cancelled JS caller.
            // Native work holds its background permit until the connection actually finishes.
            for (int i = 0; i < 3; i++) {
                final String key = "prep-" + i;
                preparations.add(pool.submit(() -> loads.withAsset(key, () -> loads.withDownload(true, () -> {
                    backgroundInside.incrementAndGet(); entered.countDown(); release.await(); return null;
                }))));
            }
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            Future<String> body = pool.submit(() -> loads.withAsset("cold-current-body", () -> loads.withDownload(false, () -> "downloaded body")));
            assertEquals("downloaded body", body.get(1, TimeUnit.SECONDS));
            assertEquals(2, backgroundInside.get());
            release.countDown(); for (Future<?> item : preparations) item.get(2, TimeUnit.SECONDS);
            assertEquals("later body", loads.withDownload(false, () -> "later body"));
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test public void cachedAudioBypassesAnOccupiedDownloadSlot() throws Exception {
        AudioLoadCoordinator loads = new AudioLoadCoordinator(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        try {
            pool.submit(() -> loads.withAsset("slow", () -> loads.withDownload(() -> {
                entered.countDown(); release.await(); return null;
            })));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            Future<String> cached = pool.submit(() -> loads.withAsset("cached", () -> "already verified"));
            assertEquals("already verified", cached.get(1, TimeUnit.SECONDS));
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test public void sameHashWorkRemainsExclusive() throws Exception {
        AudioLoadCoordinator loads = new AudioLoadCoordinator(3);
        ExecutorService pool = Executors.newFixedThreadPool(8);
        AtomicInteger inside = new AtomicInteger(), maximum = new AtomicInteger();
        try {
            List<Future<Integer>> work = new ArrayList<>();
            for (int i = 0; i < 32; i++) work.add(pool.submit(() -> loads.withAsset("same-sha", () -> {
                maximum.accumulateAndGet(inside.incrementAndGet(), Math::max);
                try { Thread.sleep(2); return 1; } finally { inside.decrementAndGet(); }
            })));
            for (Future<Integer> item : work) assertEquals(Integer.valueOf(1), item.get(3, TimeUnit.SECONDS));
            assertEquals(1, maximum.get());
            assertTrue(loads.activeKeys().isEmpty());
        } finally { pool.shutdownNow(); }
    }

    @Test public void downloadConcurrencyIsBounded() throws Exception {
        AudioLoadCoordinator loads = new AudioLoadCoordinator(2);
        ExecutorService pool = Executors.newFixedThreadPool(3);
        CountDownLatch entered = new CountDownLatch(2), release = new CountDownLatch(1);
        AtomicInteger inside = new AtomicInteger(), maximum = new AtomicInteger();
        try {
            List<Future<Integer>> work = new ArrayList<>();
            for (int i = 0; i < 3; i++) work.add(pool.submit(() -> loads.withDownload(() -> {
                maximum.accumulateAndGet(inside.incrementAndGet(), Math::max); entered.countDown();
                try { release.await(); return 1; } finally { inside.decrementAndGet(); }
            })));
            assertTrue(entered.await(2, TimeUnit.SECONDS));
            release.countDown();
            for (Future<Integer> item : work) item.get(2, TimeUnit.SECONDS);
            assertTrue(maximum.get() <= 2);
        } finally { release.countDown(); pool.shutdownNow(); }
    }

    @Test public void failuresReleaseTheHashAndDownloadSlot() throws Exception {
        AudioLoadCoordinator loads = new AudioLoadCoordinator(1);
        try {
            loads.withAsset("failed", () -> loads.withDownload(() -> { throw new IllegalStateException("network failed"); }));
            fail("failure must propagate");
        } catch (IllegalStateException expected) { assertEquals("network failed", expected.getMessage()); }
        assertTrue(loads.activeKeys().isEmpty());
        assertEquals("retry", loads.withAsset("failed", () -> loads.withDownload(() -> "retry")));
    }

    @Test public void activeKeysProtectFilesDuringPublicationAndOpen() throws Exception {
        AudioLoadCoordinator loads = new AudioLoadCoordinator(2);
        loads.withAsset("publishing", () -> {
            assertTrue(loads.activeKeys().contains("publishing")); return null;
        });
        assertTrue(loads.activeKeys().isEmpty());
    }

    @Test(expected = IllegalArgumentException.class) public void invalidLimitIsRejected() {
        new AudioLoadCoordinator(0);
    }
}
