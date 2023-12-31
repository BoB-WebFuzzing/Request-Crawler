import path from "path";
import {RequestExplorer} from "./RequestExplorer.js";
import {ENDCOLOR, isDefined, isInteractivePage, RED, sleep} from "../common/utils.js";

let re = null
let page = null

const addDataFromBrowser = async (page, parenturl) => {
//        console.log("Starting formdatafrompage");
    let requestsAdded = 0;
    let childFrames = re.page.mainFrame().childFrames();

    if (typeof childFrames !== 'undefined' && childFrames.length > 0){
        for (const frame of childFrames ){
            //console.log("[WC] Attempting to ADD form data from FRAMES. "); //, await frame.$$('form'))
            if (frame.isDetached()){
                console.log("\x1b[31mDETACHED FRAME \x1b[0m", frame.url());
                await re.page.reload();
            }
            requestsAdded += await re.addFormData(frame);
            requestsAdded += await re.addURLsFromPage(frame, parenturl);
        }
    }
    requestsAdded += await re.addFormData(page);
    requestsAdded += await re.addURLsFromPage(page, parenturl);

    //const bodynode = await page.$('html');
    //requestsAdded += await re.searchForInputs(bodynode);
    return requestsAdded;
}

const initpage = async(url, doingReload=false) => {
    console.log(`[+] initpage called (${url})`);

    // await page.keyboard.down('Escape');
    console.log(`[+] loading gremscript from local`);
    await page.addScriptTag({path: "../node_modules/gremlins.js/dist/gremlins.min.js"});

    re.isLoading = false;

    // await page.screenshot({path: '/p/tmp/screenshot-pre.png', type: "png"});

    await page.keyboard.down('Escape');

    re.requestsAdded += addDataFromBrowser(page, url);

    console.log('[+] adding hasClicker to elements')
    const elementHandles = await page.$$('div,li,span,a,input,p,button');
    for (let ele of elementHandles) {
        if (!doingReload){
            await ele.evaluate(node => node["hasClicker"] = "true");
        }
    }
    for (const frame of page.mainFrame().childFrames()) {
        const frElementHandles = await frame.$$('div,li,span,a,input,p,button');
        for (let ele of frElementHandles) {
            if (!doingReload){
                await ele.evaluate(node => node["hasClicker"] = "true");
            }
        }
    }
    console.log(`About to add code exercisers to page, u=${re.usernameValue} pw=${re.passwordValue}`);

    re.appData.addGremlinValue(re.usernameValue);
    re.appData.addGremlinValue(re.passwordValue);

    await addCodeExercisersToPage(doingReload, re.usernameValue, re.passwordValue);
    //await re.startCodeExercisers();
    return true;
}

const checkResponse = async(response, cururl) => {
    if(isDefined(response)) {
        // console.log("[WC] status = ", response.status(), response.statusText(), response.url());
        // only update status if current value is not 200
        if (re.appData.requestsFound[re.currentRequestKey].hasOwnProperty("response_status")) {
            if (re.appData.requestsFound[re.currentRequestKey]["response_status"] !== 200) {
                re.appData.requestsFound[re.currentRequestKey]["response_status"] = response.status();
            }
        } else {
            re.appData.requestsFound[re.currentRequestKey]["response_status"] = response.status();
        }

        if (response.headers().hasOwnProperty("content-type")) {
            re.appData.requestsFound[re.currentRequestKey]["response_content-type"] = response.headers()["content-type"];
        } else {
            if (!re.appData.requestsFound[re.currentRequestKey].hasOwnProperty("response_content-type")) {
                re.appData.requestsFound[re.currentRequestKey]["response_content-type"] = response.headers()["content-type"];
            }
        }
        if (response.status() >= 400) {
            console.log(`[WC] Received response error (${response.status()}) for ${cururl} `);
            return false;
        }
        //console.log(response);

        //console.log("response Headers = ", await response.headers());

        if (response.status() !== 200) {
            //console.log("[WC] ERROR status = ", response.status(), response.statusText(), response.url())
        }
        let responseText = await response.text();
        if (!isInteractivePage(response, responseText)) {
            console.log(`[WC] ${cururl} is not an interactive page, skipping`);
            return false;
        }
        if (responseText.length < 20) {
            console.log(`[WC] ${cururl} is too short of a page at ${responseText.length}, skipping`);
            return false;
        }
        if (responseText.toUpperCase().search(/<TITLE> INDEX OF /) > -1) {
            console.log("Index page, should disaable for fuzzing")
            re.appData.requestsFound[re.currentRequestKey]["response_status"] = 999;
            re.appData.requestsFound[re.currentRequestKey]["response_content-type"] = "application/dirlist";
        }
    } else {
        return false;
    }
    return true;
}

const setPageTimer = () => {
    if (re.pagetimeout){
        console.log('[+] Resetting Page Timeout')
        clearTimeout(re.pagetimeout);
    }
    re.pagetimeout = setTimeout(function(){
        console.log('[+] Page Timeout! Closing browser')
        try{
            re.browser_up = false;
            re.browser.close();
        } catch (err){
            console.error(`${RED} An error occurred while closing browser: ${ENDCOLOR}`)
        }
    }, re.actionLoopTimeout*1000 + 6000);
}

