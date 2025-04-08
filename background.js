console.log("Anime Time Tracker Background Script Started.");

const TARGET_HOSTS = [ // Keep in sync with host_permissions
    'www.crunchyroll.com',
    'www.netflix.com',
    'www.hidive.com'
    // Add other hostnames
];
const MIN_LOG_DURATION_MS = 5 * 60 * 1000; // 5 minutes minimum to log time

// Stores active timers: { tabId: { startTime: timestamp, showIdentifier: "..." } }
let activeTimers = {};
// Stores time accumulated *during the current browser focus session* before pausing
let pausedTimeAccumulators = {}; // { tabId: accumulatedMs }

// --- Utility Functions ---

function getShowIdentifier(url, title) {
    const urlObj = new URL(url);
    let identifier = null;

    // --- Site-Specific URL Parsing (MORE ROBUST) ---
    if (urlObj.hostname.includes('crunchyroll.com') && urlObj.pathname.includes('/series/')) {
        // Example: /series/G6NQ5DWZ6/one-piece -> Try to get 'one-piece' or the ID
        const parts = urlObj.pathname.split('/');
        const seriesIndex = parts.indexOf('series');
        if (seriesIndex !== -1 && parts.length > seriesIndex + 2) {
            // Use the slug after the ID if it exists, otherwise the ID
            identifier = parts[seriesIndex + 2].replace(/[^a-zA-Z0-9\-]/g, '-') || parts[seriesIndex + 1];
        } else if (seriesIndex !== -1 && parts.length > seriesIndex + 1) {
             identifier = parts[seriesIndex + 1]; // The ID
        }
    } else if (urlObj.hostname.includes('netflix.com') && urlObj.pathname.startsWith('/watch/')) {
        // Example: /watch/80107103 -> Use the ID, rely on title for name guess
        // Or maybe grab from title if available and more descriptive?
        identifier = `Netflix-${urlObj.pathname.split('/')[2]}`; // Prefix to avoid clashes
        // Try to refine with title later if needed
    }
    // Add similar logic for Hidive, etc.

    // --- Fallback to Page Title (Less Robust) ---
    if (!identifier && title) {
        // Basic title cleanup - needs improvement!
        identifier = title.split(/[-–—|]/)[0] // Take first part before common separators
                           .replace(/Watch | Season \d+| Episode \d+/i, '') // Remove common noise
                           .replace(/\(\w+ Dub\)/i, '') // Remove dub markers
                           .replace(/\(.+?\)/, '') // Remove general parentheticals
                           .trim();
    }

    // --- Final Normalization ---
    if (identifier) {
        identifier = identifier.toLowerCase().replace(/\s+/g, '-'); // Consistent format
        // Consider more aggressive cleaning (remove special chars?)
    }

    // console.log(`Identifier for ${url}: ${identifier}`);
    return identifier || 'unknown-show'; // Default if nothing found
}


async function logTime(identifier, durationMs) {
    if (!identifier || identifier === 'unknown-show' || durationMs < MIN_LOG_DURATION_MS) {
        // console.log(`Skipping log for ${identifier} - Duration ${durationMs}ms < ${MIN_LOG_DURATION_MS}ms`);
        return;
    }

    console.log(`Logging ${durationMs / 1000}s for ${identifier}`);
    try {
        const result = await browser.storage.local.get('timeLog');
        const timeLog = result.timeLog || {};
        timeLog[identifier] = (timeLog[identifier] || 0) + durationMs;
        await browser.storage.local.set({ timeLog });
    } catch (error) {
        console.error("Error saving time log:", error);
    }
}

function stopTimer(tabId, forceLog = false) {
    if (activeTimers[tabId]) {
        const { startTime, showIdentifier } = activeTimers[tabId];
        const endTime = Date.now();
        const accumulated = pausedTimeAccumulators[tabId] || 0;
        const sessionDuration = endTime - startTime;
        const totalDuration = sessionDuration + accumulated;

        console.log(`Stopping timer for Tab ${tabId} (${showIdentifier}). Session: ${sessionDuration}ms, Accumulated: ${accumulated}ms, Total: ${totalDuration}ms`);

        if (totalDuration > 0 && (totalDuration >= MIN_LOG_DURATION_MS || forceLog)) {
             logTime(showIdentifier, totalDuration);
        }

        delete activeTimers[tabId];
        delete pausedTimeAccumulators[tabId]; // Clean up accumulator too
        return totalDuration; // Return duration in case needed
    }
    return 0;
}

function pauseTimer(tabId) {
     if (activeTimers[tabId] && activeTimers[tabId].startTime) { // Ensure it's running
        const { startTime } = activeTimers[tabId];
        const elapsed = Date.now() - startTime;
        pausedTimeAccumulators[tabId] = (pausedTimeAccumulators[tabId] || 0) + elapsed;
        activeTimers[tabId].startTime = null; // Mark as paused by clearing start time
        console.log(`Paused timer for Tab ${tabId}. Accumulated ${pausedTimeAccumulators[tabId]}ms`);
     }
}

