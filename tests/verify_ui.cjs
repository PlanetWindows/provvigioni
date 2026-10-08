/* Local or deployed UI verification. Pass private credentials JSON, then optionally the site URL. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const credentials = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).accounts;
const base = process.argv[3] || 'http://127.0.0.1:4173/';
const scratch = process.env.PW_TEST_OUTPUT || '/workspace/scratch/d1fdfff43080';
const executable = process.env.PW_CHROMIUM || '/workspace/scratch/d1fdfff43080/testing-browser/chrome-headless-shell-linux64/chrome-headless-shell';
const suffix = Date.now().toString(36);
const testCode = 'QA-UI-' + suffix;
let browser;
let officePage;
let temporaryAccount;
let migratedUid;
const pageErrors = [];
const contexts = [];

async function context(viewport) {
  const c = await browser.newContext({ ignoreHTTPSErrors: true, viewport });
  contexts.push(c);
  if (base.startsWith('http://127.0.0.1:4173')) {
    // Each executor has its own network namespace; serve local source by interception.
    await c.route(base + '**', async route => {
      let target = new URL(route.request().url()).pathname;
      if (target === '/') target = '/index.html';
      await route.fulfill({ path: path.join(__dirname, '..', target),
        contentType: target.endsWith('.js') ? 'application/javascript' : target.endsWith('.css') ? 'text/css' : 'text/html' });
    });
  }
  const page = await c.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(base);
  return page;
}
async function login(page, cred) {
  await page.fill('#loginUsername', cred.username);
  await page.fill('#loginPassword', cred.password);
  await page.click('#loginButton');
  await page.waitForFunction(() => !document.getElementById('appRoot').hidden, undefined, { timeout: 45000 });
}
async function online(page) { await page.evaluate(() => loadOnline()); }

(async () => {
  const proxyURL = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  browser = await chromium.launch({ headless: true, executablePath: executable, args: ['--no-sandbox'],
    ...(proxyURL ? { proxy: { server: new URL(proxyURL).origin } } : {}) });
  try {
    officePage = await context({ width: 1440, height: 900 });
    assert(await officePage.locator('#loginPanel').isVisible());
    assert(!(await officePage.locator('#appRoot').isVisible()));
    const legacy = await officePage.evaluate(({ code }) => {
      const p = { id: code, _uid: crypto.randomUUID(), client: 'Verifica recupero dati', agent: 'Adrian Dobrea',
        option: 'A', status: 'Chiusa', close: '8500', services: '1800', discount: '10', notes: 'Verifica temporanea' };
      localStorage.setItem('pw_provvigioni_v1', JSON.stringify([p]));
      localStorage.setItem('pw_provvigioni_rules_v1', JSON.stringify(DEFAULT_RULES));
      return p;
    }, { code: testCode });
    const office = credentials.find(a => a.role === 'office');
    await login(officePage, office);
    assert(await officePage.locator('#accountsNav').isVisible());
    assert(await officePage.locator('#legacyBanner').isVisible());
    await officePage.click('#migrateButton');
    await officePage.waitForFunction(() => document.getElementById('legacyBanner').hidden, undefined, { timeout: 45000 });
    const restored = await officePage.evaluate(code => practices.find(p => p.id === code), testCode);
    migratedUid = restored._uid;
    assert.equal(restored._uid, legacy._uid);
    assert.equal(restored.agent, 'Dobrea Adrian');
    assert.equal(await officePage.evaluate(() => practices.length), 1);
    assert.equal(await officePage.evaluate(() => JSON.parse(localStorage.getItem('pw_provvigioni_v1')).length), 1);
    assert.equal(await officePage.evaluate(uid => calculate(practices.find(p => p._uid === uid)).commission, migratedUid), 2345);
    console.log('PASS: Ufficio recovers existing local data without removing the original');

    const adrian = await context({ width: 390, height: 844 });
    await login(adrian, credentials.find(a => a.username === 'dobrea.adrian'));
    assert.equal(await adrian.evaluate(() => practices.length), 1);
    assert(!(await adrian.locator('#accountsNav').isVisible()));
    await adrian.click('[data-tab="pratiche"]');
    await adrian.getByRole('button', { name: 'Modifica', exact: true }).click();
    assert(await adrian.locator('#fAgent').isDisabled());
    await adrian.fill('#fClose', '9000');
    await adrian.selectOption('#fDiscount', '20');
    const displayedCommission = await adrian.locator('#cCommission').innerText();
    assert.equal(Number(displayedCommission.replace(/[^0-9,]/g, '').replace(',', '.')), 1800);
    await adrian.click('#saveBtn');
    await adrian.waitForFunction(() => document.getElementById('globalNotice').textContent === 'Pratica salvata online.', undefined, { timeout: 45000 });
    await online(officePage);
    assert.equal(await officePage.evaluate(uid => calculate(practices.find(p => p._uid === uid)).commission, migratedUid), 1800);
    await adrian.screenshot({ path: path.join(scratch, 'agent-mobile-preview.png'), fullPage: true });
    const viewportOverflow = await adrian.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert(!viewportOverflow);
    console.log('PASS: Agent edits own data; original formula and mobile layout work');

    const other = await context({ width: 1280, height: 800 });
    await login(other, credentials.find(a => a.username === 'aldrovandi.massimiliano'));
    assert.equal(await other.evaluate(() => practices.length), 0);
    await other.click('[data-tab="regole"]');
    assert(await other.locator('#rulesBody input').first().isDisabled());
    assert(!(await other.locator('#saveRulesBtn').isVisible()));
    const tarcisio = await context({ width: 390, height: 844 });
    await login(tarcisio, credentials.find(a => a.username === 'tarcisio.dellerba'));
    assert.equal(await tarcisio.evaluate(() => practices.length), 0);
    assert((await tarcisio.locator('#accountLabel').innerText()).includes('Agente di prova'));
    console.log('PASS: Other agents see no colleague practices; agent rules are read-only');

    await officePage.click('[data-tab="pratiche"]');
    const downloadPromise = officePage.waitForEvent('download');
    await officePage.click('#backupBtn');
    const download = await downloadPromise;
    const file = path.join(scratch, 'ui-test-backup.json');
    await download.saveAs(file);
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(backup.practices.length, 1);
    assert.equal(backup.practices[0]._uid, migratedUid);
    await officePage.locator('#restoreInput').setInputFiles(file);
    await officePage.waitForFunction(() => document.getElementById('globalNotice').textContent === 'Backup importato.', undefined, { timeout: 45000 });
    assert.equal(await officePage.evaluate(() => practices.length), 1);
    console.log('PASS: Backup export/import keeps the existing online record');

    await officePage.click('#accountsNav');
    await officePage.fill('#newAccountName', 'Verifica grafica temporanea');
    await officePage.fill('#newAccountUsername', 'qa.ui.' + suffix);
    await officePage.click('#createAccountButton');
    await officePage.waitForFunction(() => document.getElementById('credentialsDialog').open, undefined, { timeout: 45000 });
    const qaUsername = await officePage.locator('#credentialsUsername').innerText();
    const qaPassword = await officePage.locator('#credentialsPassword').innerText();
    temporaryAccount = await officePage.evaluate(name => accounts.find(a => a.username === name), qaUsername);
    await officePage.click('#closeCredentials');
    const qaPage = await context({ width: 390, height: 844 });
    await login(qaPage, { username: qaUsername, password: qaPassword });
    await qaPage.click('#changePasswordButton');
    const newPassword = 'PW-UiTest-' + suffix + '!72';
    await qaPage.fill('#newPassword', newPassword);
    await qaPage.fill('#confirmPassword', newPassword);
    await qaPage.click('#savePasswordButton');
    await qaPage.waitForFunction(() => !document.getElementById('loginPanel').hidden, undefined, { timeout: 45000 });
    await login(qaPage, { username: qaUsername, password: newPassword });
    const qaRow = officePage.locator('#accountsBody tr').filter({ hasText: qaUsername });
    await qaRow.getByRole('button', { name: 'Nuova password', exact: true }).click();
    await officePage.waitForFunction(() => document.getElementById('credentialsDialog').open, undefined, { timeout: 45000 });
    assert.equal(await officePage.locator('#credentialsUsername').innerText(), qaUsername);
    assert.notEqual(await officePage.locator('#credentialsPassword').innerText(), newPassword);
    await officePage.click('#closeCredentials');
    await qaRow.getByRole('button', { name: 'Elimina accesso', exact: true }).click();
    await officePage.waitForFunction(name => !accounts.some(a => a.username === name && a.active), qaUsername, { timeout: 45000 });
    console.log('PASS: Ufficio creates/resets/deletes access; personal password change works');
    console.log('Temporary inactive UI account for metadata cleanup:', temporaryAccount.id);

    await officePage.screenshot({ path: path.join(scratch, 'accounts-preview.png'), fullPage: true });
    assert.deepEqual(pageErrors, []);
    console.log('PASS: No browser errors');
  } finally {
    if (officePage && await officePage.evaluate(() => !!account).catch(() => false)) {
      if (migratedUid) await officePage.evaluate(uid => Auth.db('provvigioni_practices?uid=eq.' + uid, { method: 'DELETE' }), migratedUid);
      if (temporaryAccount) {
        const live = await officePage.evaluate(id => Auth.db('provvigioni_accounts?select=*&id=eq.' + id), temporaryAccount.id);
        if (live[0]?.active) await officePage.evaluate(id => Auth.admin({ action: 'delete', account_id: id }), temporaryAccount.id);
      }
    }
    for (const c of contexts) {
      const page = c.pages()[0];
      if (page) await page.evaluate(() => Auth.logout()).catch(() => {});
    }
    await browser.close();
  }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
