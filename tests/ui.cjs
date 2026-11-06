// Browser UI regression checks with explicit network fixtures; no real AI/API success is claimed.
const {chromium}=require('playwright');const fs=require('fs');const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const assets=process.env.LEAFLET_ASSET_DIR || '/workspace/design-tools';
const out=process.env.TEST_OUTPUT_DIR || '/tmp/mushiyoke-ui';fs.mkdirSync(out,{recursive:true});
const context=await browser.newContext({viewport:{width:375,height:812},geolocation:{latitude:35.6812,longitude:139.7671},permissions:['geolocation']});
let failRoute=false,aiFail=false,single=false, count=0; const errors=[];const page=await context.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',async route=>{const u=route.request().url();if(u.startsWith(base)){if(u.includes('/api/recommend'))return route.fulfill({status:aiFail?502:200,json:aiFail?{error:'テスト用の接続失敗'}:{text:'おすすめ：Aルート。比較的リスクが低い候補です。'}});return route.continue();}
if(u.includes('leaflet.min.js'))return route.fulfill({body:fs.readFileSync(assets+'/leaflet.js'),contentType:'text/javascript'});
if(u.includes('leaflet.min.css'))return route.fulfill({body:fs.readFileSync(assets+'/leaflet.css'),contentType:'text/css'});
if(u.includes('nominatim'))return route.fulfill({json:u.includes('polygon_geojson')?[]:[{lat:decodeURIComponent(u).includes('東京')?'35.6812':'35.674',lon:decodeURIComponent(u).includes('東京')?'139.7671':'139.76',name:decodeURIComponent(u).includes('東京')?'東京駅':'日比谷公園',display_name:'テスト地点, 東京'}]});
if(u.includes('routed-foot')){if(failRoute)return route.fulfill({status:503,json:{}});count++;const d=single?0:(count%3)*.003;return route.fulfill({json:{code:'Ok',routes:[{geometry:{coordinates:[[139.7671,35.6812],[139.762+d,35.68-d],[139.76,35.674]]}}]}});}
if(u.includes('open-meteo'))return route.fulfill({json:{current:{temperature_2m:21,relative_humidity_2m:60},hourly:{time:[],precipitation:[]}}});
if(u.includes('overpass'))return route.fulfill({json:{elements:[]}});return route.fulfill({status:200,body:'',contentType:u.includes('fonts')?'text/css':'image/png'});});
await page.goto(base);await page.waitForFunction(()=>!!document.querySelector('.leaflet-pane'));
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:out+'/mobile-initial.png'});
console.log('initial');await page.locator('#settingsBtn').click();await page.waitForTimeout(250);await page.locator('#filter button').first().click();assert.equal(await page.locator('#sheet').getAttribute('data-size'),'expanded');await page.locator('#sheetToggle').click();
console.log('settings');await page.locator('#qStart').fill('東京駅');await page.locator('#qGoal').fill('日比谷公園');await page.locator('#goBtn').click();console.log('search clicked');await page.waitForSelector('.route');console.log('results');assert.ok(await page.locator('.route').count()>=1);assert.equal(await page.locator('#goBtn').isEnabled(),true);
await page.screenshot({path:out+'/mobile-results.png'});
const cards=await page.locator('.route').count();if(cards>1){await page.locator('.route').nth(1).click();assert.equal(await page.locator('.route').nth(1).getAttribute('aria-pressed'),'true');}
await page.locator('#sheetToggle').click();await page.locator('#ask').scrollIntoViewIfNeeded();await page.locator('#ask').click();await page.waitForFunction(()=>document.querySelector('#aiLabel').textContent==='Geminiのおすすめ');
aiFail=true;
await page.locator('#ask').click();await page.waitForFunction(()=>document.querySelector('#ask').textContent.includes('もう一度'));await page.screenshot({path:out+'/mobile-ai-error.png'});
await page.locator('#themeBtn').click();await page.screenshot({path:out+'/mobile-dark.png'});
await page.locator('#sheetToggle').click();failRoute=true;await page.locator('#qGoal').fill('別の場所');await page.locator('#goBtn').click();await page.waitForFunction(()=>document.querySelector('#statusText').textContent.includes('見つけられません'));assert.equal(await page.locator('.route').count(),cards);
await page.setViewportSize({width:1280,height:900});await page.locator('#themeBtn').click();await page.screenshot({path:out+'/desktop.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.setViewportSize({width:768,height:812});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
await page.setViewportSize({width:375,height:812});await page.locator('#sheetToggle').click();await page.locator('#resetBtn').click();
failRoute=false;single=true;await page.locator('#locBtn').click();await page.waitForFunction(()=>document.querySelector('#qStart').value==='現在地');await page.mouse.click(185,475);await page.waitForSelector('.route');
assert.equal(await page.locator('.route').count(),1);console.log('PASS geolocation, map tap and single candidate');
await page.locator('#sheetToggle').click();await page.locator('#settings').evaluate(el=>el.open=true);await page.locator('#filter button').first().scrollIntoViewIfNeeded();
const before=await page.locator('.leaflet-overlay-pane path').first().getAttribute('d');await page.locator('#filter button').first().click();assert.equal(await page.locator('.leaflet-overlay-pane path').first().getAttribute('d'),before);console.log('PASS condition change retains geometry');
await page.setViewportSize({width:768,height:812});await page.waitForTimeout(300);assert.ok(await page.evaluate(()=>document.querySelector('#sheet').getBoundingClientRect().top>=document.querySelector('.search-header').getBoundingClientRect().bottom));console.log('PASS desktop panels do not overlap');
assert.deepEqual(errors,[]);console.log('PASS initial/search/cards/conditions/AI success+retry/failure retention/themes/375+768+1280 layouts; routes='+cards);await browser.close();})().catch(e=>{console.error(e);process.exit(1)});
