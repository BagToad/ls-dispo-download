browser.runtime.onMessage.addListener(function(message: string) {
    if (message === "initiateDownload") {
        console.log("Download initiation triggered by page action click and background script");
        downloadFiles().catch(error => console.error("Download initiation failed:", error));
    }
});

async function fetchWithTimeout(resource: string, options: any) {
    const { timeout = 8000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const response = await fetch(resource, {
        ...options,
        signal: controller.signal  
    });
    clearTimeout(id);
    return response;
}

async function downloadFiles() {
    console.log("Download process started");

    const server: string = "training.vri-research.com";
    const surveyId: string = getSurveyIdFromURL();
    if (!surveyId) {
        console.error("Survey ID not found in URL");
        return;
    }

    let commonRequestPayload: string = await getRequestPayload(surveyId, server);
    if (!commonRequestPayload) {
        console.error("Failed to generate request payload");
        return;
    }

    const csvTypes = [
        'csv',
        'export-rotation-orders',
        'export-rotation-orders-options',
        'export-rotation-orders-tracker',
        'export-heatmap-text',
        'export-multichice-encoded'
    ];

    for (const csvType of csvTypes) {
        try {
            await downloadResultsOfType(surveyId, server, csvType, commonRequestPayload);
            console.log(`Downloaded ${csvType} successfully`);
        } catch (error) {
            console.error(`Failed to download ${csvType}:`, error);
            // Retry logic
            try {
                console.log(`Retrying download for ${csvType}`);
                await downloadResultsOfType(surveyId, server, csvType, commonRequestPayload);
                console.log(`Downloaded ${csvType} successfully on retry`);
            } catch (retryError) {
                console.error(`Retry failed for ${csvType}:`, retryError);
            }
        }
    }

    try {
        await downloadTermsCSV(surveyId, server);
        console.log("Downloaded terms CSV successfully");
    } catch (error) {
        console.error("Failed to download terms CSV:", error);
    }

    console.log("Download process ended");
}

async function downloadResultsOfType(surveyId: string, server: string, csvType: string, commonRequestPayload: string) {
    const exportResultURL: string = `https://${server}/index.php/admin/export/sa/exportresults/surveyid/` + surveyId;
    let requestBody: string = `${commonRequestPayload}&type=${csvType}&sid=${surveyId}`;

    const response = await fetchWithTimeout(exportResultURL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: requestBody,
        timeout: 10000
    });

    if (!response.ok) throw new Error(`Server responded with ${response.status}`);

    const blob = await response.blob();
    const blobURL = URL.createObjectURL(blob);

    const aTag = document.createElement('a');
    aTag.href = blobURL;
    aTag.download = `${csvType}-${surveyId}.csv`;
    document.body.appendChild(aTag);
    aTag.click();
    aTag.remove();

    URL.revokeObjectURL(blobURL);
}
