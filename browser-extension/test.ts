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

async function safeFetch(url: string, options: any = {}, retries: number = 3, backoff: number = 300): Promise<Response> {
    try {
        const response = await fetchWithTimeout(url, options);
        if (!response.ok) throw new Error('Fetch failed - trying again');
        return response;
    } catch (error) {
        console.error(`Fetch error: ${error.message}, Retrying... Attempts left: ${retries}`);
        if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, backoff));
            return safeFetch(url, options, retries - 1, backoff * 2);
        } else {
            throw new Error('Max retries reached');
        }
    }
}

function encodeArray(key: string, values: string[]): string {
    return values.map((currentVal: string) => {
        return `${key}%5B%5D=${currentVal}`;
    }).join('&');
}

function getSurveyIdFromURL(): string {
    if (!location) return;

    const startIdx = location.pathname.lastIndexOf('/') + 1;
    return location.pathname.substring(startIdx);
}

function getStaticPayloadValues(): string {
    let payload: string = '';
    payload += '&' + 'completionstate' + '=' + 'all';
    payload += '&' + 'exportlang' + '=' + 'en';
    payload += '&' + 'headstyle' + '=' + 'code';
    payload += '&' + 'headspacetounderscores' + '=' + '0';
    payload += '&' + 'abbreviatedtext' + '=' + '0';
    payload += '&' + 'abbreviatedtextto' + '=' + '15';
    payload += '&' + 'emcode' + '=' + '0';
    payload += '&' + 'codetextseparator' + '=' + '.+';
    payload += '&' + 'answers' + '=' + 'short';
    payload += '&' + 'converty' + '=' + 'Y';
    payload += '&' + 'convertyto' + '=' + '1';
    payload += '&' + 'convertnto' + '=' + '2';
    payload += '&' + 'addmcothercol' + '=' + 'Y';
    payload += '&' + 'close-after-save' + '=' + 'false';
    return payload;
}

function getYIITokenFromCookies(): string {
    if (!document.cookie) return;

    const TOKEN_NAME: string = 'YII_CSRF_TOKEN';
    const cookieList = document.cookie.split(';');
    for (let cookie of cookieList) {
        const c = cookie.trim();
        if (c.startsWith(TOKEN_NAME)) {
            const startIdx: number = c.lastIndexOf('=') + 1;
            return c.substring(startIdx);
        }
    }
}

async function downloadTermsCSV(surveyId: string, server: string): Promise<void> {
    const url: string = `https://${server}/index.php/admin/edispnew/sa/downloadCompleted/surveyid/${surveyId}/quotaId/all/quotaMode/all/quotaType/all`;
    try {
        const res = await safeFetch(url);
        const blob = await res.blob();
        const blobURL = URL.createObjectURL(blob);

        const aTag = document.createElement('a');
        aTag.href = blobURL;
        aTag.download = `results-survey${surveyId}-terms.csv`;
        document.body.appendChild(aTag);
        aTag.click();
        aTag.remove();

        URL.revokeObjectURL(blobURL);
    } catch (error) {
        console.error("Error while downloading terms file: ", error);
    }
}

async function getRequestPayload(surveyId: string, server: string): Promise<string | undefined> {
    const exportResultPageURL: string = `https://${server}/index.php/admin/export/sa/exportresults/surveyid/` + surveyId;
    try {
        const res = await safeFetch(exportResultPageURL);
        const pageHTML = await res.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(pageHTML, 'text/html');

        let requestBodyString: string = '';

        const c: NodeListOf<HTMLOptionElement> = doc.querySelectorAll('select#colselect > option[selected="selected"');
        if (c.length > 0) {
            const colselectOptions: string[] = Array.from(c).map((el: HTMLOptionElement) => el.value);
            requestBodyString += encodeArray('colselect', colselectOptions);
        }

        const r: NodeListOf<HTMLDivElement> = doc.querySelectorAll('div.tab-content > div');
        if (r.length > 0) {
            const rotationData: { [id: string]: string[] }[] = Array.from(r).map((el: HTMLDivElement) => {
                const options: string[] = Array.from(el.querySelectorAll('option'))
                    .filter((optionEl: HTMLOptionElement) => optionEl.selected)
                    .map((optionEl: HTMLOptionElement) => optionEl.value);
                return { [el.id]: options };
            });

            for (let rot of rotationData) {
                const [keyName, value]: [string, string[]] = Object.entries(rot)[0];
                requestBodyString += '&' + encodeArray(keyName, value);
            }
        }

        const exportFromInputEl: HTMLInputElement = doc.getElementById('export_from') as HTMLInputElement;
        requestBodyString += '&' + 'export_from=' + exportFromInputEl.value;
        const exportToInputEl: HTMLInputElement = doc.getElementById('export_to') as HTMLInputElement;
        requestBodyString += '&' + 'export_to=' + exportToInputEl.value;

        const csrfToken: string = getYIITokenFromCookies();
        const TOKEN_NAME: string = 'YII_CSRF_TOKEN';
        csrfToken && (requestBodyString += '&' + `${TOKEN_NAME}=${csrfToken}`);

        requestBodyString += '&' + getStaticPayloadValues();

        return requestBodyString;
    } catch (error) {
        console.error("Error while preparing request payload: ", error);
    }
}

async function downloadResultsOfType(surveyId: string, server: string, csvType: string, commonRequestPayload: string) {
    const exportResultURL: string = `https://${server}/index.php/admin/export/sa/exportresults/surveyid/` + surveyId;
    const requestHeaders = {
        "User-Agent": navigator.userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-CA,en-US;q=0.7,en;q=0.3",
        "Content-Type": "application/x-www-form-urlencoded",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
    }

    try {
        let requestBody: string = commonRequestPayload;
        requestBody += '&' + `type=${csvType}`;
        requestBody += '&' + `sid=${surveyId}`;

        const res = await safeFetch(exportResultURL, {
            "credentials": "include",
            "headers": requestHeaders,
            "body": requestBody,
            "method": "POST",
            "mode": "cors"
        });

        if (!res.ok) {
            console.error("Bad response from server:", res);
            throw new Error("Bad response from server");
        }

        const blob = await res.blob();
        const blobURL = URL.createObjectURL(blob);

        const aTag = document.createElement('a');
        aTag.href = blobURL;
        aTag.download = `${csvType}-${surveyId}.csv`;
        document.body.appendChild(aTag);
        aTag.click();
        aTag.remove();

        URL.revokeObjectURL(blobURL);
    } catch (error) {
        console.error("Error while downloading file of type", csvType, ":", error);
    }
}

async function downloadFiles() {
    console.log("Download process initiated");

    enum CSV_Types {
        CSV = 'csv',
        CSV_ERO = 'export-rotation-orders',
        CSV_EROO = 'export-rotation-orders-options',
        CSV_Tracker = 'export-rotation-orders-tracker',
        CSV_HM = 'export-heatmap-text',
        CSV_MCV = 'export-multichice-encoded'
    }

    const server: string = "training.vri-research.com";

    const surveyId: string = getSurveyIdFromURL();
    if (!surveyId) {
        throw new Error("Survey ID not found in URL");
    }

    let commonRequestPayload: string = await getRequestPayload(surveyId, server);
    if (!commonRequestPayload) {
        throw new Error("Failed to prepare common request payload");
    }

    console.log("Starting downloads...");
    await downloadTermsCSV(surveyId, server);
    for (const type of Object.values(CSV_Types)) {
        await downloadResultsOfType(surveyId, server, type, commonRequestPayload);
    }
    console.log("All downloads completed successfully");
}