function resumeTimer(tabId) {
    // Resume only if it *was* being tracked (has an entry in activeTimers) and is currently paused (startTime is null)
     if (activeTimers[tabId] && activeTimers[tabId].startTime === null) {
        activeTimers[tabId].startTime = Date.now();
        console.log(`Resumed timer for Tab ${tabId} (${activeTimers[tabId].showIdentifier})`);
     }
}


// --- Event Listeners ---

// Tab Updated (URL change, page load)
browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Wait for page load to complete and ensure URL exists
    if (changeInfo.status === 'complete' && tab.url) {
        const urlObj = new URL(tab.url);
        const hostname = urlObj.hostname;

        if (TARGET_HOSTS.some(host => hostname.includes(host))) {
             // Page is on a target site
             const newIdentifier = getShowIdentifier(tab.url, tab.title);

             if (activeTimers[tabId]?.showIdentifier !== newIdentifier) {
                 // Identifier changed OR timer wasn't running for this tab before
                 stopTimer(tabId); // Stop and log time for the previous identifier (if any)
                 console.log(`Starting timer for Tab ${tabId}: ${newIdentifier}`);
                 activeTimers[tabId] = { startTime: Date.now(), showIdentifier: newIdentifier };
                 delete pausedTimeAccumulators[tabId]; // Reset accumulator for new content
             } else if (!activeTimers[tabId]?.startTime) {
                 // Same identifier, but timer was paused (e.g. came back to the tab)
                  resumeTimer(tabId);
             }
             // If identifier is the same and timer is running, do nothing

        } else {
            // Navigated away from a target site within the same tab
            stopTimer(tabId);
        }
    } else if (changeInfo.status === 'loading' && activeTimers[tabId]) {
        // If the tab starts loading something new, pause the timer immediately
        // This handles cases where the user clicks a link before 'complete' fires for the new page
        pauseTimer(tabId);
    }
});

// Tab Closed
browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
    stopTimer(tabId, true); // Force log even if below threshold, as it's the end
});

// Tab Activated (Switching Tabs)
browser.tabs.onActivated.addListener(async (activeInfo) => {
    // Pause timer for the tab that *lost* focus (if we were tracking it)
    if (activeInfo.previousTabId && activeTimers[activeInfo.previousTabId]) {
         pauseTimer(activeInfo.previousTabId);
    }
    // Resume timer for the tab that *gained* focus (if we should be tracking it)
     const currentTab = await browser.tabs.get(activeInfo.tabId).catch(() => null);
     if (currentTab && currentTab.url) {
        const urlObj = new URL(currentTab.url);
        if (TARGET_HOSTS.some(host => urlObj.hostname.includes(host))) {
             resumeTimer(activeInfo.tabId);
         }
     }
});


// Window Focus Changed (Switching windows or focusing/unfocusing browser)
browser.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) {
        // Browser lost focus, pause all active timers
        console.log("Browser lost focus, pausing all timers.");
        for (const tabIdStr in activeTimers) {
             pauseTimer(parseInt(tabIdStr, 10));
        }
    } else {
        // Browser gained focus, resume timer for the active tab in the focused window
        try {
            const [activeTab] = await browser.tabs.query({ active: true, windowId: windowId });
             if (activeTab && activeTab.url) {
                 const urlObj = new URL(activeTab.url);
                  if (TARGET_HOSTS.some(host => urlObj.hostname.includes(host))) {
                      resumeTimer(activeTab.id);
                  }
             }
        } catch (error) {
            console.error("Error resuming timer on window focus:", error);
        }
    }
});

// Optional: Periodically save active timers to prevent data loss on crash
// browser.alarms.create('periodicSave', { periodInMinutes: 5 });
// browser.alarms.onAlarm.addListener(alarm => {
//     if (alarm.name === 'periodicSave') {
//         console.log("Periodic save triggered...");
//         for (const tabIdStr in activeTimers) {
//             const tabId = parseInt(tabIdStr, 10);
//             if (activeTimers[tabId]?.startTime) { // Only save if actively running
//                 const durationSinceLastSave = Date.now() - activeTimers[tabId].startTime;
//                 logTime(activeTimers[tabId].showIdentifier, durationSinceLastSave);
//                 // Reset start time to now, effectively saving the chunk
//                 activeTimers[tabId].startTime = Date.now();
//             }
//         }
//     }
// });

console.log("Anime Time Tracker background listeners attached.");

// Clear timers on startup? Maybe not needed for non-persistent workers.
// Or load previous state if using alarms for persistence.
