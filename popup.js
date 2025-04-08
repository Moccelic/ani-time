const logContainer = document.getElementById('log-container');
const clearButton = document.getElementById('clear-log');

function formatDuration(milliseconds) {
    if (!milliseconds || milliseconds < 1000) return "Less than 1 min";

    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    // const seconds = totalSeconds % 60; // Optionally include seconds

    let parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    // if (seconds > 0 && hours === 0) parts.push(`${seconds}s`); // Show seconds only if < 1 hr?

    // Ensure at least minutes are shown if there's any significant time
    if (parts.length === 0 && totalSeconds > 0) {
         parts.push(`${minutes}m`); // Will show 0m if < 60s but > 1s
    }
     if (parts.length === 0) {
         return "< 1m"; // Catch very small durations rounded down
     }

    return parts.join(' ');
}


async function displayLog() {
    logContainer.innerHTML = 'Loading log...'; // Clear previous
    try {
        const result = await browser.storage.local.get('timeLog');
        const timeLog = result.timeLog || {};
        const sortedEntries = Object.entries(timeLog).sort(([, timeA], [, timeB]) => timeB - timeA); // Sort descending by time

        if (sortedEntries.length === 0) {
            logContainer.textContent = 'No time logged yet.';
            return;
        }

        logContainer.innerHTML = ''; // Clear loading message
        sortedEntries.forEach(([identifier, durationMs]) => {
            const entryDiv = document.createElement('div');
            entryDiv.className = 'log-entry';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = identifier.replace(/-/g, ' '); // Make identifier more readable
            nameSpan.title = identifier; // Show raw identifier on hover

            const timeSpan = document.createElement('span');
            timeSpan.textContent = formatDuration(durationMs);

            entryDiv.appendChild(nameSpan);
            entryDiv.appendChild(timeSpan);
            logContainer.appendChild(entryDiv);
        });

    } catch (error) {
        console.error("Error loading or displaying time log:", error);
        logContainer.textContent = 'Error loading log.';
    }
}

clearButton.addEventListener('click', async () => {
     if (confirm("Are you sure you want to clear the entire time log? This cannot be undone.")) {
        try {
            await browser.storage.local.remove('timeLog');
            console.log("Time log cleared.");
            displayLog(); // Refresh display
        } catch (error) {
             console.error("Error clearing time log:", error);
             alert("Failed to clear the log.");
        }
     }
});

// Initial load
displayLog();