const hasGremlinResults = () => {
    return ("grandTotal" in re.gremCounter);
}

const addCodeExercisersToPage = async (gremlinsHaveStarted, usernameValue="", passwordValue="") => {
    await re.page.evaluate( (gremlinsHaveStarted, usernameValue, passwordValue)=> {
        window.gremlinsHaveFinished = false
        window.gremlinsHaveStarted = gremlinsHaveStarted;
        gremlinsHaveStarted = true;

        let formEntries = {}

        // 기본 window.alert 함수를 오버라이드하여 경고 대신 콘솔에 로그를 출력합니다.
        function overrideSelectNativeJS_Functions () {
            console.log("[WC] ---------------- OVERRIDING window.alert ------------------------------");
            window.alert = function alert (message) {
                console.log (message);
            }
        }


        function addJS_Node (text, s_URL, funcToRun) {
            let D = document;
            let scriptNode= D.createElement ('script');
            scriptNode.type = "text/javascript";
            if (text)       scriptNode.textContent  = text;
            if (s_URL)      scriptNode.src          = s_URL;
            if (funcToRun)  scriptNode.textContent  = '(' + funcToRun.toString() + ')()';

            let targ = D.getElementsByTagName ('head')[0] || D.body || D.documentElement;
            console.log(`[WC] Alert OVERRIDE attaching script to ${targ}`);
            targ.appendChild (scriptNode);
        }

        addJS_Node (null, null, overrideSelectNativeJS_Functions);
        if (usernameValue === ""){
            usernameValue = "Witcher";
        }
        if (passwordValue === ""){
            passwordValue = "Witcher";
        }
        console.log(`[WC] usernameValue = ${usernameValue} passwordValue = ${passwordValue}`);
        const CLICK_ELE_SELECTOR = "div,li,span,input,p,button";
        //const CLICK_ELE_SELECTOR = "button";
        let usedText = new Set();
        const STARTPAGE = window.location.href;
        const MAX_LEVEL = 10;

        let today = new Date();
        let dd = String(today.getDate()).padStart(2, '0');
        let mm = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
        let yyyy = today.getFullYear();

        let currentDateYearFirst = `${yyyy}-${mm}-${dd}`;
        let currentDateMonthFirst = `${mm}-${dd}-${yyyy}`;
        function shuffle(array) {
            let currentIndex = array.length, temporaryValue, randomIndex;

            // While there remain elements to shuffle...
            while (0 !== currentIndex) {

                // Pick a remaining element...
                randomIndex = Math.floor(Math.random() * currentIndex);
                currentIndex -= 1;

                // And swap it with the current element.
                temporaryValue = array[currentIndex];
                array[currentIndex] = array[randomIndex];
                array[randomIndex] = temporaryValue;
            }

            return array;
        }
        function getChangedDOM(domBefore, domAfter){
            let changedDOM = {};
            let index = 0
            for (let dbIndex of Object.keys(domBefore)){
                let db = domBefore[dbIndex];
                let found = false;
                for (let da of domAfter){
                    if (db === da){
                        found = true;
                        break;
                    }
                }
                if (!found){
                    changedDOM[index] = db;
                    index++;
                }

            }
            // if domAfter larger, then add entries if not in domBefore
            for (let daIndex=Object.keys(domBefore).length;daIndex < Object.keys(domAfter).length; daIndex++){
                let da = domAfter[daIndex];
                let found = false;
                for (let db of domBefore){
                    if (db === da){
                        found = true;
                        break;
                    }
                }
                if (!found){
                    changedDOM[index] = da;
                    index++;
                }
            }
            return changedDOM;
        }

        /**
         * cnt 만큼 들여쓰기를 합니다.
         * @param cnt {Number}   들여쓰기 횟수
         * @returns {string}    들여쓰기 문자열
         */
        function indent(cnt){
            let out = ""
            for (let x =0;x<cnt;x++){
                out += "  ";
            }
            return out;
        }


        /**
         * 페이지내에서 클릭 이벤트를 여러번 발생시키는 함수입니다.
         * @param elements  {NodeListOf<elements>}     클릭 이벤트를 발생시킬 엘리먼트들의 배열
         * @param level    {Number}    재귀호출 레벨
         * @param parentClicks  {Array}    부모 엘리먼트들의 배열
         * @returns {Promise<void>}
         */
        async function clickSpam(elements, level=0, parentClicks=[]){
            if (level >= MAX_LEVEL){
                console.log(`[WC] ${indent(level)} L${level} too high, skipping`);
                return;
            }
            //let randomArr = shuffle(Array.from(Object.values(elements)));
            let elementArr = Array.from(Object.values(elements));
            //console.log(`[WC] ${indent(level)} L${level} Starting cliky for ${randomArr.length} elements`);
            //t randomArr = Array.from(Object.values(elements));

            let mouseEvents = ["click","mousedown","mouseup"];
            let eleIndex = 0;
            let startingURL = location.href;
            let startingDOM = document.querySelectorAll(CLICK_ELE_SELECTOR);
            let frames = window.frames; // or // let frames = window.parent.frames;
            let frameurls = []  //
            if (frames){
                for (let i = 0; i < frames.length; i++) {
                    startingDOM = [... startingDOM, ...frames[i].document.querySelectorAll(CLICK_ELE_SELECTOR)];
                    frameurls.push(frames[i].location)
                }
            }
            function check_for_url_change_in_frames(frameurls) {
                let framediff = false;

                if (frames) {
                    for (let i = 0; i < frames.length; i++) {
                        if (frames[i].location !== frameurls[i]) {
                            framediff = true;
                            break;
                        }
                    }
                }
                return framediff;
            }
            function report_frame_changes(frameurls) {
                if (frames) {
                    for (let i = 0; i < frames.length; i++) {
                        if (frames[i].location !== frameurls[i]) {
                            console.log(`[WC] FOUND a change to frame ${i}`, frames[i].location.href);
                            console.log(`[WC-URL] ${frames[i].location}` ); // report changed location to puppeteer
                        }
                    }
                }
            }

            for (let eleIndex =0; eleIndex < elementArr.length; eleIndex++){
                let ele = elementArr[eleIndex];
                let textout = ele.textContent.replaceAll("\n",",").replaceAll("  ", "")

                //console.log(`[WC] ${indent(level)} L${level} attempt to click on e#${eleIndex} of ${randomArr.length} : ${textout.length} ${textout.substring(0,50)}`);
                try {
                    if (ele.href != null){
                        console.log(`${indent(level)} L${level} FOUND URL of ${ele.href}`)
                        // TODO: IGNORING URL 확인 (witcher가 테스트 할 때 사용)
                        if (ele.href.indexOf("support.dlink.com") !== -1){
                            console.log(`[WC] IGNORING url of FOUND URL of ${ele.href}`)
                            continue;
                        }
                    }

                    let searchText="";
                    if (ele.outerHTML != null) {
                        searchText += ele.outerHTML;
                    }
                    if (ele.innerHTML != null) {
                        searchText += ele.innerHTML;
                    }
                    if (ele.textContent != null) {
                        searchText += ele.textContent;
                    }

                    //console.log(`ele id=${ele.id} name=${ele.name}`)
                    if (usedText.has(ele.innerHTML) ){
                        //console.log("[WC] SKIPPING B/C IT'found in usedText, ");
                        continue;
                        //return;  // not sure why it was a return that's causing it to exit the entire thing
                    }
                    let pos = searchText.indexOf("Logout");
                    if (pos > -1 ){
                        console.log("[WC] SKIPPING B/C IT's a logout, ", ele.textContent);
                        continue;
                    }

                    try {
                        ele.disabled = false;
                    } catch (ex){
                        //pass
                        console.log("[WC] ERROR WITH THE ELEMENTS CLICKING : ", ex.stack);
                    }

                    try {

                        /**
                         * 주어진 요소에 마우스 클릭을 발생시키는 역할을 합니다.
                         * @param node    {HTMLElement}   마우스 클릭을 발생시킬 대상 DOM 요소
                         * @param eventType {String}    발생시킬 마우스 이벤트 타입
                         */
                        function triggerMouseEvent (node, eventType) {
                            if (level > 1){
                                console.log(`[WC] ${indent(level)} L${level} ${indent(level)} L${level} triggering on ${node.textContent}`)
                            }

                            usedText.add(node.innerHTML);   // 이미 클릭한 요소를 추적하기 위해 사용
                            let clickEvent = document.createEvent ('MouseEvents');
                            clickEvent.initEvent (eventType, true, true);
                            node.dispatchEvent (clickEvent);
                            if(typeof node.click === 'function') {  // 클릭 가능한 요소인지 확인 후 클릭
                                try {
                                    node.click()
                                } catch (ex){
                                    console.log(`[WC] ${indent(level)} L${level} click method threw an error ${ex}`);
                                }
                            }
                        }

                        for (let ev of mouseEvents) {
                            //console.log("mouse event = ", ev);
                            let mainurl = window.location.href;
                            let hiddenChildren = [];
                            for (let clickablechild of startingDOM) {
                                if (clickablechild.offsetParent === null){
                                    hiddenChildren.push(clickablechild)
                                }
                            }

                            triggerMouseEvent (ele, ev);

                            await sleep(50);

                            let mainurl_changed = mainurl !== window.location.href
                            if (mainurl_changed || check_for_url_change_in_frames(frameurls)) {
                                // bubble up URL for change
                                if (mainurl_changed) {
                                    console.log(`[WC] ${indent(level)} L${level} FOUND a change to main frame `, mainurl, window.location.href);
                                    console.log(`[WC-URL]${window.location.href}`);
                                } else {
                                    report_frame_changes(frameurls)
                                }
                                // reload main frame
                                await window.location.replace(mainurl); // fix : main -> mainurl로 수정
                                // retrigger parents after reload to show the children
                                for (let pc of parentClicks) {
                                    //console.log (`[WC] ${indent(level)} retriggering ${pc.textContent}`);
                                    triggerMouseEvent(pc, "click");
                                }
                            }

                            let curDOM = document.querySelectorAll(CLICK_ELE_SELECTOR);
                            if (frames) {
                                for (let i = 0; i < frames.length; i++) {
                                    curDOM = [... curDOM, ...frames[i].document.querySelectorAll(CLICK_ELE_SELECTOR)];
                                }
                            }
                            let newlyVisibleLinks = []
                            for (let child of hiddenChildren){
                                if (child.offsetParent !== null){
                                    try {
                                        let newvislinks = ""
                                        for (let subc of child.querySelectorAll(CLICK_ELE_SELECTOR)) {
                                            if (subc.offsetParent === null){
                                                newvislinks += subc.textContent + ", ";
                                            }
                                        }
                                        if (newvislinks.length === 0 ){
                                            newvislinks = child.textContent.replace("\n",",").replace(" ","");
                                        }
                                        console.log(`[WC] ${indent(level)} L${level} after clicking on ${ele.textContent} adding newly visible link ${newvislinks} `);

                                    } catch (eex){
                                        console.log("[WC] Error with finding newly visible link ", eex.stack);
                                    }
                                    newlyVisibleLinks.push(child);
                                }
                            }
                            if (newlyVisibleLinks.length > 0){
                                console.log(`[WC] ${indent(level)} L${level} click on ${ele.textContent} showed ${newlyVisibleLinks.length} new links, recursing the new links`);
                                parentClicks.push(ele);
                                await clickSpam(newlyVisibleLinks, level+1, parentClicks)
                            }

                            // have we added any clickable items that we need to now clicky?
                            if (Object.keys(curDOM).length !== Object.keys(startingDOM).length && Object.keys(curDOM).length > 0){
                                console.log(`[WC] maybe some difference here`)
                                let changedDOM = getChangedDOM(startingDOM, curDOM);
                                console.log(`[WC] ${indent(level)} ${level} starting len = ${Object.keys(elements).length} cur len = ${Object.keys(curDOM).length} changed len=${Object.keys(changedDOM).length}`);
                                parentClicks.push(ele);
                                console.log(`[WC] ${indent(level)} L${level} recursing into the next level of ${ele.textContent}`);
                                await clickSpam(changedDOM, level+1, parentClicks);
                                location.href = startingURL;
                                break;
                            }
                        }
                        await sleep(50);


                    } catch(e2){
                        console.trace("[WC] NO CLICK, ERROR ", e2.message);
                        if (e2.stack){
                            console.log("[WC] ", e2.stack);
                        } else {
                            console.log("[WC] Stack is unavailable to print");
                        }

                    }
                } catch (e){
                    console.trace("[WC] ERROR WITH THE ELEMENTS CLICKING ", e.message);
                    if (e.stack){
                        console.log("[WC] ", e.stack);
                    } else {
                        console.log("[WC] Stack is unavailable to print");
                    }
                }

            } //end for loop eleIndex
        }

        /**
         * Gremlins.js 가 브라우저에 로드되었는지 확인하는 함수입니다
         * @returns {Promise<void>}
         */
        async function checkHordeLoad(){
            if (typeof window.gremlins === 'undefined') {
                console.log("로컬 Gremlins.js를 로드할 수 없습니다. 웹을 통해 Gremlins.js를 로드합니다.");
                (function (d, script) {
                    script = d.createElement('script');
                    script.type = 'text/javascript';
                    script.async = true;
                    script.onload = function () {
                        // remote script has loaded
                    };
                    script.src = 'https://trickel.com/gremlins.min.js';
                    //script.src = 'https://unpkg.com/gremlins.js';
                    d.getElementsByTagName('head')[0].appendChild(script);
                }(document));
            }
        }
        async function repeativeHorde(){
            let all_submitable =  [...document.getElementsByTagName("form"),
                ...document.querySelectorAll('[type="submit"]')];

            //let randomArr = shuffle(all_submitable);
            let randomArr = all_submitable;

            for(let i = 0; i < all_submitable.length; i++) {
                let submitable_item = randomArr[i];
                if(typeof submitable_item.submit === 'function') {
                    submitable_item.submit();
                } else if(typeof submitable_item.requestSubmit === 'function') {
                    try{
                        submitable_item.requestSubmit();
                    } catch (e){
                        console.trace(`[WC] Error while trying to request submit`);
                        console.log(e.stack)
                    }
                }
                if(typeof submitable_item.click === 'function') {
                    submitable_item.click()
                }
            }
        }

        /**
         * 문서 내의 모든 <form> 요소를 찾아서 제출(submit)하는 역할을 합니다.
         * @param doc   {Document}  문서 객체
         * @returns {Promise<void>}
         */
        async function submitForms(doc) {
            let pforms = doc.getElementsByTagName("form");
            for (let i = 0; i < pforms.length; i++) {
                let frm = pforms[i];
                if (typeof frm.submit === 'function') {
                    console.log("[ExerciseTarget] Submitting form ", frm.name);
                    frm.submit();
                } else if (typeof frm.submit === 'undefined') {
                    console.log("[ExerciseTarget] lameHorde: The method submit of ", frm, "is undefined");
                } else {
                    //console.log("[WC] lameHorde: It's neither undefined nor a function. It's a " + typeof frm.submit, frm);
                }
            }
        }

        /**
         * Gremlins.js의 하위 버전을 개발한 LameHorde를 실행하는 함수입니다.
         * @returns {Promise<void>}
         */
        async function lameHorde(){
            console.log("[WC] Searching and clicking.");
            window.alert = function(message) {/*console.log(`Intercepted alert with '${message}' `)*/};

            let all_elements = document.querySelectorAll(CLICK_ELE_SELECTOR);  //
            let frames = window.frames; // or // let frames = window.parent.frames;
            if (frames){
                console.log(`[WC] FOUND ${all_elements.length} elements to attempt to click in main `);
                for (let i = 0; i < frames.length; i++) {
                    all_elements = [... all_elements, ...frames[i].document.querySelectorAll(CLICK_ELE_SELECTOR)];
                }
            }
            for (let ele of document.querySelectorAll("iframe")){
                all_elements = [...all_elements, ...ele.contentWindow.document.querySelectorAll(CLICK_ELE_SELECTOR) ];
            }

            console.log(`[WC] FOUND after FRAMES ${all_elements.length} elements to attempt to click in main `);

            function hashChangeEncountered(){
                alert('got hashchange');
            }
            window.addEventListener("hashchange", hashChangeEncountered);

            let filter   = Array.prototype.filter;
            let clickableElements = filter.call( all_elements, function( node ) {
                if (node.hasOwnProperty("href") && node.href.startsWith("http")){
                    return false;
                }
                return node.hasOwnProperty('hasClicker');
            });
            console.log("[WC] clicky  DOM elements count = ", clickableElements.length);

            //await clickSpam(clickableElements);
            await clickSpam(all_elements);

            await submitForms(document);

            if (frames){
                for (let i = 0; i < frames.length; i++) {
                    console.log(`[WC] Submit forms ${frames[i].location.href}`)
                    await submitForms(frames[i].document);
                }
            }

            //
            console.log(`[WC] lamehorde is done.`);
            clearTimeout(checkHordeLoad)
            clearTimeout(coolHorde);
            await checkHordeLoad();
            setTimeout(coolHorde, 1000);

        }
        async function triggerHorde(){
            try{
                let select_elems = document.querySelectorAll("select");
                for (let i = 0; i < select_elems.length; i++) {
                    let event = new Event('change');
                    select_elems[i].dispatchEvent(event);
                    await sleep(100);
                    select_elems[i].selectedIndex = 1
                }
            } catch (ex){
                console.trace(`ERROR with selecting either change or selected Index in triggerHorde() ${ex}`)
                console.log(ex.stack)
            }
        }
        const triggerSimulatedOnChange = (element, newValue, prototype) => {
            const lastValue = element.value;
            element.value = newValue;

            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
            nativeInputValueSetter.call(element, newValue);
            const event = new Event('input', { bubbles: true });

            // React 15
            event.simulated = true;
            // React >= 16
            let tracker = element._valueTracker;
            if (tracker) {
                tracker.setValue(lastValue);
            }
            element.dispatchEvent(event);
        };

        const fillTextAreaElement = (element) => {
            let rnd =  Math.random();
            let value = "2";
            if (rnd > 0.7){
                value = "Witcher";
            } else if (rnd > 0.3) {
                value =  "127.0.0.1";
            }
            triggerSimulatedOnChange(element, value, window.HTMLTextAreaElement.prototype);

            return value;
        };
        const fillNumberElement = (element) => {
            const number = randomizer.character({ pool: '0123456789' });
            const newValue = element.value + number;
            triggerSimulatedOnChange(element, newValue, window.HTMLInputElement.prototype);

            return number;
        };
        const fillSelect = (element) => {
            const options = element.querySelectorAll('option');
            if (options.length === 0) return;
            const randomOption = randomizer.pick(options);
            options.forEach((option) => {
                option.selected = option.value === randomOption.value;
            });

            let event = new Event('change');
            element.dispatchEvent(event);

            return randomOption.value;
        };
        const fillRadio = (element) => {
            // using mouse events to trigger listeners
            const evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('click', true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
            element.dispatchEvent(evt);

            return element.value;
        };
        const fillCheckbox = (element) => {
            // using mouse events to trigger listeners
            const evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('click', true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
            element.dispatchEvent(evt);

            return element.value;
        };
        const fillEmail = (element) => {
            const email = "test@test.com";
            triggerSimulatedOnChange(element, email, window.HTMLInputElement.prototype);

            return email;
        };
        const fillTextElement = (element) => {
            if (!element){
                console.log('[*] fillTextElement : Element is null')
                return 0;
            }
            let oldDateYearFirst = "1998-10-11";
            let oldDateMonthFirst = "11-12-1997";

            let rnd =  Math.random()
            let current_value = element.value;
            let desc = element.id;
            if (!desc){
                desc = element.name;
            }
            // let's leave it the default value for a little while.
            if (current_value && current_value > "" && desc > ""){
                if (desc in formEntries){
                    if (formEntries[desc]["inc"] < 5){
                        formEntries[desc]["inc"] += 1;
                        return current_value;
                    }
                } else {
                    formEntries[desc] = {origingal_value: current_value, inc:1};
                    return current_value;
                }
            }

            let value = "2";

            if (rnd > .2 && element.placeholder && (element.placeholder.match(/[Yy]{4}.[Mm]{2}.[Dd]{2}/) || element.placeholder.match(/[Mm]{2}.[Dd]{2}.[Yy]{4}/))){
                let yearfirst = element.placeholder.match(/[Yy]{4}(.)[Mm]{2}.[Dd]{2}/);
                let sep = "-";
                if (yearfirst)
                    sep = yearfirst[1]
                else {
                    let monthfirst = element.placeholder.match(/[Mm]{2}(.)[Dd]{2}.[Yy]{4}/)
                    if (monthfirst){
                        sep = monthfirst[1];
                    } else {
                        console.log("[WC] this should never occur, couldn't find the separator, defaulting to -")
                    }
                }

                if (element.placeholder.match(/[Yy]{4}.[Mm]{2}.[Dd]{2}/)) {
                    value = rnd > .8 ? currentDateYearFirst.replace("-",sep) : oldDateYearFirst.replace("-",sep);
                } else if (element.placeholder.match(/[Mm]{2}.[Dd]{2}.[Yy]{4}/)){
                    value = rnd > .8 ? currentDateMonthFirst.replace("-",sep) : oldDateMonthFirst.replace("-",sep);
                }
            } else if (rnd > .5 && element.name && (element.name.search(/dob/i) !== -1 || element.name.search(/birth/i) !== -1 )){
                value = rnd > .75 ? oldDateMonthFirst : oldDateYearFirst;
            } else if (rnd > .5 && element.name && (element.name.search(/date/i) !== -1)){
                value = rnd > .75 ? currentDateMonthFirst : currentDateYearFirst;
            } else if (rnd > .5 && element.name && (element.name.search(/time/i) !== -1)){
                value = element.name.search(/start/i) !== -1 ? "8:01" : "11:11";
            } else if (rnd > 0.4) {
                value = "127.0.0.1";
            } else if (rnd > .3){
                value = usernameValue.substring(0,1) + "'" + usernameValue.substring(2);
            } else if (rnd > 0.2) {
                value = value = rnd > .35 ? currentDateYearFirst : oldDateYearFirst;
            } else if (rnd > 0.1) {
                value = rnd > .45 ? currentDateYearFirst : oldDateYearFirst;
            } else if (rnd > 0.0){
                value = current_value;
            }
            element.value = value;
            if (Math.random() > 0.80){
                repeativeHorde();
            }
            return value;
        };
        const fillPassword = (element) => {
            let rnd =  Math.random()
            if (rnd < 0.8) {
                element.value = passwordValue;
            } else {
                element.value = passwordValue.replace("t","'");
            }
            return element.value;
        };
        const clickSub = (element) => {
            element.click();
            return element.value
        }
        async function coolHorde(){
            let noChance = new gremlins.Chance();
            noChance.character = function(options) {
                if (options != null){
                    return "2";
                } else {
                    let rnd =  Math.random()
                    if (rnd > 0.7){
                        return usernameValue;
                    } else if (rnd > 0.3){
                        return "127.0.0.1";
                    } else {
                        return "2"
                    }
                }
            };

            if (!gremlinsHaveStarted ){
                console.log("[WC] UNLEASHING Horde for first time!!!");
            }
            window.gremlinsHaveStarted = true;
            let ff = window.gremlins.species.formFiller({elementMapTypes:wFormElementMapTypes, randomizer:noChance});
            const distributionStrategy = gremlins.strategies.distribution({
                distribution: [0.80, 0.15, 0.05], // the first three gremlins have more chances to be executed than the last
                delay: 20,
            });

            for (let i =0; i < 5; i ++){
                console.log("[WC] Form Horde away!")
                await gremlins.createHorde({
                    species: [ff],
                    mogwais: [gremlins.mogwais.alert(),gremlins.mogwais.gizmo()],
                    strategies: [gremlins.strategies.allTogether({ nb: 1000 })],
                    randomizer: noChance
                }).unleash();
                await gremlins.createHorde({
                    species: [gremlins.species.clicker(),ff, gremlins.species.scroller()],
                    mogwais: [gremlins.mogwais.alert(),gremlins.mogwais.gizmo()],
                    strategies: [distributionStrategy],
                    randomizer: noChance
                }).unleash();
                try{
                    await gremlins.createHorde({
                        species: [gremlins.species.clicker(), gremlins.species.typer()],
                        mogwais: [gremlins.mogwais.alert(),gremlins.mogwais.gizmo()],
                        strategies: [gremlins.strategies.allTogether({ nb: 1000 })],
                        randomizer: noChance
                    }).unleash();
                } catch (e){
                    console.log(`\x1b[38;5;8m${e}\x1b[0m`);
                }
            }
            window.gremlinsHaveFinished = true
            clearInterval(repeativeHorde);
            clearInterval(triggerHorde);
        }

        let wFormElementMapTypes = {
            textarea: fillTextAreaElement,
            'input[type="text"]': fillTextElement,
            'input[type="password"]': fillPassword,
            'input[type="number"]': fillNumberElement,
            select: fillSelect,
            'input[type="radio"]': fillRadio,
            'input[type="checkbox"]': fillCheckbox,
            'input[type="email"]': fillEmail,
            'input[type="submit"]' : clickSub,
            'button' : clickSub,
            'input:not([type])': fillTextElement,
        }

        let randomizer = new gremlins.Chance(); // 난수 생성

        try {
            if (gremlinsHaveStarted) {
                console.log("[WC] Restarted Page -- going with Gremlins only")
                if (typeof window.gremlins === 'undefined') {
                    setTimeout(checkHordeLoad, 3500);
                    setTimeout(coolHorde, 4000);
                } else {
                    coolHorde();
                }
            } else {
                console.log("[WC] Initial Page Test -- using lameHorde then coolHorde")
                setTimeout(lameHorde, 2000);
                setTimeout(checkHordeLoad, 19000);
                setTimeout(coolHorde, 20000);
            }

            function hc() {
                console.log(`[WC] Detected HASH CHANGE, replacing ${window.location.href} with ${STARTPAGE}`);
                window.location.replace(STARTPAGE);
            }

            window.onhashchange = hc
        } catch (e){
            console.log("[WC] Error occurred in browser", e)
        }
    }, gremlinsHaveStarted, usernameValue, passwordValue);
}

export const ExerciseTarget = async (RequestExplorer) => {
    re = RequestExplorer
    page = RequestExplorer.page
    re.setRequestAdded(0);
    let errorThrown = false;
    let clearURL = false;

    setPageTimer();

    let url = re.url;

    if (re.appData.ignoreEndpoints.includes(url)) {
        console.log(`[*] Gremlins Test : Ignoring endpoint ${url.href}`);
        return;
    }

    let shortname = "";
    if (url.href.indexOf("/") > -1) {
        shortname = path.basename(url.pathname);
    }
    let options = {timeout: 20000, waituntil: "networkidle2"};
    let madeConnection = false;
    await page.on('dialog', async dialog => {
        console.log(`[WC] Dismissing Message(1): ${dialog.message()}`);
        await dialog.dismiss();
    });

    // 페이지 로드를 최대 3번까지 시도 후 실패하면 종료
    for (let i=0;i<3;i++){
        try {
            let response = "";
            re.isLoading = true;

            if (clearURL){
                response = await page.reload(options);
                let turl = await page.url();
                console.log("Reloading page ", turl);
            } else {
                let request_page =url.origin + url.pathname
                // console.log("GOING TO requested page =", request_page );
                console.log("GOING TO requested page =", url.href );
                response = await page.goto(url.href, options);
            }

            await page.on('dialog', async dialog => {
                console.log(`[WC] Dismissing Message(2): ${dialog.message()}`);
                await dialog.dismiss();
            });

            let response_good = await checkResponse(response, page.url());

            if (response_good){
                madeConnection = await initpage(url);
            }
            break; // connection successful
        } catch (e) {
            console.log(`${RED}[-] Browser can't connect to : ${url.href}${ENDCOLOR}`);
            console.log('Retrying...' + (i + 1) + ' of 3');
            // console.log(e.stack);
        }
    }
    if (!madeConnection){
        console.log(`${RED}[-] Browser can't connect to : ${url.href}${ENDCOLOR}`);
        console.log(`${RED}[-] Exiting...${ENDCOLOR}`);
        return;
    }

    let lastGT=0, lastGTCnt=0, gremCounterStr="";
    try {
        let errorLoopcnt = 0;
        for (let cnt=0; cnt < re.timeoutLoops;cnt++){
            setPageTimer();
            if (!re.browser_up){
                console.log(`[WC] Browser is not available, exiting timeout loop`);
                break;
            }
            console.log(`[WC] Starting timeout Loop #${cnt+1} `);
            let roundResults = re.getRoundResults();
            if (page.url().indexOf("/") > -1) {
                shortname = path.basename(page.url());
            }
            let processedCnt = 0;
            if (re.currentRequestKey in re.appData.requestsFound){
                processedCnt = re.appData.requestsFound[re.currentRequestKey]["processed"];
            }
            if (typeof re.requestsAdded === "string"){
                re.requestsAdded = parseInt(re.requestsAdded);
            }
            let startingReqAdded = re.requestsAdded;
            re.requestsAdded += await addDataFromBrowser(page, url);
            if (cnt % 10 === 0){
                // console.log(`[WC] W#${re.workernum} ${shortname} Count ${cnt} Round ${re.appData.currentURLRound} loopcnt ${processedCnt}, added ${re.requestsAdded} reqs : Inputs: ${roundResults.totalInputs}, (${roundResults.equaltoRequests}/${roundResults.totalRequests}) reqs left to process ${gremCounterStr}`);
            }
            let pinfo = re.browser.process();
            if (isDefined(pinfo) && pinfo.killed){
                console.log("Breaking out from test loop b/c BROWSER IS DEAD....")
                break;
            }
            // if new requests added on last passs, then keep going
            if (startingReqAdded < re.requestsAdded){
                cnt = (cnt > 3) ? cnt-3: 0;
            }

            const now_url = await page.url();
            const this_url = re.url.href
            if (re.reinitPage){
                madeConnection = await initpage(url, true);
                re.reinitPage = false;
            }
            if (now_url !== this_url){
                //console.log(`[WC] Attempting to reload target page b/c browser changed urls ${this_url !== now_url} '${re.url}' != '${now_url}'`)
                re.isLoading = true;
                let response = "";
                try{
                    response = await page.goto(re.url, options);
                } catch (e2){
                    console.log(`trying ${re.url} again`)
                    response =  await page.goto(re.url, options);
                }

                let response_good = await checkResponse(response, page.url());

                if (response_good){
                    madeConnection = await initpage(url, true);
                }
                re.isLoading = false;
            }

            await page.waitForTimeout(re.timeoutValue*1000);
            let gremlinsHaveFinished = false;
            let gremlinsHaveStarted = false;
            let gremlinsTime = 0;
            try{
                gremlinsHaveFinished = await page.evaluate(()=>{return window.gremlinsHaveFinished;});
                gremlinsHaveStarted = await page.evaluate(()=>{return window.gremlinsHaveStarted;});
                console.log(`FIRST: gremlinsHaveStarted = ${gremlinsHaveStarted} gremlinsHaveFinished = ${gremlinsHaveFinished} browser_up=${re.browser_up} gremlinsTime=${gremlinsTime}`);
                // the idea, is that we will keep going as long as gremlinsTime gets reset before 30 seconds is up
                while (!gremlinsHaveFinished && re.browser_up && gremlinsTime < 30){
                    let currequestsAdded = re.requestsAdded;
                    console.log(`LOOP: gremlinsHaveStarted = ${gremlinsHaveStarted} gremlinsHaveFinished = ${gremlinsHaveFinished} browser_up=${re.browser_up}  gremlinsTime=${gremlinsTime}`);
                    await(sleep(3000));
                    gremlinsHaveFinished = await page.evaluate(()=>{return window.gremlinsHaveFinished;});
                    gremlinsHaveStarted = await page.evaluate(()=>{return window.gremlinsHaveStarted;});
                    if (typeof(gremlinsHaveFinished) === "undefined" || gremlinsHaveFinished === null){
                        console.log("[WC] attempting to reinet client scripts");
                        await initpage(url, true);
                    }
                    if (gremlinsHaveStarted) {
                        gremlinsTime += 3;
                    }
                    if (currequestsAdded !== re.requestsAdded){
                        setPageTimer();
                        gremlinsTime = 0;
                        console.log("[WC] resetting timers b/c new request found")
                    }
                    await page.evaluate((ignoreEndpoints) => {
                        document.addEventListener('click', (e) => {
                            const clickedUrl = e.target.href;

                            // Check if the clicked URL contains any of the ignored endpoints
                            if (ignoreEndpoints.some((endpoint) => clickedUrl.includes(endpoint))) {
                                e.preventDefault(); // Prevent the default click behavior
                                e.stopPropagation(); // Stop the click event propagation
                                console.log(`Blocked click to: ${clickedUrl}`);
                            }
                        });
                    }, re.appData.ignoreEndpoints);

                }
            } catch (ex){
                console.log("Error occurred while checking gremlins, restarting \nError Info: ", ex);
                errorLoopcnt ++;
                if (errorLoopcnt < 10){
                    continue;
                } else {
                    console.log("\x1b[38;5;1mToo many errors encountered, breaking out of test loop.\x1b[0m");
                    break;
                }
            }
            console.log(`DONE with waiting for gremlins:: gremlinsHaveStarted = ${gremlinsHaveStarted} gremlinsHaveFinished = ${gremlinsHaveFinished} browser_up=${re.browser_up}  gremlinsTime=${gremlinsTime}`);

            if (hasGremlinResults()) {
                if (lastGT === re.gremCounter["grandTotal"]){
                    lastGTCnt++;
                } else {
                    lastGTCnt = 0;
                }
                gremCounterStr = `Grems total = ${re.gremCounter["grandTotal"]}`;
                lastGT = re.gremCounter["grandTotal"];
                if (lastGTCnt > 3){
                    console.log("Grand Total the same too many times, exiting.");
                    break
                }
            }
        }
    } catch (e) {
        console.log(`Error: Browser cannot connect to ${url.href}`);
        console.log(e.stack);
        errorThrown = true;

    }
    // Will reset :
    //   If added more than 10 requests (whether error or not), re catches the situation when
    //     we added so many requests it caused a timeout.
    //   OR IF only a few urls were added but no error was thrown
    if (re.requestsAdded > 10 || (errorThrown===false && re.requestsAdded > 0)){
        re.appData.resetRequestsAttempts(re.currentRequestKey);
    }

}